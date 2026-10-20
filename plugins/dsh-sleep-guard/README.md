# dsh-sleep-guard

拦截以 `sleep N` 开头的 Bash 命令，让 Agent 改用 DSH 已有的长任务机制：后台 Job 加 `job_output(wait=true)`，或前台 `timeoutMs`。

## 背景

`sleep 300; cat /tmp/test.log` 按预估时间等待，等待本身不观察任务是否已经结束。后台任务可能 5 秒前就跑完了，Agent 仍要等满 300 秒才去读日志。

DSH 已有对应的机制：`run_in_background: true` 启动的后台任务立即返回 Job ID，`job_output(wait=true)` 在任务真正结束时返回。本插件在命令执行前拒绝固定等待，并把这条指引返回给 Agent。

## 拦截规则

只检查 Bash 命令的**开头**：

- 命令开头（允许前导空白）是独立的 `sleep` 单词，后面至少一个空白字符；
- 紧跟有效的数字时长：整数、小数，可带 `s` / `m` / `h` / `d` 后缀，不带后缀按秒；
- 数字时长之后是合法边界：命令结束、空白、Shell 分隔符或重定向符号，或 `#` 开始的注释。

| 命令 | 行为 |
| --- | --- |
| `sleep 300; cat /tmp/test.log` | 拦截 |
| `sleep 120 && grep PASS /tmp/test.log` | 拦截 |
| `sleep 30` | 拦截 |
| `  sleep 1m; echo done` | 拦截 |
| `sleep 0.5 && echo ready` | 拦截 |
| `pytest tests/` | 放行 |
| `echo sleep 300` | 放行 |
| `sleepy 300` | 放行 |
| `sleep $DELAY` | 放行 |
| `sleep 10abc` | 放行 |
| `cd project && sleep 60` | 放行（`sleep` 不在命令开头） |
| `bash -c 'sleep 60'` | 放行（同上） |

其他工具（`read`、`grep` 等）不受影响。

时长只认 `s`、`m`、`h`、`d` 四种后缀，不解析成秒数：规则的用途是识别“在固定等待”，不是复现 `sleep` 的参数语法。没有阈值、白名单或开关，`sleep 1` 与 `sleep 300` 一样拦截。

## 被拦截时 Agent 看到的内容

拒绝原因作为工具错误返回：

```text
Error: 已拦截：不要用 `sleep N` 固定等待任务完成。

- 任务已在后台运行、且你手上有 Job ID：用 `job_output(wait=true)` 等它结束并读取结果。
- 任务还没启动：直接执行实际命令；需要时用 Bash 的 `timeoutMs` 控制前台等待，或用 `run_in_background: true` 起后台任务。
- 不要用 `sleep N; cat/grep ...` 这类「先等再读日志」的方式轮询任务。
```

`job_output` 只对已经存在的 Job 有效，所以「已有 Job ID」和「任务还没启动」分开写。

## 安装

从本仓库安装：

```sh
dsh plugin --profile web add \
  "github:Xinglei-dev/dsh-plugin#path:/plugins/dsh-sleep-guard"
```

锁定版本时在 `#` 后写 tag：

```sh
dsh plugin --profile web add \
  "git+https://github.com/Xinglei-dev/dsh-plugin.git#dsh-sleep-guard-v0.1.0&path:/plugins/dsh-sleep-guard"
```

`path:` 片段不能省，原因见[根 README](../../README.md#安装插件)。

本地开发用 `link:`：

```sh
dsh plugin --profile web add link:/绝对路径/dsh-plugin/plugins/dsh-sleep-guard
```

安装或卸载插件后要重启 `dsh web` 进程，插件才会被加载。

## 配置

没有配置项。要停用，在 profile 的 patch 层给 `sleep-guard` 这一行加 `disabled: true`，或直接卸载插件。

## 限制

- **只看命令开头。** `cd project && sleep 60`、`bash -c 'sleep 60'`、脚本文件里的 `sleep` 都放行。识别这些位置需要解析 Shell 语法，本插件不做。
- **不防绕过。** `read -t 30`、`timeout 30 true`、`perl -e 'sleep 30'` 等等价写法不拦截。目标是拦住常见的写法，不是封堵所有等待手段。
- **不替代长任务机制。** 插件只拒绝固定等待，不启动 Job、不改写被拒命令、不查询 Job 状态，也不把长任务自动转为后台。前台 `timeoutMs`、`run_in_background`、`job_output` 的行为不变。

## 支持的 DSH 版本

在 DSH `0.2.1-rc.2` 上实测通过。`package.json` 的 `engines.dsh` 声明为 `>=0.2.1-rc.2 <0.3.0-0`。

插件读取 `tools/pre-execute` 事件里的 `exec.name` 和 `exec.arguments.command`，并返回 `{ kind: 'deny', reason }`。这些属于 DSH 内部接口：字段改名后插件读不到命令，会退回放行的旧行为，不会报错。升级 DSH 后请确认拦截仍然生效。

## 本地开发

```sh
cd plugins/dsh-sleep-guard
sh test/link-peers.sh
node --test
```

测试说明见 [test/README.md](test/README.md)。

## 许可证

[MIT](../../LICENSE)
