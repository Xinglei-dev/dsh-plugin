# 测试

测试全部离线运行：不启动 DSH 服务，不读写 `$DSH_HOME`，不依赖正在运行的 GUI。

从仓库 checkout 直接跑测试前，先把测试要挂载的 DSH 包链接进插件目录：

```sh
cd plugins/dsh-command-duration
sh test/link-peers.sh
node --test
```

`test/link-peers.sh` 从 `dsh` 可执行文件的安装位置找到这些包，也可以把 `dsh` 的路径作为第一个参数传入。安装到 profile 后不需要这一步：插件运行时不导入任何外部包，测试里的导入由 profile 的链接包解析完成。缺少这些包时 `pipeline.test.js` 与 `live.test.js` 显示跳过，`format.test.js` 仍可单独运行。

## 三层测试

- `format.test.js` 覆盖耗时文本、状态行位置和后台总时长的取值口径：毫秒与秒的切换、`[exit code: N]` / `[killed by signal: …]` / `[status: …]` 保持在最后一行、运行中或缺时间戳的 Job 不产出总时长、非 `bash` 的 Job 不标记。
- `pipeline.test.js` 挂载真实的 `@deepseek-ai/dsh-tools` 和 `@deepseek-ai/cordis`，用伪造的 `bash` / `job_output` 工具走完整的工具管线。断言的是模型读到的结果：成功与失败命令的耗时、后台启动的标记、任务终态的总时长、非 Bash 工具不受影响、未加载或卸载插件后结果回到原样，以及和其他结果改写策略（截断、阻断、替换值）同时存在时的行为。
- `live.test.js` 挂载真实的 `dsh-tool-bash`、`dsh-tool-jobs`、`dsh-jobs-local`、`dsh-bash-local` 与 `dsh-subprocess-local`，执行真实命令。覆盖前台成功与失败、后台任务的启动与等待、`job_output(wait=true)` 超时后仍不伪报总时长、前台超时转后台后总时长覆盖整项任务、其他类型 Job 不受影响。只用亚秒级命令，不额外等待几十秒。

浏览器里的卡片外观测不到，那部分只能手点。

`node_modules/` 已在仓库 `.gitignore` 中，链接不入库。
