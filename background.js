/*
 * ReRes Service Worker（Manifest V3）
 * ------------------------------------------------------------------
 * 旧版在这里用 chrome.webRequest + "blocking" 直接返回 redirectUrl，
 * MV3 已经不允许普通扩展这么做，改为把规则编译成 declarativeNetRequest
 * 动态规则（dynamic rules），由浏览器网络栈直接完成重定向。
 */
importScripts('js/rule-engine.js');

var STORAGE_KEY = ReResEngine.STORAGE_KEY;
var DIAG_KEY = ReResEngine.DIAG_KEY;
var MAX_DYNAMIC_RULES = 5000;

var syncing = null;
var dirty = false;

/* 首次安装写入示例规则（默认关闭，避免误伤线上请求） */
var DEFAULT_RULES = [
    {
        req: '^https?://cdn\\.example\\.com/static/',
        res: 'http://127.0.0.1:5500/static/',
        group: '示例',
        checked: false
    },
    {
        req: '^https?://www\\.example\\.com/js/app\\.js',
        res: 'file:///local/app.js',
        group: '示例',
        checked: false
    }
];

function readMaps() {
    return chrome.storage.local.get(STORAGE_KEY).then(function (data) {
        return Array.isArray(data[STORAGE_KEY]) ? data[STORAGE_KEY] : [];
    });
}

function getDiagnostics() {
    return chrome.storage.local.get(DIAG_KEY).then(function (data) {
        return data[DIAG_KEY] || null;
    });
}

function replaceDynamicRules(addRules, removeRuleIds) {
    return chrome.declarativeNetRequest.updateDynamicRules({
        removeRuleIds: removeRuleIds || [],
        addRules: addRules || []
    });
}

function doSync() {
    return readMaps().then(function (maps) {
        return chrome.declarativeNetRequest.getDynamicRules().then(function (existing) {
            var removeRuleIds = existing.map(function (r) { return r.id; });
            var compiled = ReResEngine.compile(maps);
            var errors = compiled.errors.slice();
            var applied = 0;

            if (compiled.rules.length > MAX_DYNAMIC_RULES) {
                errors.push({
                    index: -1,
                    message: '规则数超过 DNR 上限（' + MAX_DYNAMIC_RULES + ' 条），多余的规则未生效'
                });
                compiled.rules = compiled.rules.slice(0, MAX_DYNAMIC_RULES);
            }

            return replaceDynamicRules(compiled.rules, removeRuleIds)
                .then(function () {
                    applied = compiled.rules.length;
                    return null;
                })
                .catch(function (err) {
                    // 批量失败时逐条安装，把真正不合法的规则挑出来
                    return replaceDynamicRules([], removeRuleIds).then(function () {
                        return compiled.rules.reduce(function (chain, rule) {
                            return chain.then(function () {
                                return replaceDynamicRules([rule], [])
                                    .then(function () { applied++; })
                                    .catch(function (e) {
                                        errors.push({
                                            index: -1,
                                            req: rule.condition.regexFilter,
                                            res: rule.action.redirect.regexSubstitution ||
                                                rule.action.redirect.url ||
                                                rule.action.redirect.extensionPath,
                                            message: 'DNR 拒绝该规则：' + (e && e.message ? e.message : e) +
                                                '（原始错误：' + (err && err.message ? err.message : err) + '）'
                                        });
                                    });
                            });
                        }, Promise.resolve());
                    });
                })
                .then(function () {
                    var diag = {
                        at: Date.now(),
                        applied: applied,
                        total: compiled.rules.length,
                        enabled: maps.filter(function (r) { return r && r.checked === true; }).length,
                        errors: errors,
                        warnings: compiled.warnings
                    };
                    var payload = {};
                    payload[DIAG_KEY] = diag;
                    return chrome.storage.local.set(payload).then(function () {
                        return diag;
                    });
                });
        });
    });
}

function syncRules() {
    if (syncing) {
        // 同步进行中又来了一次变更：标记为脏，等当前这轮结束后再补一次，
        // 否则最后一次修改可能被丢掉（popup 连续保存时很常见）。
        dirty = true;
        return syncing;
    }
    syncing = doSync().catch(function (e) {
        return {
            at: Date.now(),
            applied: 0,
            total: 0,
            errors: [{ index: -1, message: '同步规则失败：' + (e && e.message ? e.message : e) }],
            warnings: []
        };
    }).then(function (result) {
        syncing = null;
        if (dirty) {
            dirty = false;
            return syncRules();
        }
        return result;
    });
    return syncing;
}

chrome.runtime.onInstalled.addListener(function (details) {
    if (details.reason === 'install') {
        chrome.storage.local.get(STORAGE_KEY).then(function (data) {
            if (!Array.isArray(data[STORAGE_KEY])) {
                var seed = {};
                seed[STORAGE_KEY] = DEFAULT_RULES;
                return chrome.storage.local.set(seed);
            }
        }).then(syncRules);
    } else {
        syncRules();
    }
});

chrome.runtime.onStartup.addListener(function () {
    syncRules();
});

chrome.storage.onChanged.addListener(function (changes, area) {
    if (area === 'local' && changes[STORAGE_KEY]) {
        syncRules();
    }
});

chrome.runtime.onMessage.addListener(function (message, sender, sendResponse) {
    if (!message || typeof message.type !== 'string') {
        return;
    }
    if (message.type === 'reres:sync') {
        syncRules().then(sendResponse);
        return true;
    }
    if (message.type === 'reres:state') {
        Promise.all([
            readMaps(),
            chrome.declarativeNetRequest.getDynamicRules(),
            getDiagnostics()
        ]).then(function (res) {
            sendResponse({ maps: res[0], dynamicRules: res[1], diagnostics: res[2] });
        });
        return true;
    }
    if (message.type === 'reres:preview') {
        sendResponse(ReResEngine.preview(message.maps || [], message.url || ''));
        return false;
    }
});

/*
 * 这里刻意不在 Service Worker 顶层调用 syncRules()：
 * DNR 动态规则由浏览器持久化保存，SW 被频繁唤醒时不必重建；
 * 规则变更会通过 storage.onChanged 触发，安装/启动由对应事件触发。
 */
