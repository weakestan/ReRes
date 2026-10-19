/*
 * ReRes 规则编译引擎
 * ------------------------------------------------------------------
 * MV3 中 chrome.webRequest 的 blocking 能力只对策略强制安装的扩展开放，
 * 普通扩展要改写请求只能使用 declarativeNetRequest（DNR）。
 *
 * 本文件负责把 ReRes 原有的「JS 正则 + 替换串」规则编译成 DNR 动态规则，
 * 同时把两类无法直接表达的写法识别出来，给出可读的错误提示。
 */
(function (root) {
    'use strict';

    var STORAGE_KEY = 'ReResMap';
    var DIAG_KEY = 'ReResDiagnostics';
    var MAX_REGEX_LENGTH = 2000;

    /* RE2（DNR 使用的正则引擎）不支持、但 JS 支持的语法 */
    var UNSUPPORTED_PATTERNS = [
        { re: /\(\?<=/, msg: '不支持后行断言 (?<=...)' },
        { re: /\(\?<!/, msg: '不支持后行断言 (?<!...)' },
        { re: /\(\?=/, msg: '不支持先行断言 (?=...)' },
        { re: /\(\?!/, msg: '不支持先行断言 (?!...)' },
        { re: /\(\?<([A-Za-z_$][\w$]*)>/, msg: '不支持 JS 命名捕获组 (?<name>...)，可改用普通捕获组 (...)' },
        { re: /\\k</, msg: '不支持命名反向引用 \\k<name>' },
        { re: /(^|[^\\])\\[1-9]/, msg: '不支持反向引用 \\1 ~ \\9（DNR 规则里它表示替换串而不是匹配）' },
        { re: /\(\?>/, msg: '不支持原子分组 (?>...)' },
        { re: /\(\?#/, msg: '不支持注释分组 (?#...)' }
    ];

    /**
     * 校验用户输入的 JS 正则能否在 DNR/RE2 下工作。
     * @returns {string|null} 错误信息，null 表示通过
     */
    function checkPattern(pattern) {
        if (typeof pattern !== 'string' || !pattern.length) {
            return 'If URL match 不能为空';
        }
        try {
            new RegExp(pattern, 'i');
        } catch (e) {
            return '正则语法错误：' + (e && e.message ? e.message : e);
        }
        if (pattern.length > MAX_REGEX_LENGTH) {
            return '正则过长，DNR 限制最多 ' + MAX_REGEX_LENGTH + ' 个字符';
        }
        for (var i = 0; i < UNSUPPORTED_PATTERNS.length; i++) {
            if (UNSUPPORTED_PATTERNS[i].re.test(pattern)) {
                return UNSUPPORTED_PATTERNS[i].msg;
            }
        }
        return null;
    }

    /**
     * JS 的 String.prototype.replace 替换串 -> DNR 的 regexSubstitution。
     *   $$      -> $
     *   $&      -> \0（整个匹配）
     *   $1..$9  -> \1..\9（捕获组）
     *   $`  $'  -> 无法表达，直接报错
     */
    function toSubstitution(res) {
        var out = '';
        for (var i = 0; i < res.length; i++) {
            var c = res.charAt(i);
            var next = res.charAt(i + 1);
            if (c === '$' && next) {
                if (next === '$') { out += '$'; i++; continue; }
                if (next === '&') { out += '\\0'; i++; continue; }
                if (next >= '1' && next <= '9') {
                    var after = res.charAt(i + 2);
                    if (after >= '0' && after <= '9') {
                        throw new Error('只支持 $1 ~ $9 形式的捕获组引用，$' + next + after + ' 无法转换');
                    }
                    out += '\\' + next;
                    i++;
                    continue;
                }
                if (next === '`' || next === "'") {
                    throw new Error('替换串不支持 $` 和 $\'（DNR 无对应语法）');
                }
            }
            out += c;
        }
        return out;
    }

    /**
     * 判断 Response 指向的目标类型。
     *  - url       : http/https/ftp，直接重定向
     *  - extension : 扩展包内的 local/ 目录，用 extensionPath 重定向
     *  - blocked   : MV3 无法表达，返回原因
     */
    function classifyTarget(res) {
        if (typeof res !== 'string' || !res.length) {
            return { kind: 'blocked', message: 'Response 不能为空' };
        }
        if (/^(https?|ftp):\/\//i.test(res)) {
            return { kind: 'url' };
        }
        if (/^file:\/\//i.test(res) || /^chrome-extension:\/\//i.test(res)) {
            var path = res
                .replace(/^file:\/\//i, '')
                .replace(/^chrome-extension:\/\/[^/]+/i, '');
            if (path.charAt(0) !== '/') {
                path = '/' + path;
            }
            if (path.indexOf('/local/') === 0) {
                return { kind: 'extension', path: path };
            }
            return {
                kind: 'blocked',
                message: 'Manifest V3 禁止扩展把请求重定向到 file:// 路径。请改用：① 本地 HTTP 服务（如 http://127.0.0.1:5500/app.js）；② 把文件放进扩展的 local/ 目录后用 file:///local/app.js'
            };
        }
        return {
            kind: 'blocked',
            message: 'Response 必须以 http://、https:// 或 file:///local/ 开头'
        };
    }

    /**
     * 判断重定向目标是否落在私有地址空间（localhost / 内网 IP）。
     * 这类目标本身是合法的，但页面若来自公网 http，Chrome 的
     * Private Network Access 会在请求发出前拦截，且扩展无法绕过，
     * 所以编译阶段就给出提示，省得用户对着 CORS 报错排查半天。
     */
    function isPrivateTarget(res) {
        var m = /^(?:https?|ftp):\/\/([^/?#]+)/i.exec(res || '');
        if (!m) {
            return false;
        }
        var host = m[1].replace(/^[^@]*@/, '').replace(/:\d+$/, '').toLowerCase();
        if (host === 'localhost' || host === '127.0.0.1' || host === '::1' || host === '[::1]') {
            return true;
        }
        if (/^10\./.test(host) || /^192\.168\./.test(host) || /^169\.254\./.test(host)) {
            return true;
        }
        return /^172\.(1[6-9]|2\d|3[01])\./.test(host);
    }

    /**
     * 把 ReRes 规则数组编译成 DNR 规则数组。
     * @param {Array} maps 规则数组（{req, res, checked, group}）
     * @returns {{rules: Array, errors: Array, warnings: Array}}
     */
    function compile(maps) {
        var rules = [];
        var errors = [];
        var warnings = [];
        var id = 0;

        if (!Array.isArray(maps)) {
            return { rules: rules, errors: errors, warnings: warnings };
        }

        maps.forEach(function (rule, index) {
            if (!rule || rule.checked !== true) {
                return;
            }
            if (typeof rule.req !== 'string' || typeof rule.res !== 'string') {
                errors.push({ index: index, req: rule.req, res: rule.res, message: '规则缺少 req 或 res 字段' });
                return;
            }

            var patternError = checkPattern(rule.req);
            if (patternError) {
                errors.push({ index: index, req: rule.req, res: rule.res, message: patternError });
                return;
            }

            var target = classifyTarget(rule.res);
            if (target.kind === 'blocked') {
                errors.push({ index: index, req: rule.req, res: rule.res, message: target.message });
                return;
            }

            var redirect;
            if (target.kind === 'extension') {
                redirect = { extensionPath: target.path };
            } else {
                var substitution;
                try {
                    substitution = toSubstitution(rule.res);
                } catch (e) {
                    errors.push({ index: index, req: rule.req, res: rule.res, message: e.message });
                    return;
                }
                // 必须用 regexSubstitution：它的语义是「只替换正则命中的那一段」，
                // 与旧版 url.replace(reg, res) 一致；静态 url 会把整条 URL 换掉，
                // 目录映射（^https://cdn/static/ -> http://localhost:5500/）会丢失剩余路径。
                redirect = { regexSubstitution: substitution };

                if (isPrivateTarget(rule.res)) {
                    warnings.push({
                        index: index,
                        req: rule.req,
                        res: rule.res,
                        message: 'Response 指向内网/本机地址。若发起页面是公网 http 页面，Chrome 的 Private Network Access 会在请求发出前拦截（报 "not a secure context ... more-private address space"），扩展无法绕过：可给 Chrome 加启动参数 --unsafely-treat-insecure-origin-as-secure=http://发起页域名，或在服务端做同源反向代理。'
                    });
                }
            }

            rules.push({
                id: ++id,
                priority: 1,
                action: { type: 'redirect', redirect: redirect },
                condition: {
                    regexFilter: rule.req,
                    isUrlFilterCaseSensitive: false
                }
            });
        });

        return { rules: rules, errors: errors, warnings: warnings };
    }

    /**
     * 给 options 页面用的“预演”。
     * 注意：DNR 对同一个请求只会应用一条规则（优先级最高，同优先级取 id 最小），
     * 所以这里也只套用第一条命中的规则，但会把所有命中的规则都报出来，
     * 避免用户按旧版「链式替换」的直觉写出实际不生效的配置。
     */
    function preview(maps, url) {
        var result = url;
        var hits = [];
        var applied = -1;
        (maps || []).forEach(function (rule, index) {
            if (!rule || rule.checked !== true || typeof rule.req !== 'string' || typeof rule.res !== 'string') {
                return;
            }
            var reg;
            try {
                reg = new RegExp(rule.req, 'i');
            } catch (e) {
                return;
            }
            if (!reg.test(url)) {
                return;
            }
            hits.push(index);
            if (applied < 0) {
                applied = index;
                result = url.replace(new RegExp(rule.req, 'gi'), rule.res);
            }
        });
        return { url: result, hits: hits, applied: applied };
    }

    var api = {
        STORAGE_KEY: STORAGE_KEY,
        DIAG_KEY: DIAG_KEY,
        checkPattern: checkPattern,
        toSubstitution: toSubstitution,
        classifyTarget: classifyTarget,
        isPrivateTarget: isPrivateTarget,
        compile: compile,
        preview: preview
    };

    if (typeof module !== 'undefined' && module.exports) {
        module.exports = api;
    }
    root.ReResEngine = api;
})(typeof self !== 'undefined' ? self : this);
