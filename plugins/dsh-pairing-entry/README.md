# dsh-pairing-entry

给 DSH Web 一个收藏夹里不会失效的入口：访问 `/entry/<key>`，插件把浏览器送到当前的启动 token 上，登录流程和直接打开 `dsh web` 打印的地址完全一样。

## 背景

`dsh web` 每次启动生成一个随机启动 token，拼进打印的地址：

```text
dsh web: http://127.0.0.1:8082/?token=<每次启动都不同>
```

浏览器带着这个 token 访问 `/`，Connection 校验后签发一个 cookie（默认 30 天，`cookieMaxAgeDays` 可调）并 303 到 `./`，之后靠 cookie 认证。地址本身每次启动都变，所以收藏夹里的链接过一夜就失效。

本插件增加一条固定路径 `/entry/<key>`。访问它，插件 303 到 `/?token=<当前 token>`，浏览器随后照常换取 cookie。你收藏的是 `/entry/<key>`，token 再变它也不变。

## 它不做什么

- 不改变启动 token 的生成，也不改变 cookie 的签发与校验。
- 不把入口地址写进启动日志。地址里的 key 是长期凭据，不该出现在日志里。
- 不在"已经登录"时跳过 token 换取。`/connect` 签发的 API cookie（版本 2）会覆盖索引 cookie（版本 1），按 cookie 判断登录态并跳过，入口页在换过 API cookie 的浏览器里就会失效。

## 安装

从本仓库安装：

```sh
dsh plugin --profile web add \
  "github:Xinglei-dev/dsh-plugin#path:/plugins/dsh-pairing-entry"
```

锁定版本时在 `#` 后写 commit：

```sh
dsh plugin --profile web add \
  "git+https://github.com/Xinglei-dev/dsh-plugin.git#<commit>&path:/plugins/dsh-pairing-entry"
```

`path:` 片段不能省。仓库根没有 `package.json`，省略后 pnpm 会把整个仓库当成一个包。

本地开发用 `link:`：

```sh
dsh plugin --profile web add link:/绝对路径/dsh-plugin/plugins/dsh-pairing-entry
```

安装或卸载插件后要重启 `dsh web` 进程，插件才会被加载。

## 配置

在 Web 界面里配置：**设置 → 插件 → 配对入口**，填入 key 后保存。

- 保存会写进当前 profile 的 `cordis.patch.yml`（`id: pairing-entry` 的 `config.key`）。`key` 是 volatile 字段，Loader 把新值直接提交给运行中的实例，插件随即按新 key 重新注册路由，不用重启 DSH。
- 「随机生成」按钮生成 32 个字符的 key，等价于 `node -e "console.log(require('node:crypto').randomBytes(32).toString('base64url'))"`。
- 面板下方显示当前 key 对应的入口地址，可以直接复制。
- 没配置 key、或 key 不合法时，插件照常加载但不提供入口页，面板里会写明原因（日志里同时有一条 `pairing-entry:` 警告，前提是 profile 装了日志导出器）。

也可以不用面板，直接写 profile 的 `cordis.patch.yml`：

```yaml
- id: pairing-entry
  config:
    key: '<你的 key>'
```

手写 patch 也会被 HMR 监听：改完不用重启，路由按新 key 重新注册；删掉 `config` 则入口页停止服务。

key 的要求：

- 至少 32 个字符；
- 只能包含 `A-Z`、`a-z`、`0-9`、`-`、`_`。key 是路径的一段，超出这个范围的字符要转义，收藏的地址就无法逐字节复现。

## 使用

把 `https://<你的域名>/entry/<key>` 放进收藏夹。打开后：

1. 未登录的浏览器带着请求到 `/entry/<key>`；
2. 插件返回 303，`Location: ../?token=<当前启动 token>`；
3. 浏览器访问 `/?token=...`，Connection 校验、签发 cookie、303 到 `./`；
4. 落在正常界面。

已登录的浏览器走同一条路径，cookie 会被重新签发一次。

