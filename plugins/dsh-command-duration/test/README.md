# 测试

测试全部离线运行：不启动 DSH 服务，不读写 `$DSH_HOME`，不依赖正在运行的 GUI。

`pipeline.test.js` 和 `live.test.js` 会挂载真实的 DSH 包，从 checkout 直接运行前先把它们链接进插件目录：

```sh
cd plugins/dsh-command-duration
sh test/link-peers.sh
node --test
```

`test/link-peers.sh` 从 `dsh` 可执行文件的安装位置找到这些包，也可以把 `dsh` 的路径作为第一个参数传入。缺少链接时这两个文件跳过，`format.test.js` 仍可单独运行。

## 四个文件的分工

- `format.test.js`：耗时文本、状态行位置和后台总时长的取值口径。包括毫秒与秒的切换，`[exit code: N]`、`[killed by signal: …]`、`[status: …]` 保持在最后一行，运行中或缺时间戳的 Job 不产出总时长，非 `bash` 的 Job 不标记。
- `pipeline.test.js`：挂载真实的 `@deepseek-ai/dsh-tools` 和 `@deepseek-ai/cordis`，用伪造的 `bash` / `job_output` 执行完整的工具管线，断言模型读到的结果。覆盖成功与失败命令的耗时、后台启动的标记、任务终态的总时长、非 Bash 工具不受影响、未加载或卸载插件后结果回到原样，以及和截断、阻断、替换值等其他结果改写策略共存时的行为。
- `live.test.js`：挂载真实的 `dsh-tool-bash`、`dsh-tool-jobs`、`dsh-jobs-local`、`dsh-bash-local` 与 `dsh-subprocess-local`，在能运行 `bash` 的 POSIX 环境里执行真实命令。覆盖前台成功与失败、后台任务的启动与等待、`job_output(wait=true)` 超时后仍不伪报总时长、前台超时转后台后总时长覆盖整项任务、其他类型 Job 不受影响。全部使用亚秒级命令。
- `client.test.js`：用最小的 React 替身加载 `lib/client.js`，断言 Web 实时耗时的选择与显示规则——只计已派发的 `bash` 调用、参数仍在传时不计时、多命令合并计数、没法读的开始时间不猜、读数按量级取整，以及宿主时钟与浏览器时钟的偏差在挂载时被抵消。不启动浏览器。

浏览器里的卡片外观测不到，只能手点。

`node_modules/` 已在仓库 `.gitignore` 中，链接不入库。
