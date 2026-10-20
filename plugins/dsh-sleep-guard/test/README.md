# 测试

测试全部离线运行：不启动 DSH 服务，不读写 `$DSH_HOME`，不依赖正在运行的 GUI。

`hook.test.js` 挂载真实的 `@deepseek-ai/dsh-tools` 和 `@deepseek-ai/cordis`，从插件目录直接跑测试前先把这两个包链接进来：

```sh
cd plugins/dsh-sleep-guard
sh test/link-peers.sh
node --test
```

`test/link-peers.sh` 从 `dsh` 可执行文件的安装位置找到这两个包，也可以把 `dsh` 的路径作为第一个参数传入。安装到 profile 后不需要这一步：插件运行时不导入任何外部包，测试里的这两个导入由 profile 的链接包解析完成。

## 两层测试

- `matcher.test.js` 覆盖 README 拦截表格中的全部案例，另外检查前导空白、制表符、分数时长、后缀、注释与重定向边界，以及 `sleepy`、`echo sleep 300`、`sleep $DELAY`、`sleep 10abc` 这类不能误拦截的写法。非字符串输入按“没有命令”处理。
- `hook.test.js` 把插件挂到真实的 `ToolRuntime` 上，只伪造它构造时要用到的 `systemPrompt`。这样断言的是工具结果本身：拒绝时 `isError` 为真、拒绝原因出现在 Agent 可见的文本里、命令体一次都没执行；放行时命令体执行、后续监听器仍然被调用；拒绝时后续监听器不再被调用。

浏览器里的插件列表外观（标题、描述、图标）测不到，那部分只能手点。

`node_modules/` 已在仓库 `.gitignore` 中，链接不入库。
