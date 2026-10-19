# ReRes

把线上页面的 CSS / JS / 图片请求重定向到本地开发服务器，在真实环境里调试本地代码。

当前版本 **2.0.0**，Manifest V3，要求 **Chrome 116+**。

> 上游项目 [annnhan/ReRes](https://github.com/annnhan/ReRes) 1.8.1 是 Manifest V2 版本。Chrome 已于 2025-07-24（Chrome 138）彻底停用 MV2，扩展无法再加载；本仓库是它的 MV3 重写版，**规则格式完全兼容**，旧配置可直接导入。

## 功能

- 正则匹配请求 URL，重定向到另一个 URL（单文件或整个目录）
- 支持 `$1`~`$9` 捕获组与 `$&` 整段引用
- 按分组管理规则，逐条启用/停用，扩展图标一键总开关
- 规则预演：填入一个 URL，立即看到会被哪条规则改写成什么
- 诊断面板：显示浏览器实际注册成功的规则数，以及被拒绝的规则和原因
- 规则导入 / 导出（`ReResSetting.json`），兼容 1.x 配置

## 安装

1. 下载本仓库（`git clone` 或右上角 Code → Download ZIP 后解压）
2. 打开 `chrome://extensions/`，开启右上角「开发者模式」
3. 点「加载已解压的扩展程序」，选择本仓库根目录（含 `manifest.json` 的那一层）
4. 加载后扩展卡片不应出现红色「错误」按钮

## 快速开始

假设线上页面引用了 `https://cdn.example.com/static/js/app.js`，而你在本地 `http://127.0.0.1:5500/static/js/app.js` 上调试：

1. 点扩展图标 →「管理规则」→「添加规则」
2. 填入：

   | 字段 | 值 |
   | --- | --- |
   | If URL match | `^https?://cdn\.example\.com/static/` |
   | Response | `http://127.0.0.1:5500/static/` |
   | Group | `demo`（可选） |

3. 打开线上页面，DevTools → Network，`app.js` 的请求地址应变成 `http://127.0.0.1:5500/static/js/app.js`

只想临时切一下时，用工具栏弹窗里的总开关即可，不用删规则。

## 规则写法

规则字段与 1.x 完全一致：

```json
[
    {
        "req": "^https?://cdn\\.example\\.com/static/",
        "res": "http://127.0.0.1:5500/static/",
        "group": "demo",
        "checked": true
    }
]
```

| 字段 | 说明 |
| --- | --- |
| `req` | JS 正则表达式，**不要**写首尾的 `/` 和 `/gi` 修饰符 |
| `res` | 重定向目标，支持 `http://` / `https://` / `ftp://`，或 `file:///local/文件名` |
| `group` | 分组名，仅用于界面归类，可选 |
| `checked` | 是否启用 |

### 替换语义

`res` 只会替换 URL 中**被正则命中的那一段**，其余部分保留，这与 1.x 的 `url.replace(reg, res)` 一致。

```js
// 规则
req = '^https?://cdn\.example\.com/static/'
res = 'http://127.0.0.1:5500/static/'

// 结果
https://cdn.example.com/static/js/app.js?v=2
→ http://127.0.0.1:5500/static/js/app.js?v=2
```

所以做目录映射时，正则要匹配到目录层级并保留末尾的 `/`，否则剩余路径会拼接错位。

### 常用示例

**单文件替换**

```json
{ "req": "^https://cdn\\.example\\.com/static/js/app\\.js.*$", "res": "http://127.0.0.1:5500/app.js", "checked": true }
```

**整个目录**

```json
{ "req": "^https?://cdn\\.example\\.com/static/", "res": "http://127.0.0.1:5500/static/", "checked": true }
```

**捕获组重排**

```json
{ "req": "^https://old\\.com/(.*)$", "res": "https://new.com/$1", "checked": true }
```

`$&` 表示整个匹配内容。

**指向扩展内置的本地文件**

把文件放进 `local/` 目录，然后在 `chrome://extensions` 点一次「重新加载」：

```json
{ "req": "^https://cdn\\.example\\.com/static/app\\.js$", "res": "file:///local/app.js", "checked": true }
```

适合临时改几行、又不想起本地服务的场景。

## 界面说明

**工具栏弹窗**：总开关、当前生效规则数、入口按钮。状态行可点击，直接跳到规则管理页的诊断面板。

**规则管理页**（`options.html`）：

- 添加 / 删除规则，勾选启用，上下移动调整顺序
- 导入 / 导出 `ReResSetting.json`，导入时自动补齐缺失的 `group` / `checked`
- **规则预演**：输入任意 URL，显示会被哪条规则重定向成什么；多条规则同时命中时会说明只有第一条生效
- **诊断**：显示浏览器实际注册成功的规则数；被 DNR 拒绝的规则会列出原因；目标为内网地址的规则会给出黄色提示

## 与 1.x 的差异

| 能力 | 1.x（MV2） | 2.0（MV3） |
| --- | --- | --- |
| 规则格式 | `{req, res, group, checked}` | 相同，可直接导入 |
| 重定向实现 | `webRequest` 阻塞式拦截 | `declarativeNetRequest` 动态规则 |
| 映射到线上 / 本地 HTTP 地址 | 支持 | 支持 |
| 映射到任意本地文件 `file:///D:/...` | 支持 | 不支持，见下方限制 |
| 多条规则链式改写同一个 URL | 支持 | 不支持，每个请求只应用一条 |
| 规则存储 | background page 的 `localStorage` | `chrome.storage.local` |

## 已知限制

### 1. 一个请求只应用一条规则

DNR 对同一个请求只应用优先级最高的一条规则（本扩展所有规则优先级相同，按列表顺序取第一条）。1.x 的"链式替换"不再成立，需要拆成一条带捕获组的规则。

### 2. 正则引擎是 RE2

不支持 `(?=)`、`(?!)`、`(?<=)`、`(?<!)`、反向引用 `\1`、命名分组。写了会在编译期报错并给出中文提示，不会静默失效。

### 3. 替换串只支持 `$1`~`$9` 和 `$&`

`$10` 及以上无法表达（会被误解析成 `$1` + `0`），编译期直接拒绝。

### 4. 不能重定向到 `file:///D:/...`

MV3 的 Service Worker 里没有同步 XHR，也不能 `fetch('file://')`，而 DNR 只允许重定向到 http/https 等网络协议。替代方案：

- 起一个本地静态服务（`npx serve`、VSCode Live Server、`python -m http.server`），规则指向 `http://127.0.0.1:端口/...`
- 或把文件放进扩展的 `local/` 目录，用 `file:///local/文件名`（改文件后需重新加载扩展）

### 5. 不能修改响应体

DNR 只能重定向，无法改写内容。要改响应体只能用 `chrome.debugger`（`Fetch.fulfillRequest`），代价是页面顶部常驻"正在调试此浏览器"提示条，对一个轻量映射工具不划算。

### 6. 重定向到内网地址会被 PNA 拦截

把公网页面的资源指向内网/本机（`127.0.0.1`、`192.168.x.x`、`10.x.x.x`、`172.16~31.x.x`）时，控制台会出现：

```
Access to script at 'http://192.168.1.100:8080/app.js' from origin
'http://dev.example.com' has been blocked by CORS policy: The request client
is not a secure context and the resource is in more-private address space `local`.
```

这**不是规则没生效**——报错里的地址已经是改写后的目标，说明重定向成功了。拦截来自 Chrome 的 **Private Network Access**：公网且非安全上下文（http）的页面，不允许请求地址空间更私有的资源。该检查在请求发出前执行，`declarativeNetRequest` 无法绕过，修改响应头也无效。

处理方式（择一）：

1. **启动参数（已实测有效）**

   ```
   chrome.exe --unsafely-treat-insecure-origin-as-secure=http://dev.example.com
   ```

   - Chrome 已在运行时追加参数不生效，必须完全退出（含后台进程）再启动
   - 从任务栏 / 开始菜单点开的 Chrome 不带参数，需改快捷方式「目标」或从命令行启动
   - 会在窗口顶部显示"不受支持的命令行标记"提示，**无法关闭**，不影响功能

2. **使用 chrome://flags 配置同一选项（不产生提示条）**

   打开 `chrome://flags/#unsafely-treat-insecure-origin-as-secure`，填入 `http://dev.example.com`，设为 Enabled 后重启。该配置存在 Chrome 的 Local State 中，不会触发命令行标记警告。

3. **源站反向代理（最稳）**

   在源站（如 nginx）上把该 URL 代理到内网服务，让页面始终同源，PNA 与 CORS 都不会触发，也不依赖浏览器配置：

   ```nginx
   location = /static/app.js {
       proxy_pass http://192.168.1.100:8080/app.js;
   }
   ```

扩展在编译阶段会识别内网目标，并在诊断面板给出对应的黄色提示，避免把 PNA 拦截误判成规则失效。

## 常见问题

| 现象 | 检查点 |
| --- | --- |
| 扩展卡片有红色「错误」按钮 | 点开看 Service Worker 报错栈，通常是 `importScripts` 路径或 JS 语法问题 |
| 诊断面板显示已生效 0 条 | 规则没勾选「启用」，或 `req` 不是合法正则 |
| 诊断面板列出被 DNR 拒绝 | 正则用了 lookahead / 反向引用，或替换串用了 `$10` 以上 |
| 重定向后路径拼接错 | 正则没匹配到目录层级，或 `res` 末尾少了 `/` |
| 规则生效但页面仍是旧内容 | 浏览器缓存（硬刷新）、目标服务器没起，或 CDN 返回了 304 |
| 报 `ERR_CONNECTION_REFUSED` | 目标地址的本地服务没启动 |
| 报 `more-private address space` | PNA 拦截，见「已知限制 6」 |

## 目录结构

```
.
├── manifest.json          MV3 清单
├── background.js          Service Worker：编译规则并同步为 DNR 动态规则
├── js/rule-engine.js      规则编译引擎（校验、$n 转换、目标类型判定、预演）
├── js/shared.js           storage 封装与 UI 工具
├── js/popup.js            工具栏弹窗
├── js/options.js          规则管理页
├── popup.html             工具栏弹窗
├── options.html           规则管理页
├── css/ui.css             界面样式
├── local/                 扩展内置资源目录（可被 file:///local/ 命中）
├── ReResSetting.json      规则导入示例
└── test/verify.js         离线回归脚本
```

## 开发与验证

规则编译逻辑有离线回归脚本，不需要浏览器：

```
cscript //nologo test\verify.js
```

覆盖 26 项断言：5 个 JS 文件的语法、URL 规则编译、`regexSubstitution` 生成、`$1`/`$&` 转换、`file:///` 拒绝与 `extensionPath`、RE2 不支持语法的报错、规则 id 唯一性、预演行为、内网目标提示等，全部通过。

`test/verify.js` 用 Windows 脚本宿主（JScript）实现，因此语法探测部分对 ES3 保留字做了兼容处理，仅用于验证规则引擎，不是扩展运行时的一部分。

## 迁移自 1.x

1. 在旧版「管理规则」页点**导出**，得到 `ReResSetting.json`
2. 在本版「管理规则」页点**导入**
3. 含 `file:///D:/...` 的规则会被标记为诊断错误，按提示改成 HTTP 地址或 `file:///local/...`

旧版规则存在 background page 的 `localStorage` 中，MV3 无法直接读取，所以必须走导出/导入。
