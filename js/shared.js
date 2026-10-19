/*
 * popup / options 共用的存储与 UI 小工具。
 * 旧版通过 chrome.extension.getBackgroundPage() 直接读写 background 的
 * localStorage，MV3 已经没有 background page，也没有 localStorage，
 * 统一改为 chrome.storage.local。
 */
(function (global) {
    'use strict';

    var STORAGE_KEY = 'ReResMap';
    var DIAG_KEY = 'ReResDiagnostics';

    function getMaps() {
        return chrome.storage.local.get(STORAGE_KEY).then(function (data) {
            return Array.isArray(data[STORAGE_KEY]) ? data[STORAGE_KEY] : [];
        });
    }

    function setMaps(maps) {
        var payload = {};
        payload[STORAGE_KEY] = maps;
        return chrome.storage.local.set(payload);
    }

    function getDiagnostics() {
        return chrome.storage.local.get(DIAG_KEY).then(function (data) {
            return data[DIAG_KEY] || null;
        });
    }

    /** 让 Service Worker 立刻重建 DNR 规则，并返回同步结果 */
    function sync() {
        return new Promise(function (resolve) {
            chrome.runtime.sendMessage({ type: 'reres:sync' }, function (result) {
                if (chrome.runtime.lastError) {
                    resolve(null);
                    return;
                }
                resolve(result || null);
            });
        });
    }

    /** 按 group 字段分组，保留原始顺序 */
    function groupBy(list) {
        var order = [];
        var buckets = {};
        (list || []).forEach(function (rule, index) {
            var key = (rule && typeof rule.group === 'string' && rule.group) ? rule.group : '未命名';
            if (!buckets[key]) {
                buckets[key] = [];
                order.push(key);
            }
            buckets[key].push({ rule: rule, index: index });
        });
        return order.map(function (key) {
            return { group: key, items: buckets[key] };
        });
    }

    function el(tag, className, text) {
        var node = document.createElement(tag);
        if (className) {
            node.className = className;
        }
        if (text !== undefined && text !== null) {
            node.textContent = String(text);
        }
        return node;
    }

    global.ReRes = {
        STORAGE_KEY: STORAGE_KEY,
        DIAG_KEY: DIAG_KEY,
        getMaps: getMaps,
        setMaps: setMaps,
        getDiagnostics: getDiagnostics,
        sync: sync,
        groupBy: groupBy,
        el: el
    };
})(window);
