# dsh-fixed-pairing-token

用固定 token 替换 DSH Web 每次启动随机生成的启动 token。

> **状态：未实现。** 本文是实现前的设计说明，插件还不能安装。DSH `0.2.1-rc.2` 上已完成离线验证，结论见文末。

## 背景

DSH Web 启动时生成一个随机启动 token，并把它拼进 `dsh web:` 打印的地址：

```text
dsh web: http://127.0.0.1:3080/?token=<每次启动都不同>
```

浏览器首次用这个 token 换取签名 cookie，之后靠 cookie 认证，所以同一浏览器重启后仍保持登录。但地址本身每次都变，收藏夹、书签栏以及写在别处的链接在每次重启后失效。本插件让这个 token 由配置提供，地址因此固定。

插件不改变 cookie 的签发与校验，只改变启动 token 的来源。

## 两个凭据

| 凭据 | 生命周期 | 存放位置 |
|---|---|---|
| 启动 token（URL 里的 `?token=`） | 每个进程随机生成一次 | 进程内存，[`BrowserAuth.launchToken`](https://github.com/deepseek-ai/deepseek-harness/blob/dsh-v0.2.1-rc.2/packages/client/connection/src/browser-auth.ts#L206-L215) |
| 签名 cookie | 默认 30 天，由 connection 配置的 `cookieMaxAgeDays` 调整 | 签名密钥持久化在 `$DSH_HOME/.credentials.yaml` 的 `client-connection/browser-session` 记录，配置字段见 [connection `Config`](https://github.com/deepseek-ai/deepseek-harness/blob/dsh-v0.2.1-rc.2/packages/client/connection/src/index.ts#L105-L116) |

这个区别很重要：token 只在换浏览器、清掉 cookie，或者用 `GET /connect` 换取 API cookie 时才需要。如果遇到的是“重启后要重新登录”，原因通常与 token 无关，而是 cookie 被清除或 `cookieMaxAgeDays` 太短。

## 上游依据

以下对应 DSH `0.2.1-rc.2`，即 npm 上 `@deepseek-ai/dsh` 的当前版本。链接指向该版本的 tag，便于日后核对差异。

- `launchToken` 由 [`processLaunchToken`](https://github.com/deepseek-ai/deepseek-harness/blob/dsh-v0.2.1-rc.2/packages/client/connection/src/browser-auth.ts#L61-L66) 生成，按 root context 缓存，内容为 32 字节随机数的 base64url 编码。
- 三个消费点读同一个字段：`authenticatedUrl()`、`authorizeIndex()`、`authorizeConnect()`。替换字段即可同时改变 URL 生成、首页 token 交换与 `/connect` 换 cookie。
- 首页认证在 [frontend-static](https://github.com/deepseek-ai/deepseek-harness/blob/dsh-v0.2.1-rc.2/packages/host/frontend-static/src/index.ts#L130-L138) 中通过 `ctx.connection.authorizeIndex(req, res)` 完成；打印地址与打开浏览器在 [web-app](https://github.com/deepseek-ai/deepseek-harness/blob/dsh-v0.2.1-rc.2/packages/bundle/web-app/src/index.ts#L224-L232) 中通过 `ctx.connection.authenticatedUrl(webUrl)` 完成。
- `browserAuth` 在 [`HostConnectionService`](https://github.com/deepseek-ai/deepseek-harness/blob/dsh-v0.2.1-rc.2/packages/client/connection/src/rpc-host.ts#L90) 上是 `private readonly`，不在公开的 `HostConnectionHandle` 类型中。插件依赖这个非公开字段，这是它最脆弱的地方。

## 设计

等 `connection` 服务就绪，用 `Object.defineProperty` 把 `connection.browserAuth.launchToken` 替换成返回配置值的 getter；插件卸载时还原原始属性描述符。

三条硬性要求：

- 保留原 descriptor 并在 effect 的 cleanup 中还原，保证 HMR 和 reload 之后不残留改写。
- 加载时自检：请求 `connection.authenticatedUrl('http://dsh.invalid/')` 并解析 `token` 参数，与配置值不一致就抛错。上游字段形状变化时，静默退回随机 token 会让使用者无从察觉，因此必须让加载失败。
- 用 `ctx.inject(['connection'], …)` 注册，provider 被替换后回调会重新执行。

## 配置

token 取值顺序：`config.token`，其次环境变量 `DSH_PAIRING_TOKEN`，两者都没有则加载失败。不提供自动生成后持久化的模式，否则配置里看不出实际生效的 token。

长度下限 16 字符，推荐 32 字节随机数的 base64url 形式：

```sh
node -e "console.log(require('node:crypto').randomBytes(32).toString('base64url'))"
```

## 安全说明

固定 token 是有意的取舍，使用前请确认能接受：

- 启动 token 从一次性的启动凭据变成长期有效的 bearer 凭据。拿到该链接的人可以换到一个有效期至多 30 天的 cookie。
- 监听器是明文 HTTP 时（例如前面挂反向代理提供 HTTPS），签出的 cookie 不带 `Secure`。这是 DSH 的现有行为，插件不改变它。
- 相应地，不要公开分享启动日志；token 使用长随机串；必要时在反向代理层再加一层访问控制；需要撤销时改配置换 token 并重启。

## 验证情况

在 `/tmp` 下复制上游 `dsh-client-connection/lib/index.js`，对真实的 `BrowserAuth` 实例做过离线验证，`0.2.1-rc.2` 上的结果：

- 钉住后 `authenticatedUrl()` 返回固定 token；
- 正确 token 经 `authorizeIndex` 得到 303 和 `set-cookie`，错误 token 得到 401；
- `authorizeConnect` 得到 302，指向 `./api/remote.mux`；
- 还原 descriptor 后恢复原来的随机 token。

实现时这四步会成为 `test/` 下的离线测试，另加一条“上游字段形状变化时加载报错”的用例。真实 GUI 上的端到端验证需要重启 DSH 进程，会在征得同意后进行。