## 安全说明

- key 是长期有效的 bearer 凭据，强度和原来的固定 token 相同。拿到它的人能换到一个有效期至多 `cookieMaxAgeDays` 天的 cookie。
- key 在 URL 路径里，会进反向代理的访问日志、浏览器历史记录和任何记录 `Referer` 的地方。响应带了 `Referrer-Policy: no-referrer`，只减少二次泄漏。
- key 以明文存在 profile 的 `cordis.patch.yml` 里（文件权限 `0600`）。
- 需要撤销时，在面板里换一个 key（或清除），旧地址立刻失效。

## 排障

**访问入口页返回 403。** `requestRejection` 判定 Host、Origin 或 `Sec-Fetch-Site` 不可信。经反向代理暴露时必须用 `--trusted-host` 声明外部域名（例如 `--trusted-host deepseek.xinglei.org`），并原样转发 `Host`；浏览器发出的 `Origin` 也必须和 Host 同源。

**访问入口页返回 404。** 没配 key、key 不合法、或者还在用改 key 之前的旧书签。打开面板的「配对入口」页，它会显示当前存储值和问题。

**设置里没有「配对入口」页。** 插件条目没加载，或者 DSH 版本与随包提供的浏览器端 bundle 契约不匹配（见下方版本范围）。

**保存失败。** 配置在你读取之后被别的窗口改过。面板会重新读取，确认当前值后再保存一次。

**子路径挂载。** 入口路由是根相对的 `/entry/<key>`。如果反向代理给整个 GUI 加了前缀（例如 `/dsh/`），要像转发 GUI 一样把前缀剥掉；面板里显示的入口地址按根挂载拼接。

**改了 key 之后旧书签打不开。** 路由路径跟着 key 变，旧地址落到前端兜底并返回 404，重新收藏新地址。

## 实现与依赖

- 宿主端只读公开接口：`connection.requestRejection()`、`connection.authenticatedUrl()`、`webServer.register()`。启动 token 从 `authenticatedUrl()` 拼出的地址里取，上游改变 token 的传递方式会在加载阶段报错，不会悄悄返回旧值。
- key 用 Schemastery 的 `volatile` 字段声明。这是设置面板能读写它的前提：设置面板只展示和写入 volatile 字段。
- 面板写入走 `settings` → `configEditor`，落到 profile patch；volatile 字段的变化由 Loader 提交到运行中的实例（不重载条目），插件监听 `loader/volatile-update` 后按新 key 重新注册路由。
- 浏览器端是包内自带的 `lib/client.js`（`dsh.client` 声明），注册到 `settings.plugins.tab`，通过 `ctx.configForms` 读写同一个配置命名空间；只依赖 `react`。
- 入口响应是 303，带 `cache-control: no-store` 和 `referrer-policy: no-referrer`；`Location` 用相对的 `../?token=...`，不依赖 `Host` 头。

## 支持的 DSH 版本

在 DSH `0.2.1-rc.2` 上实测通过：

- 配好 key 后 `/entry/<key>` 返回 303，`Location: ../?token=<当前启动 token>`；
- 跟完整个跳转链能拿到 cookie 并加载界面；已登录的浏览器同样得到 303；
- 外来 `Host` 和 `Sec-Fetch-Site: cross-site` 得到 403；
- 改 key 后路由热切换到新地址、旧地址 404；删掉 key 后入口页停止服务；
- 客户端 bundle 进入启动清单并由 Web 服务提供。

`package.json` 的 `engines.dsh` 声明为 `>=0.2.1-rc.2 <0.3.0-0`。DSH 处于 `0.2.x` 预发布阶段，浏览器端 bundle 的加载契约不在公开接口里；形状不符时插件在加载阶段报错，不会静默降级。

## 本地开发

```sh
cd plugins/dsh-pairing-entry
sh test/link-peers.sh
node --test
```

测试说明见 [test/README.md](test/README.md)。

## 许可证

[MIT](../../LICENSE)
