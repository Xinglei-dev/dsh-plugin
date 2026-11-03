# dsh-memorix-tools

把 Memorix 的 MCP 工具接到 DSH，但按**每次调用所属会话的工作目录**选项目。多个会话同时处理不同项目时，各自读到自己的记忆。

## 它解决什么

Memorix 默认把项目绑在连接上：一条 HTTP 会话、一次 `session_start`、一个当前项目。DSH 里所有浏览器会话共用一条 MCP 连接，于是最后绑定的项目对所有人生效——A 会话刚绑项目 1，B 会话绑了项目 2，A 再查就拿到项目 2 的记忆。

Memorix 另外支持无状态协议：每个请求自己在请求头里声明项目。这个插件走这条路，用一条连接服务所有会话，每次调用带上当前会话的项目根，不再有共享的可变绑定。

工具名与原来的 MCP 接入完全一致（`mcp__memorix__*`），所以原有的调用习惯和提示词不用改。

## 安装

前提：本机已经在跑 `memorix serve-http`（默认 `http://127.0.0.1:3211/mcp`）。

推荐通过 [dsh-mcp-memorix](../dsh-mcp-memorix/) 组合：它提供「插件」页上的启停卡片，并插入本包的行。两个包一起装：

```sh
dsh plugin --profile web add \
  "github:Xinglei-dev/dsh-plugin#path:/plugins/dsh-memorix-tools" \
  "github:Xinglei-dev/dsh-plugin#path:/plugins/dsh-mcp-memorix"
```

本地开发用 `link:`，改代码直接生效：

```sh
dsh plugin --profile web add \
  "link:/path/to/dsh-plugins/plugins/dsh-memorix-tools" \
  "link:/path/to/dsh-plugins/plugins/dsh-mcp-memorix"
```

本包**不是 bundle**：`dsh plugin add` 会把它装成普通依赖并提示「declares no dsh.bundle」，这是预期输出——卡片由 `dsh-mcp-memorix` 提供，避免同一批工具名被两次插入。

不用卡片时，也可以直接组合：装本包，再把包内 [cordis.patch.yml](cordis.patch.yml) 那行加进 profile 的 patch：

```yaml
- insert:
  - id: memorix-tools
    name: dsh-memorix-tools
    config:
      baseUrl: http://127.0.0.1:3211/mcp
```

无论哪种接法，同一批 `mcp__memorix__*` 工具名只能有一个来源：原来的 `@deepseek-ai/dsh-mcp-client` 行、别的 bundle、以及本包三者只能留一个，否则注册会整批失败并报 `already registered`。

重启 `dsh web` 后生效。

## 配置

写在 profile 的 patch 层，按条目 id 覆盖。`config` 是整体替换而不是深合并，所以只需写你要改的字段，但同一行里其他字段一旦写就要写全。行 id 由插入它的那一层决定：经 `dsh-mcp-memorix` 组合时是 `mcp-memorix`，直接插入时是本包 `cordis.patch.yml` 里的 `memorix-tools`：

```yaml
- id: mcp-memorix
  config:
    baseUrl: http://127.0.0.1:3211/mcp
```

| 字段 | 默认 | 说明 |
| --- | --- | --- |
| `baseUrl` | `http://127.0.0.1:3211/mcp` | Memorix 的 streamable-http 端点 |
| `serverName` | `memorix` | 工具名命名空间，产出 `mcp__<serverName>__<tool>`；保持 `memorix` 才与原有工具名一致 |
| `toolCallTimeoutMs` | `60000` | 单次调用超时；调用方取消会先于它生效 |
| `fallbackProjectRoot` | 空 | 会话没有工作目录时使用的绝对路径。留空表示这种情况直接报错，不回退到服务端的上次项目 |
| `failOnStartupError` | `true` | 首次读取工具列表失败时让该条目加载失败；设为 `false` 则加载但没有任何 memorix 工具，并记一条错误日志 |

## 工作方式

1. 插件加载时向 Memorix 请求一次 `tools/list`，把返回的工具按原名注册到 DSH。
2. 每次调用把会话的 `session.header.cwd`（会话创建时记录的绝对路径）写进 `Mcp-Project-Root` 请求头，Memorix 按该路径解析项目。
3. 请求同时带无状态协议要求的信封与 `Mcp-*` 头；协议版本固定为 `2026-07-28`，服务端换了版本会在启动时直接失败并报出它支持的版本。

## 排障

**条目加载失败，日志提到 `could not read the tool list`。** 先确认 `memorix serve-http` 在跑、`baseUrl` 对得上。若服务端报 `Unsupported protocol version`，说明它已不支持 `2026-07-28`，需要升级本插件。

**`registering the server's tools failed ... already registered`。** 旧的 memorix MCP 条目还在，或者另一个插件占用了 `mcp__memorix__*`。删掉旧条目后重启。

**调用报 `refusing to let the server choose a project`。** 这次调用所在的会话没有工作目录，且没有配置 `fallbackProjectRoot`。补上配置，或在有目录的会话里调用。

**`timed out after N ms`。** 这一调用超过 `toolCallTimeoutMs`；记忆检索变慢时调大该值。

## 适用版本

- DSH `>=0.2.1-rc.2 <0.3.0`，实测通过 `0.2.1-rc.2`。
- Memorix `1.10.2` 的无状态 MCP 协议（协议版本 `2026-07-28`）。

## 开发

```sh
sh test/link-peers.sh   # 把 schemastery、cordis、dsh-tools 链到本地，供测试使用
node --test
```

测试全部离线：自建 HTTP 假服务端验证请求信封与项目路由，不启动 DSH，也不读写 `$DSH_HOME`。
