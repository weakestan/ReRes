这个目录用于放置需要被重定向命中的本地文件（Manifest V3 不允许扩展重定向到 file:// 路径）。

用法：
1. 把 app.js、style.css 等文件复制到本目录；
2. 在规则里写：file:///local/app.js
3. 修改文件后，需要到 chrome://extensions 里对本扩展点一次「重新加载」。

更推荐的方式：直接起一个本地静态服务器（例如 npx serve），
把 Response 写成 http://127.0.0.1:5500/xxx.js，这样改文件不用重载扩展。
