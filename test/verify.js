/*
 * ReRes MV3 规则引擎验证脚本
 * 用法：cscript //nologo test\verify.js
 * 说明：本机没有 Node.js 时，用 Windows 脚本宿主 (JScript) 做语法与逻辑回归。
 */
(function () {
    if (!Array.prototype.forEach) {
        Array.prototype.forEach = function (fn) {
            for (var i = 0; i < this.length; i++) { fn(this[i], i, this); }
        };
    }
    if (!Array.isArray) {
        Array.isArray = function (o) { return Object.prototype.toString.call(o) === '[object Array]'; };
    }
    if (!String.prototype.trim) {
        String.prototype.trim = function () { return this.replace(/^\s+|\s+$/g, ''); };
    }

    var ROOT = 'D:\\CodeBuddyData\\Reres\\ReRes-mv3\\';

    function readUtf8(path) {
        var stream = new ActiveXObject('ADODB.Stream');
        stream.Type = 2;
        stream.Charset = 'utf-8';
        stream.Open();
        stream.LoadFromFile(path);
        var text = stream.ReadText();
        stream.Close();
        return text;
    }

    var passed = 0;
    var failed = 0;

    function check(name, condition) {
        if (condition) {
            passed++;
            WScript.Echo('PASS  ' + name);
        } else {
            failed++;
            WScript.Echo('FAIL  ' + name);
        }
    }

    function syntax(name, file) {
        try {
            // JScript 5.8 是 ES3，不允许把保留字 catch 当作属性名；
            // 仅为了做语法探测，把 .catch( 临时替换为 .then(。
            var probe = readUtf8(ROOT + file).replace(/\.catch\(/g, '.then(');
            new Function(probe);
            check('syntax: ' + file, true);
        } catch (e) {
            check('syntax: ' + file + ' -> ' + e.message, false);
        }
    }

    /* ---------- 语法检查 ---------- */
    syntax('background', 'background.js');
    syntax('popup', 'js\\popup.js');
    syntax('options', 'js\\options.js');
    syntax('shared', 'js\\shared.js');
    syntax('rule-engine', 'js\\rule-engine.js');

    /* ---------- 加载规则引擎 ---------- */
    eval(readUtf8(ROOT + 'js\\rule-engine.js'));
    var E = ReResEngine;
    check('engine loaded', !!E && typeof E.compile === 'function');

    /* ---------- 1. 目录映射到本地 HTTP 服务 ---------- */
    var r1 = E.compile([{
        req: '^https?://cdn\\.example\\.com/static/',
        res: 'http://127.0.0.1:5500/static/',
        checked: true
    }]);
    check('url map: 1 rule', r1.rules.length === 1 && r1.errors.length === 0);
    check('url map: regexSubstitution', r1.rules[0].action.redirect.regexSubstitution === 'http://127.0.0.1:5500/static/');
    check('url map: regexFilter kept', r1.rules[0].condition.regexFilter === '^https?://cdn\\.example\\.com/static/');
    check('url map: case insensitive', r1.rules[0].condition.isUrlFilterCaseSensitive === false);
    check('url map: redirect action', r1.rules[0].action.type === 'redirect');

    /* ---------- 2. 捕获组 $1 -> \1 ---------- */
    var r2 = E.compile([{ req: '^https://old\\.com/(.*)$', res: 'https://new.com/$1', checked: true }]);
    check('capture group -> \\1', r2.rules.length === 1 &&
        r2.rules[0].action.redirect.regexSubstitution === 'https://new.com/\\1');

    /* ---------- 3. $& -> \0 ---------- */
    var r3 = E.compile([{ req: 'a\\.js', res: 'https://x/$&', checked: true }]);
    check('$& -> \\0', r3.rules.length === 1 &&
        r3.rules[0].action.redirect.regexSubstitution === 'https://x/\\0');

    /* ---------- 4. file:///D:/... 必须被拒绝 ---------- */
    var r4 = E.compile([{ req: '^https://a/b\\.js$', res: 'file:///D:/proj/b.js', checked: true }]);
    check('file url rejected', r4.rules.length === 0 && r4.errors.length === 1);

    /* ---------- 5. file:///local/ -> extensionPath ---------- */
    var r5 = E.compile([{ req: '^https://a/b\\.js$', res: 'file:///local/b.js', checked: true }]);
    check('extensionPath', r5.rules.length === 1 &&
        r5.rules[0].action.redirect.extensionPath === '/local/b.js');

    /* ---------- 6. 未启用规则被跳过 ---------- */
    var r6 = E.compile([{ req: 'a', res: 'http://b.com', checked: false }]);
    check('disabled rule skipped', r6.rules.length === 0 && r6.errors.length === 0);

    /* ---------- 7. 不支持的断言语法 ---------- */
    var r7 = E.compile([{ req: 'https://a/(?=b)', res: 'http://c.com', checked: true }]);
    check('lookahead rejected', r7.rules.length === 0 && r7.errors.length === 1);

    /* ---------- 8. 非法正则 ---------- */
    var r8 = E.compile([{ req: 'https://a/(', res: 'http://c.com', checked: true }]);
    check('invalid regex rejected', r8.rules.length === 0 && r8.errors.length === 1);

    /* ---------- 9. $10 无法转换 ---------- */
    var r9 = E.compile([{ req: 'a', res: 'http://c.com/$10', checked: true }]);
    check('$10 rejected', r9.rules.length === 0 && r9.errors.length === 1);

    /* ---------- 10. 规则 id 自增且唯一 ---------- */
    var r10 = E.compile([
        { req: 'a', res: 'http://b.com', checked: true },
        { req: 'c', res: 'http://d.com', checked: true }
    ]);
    check('unique incremental ids', r10.rules.length === 2 &&
        r10.rules[0].id === 1 && r10.rules[1].id === 2);

    /* ---------- 11. 预演 ---------- */
    var p = E.preview(
        [{ req: '^https?://cdn\\.example\\.com/static/', res: 'http://127.0.0.1:5500/static/', checked: true }],
        'https://cdn.example.com/static/js/app.js'
    );
    check('preview rewrites url',
        p.url === 'http://127.0.0.1:5500/static/js/app.js' && p.hits.length === 1 && p.applied === 0);

    /* ---------- 11b. 多条规则命中时只应用第一条（与 DNR 行为一致） ---------- */
    var p2 = E.preview([
        { req: '^https?://cdn\\.example\\.com/static/', res: 'http://a.com/', checked: true },
        { req: '^https?://cdn\\.example\\.com/static/', res: 'http://b.com/', checked: true }
    ], 'https://cdn.example.com/static/app.js');
    check('preview applies first match only',
        p2.url === 'http://a.com/app.js' && p2.hits.length === 2 && p2.applied === 0);

    /* ---------- 11c. 内网目标给出 Private Network Access 提示 ---------- */
    var pw = E.compile([{ req: '^https?://a\\.com/x', res: 'http://192.168.1.100:8080/app.js', checked: true }]);
    check('private target warns about PNA', pw.rules.length === 1 && pw.warnings.length === 1);
    var pg = E.compile([{ req: '^https?://a\\.com/x', res: 'http://1.2.3.4/app.js', checked: true }]);
    check('public target has no warning', pg.rules.length === 1 && pg.warnings.length === 0);

    /* ---------- 12. 末尾斜杠与协议限制 ---------- */
    var r12 = E.compile([{ req: 'a', res: 'ftp://files.example.com/a.js', checked: true }]);
    check('ftp target accepted', r12.rules.length === 1 && r12.errors.length === 0);

    var r13 = E.compile([{ req: 'a', res: '/relative/path.js', checked: true }]);
    check('relative target rejected', r13.rules.length === 0 && r13.errors.length === 1);

    WScript.Echo('');
    WScript.Echo('passed = ' + passed + ', failed = ' + failed);
    WScript.Quit(failed === 0 ? 0 : 1);
})();
