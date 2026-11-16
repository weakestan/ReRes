/*
 * ReRes 浏览器内端到端验证（Node 22+）
 * ------------------------------------------------------------------
 * 真的启动一个 Headless Chrome、真的加载本扩展、真的发请求，
 * 验证「规则 → DNR 动态规则 → 请求被重定向到目标地址」整条链路。
 *
 * 用法：
 *   set CHROME_PATH=C:\Program Files\Google\Chrome\Application\chrome.exe
 *   node test\e2e.js
 *
 * 说明：
 *   - Chrome 137+ 已移除 --load-extension，这里改用 DevTools 协议的
 *     Extensions.loadUnpacked（需要 --enable-unsafe-extension-debugging）
 *   - 页面与目标都在 127.0.0.1，属于同一地址空间，不涉及 LNA
 *   - 通过：退出码 0；失败：退出码 1
 */
'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('http');
const { spawn } = require('child_process');

const ROOT = path.resolve(__dirname, '..');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function findChrome() {
    const candidates = [
        process.env.CHROME_PATH,
        'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
        'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
        path.join(process.env.LOCALAPPDATA || '', 'Google\\Chrome\\Application\\chrome.exe'),
        'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
        'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe'
    ].filter(Boolean);
    for (const file of candidates) {
        if (fs.existsSync(file)) {
            return file;
        }
    }
    throw new Error('找不到 Chrome / Edge，请设置环境变量 CHROME_PATH');
}

function startServer(handler) {
    return new Promise((resolve) => {
        const server = http.createServer(handler);
        server.listen(0, '127.0.0.1', () => {
            resolve({ server, port: server.address().port });
        });
    });
}

class CDP {
    constructor(ws) {
        this.ws = ws;
        this.nextId = 0;
        this.pending = new Map();
        this.events = [];
        ws.addEventListener('message', (event) => {
            const msg = JSON.parse(event.data);
            if (msg.id && this.pending.has(msg.id)) {
                const { resolve, reject } = this.pending.get(msg.id);
                this.pending.delete(msg.id);
                if (msg.error) {
                    reject(new Error(JSON.stringify(msg.error)));
                } else {
                    resolve(msg.result);
                }
            } else if (msg.method) {
                this.events.push(msg);
            }
        });
    }

    static connect(url) {
        return new Promise((resolve, reject) => {
            const ws = new WebSocket(url);
            ws.addEventListener('open', () => resolve(new CDP(ws)));
            ws.addEventListener('error', () => reject(new Error('无法连接 DevTools: ' + url)));
        });
    }

    send(method, params) {
        const id = ++this.nextId;
        return new Promise((resolve, reject) => {
            this.pending.set(id, { resolve, reject });
            this.ws.send(JSON.stringify({ id, method, params: params || {} }));
        });
    }

    async eval(expression) {
        const result = await this.send('Runtime.evaluate', {
            expression,
            awaitPromise: true,
            returnByValue: true
        });
        if (result.exceptionDetails) {
            throw new Error('页面内执行失败: ' + JSON.stringify(result.exceptionDetails));
        }
        return result.result ? result.result.value : undefined;
    }

    close() {
        try {
            this.ws.close();
        } catch (e) {
            // 忽略关闭错误
        }
    }
}

async function waitFor(fn, timeoutMs, label) {
    const deadline = Date.now() + timeoutMs;
    let lastError = null;
    while (Date.now() < deadline) {
        try {
            const value = await fn();
            if (value) {
                return value;
            }
        } catch (e) {
            lastError = e;
        }
        await sleep(200);
    }
    throw new Error('等待超时：' + label + (lastError ? '（' + lastError.message + '）' : ''));
}

let passed = 0;
let failed = 0;
function check(name, ok) {
    if (ok) {
        passed++;
        console.log('PASS  ' + name);
    } else {
        failed++;
        console.log('FAIL  ' + name);
    }
}

