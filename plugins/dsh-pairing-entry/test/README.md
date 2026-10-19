# 测试

测试全部离线运行：不启动 DSH 服务，不读写 `$DSH_HOME`，不依赖正在运行的 GUI。

插件本体导入 `@deepseek-ai/schemastery`（在 `peerDependencies` 中声明），`upstream.test.js` 还会挂载真实的 `@deepseek-ai/cordis`、`@deepseek-ai/dsh-client-connection`，并读取 `@deepseek-ai/dsh-settings` 的 schema 投影函数。从仓库 checkout 直接跑测试前，先把这四个包链接进插件目录：

```sh
cd plugins/dsh-pairing-entry
sh test/link-peers.sh
node --test
```

`test/link-peers.sh` 从 `dsh` 可执行文件的安装位置找到这四个包，也可以把 `dsh` 的路径作为第一个参数传入。安装到 profile 后不需要这一步：profile 的链接包解析会把插件对这三个包的导入路由到 DSH 安装目录。

## 三层测试

- `host.test.js` 用伪造的 `connection`、`webServer` 和 `ctx` 测试密钥读取与校验、路由注册、信任栅栏拒绝、303 的相对地址、方法限制和请求期的 token 失败。
- `upstream.test.js` 在内存里伪造 credential provider，挂载真实的上游 Connection，验证真实 `BrowserAuth` 的 token、真实 `requestRejection` 的 403 判定，以及真实 Schemastery 把 volatile 字段解析成引用对象；另外用真实的 settings schema 投影确认设置面板只会看到 `key` 一个字段、无 key 时该字段仍可编辑。
- `client.test.js` 在 Node 里伪造 `window.__ModuleLoader__`、`react` 和客户端服务，加载 `lib/client.js`，检查 bundle 的 id、`inject`、字典、tab 注册，以及用最小 hook 运行时渲染出的表单状态（加载中、不可用、空密钥、只读、生成、保存、清除）。

浏览器里的实际外观与交互测不到，那部分只能手点。

`node_modules/` 已在仓库 `.gitignore` 中，链接不入库。
