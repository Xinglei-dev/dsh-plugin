# dsh-agents-md

在 DSH Web 设置里编辑全局与项目级的 `AGENTS.md`：列出 DSH 实际加载的指令链，就地修改、新建、保存。

## 背景

DSH 通过 `dsh-agent-instructions` 在每次请求前组装工作区指令：

- 先读两个全局文件：`$DSH_HOME/AGENTS.md`（默认 `~/.dsh/AGENTS.md`）和 `$DSH_AGENTS_HOME/AGENTS.md`（默认 `~/.agents/AGENTS.md`）；
- 再从项目根到会话工作目录逐层读取 `AGENTS.md`、`CLAUDE.md` 以及 `AGENTS.local.md`、`CLAUDE.local.md` 覆盖；
- 项目根由向上查找 `.git` 得到，找不到时使用工作目录；
- 每次 `agent/pre-step` 都会重新组装，内容去空白后相同的文件只注入一次。

手工找这些文件、确认哪一层会生效比较麻烦，这个插件把同一条链放进设置页。

## 安装

```sh
dsh plugin --profile web add \
  "github:Xinglei-dev/dsh-plugin#path:/plugins/dsh-agents-md"
```

安装后重启 DSH 进程，打开 Web 面板的「设置」→「Agent 指令」。

本地开发用 `link:`，不要用 `file:`（`file:` 会拷贝快照，改代码不生效）。

## 使用

页面分为三部分：

1. **项目下拉**：列出已注册的 workspace；选「仅全局」时不读取项目链。
2. **指令链**：左侧按加载顺序列出两个全局文件，以及项目根到 workspace 目录的每一层。已存在的 `CLAUDE.md`、`.local` 覆盖会一并列出；每层的 `AGENTS.md` 始终可点，文件不存在时点击即可新建。
3. **编辑器**：右侧显示绝对路径、生效说明和文本内容。保存、重新加载、放弃修改都在这里。

保存冲突：读取时记录 SHA-256，保存时带回去比对。文件在两次操作之间被外部改动时，页面提示冲突；可以重新加载采用磁盘版本，或覆盖保存当前草稿。

## 生效时机

保存后不需要重启 DSH，也不需要重开会话。下一轮模型请求会重新读取文件；正在运行的回合不会中途改变。如果 Agent 空闲，下一条消息就会用上新内容。

## 边界

- **以 workspace 路径为锚点**。DSH 的加载链终点是会话的工作目录，而设置页没有会话上下文。如果某个会话用 `workingDirectory.set` 切到了 workspace 之外，实际加载链可能与页面展示不同；项目根上的文件仍然生效。
- **项目根按 `.git` 判断**。没有 `.git` 时项目根就是 workspace 目录，页面会提示这一点。
- **只允许四个候选文件名**：`AGENTS.md`、`CLAUDE.md`、`AGENTS.local.md`、`CLAUDE.local.md`。页面只提交 scope、workspace、链上目录和文件名，宿主侧重新计算目标并校验白名单，浏览器不能指定任意路径。
- **写入绕过 Agent 的文件沙箱**。这是在编辑用户自己的配置，不是 Agent 的工具调用；因此由插件直接写文件，并用白名单、符号链接拒绝和信任检查限制范围。
- **单文件 1 MiB**。超过上限的文件不会在页面里打开，保存也会被拒绝。
- **外部修改只在保存时检测**。页面不监视文件变化，也不会自动刷新草稿。
- 不新增 Agent 工具；Agent 仍可用 `write`/`edit` 修改同一文件，冲突保护对两边都有效。

## 配置

没有配置项。要停用整个插件，在 profile 的 patch 层把 `agents-md` 行设为 `enabled: false`。

## 排障

| 现象 | 处理 |
| --- | --- |
| 设置里没有「Agent 指令」 | 确认插件已安装并重启过 DSH；查看插件是否因 DSH 版本不匹配而加载失败 |
| 页面提示 403 | 请求未通过宿主信任检查；确认从当前 `dsh web` 打印的地址打开，而不是别的来源 |
| 项目下拉为空 | 还没有注册 workspace；先在侧边栏添加项目 |
| 保存返回 409 | 文件在读取后被改动；按提示重新加载或覆盖保存 |
| 保存失败（500） | 检查目标目录的写权限，或文件是否位于只读挂载 |
| 文件不在列表里 | 只显示已存在的 `CLAUDE.md` 和 `.local` 覆盖；`AGENTS.md` 始终显示 |

## 兼容性

- 实测通过：DSH `0.2.1-rc.2`。
- `package.json` 的 `engines.dsh` 为 `>=0.2.1-rc.2 <0.3.0-0`。插件使用 `webServer.register`、`connection.requestRejection` 与 `workspaceRegistry.get`；这些接口变化时会在加载或请求阶段报错，不会静默退回旧行为。