async function main() {
    const chromePath = findChrome();
    console.log('Chrome: ' + chromePath);

    let cdn, target, page, browser, chrome;
    const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'reres-e2e-'));

    try {
        /* ---------- 三台本地服务 ---------- */
        cdn = await startServer((req, res) => {
            if (req.url.startsWith('/static/app.js')) {
                res.writeHead(200, { 'Content-Type': 'text/javascript; charset=utf-8' });
                res.end("window.__SOURCE = 'cdn';");
                return;
            }
            res.writeHead(404);
            res.end('not found');
        });
        target = await startServer((req, res) => {
            if (req.url.startsWith('/static/app.js')) {
                res.writeHead(200, { 'Content-Type': 'text/javascript; charset=utf-8' });
                res.end("window.__SOURCE = 'target';");
                return;
            }
            res.writeHead(404);
            res.end('not found');
        });
        page = await startServer((req, res) => {
            res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
            res.end('<!doctype html><meta charset="utf-8"><title>e2e</title>' +
                '<script src="http://127.0.0.1:' + cdn.port + '/static/app.js"></script>');
        });

        /* ---------- 启动 Headless Chrome ---------- */
        chrome = spawn(chromePath, [
            '--headless=new',
            '--user-data-dir=' + profile,
            '--remote-debugging-port=0',
            '--enable-unsafe-extension-debugging',
            '--no-first-run',
            '--no-default-browser-check',
            '--disable-gpu',
            '--no-sandbox',
            'about:blank'
        ], { stdio: 'ignore' });

        const activePortFile = path.join(profile, 'DevToolsActivePort');
        const devtoolsPort = await waitFor(() => {
            if (!fs.existsSync(activePortFile)) {
                return null;
            }
            const lines = fs.readFileSync(activePortFile, 'utf8').split(/\r?\n/);
            return lines[0] ? Number(lines[0]) : null;
        }, 30000, 'Chrome 启动（DevToolsActivePort）');

        const wsPath = fs.readFileSync(activePortFile, 'utf8').split(/\r?\n/)[1];
        browser = await CDP.connect('ws://127.0.0.1:' + devtoolsPort + wsPath);

        /* ---------- 加载扩展 ---------- */
        let extensionId = null;
        try {
            const loaded = await browser.send('Extensions.loadUnpacked', { path: ROOT });
            extensionId = loaded.id;
        } catch (e) {
            throw new Error('Extensions.loadUnpacked 失败，请确认 Chrome >= 125 且支持 ' +
                '--enable-unsafe-extension-debugging：' + e.message);
        }
        console.log('扩展 ID: ' + extensionId);

        const serviceWorker = await waitFor(async () => {
            const targets = await (await fetch('http://127.0.0.1:' + devtoolsPort + '/json/list')).json();
            return targets.find((t) => t.type === 'service_worker' && t.url.includes(extensionId)) || null;
        }, 20000, '扩展 Service Worker');

        const sw = await CDP.connect(serviceWorker.webSocketDebuggerUrl);
        await sw.send('Runtime.enable');
        const rule = {
            req: '^http://127\\.0\\.0\\.1:' + cdn.port + '/static/',
            res: 'http://127.0.0.1:' + target.port + '/static/',
            group: 'e2e',
            checked: true
        };
        await sw.eval('chrome.storage.local.set({ReResMap: ' + JSON.stringify([rule]) + '}).then(() => true)');

        const dynamicRules = await waitFor(async () => {
            const raw = await sw.eval('chrome.declarativeNetRequest.getDynamicRules().then((r) => JSON.stringify(r))');
            const rules = JSON.parse(raw);
            return rules.length === 1 ? rules : null;
        }, 15000, 'DNR 动态规则写入');

        check('动态规则已注册（1 条）', dynamicRules.length === 1);
        check('规则使用 regexSubstitution',
            dynamicRules[0].action.redirect.regexSubstitution === 'http://127.0.0.1:' + target.port + '/static/');

        /* ---------- 打开页面，验证真的加载到目标资源 ---------- */
        const created = await browser.send('Target.createTarget', { url: 'about:blank' });
        const pageTarget = await waitFor(async () => {
            const targets = await (await fetch('http://127.0.0.1:' + devtoolsPort + '/json/list')).json();
            return targets.find((t) => t.id === created.targetId) || null;
        }, 10000, '页面 target');

        const tab = await CDP.connect(pageTarget.webSocketDebuggerUrl);
        await tab.send('Page.enable');
        await tab.send('Runtime.enable');
        await tab.send('Page.navigate', { url: 'http://127.0.0.1:' + page.port + '/index.html' });

        const source = await waitFor(async () => {
            const value = await tab.eval('window.__SOURCE || null');
            return value || null;
        }, 15000, '页面脚本加载');

        check('请求被重定向到目标资源', source === 'target');

        tab.close();
        sw.close();
    } finally {
        try { if (browser) browser.close(); } catch (e) { }
        try { if (chrome) chrome.kill(); } catch (e) { }
        for (const item of [cdn, target, page]) {
            try { if (item) item.server.close(); } catch (e) { }
        }
        try { fs.rmSync(profile, { recursive: true, force: true }); } catch (e) { }
    }

    console.log('');
    console.log('passed = ' + passed + ', failed = ' + failed);
    process.exit(failed === 0 ? 0 : 1);
}

main().catch((e) => {
    console.error('ERROR ' + (e && e.message ? e.message : e));
    process.exit(1);
});
