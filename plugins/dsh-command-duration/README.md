# dsh-command-duration

在模型读到的工具结果里追加一行 Bash 耗时：前台命令给出这次调用等了多久，后台任务在 `job_output` 读到终态时给出任务总运行时长。

## 背景

工具结果能说明命令是否成功，却不说明花了多久。Agent 无法区分 20 毫秒的检查和两分钟的构建，可能为了看另一行错误信息把昂贵的命令再跑一遍。本插件在结果文本中追加耗时，供 Agent 判断时间成本。

插件只提供耗时信息，不判断是否值得重复执行，也不拦截、改写或重试任何命令；与 [dsh-sleep-guard](../dsh-sleep-guard/) 互不替代。

## 展示内容

| 情形 | 追加的一行 |
| --- | --- |
| 前台 Bash 命令 | `【命令调用耗时：2.4 秒】` |
| `run_in_background: true` 启动 | `【命令调用耗时：11 毫秒（仅启动后台 Job，不含任务运行时间）】` |
| 前台等待超时、任务转入后台 | `【命令调用耗时：104 毫秒（前台等待，任务在后台继续运行）】` |
| 后台 Bash 任务结束后的 `job_output` | `【后台任务运行耗时：417 毫秒】` |

耗时按量级显示：不足 1 毫秒写「不到 1 毫秒」，不足 1 秒写整数毫秒，不足 1 分钟以秒为单位保留一位小数，更长按整秒。

追加行插在输出正文之后、状态标记之前：`[exit code: N]`、`[killed by signal: …]`、`[timed out after Nms]` 和 `job_output` 的 `[status: …]` 仍是结果的最后一行。DSH 依据这一行的位置解析退出状态，因此追加行不会改变它。stdout、stderr、Job ID 和 Job 状态都不改动。

## 计时口径

- **命令调用耗时**：这次调用从发起到拿回结果的墙钟时间，包含命令执行、输出收集，以及调用期间的策略与审批等待；不是 CPU 时间，也不是操作系统测得的纯进程运行时间。
- **后台任务运行耗时**：取自 Job 记录的开始与结束时间，覆盖整项任务从启动到结束，只在 `job_output` 读到 `completed`、`killed` 或 `failed` 时显示。任务仍在 `running` / `stopping` 时不显示，单次 `job_output` 等待的时长也不会被当成任务总时长；前台超时转后台的任务按同一口径计算，看到的是任务总时长，而非先前那次前台等待。

插件自身计时或追加文本失败时，结果保持原样，命令不会因此失败、重试或改变执行方式。Bash 调用本身以工具错误结束（策略拒绝、取消、启动失败等）时同样不追加这一行。

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

没有配置项。要停用，在 profile 的 patch 层给 `command-duration` 这一行加 `disabled: true`，或直接卸载插件。停用后工具结果与未安装插件时一致。

## 范围与限制

- 只处理名为 `bash` 的工具，包括一次性的 `dsh-tool-bash` 和持久化的 `dsh-tool-bash-persistent`；`pwsh`、`terminal_send` 和文件工具等不受影响。
- 后台耗时只处理 `kind` 为 `bash` 的 Job；workflow 等其他类型的 Job 在 `job_output` 里保持原样。
- **PTC 模式下模型看不到这一行。** 模型只看到 `run_code` 程序打印或返回的内容，子调用的工具结果不进入模型上下文。耗时行仍写入 Session 中该子调用的记录（界面可见），但模型读不到；需要模型直接看到耗时，请使用原生工具调用模式。
- **不做统计，也不做判断。** 没有耗时数据库、阈值提醒、重复命令识别或执行建议。
- **前台数值包含调用开销。** 需要纯进程计时，请在命令里自行使用 `time`。
- **后台总时长依赖 Job 记录的时间。** 拿不到可用的开始或结束时间时省略这一行，不做估算。

## 支持的 DSH 版本

在 DSH `0.2.1-rc.2` 上实测通过。`package.json` 的 `engines.dsh` 声明为 `>=0.2.1-rc.2 <0.3.0-0`。

插件监听 `tools/pre-execute` 和 `tools/post-execute`，读取 `exec.name`、`exec.arguments`、`result.value`，以及 `job_output` 返回的 `{ text, job }` 里的 `kind`、`status`、`startedAt`、`finishedAt`。这些字段属于 DSH 内部接口：形状不符时插件省略耗时行并记一条警告，不会让命令失败。升级 DSH 后请确认耗时行仍然出现。

## 本地开发

从 checkout 运行时先链接测试所需的 DSH 包：

```sh
cd plugins/dsh-command-duration
sh test/link-peers.sh
node --test
```

测试说明见 [test/README.md](test/README.md)。

## 许可证

[MIT](../../LICENSE)
