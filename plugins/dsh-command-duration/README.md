# dsh-command-duration

在模型看到的工具返回内容里附上 Bash 调用的耗时：前台命令显示本次调用等了多久，后台任务在 `job_output` 读到终态时显示任务总运行时长。

## 背景

工具结果会说明命令是否成功，却不说花了多久。Agent 分不清 20 毫秒的检查和两分钟的构建，可能为了换一行错误信息把昂贵的命令再跑一遍。本插件在原有结果后追加一行耗时，供 Agent 判断时间成本。

插件只提供事实，不判断是否值得重复执行，也不拦截或改写任何命令。它与 [dsh-sleep-guard](../dsh-sleep-guard/) 互不替代。

## 展示内容

| 情形 | 追加的一行 |
| --- | --- |
| 前台 Bash 命令 | `【命令调用耗时：2.4 秒】` |
| `run_in_background: true` 启动 | `【命令调用耗时：11 毫秒（仅启动后台 Job，不含任务运行时间）】` |
| 前台超时转后台 | `【命令调用耗时：104 毫秒（前台等待，任务在后台继续运行）】` |
| 后台 Bash 任务结束后的 `job_output` | `【后台任务运行耗时：417 毫秒】` |

耗时短于 1 秒用毫秒表示，1 秒到 1 分钟保留一位小数，更长按整秒。

追加的行跟在原有内容之后，脚本输出的 `[exit code: N]`、`[killed by signal: …]` 和 `job_output` 的 `[status: …]` 仍是最后一行。stdout、stderr、退出状态、Job ID 和 Job 状态都保持原样。

## 两种时间不是一回事

- **命令调用耗时**是这次调用从开始等待到拿回结果的墙钟时间，不是 CPU 时间，也不是操作系统测得的纯进程运行时间。它包含命令本身、输出收集，以及调用期间的策略与审批等待。
- **后台任务运行耗时**只在 `job_output` 拿到任务的终态（`completed`、`killed`、`failed`）时显示，数值取自 Job 注册表记录的 `startedAt` 与 `finishedAt`，是整项任务从启动到结束的总时长。任务还在 `running` / `stopping` 时没有这一行，`job_output` 单次等待的时长不会被当成任务总时长。前台超时转后台的任务同样按这个口径计算，因此在 `job_output` 里看到的是任务总时长，而不是前面那次前台等待。

计时和追加文本失败时，工具结果保持原样，命令不会因此失败、重试或改变执行方式。

## 安装

从本仓库安装：

```sh
dsh plugin --profile web add \
  "github:Xinglei-dev/dsh-plugin#path:/plugins/dsh-command-duration"
```

锁定版本时在 `#` 后写 tag：

```sh
dsh plugin --profile web add \
  "git+https://github.com/Xinglei-dev/dsh-plugin.git#dsh-command-duration-v0.1.0&path:/plugins/dsh-command-duration"
```

`path:` 片段不能省，原因见[根 README](../../README.md#安装插件)。

本地开发用 `link:`：

```sh
dsh plugin --profile web add link:/绝对路径/dsh-plugin/plugins/dsh-command-duration
```

安装或卸载插件后要重启 `dsh web` 进程，插件才会被加载。

## 配置

没有配置项。要停用，在 profile 的 patch 层给 `command-duration` 这一行加 `disabled: true`，或直接卸载插件。停用后工具结果回到 DSH 原样，不留下任何计时状态。

## 生效范围

- 只处理名为 `bash` 的工具，包括一次性的 `dsh-tool-bash` 和持久化的 `dsh-tool-bash-persistent`。`pwsh`、`terminal_send`、文件工具等其他工具不受影响。
- 后台耗时只处理 `kind` 为 `bash` 的 Job。其他类型的后台 Job（例如 workflow）在 `job_output` 里保持原样。
- PTC 模式（`run_code` 内部的 `tools.bash(...)`）下，模型只看 `run_code` 程序自己打印或返回的内容，子调用的结果不进入模型上下文。因此这一行只写入 Session 里该子调用的记录（界面可见），不会出现在模型读到的结果里。需要让模型看到耗时的场景请使用原生工具调用模式。

## 限制

- **不统计历史。** 没有耗时数据库、阈值提醒或执行建议，也不识别重复命令。
- **前台的数值包含调用开销。** 它回答“这次调用等了多久”，不是精确的进程 CPU 时间；需要纯进程计时请在命令里自行使用 `time`。
- **后台总时长依赖 Job 记录的时间戳。** 拿不到可用的 `startedAt` / `finishedAt` 时省略这一行，不做估算。
- **不覆盖非 `bash` 命名的工具。** 若部署把 Bash 注册成别的工具名，本插件不会处理。

## 支持的 DSH 版本

在 DSH `0.2.1-rc.2` 上实测通过。`package.json` 的 `engines.dsh` 声明为 `>=0.2.1-rc.2 <0.3.0-0`。

插件读取 `tools/post-execute` 的 `exec.name` 与 `result.value`、`job_output` 返回的 `{ text, job }` 结构，以及 Bash 工具结果的 `kind` 字段。这些属于 DSH 内部接口：字段形状不符时插件只省略耗时行并记一条警告，不会让命令失败。升级 DSH 后请确认耗时行仍然出现。

## 本地开发

```sh
cd plugins/dsh-command-duration
sh test/link-peers.sh
node --test
```

测试说明见 [test/README.md](test/README.md)。

## 许可证

[MIT](../../LICENSE)
