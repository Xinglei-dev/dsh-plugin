# dsh-mcp-memorix

在「插件」页给 Memorix 一张可整体启停的卡片。卡片插入的那一行是 [dsh-memorix-tools](../dsh-memorix-tools/)：它把 Memorix 的工具注册到 DSH，并且**按调用所属会话的工作目录**选项目。

工具名仍是 `mcp__memorix__*`，与其他接法一致。

## 安装

安装两个包：卡片包，以及它组合的实现包。

```sh
dsh plugin --profile web add \
  "github:Xinglei-dev/dsh-plugin#path:/plugins/dsh-memorix-tools" \
  "github:Xinglei-dev/dsh-plugin#path:/plugins/dsh-mcp-memorix"
```

本地开发用 `link:`：

```sh
dsh plugin --profile web add \
  "link:/path/to/dsh-plugins/plugins/dsh-memorix-tools" \
  "link:/path/to/dsh-plugins/plugins/dsh-mcp-memorix"
```

`dsh-memorix-tools` 不是 bundle，安装时会提示「declares no dsh.bundle — installed as a plain dependency」，这是预期输出：它只提供实现，卡片由本包提供。

安装后刷新 Web 页面，在「插件 → 已安装插件」里可以看到 Memorix 卡片；关掉它，`mcp__memorix__*` 工具随之消失。

## 配置

包内 `cordis.patch.yml` 插入一行 `dsh-memorix-tools`：

| 字段 | 值 |
|---|---|
| `id` | `mcp-memorix` |
| `name` | `dsh-memorix-tools` |
| `config.baseUrl` | `http://127.0.0.1:3211/mcp`（工具名前缀来自实现包默认的 `mcp__memorix__`） |

服务在别处时在 profile 的 `cordis.patch.yml` 里按 id 覆盖（`config` 是整体替换）：

```yaml
- id: mcp-memorix
  config:
    baseUrl: http://127.0.0.1:3211/mcp
```

实现包还有 `toolCallTimeoutMs`、`fallbackProjectRoot`、`failOnStartupError` 三个字段，含义见 [dsh-memorix-tools 的说明](../dsh-memorix-tools/)。要一并覆盖时，在同一段 `config` 里写全。

## 排障

- **卡片开着但工具不出现**：确认 `127.0.0.1:3211` 上的 `memorix serve-http` 在运行，且 `/mcp` 可访问。该行默认启动失败即报错，日志或「插件」页会显示服务端的原文，例如 `Unsupported protocol version` 表示服务端已不支持当前协议版本，需要升级实现包。
- **条目加载失败**：若报 `already registered`，说明还有另一处接入了 Memorix（旧的 `@deepseek-ai/dsh-mcp-client` 行，或另一个 bundle），两者占用同一批工具名，删掉其中一个。
- **调用报 `no session working directory`**：该会话没有工作目录且未配置 `fallbackProjectRoot`。实现包不会退回服务端的「上次项目」。

## 适用版本

- DSH `>=0.2.1-rc.2 <0.3.0`，实测通过 `0.2.1-rc.2`。
- 配套的 `dsh-memorix-tools` 需为同一版本。
