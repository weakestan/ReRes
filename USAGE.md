# ReRes 简要使用说明 / Quick Start

完整文档见 [README.md](README.md)。以下只讲最短路径。
Full documentation is in [README.md](README.md) (Chinese). This page is a short bilingual guide.

---

## 简体中文

### 1. 安装

1. 下载或克隆本仓库
2. 打开 `chrome://extensions`，开启右上角「开发者模式」
3. 点「加载已解压的扩展程序」，选择仓库根目录（含 `manifest.json` 的那一层）
4. 扩展卡片没有红色「错误」按钮即安装成功

### 2. 添加一条规则

点扩展图标 →「管理规则」→「添加规则」：

| 字段 | 填什么 |
| --- | --- |
| If URL match | JS 正则，不要写首尾的 `/` 和 `/gi` |
| Response | 目标地址，或扩展内置文件 `file:///local/文件名` |
| Group | 可选，仅用于分组显示 |

示例：把线上 CDN 目录映射到本地服务

```
If URL match:  ^https?://cdn\.example\.com/static/
Response:      http://127.0.0.1:5500/static/
```

规则立即生效。`Response` **只替换 URL 中被正则命中的那一段**，其余路径保留：

```
https://cdn.example.com/static/js/app.js?v=2
→ http://127.0.0.1:5500/static/js/app.js?v=2
```

### 3. Chrome 142+ 必看：本地网络访问限制（LNA）

公网页面请求 `127.0.0.1` / 内网地址时，规则会生效，但请求会被 Chrome 拦掉，
控制台报 `more-private address space` 或 `Permission was denied ... loopback`。
诊断面板会给出黄色提示。任选一种解决：

**A. 启动参数（最简单，http / https 页面都有效）**

```
--disable-features=LocalNetworkAccessChecks
```

加到 Chrome 快捷方式的「目标」末尾、命令行，或启动器的自定义参数里。

**B. 策略白名单（按来源放行）**

```bat
reg add "HKCU\Software\Policies\Google\Chrome\LocalNetworkAccessAllowedForUrls" /v 1 /t REG_SZ /d "https://dev.example.com" /f
```

或使用仓库脚本：

```
powershell -ExecutionPolicy Bypass -File tools\apply-lna-policy.ps1 -Origin https://dev.example.com
```

发起页是 `http://` 时，还要同时加 `--unsafely-treat-insecure-origin-as-secure=<发起页来源>`。

**C. 不改浏览器设置**

把文件放进扩展目录的 `local/`，规则写成 `file:///local/app.js`。
该路径走扩展内部资源，不受 LNA 限制（改文件后需重载扩展）。

> 改完启动参数或策略后，必须完全退出 Chrome（含后台进程）再启动。

### 4. 怎么确认生效

- 扩展弹窗：显示「已生效 N 条重定向规则」
- 管理规则页「诊断」：列出注册失败的规则和原因
- 页面 DevTools → Network：请求地址应变成 `Response` 里的目标地址

### 5. 常见限制

- 一个请求只应用一条规则（优先级最高 / 列表第一条）
- 正则引擎是 RE2：不支持 `(?=)`、`(?!)`、`(?<=)`、反向引用 `\1`
- 不能重定向到 `file:///D:/...`，请用本地 HTTP 服务或 `file:///local/...`

---

## English

### 1. Install

1. Download or clone this repository
2. Open `chrome://extensions` and enable **Developer mode**
3. Click **Load unpacked** and select the repository root (the folder containing `manifest.json`)
4. No red **Errors** button on the extension card means it is installed

### 2. Add a rule

Click the extension icon → **Manage rules** → **Add rule**:

| Field | Value |
| --- | --- |
| If URL match | JavaScript regex, without leading/trailing `/` and flags |
| Response | Target URL, or an extension-local file `file:///local/file.js` |
| Group | Optional, only used for grouping |

Example: map a CDN directory to a local dev server

```
If URL match:  ^https?://cdn\.example\.com/static/
Response:      http://127.0.0.1:5500/static/
```

Rules take effect immediately. `Response` **replaces only the matched part** of the URL:

```
https://cdn.example.com/static/js/app.js?v=2
→ http://127.0.0.1:5500/static/js/app.js?v=2
```

### 3. Chrome 142+ : Local Network Access (LNA)

When a public page requests `127.0.0.1` or a private-network address, the redirect is applied
but Chrome blocks the request (console: `more-private address space` or
`Permission was denied ... loopback`). The Diagnostics panel shows a yellow hint. Pick one fix:

**A. Launch flag (simplest, works for http and https pages)**

```
--disable-features=LocalNetworkAccessChecks
```

Append it to the Chrome shortcut target, a command line, or your launcher's custom arguments.

**B. Policy allow-list (per origin)**

```bat
reg add "HKCU\Software\Policies\Google\Chrome\LocalNetworkAccessAllowedForUrls" /v 1 /t REG_SZ /d "https://dev.example.com" /f
```

Or use the bundled script:

```
powershell -ExecutionPolicy Bypass -File tools\apply-lna-policy.ps1 -Origin https://dev.example.com
```

If the page origin is `http://`, also add `--unsafely-treat-insecure-origin-as-secure=<origin>`.

**C. Don't touch browser settings**

Copy the file into the extension's `local/` folder and use `file:///local/app.js`.
That path is served from the extension itself and is not affected by LNA
(reload the extension after changing the file).

> Fully quit Chrome (including background processes) and start it again for flags/policies to apply.

### 4. Verify

- Extension popup: shows how many redirect rules are active
- Options page → Diagnostics: rejected rules and reasons
- DevTools → Network: request URL should be the `Response` target

### 5. Known limits

- One rule per request (highest priority / first match wins)
- RE2 regex engine: no `(?=)`, `(?!)`, `(?<=)`, no back-references `\1`
- No redirect to `file:///D:/...`; use a local HTTP server or `file:///local/...`
