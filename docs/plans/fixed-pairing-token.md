# 设计约束：固定 Web 启动 token（`dsh-fixed-pairing-token`）

> **状态：未实现。** 本文记录已经核实的设计约束与验证方法，不是可安装插件的说明。
> 实现完成后，仍然有效的内容并入 `plugins/fixed-pairing-token/README.md`，本文件删除。

## 目标

DSH Web 每次启动都会生成新的启动 token，`dsh web:` 打印的地址因此每次都变。本插件把该 token 固定下来，让收藏的 GUI 地址在重启后仍然有效。

## 需要先分清的两个凭据

| 凭据 | 生命周期 | 位置 |
|---|---|---|
| 启动 token（URL 里的 `?token=`） | 每个进程随机生成一次 | 内存，`BrowserAuth.launchToken` |
| 签名 cookie | 默认 30 天，`cookieMaxAgeDays` 可调 | 持久化签名密钥在 `$DSH_HOME/.credentials.yaml` 的 `client-connection/browser-session` 记录 |

签名密钥本来就已经持久化，所以**同一浏览器重启后不会掉登录**。启动 token 只在“新浏览器、清过 cookie、或走 `/connect` API”时才需要。插件解决的是“地址记不住”的问题，不是“重启后被登出”的问题。

## 上游事实（DSH `0.2.1-rc.2`）

- `packages/client/connection/src/browser-auth.ts`：`launchToken` 是 `BrowserAuth` 上的普通可写实例属性，由 `processLaunchToken(ctx.root)` 生成并按 root 缓存。
- 三个消费点都读 `this.launchToken`：`authenticatedUrl()`、`authorizeIndex()`、`authorizeConnect()`。替换该属性即可让三者同时生效，无需改 `req.url` 或 cookie 格式。
- `dsh-host-frontend-static` 用 `ctx.connection.authorizeIndex(req, res)` 认证首页；`dsh-web-app` 用 `ctx.connection.authenticatedUrl()` 打印地址并打开浏览器；`GET /connect` 用 `authorizeConnect()` 签发 API cookie。
- `browserAuth` 在 `HostConnectionService` 上是 `private readonly`，不在 `HostConnectionHandle` 公开类型里。**这是本插件的兼容性风险点**：上游改字段名或改成 `#private` 时插件会失效。

## 实现方式

在 `connection` 服务就绪后，把 `connection.browserAuth.launchToken` 用 `Object.defineProperty` 换成返回固定值的 getter，并在插件卸载时还原原始属性描述符。

- 必须保留原 descriptor，在 effect 的 cleanup 里还原，保证 HMR/reload 不残留。
- 必须做启动自检：用 `connection.authenticatedUrl('http://dsh.invalid/')` 解析出 `token` 参数，与配置值不一致就抛错。静默失败比不实现更糟。
- 用 `ctx.inject(['connection'], …)` 注册；provider 被替换后回调会重新执行。

## token 来源

优先 `config.token`；为空时读 `DSH_PAIRING_TOKEN`；两者都没有则插件加载失败。不使用自动生成并持久化的方案，避免“配置里看不出来用了什么 token”。

长度下限 16 字符，推荐 32 字节随机 base64url。

## 安全边界

- token 从“一次性启动物”变成长期 bearer 凭据：看到链接的人都能换一个 30 天 cookie。
- 监听器是明文 HTTP 时（例如经反向代理对外提供 HTTPS），签出的 cookie 不带 `Secure`。这是上游现有行为，本插件不改变它。
- 因此：不要分享启动日志；token 用长随机串；必要时在代理层加访问控制。

## 验证方法

已用 `/tmp` 下复制上游 `dsh-client-connection/lib/index.js` 的方式对真实 `BrowserAuth` 做过离线验证，`0.2.1-rc.2` 上结论是：

- 钉住后 `authenticatedUrl()` 返回固定 token；
- 正确 token 走 `authorizeIndex` 得到 303 + `set-cookie`，错误 token 得到 401；
- `authorizeConnect` 得到 302 指向 `./api/remote.mux`；
- 还原 descriptor 后恢复原随机 token。

插件落地时应把这四步固化为 `test/` 中的离线测试，并补一条“上游字段形状变化时启动报错”的测试。
