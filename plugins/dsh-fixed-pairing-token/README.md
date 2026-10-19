# dsh-fixed-pairing-token

把 DSH Web 的启动 token 固定成配置里的值，让 `dsh web:` 打印的地址在重启后不变。

## 背景

DSH Web 每次启动生成一个随机启动 token，拼进打印的地址：

```text
dsh web: http://127.0.0.1:3080/?token=<每次启动都不同>
```

浏览器首次用这个 token 换取签名 cookie，之后靠 cookie 认证。地址本身每次都变，于是收藏夹、书签栏和写在别处的链接在每次重启后失效。本插件让 token 由配置提供，地址因此固定。

插件只改变启动 token 的来源，不改 cookie 的签发与校验。

## 两个凭据

| 凭据 | 生命周期 | 说明 |
|---|---|---|
| 启动 token（URL 里的 `?token=`） | 默认每个进程随机生成一次 | 本插件把它换成固定值 |
| 签名 cookie | 默认 30 天，由 connection 的 `cookieMaxAgeDays` 调整 | 插件不改变它 |

这个区别决定它解决什么问题：如果遇到的是“重启后要重新登录”，原因通常是 cookie 被清除或 `cookieMaxAgeDays` 太短，与本插件无关。

## 安装

从本仓库安装：

```sh
dsh plugin --profile web add \
  "github:Xinglei-dev/dsh-plugin#path:/plugins/dsh-fixed-pairing-token"
```

锁定版本时在 `#` 后写 commit：

```sh
dsh plugin --profile web add \
  "git+https://github.com/Xinglei-dev/dsh-plugin.git#<commit>&path:/plugins/dsh-fixed-pairing-token"
```

`path:` 片段不能省。仓库根没有 `package.json`，省略后 pnpm 会把整个仓库当成一个包。

本地开发用 `link:`：

```sh
dsh plugin --profile web add link:/绝对路径/dsh-plugin/plugins/dsh-fixed-pairing-token
```

插件不发布到 npm，因此不能直接 `dsh plugin add dsh-fixed-pairing-token`。

## 配置

token 取 `config.token`，没有时读环境变量 `DSH_PAIRING_TOKEN`。两者都没有则插件加载失败，不使用随机 token 兜底。

在 profile 的 `cordis.patch.yml` 里写：

```yaml
- id: fixed-pairing-token
  config:
    token: '<你的 token>'
```

或者启动 `dsh web` 的进程带环境变量：

```sh
DSH_PAIRING_TOKEN='<你的 token>' dsh --profile web
```

token 的要求：

- 至少 16 个字符；
- 只能包含 `A-Z`、`a-z`、`0-9`、`-`、`_`，这样打印出的地址与配置值逐字节一致；
- 推荐 32 字节随机数的 base64url 形式：

```sh
node -e "console.log(require('node:crypto').randomBytes(32).toString('base64url'))"
```

修改 token 后重启 DSH 生效。已经换过 cookie 的浏览器不受影响，仍然用原 cookie 登录；token 只在换浏览器、清除 cookie 或用 `GET /connect` 换取 API cookie 时使用。

## 排障

**启动日志出现 `no launch token configured`，地址仍是随机 token。** 配置或环境变量没有生效。确认 `cordis.patch.yml` 的条目 id 是 `fixed-pairing-token`，或确认启动进程能看到 `DSH_PAIRING_TOKEN`。插件坚持让条目失败而不是退回随机 token，因为静默退回会让使用者以为地址已经固定。

**启动日志出现 `connection.browserAuth is missing`、`launchToken is not an own property`、`is an accessor` 或 `authenticatedUrl() does not report the pinned token`。** 当前 DSH 版本改变了插件依赖的非公开字段。升级 DSH 后旧插件不能继续用，需要升级插件或停用它。

**地址打印出来还是随机的，但日志没有报错。** 检查是不是有另一层 patch 覆盖了这个条目的 `config`：后续 patch 会整体替换 `config`，`token` 会被丢掉。用 `dsh --profile web --dump-config` 查看合成后的条目。

**地址里带着一个旧 token，但配置的是新值。** 进程没有重启。启动 token 只在进程启动时确定。

## 安全说明

固定 token 是有意的取舍，用之前先确认能接受：

- 启动 token 从一次性的启动凭据变成长期有效的 bearer 凭据。拿到这条链接的人，可以换到一个有效期至多 `cookieMaxAgeDays` 天的 cookie。
- 监听器是明文 HTTP 时（例如前面挂反向代理提供 HTTPS），签出的 cookie 不带 `Secure`。这是 DSH 的现有行为，插件不改变它。
- 因此不要公开分享启动日志；token 用长随机串；必要时在反向代理层再加一层访问控制；需要撤销时改配置换 token 并重启。

## 实现方式

DSH `0.2.1-rc.2` 上：

- `launchToken` 是 `BrowserAuth` 上的 own data property，由 `authenticatedUrl()`、`authorizeIndex()`、`authorizeConnect()` 三处读取。
- 它不是公开 `HostConnectionHandle` 的一部分，插件依赖这个非公开字段，这是它最容易失效的地方。
- 配置用 Schemastery 声明，因此 `--dump-config-schema` 和 `Config.listConfigs` 能读到这个条目自己的 schema。
- 插件在 `connection` 服务就绪后保存原 descriptor，用 `Object.defineProperty` 把 `launchToken` 换成配置值；卸载或 HMR 时还原原 descriptor，还原操作幂等。
- 加载时调用一次 `connection.authenticatedUrl('http://dsh.invalid/')` 自检，解析出的 `token` 不是配置值就还原并抛错。
- `connection` 服务被替换时，Cordis 会让条目重新等待并重新执行，重新钉住新实例。

## 支持的 DSH 版本

在 DSH `0.2.1-rc.2` 上实测通过：打印地址携带固定 token；固定 token 经 `GET /` 换到 303 和签名 cookie；错误 token 得到 401；`GET /connect` 得到 302；两次独立启动打印同一地址；未配置 token 时条目加载失败。

`package.json` 的 `engines.dsh` 声明为 `>=0.2.1-rc.2 <0.3.0-0`。DSH 处于 `0.2.x` 预发布阶段，内部字段仍会变化；字段形状不符时插件在加载阶段报错，不会静默退回随机 token。

## 许可

[MIT](../../LICENSE)
