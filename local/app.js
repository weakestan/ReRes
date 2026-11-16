/*
 * ReRes 内置示例文件
 * ------------------------------------------------------------------
 * 把文件放在扩展目录的 local/ 下，规则里的 Response 写成
 * file:///local/文件名 即可命中本文件。
 *
 * 这条路径由 declarativeNetRequest 的 extensionPath 实现，走的是
 * chrome-extension:// 内部资源，不经过网络栈，因此不受 Chrome 142+
 * 的本地网络访问（LNA）限制，也不受混合内容限制。
 *
 * 改完文件后，需要到 chrome://extensions 点一次「重新加载」。
 */
(function () {
    'use strict';
    if (typeof window !== 'undefined') {
        window.__RERES_LOCAL_FILE__ = true;
    }
    if (typeof console !== 'undefined' && console.info) {
        console.info('[ReRes] 已由扩展内置文件 local/app.js 提供响应。');
    }
})();
