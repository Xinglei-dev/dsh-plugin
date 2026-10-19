# 测试

测试全部离线运行：不启动 DSH 服务，不读写 `$DSH_HOME`，不依赖正在运行的 GUI。

插件本体导入 `@deepseek-ai/schemastery`（在 `peerDependencies` 中声明），测试还会挂载真实的 `@deepseek-ai/cordis` 与 `@deepseek-ai/dsh-client-connection`。从仓库 checkout 直接跑测试前，先把这三者链接进插件目录：

```sh
cd plugins/dsh-fixed-pairing-token
sh test/link-peers.sh
node --test
```

`test/link-peers.sh` 从 `dsh` 可执行文件的安装位置找到这三个包，也可以把 `dsh` 的路径作为第一个参数传入。安装到 profile 后不需要这一步：profile 的链接包解析会把插件对这三个包的导入路由到 DSH 安装目录。

## 两层测试

- `token.test.js`、`pin.test.js` 用伪造的 `connection` 对象测试 token 读取、字段形状校验和钉住/还原。
- `upstream.test.js` 在内存里伪造 credential provider，挂载真实的上游 Connection，验证真实 `BrowserAuth` 上的钉住、加载失败与 Connection 重载后的重新钉住。

`node_modules/` 已在仓库 `.gitignore` 中，链接不入库。
