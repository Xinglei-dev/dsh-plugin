# dsh-fixed-pairing-token

> **状态：未实现。** 本文记录已核实的设计约束，插件还不能安装。

## 目标

DSH Web 每次启动都会生成一个新的启动 token，`dsh web:` 打印的地址因此每次都不同。本插件把这个 token 固定下来，让收藏的 GUI 地址在重启后仍然可用。

## 两个凭据

| 凭据 | 生命周期 | 存放位置 |
|---|---|---|
| 启动 token（URL 里的 `?token=`） | 每个进程随机生成一次 | 内存中的 `BrowserAuth.launchToken` |
| 签名 cookie | 默认 30 天，由 `cookieMaxAgeDays` 调整 | 签名密钥持久化在 `$DSH_HOME/.credentials.yaml` 的 `client-connection/browser-session` 记录 |

签名密钥已经持久化，同一浏览器重启后不会掉登录。启动 token 只在换浏览器、清过 cookie，或者走 `GET /connect` 换取 API cookie 时用得上。插件要解决的是地址记不住，不是重启后被登出。

## 上游事实

以下结论对应 DSH `0.2.1-rc.2`。

- `launchToken` 是 `BrowserAuth` 上的普通可写实例属性，由 `processLaunchToken(ctx.root)` 生成，并按 root 缓存。
- 三个消费点都读 `this.launchToken`：`authenticatedUrl()`、`authorizeIndex()`、`authorizeConnect()`。替换这个属性就能让三者同时改用固定值，不需要改写 `req.url`，也不必改动 cookie 格式。
- `dsh-host-frontend-static` 通过 `ctx.connection.authorizeIndex(req, res)` 认证首页；`dsh-web-app` 通过 `ctx.connection.authenticatedUrl()` 打印地址并打开浏览器；`GET /connect` 通过 `authorizeConnect()` 签发 API cookie。
- `browserAuth` 在 `HostConnectionService` 上是 `private readonly`，不在 `HostConnectionHandle` 的公开类型中。这构成本插件主要的兼容性风险：上游改字段名或改成 `#private` 后，插件失效。

## 实现方式

等 `connection` 服务就绪，用 `Object.defineProperty` 把 `connection.browserAuth.launchToken` 换成返回固定值的 getter，并在插件卸载时还原原始属性描述符。

必须同时满足三点：

- 保留原 descriptor，在 effect 的 cleanup 中还原，保证 HMR 与 reload 之后不留改写。
- 加载时自检：用 `connection.authenticatedUrl('http://dsh.invalid/')` 解析出 `token` 参数，与配置值不一致就抛错。字段形状变化时静默退回随机 token，使用者无法察觉，所以这种情况必须报错。
- 用 `ctx.inject(['connection'], …)` 注册。provider 被替换后，回调会重新执行。

## token 来源

优先取 `config.token`；为空时读 `DSH_PAIRING_TOKEN`；两者都没有时插件加载失败。不采用自动生成后持久化的做法，否则配置里看不出实际使用哪个 token。

长度下限 16 字符，推荐 32 字节随机数的 base64url 形式。

## 安全边界

- token 从一次性的启动凭据变成长期有效的 bearer 凭据，拿到链接的人可以换到一个 30 天有效的 cookie。
- 监听器是明文 HTTP 时（例如由反向代理对外提供 HTTPS），签出的 cookie 不带 `Secure`。这是上游现有行为，插件不改变它。
- 相应地，启动日志不宜外传，token 使用长随机串，必要时在代理层再加访问控制。

## 已完成的验证

在 `/tmp` 下复制上游 `dsh-client-connection/lib/index.js`，对真实 `BrowserAuth` 实例做过离线验证。`0.2.1-rc.2` 上的结果：

- 钉住后 `authenticatedUrl()` 返回固定 token；
- 正确 token 经 `authorizeIndex` 得到 303 和 `set-cookie`，错误 token 得到 401；
- `authorizeConnect` 得到 302，指向 `./api/remote.mux`；
- 还原 descriptor 后恢复原来的随机 token。

实现插件时把这四步写成 `test/` 下的离线测试，再补一条“上游字段形状变化时加载报错”的测试。
