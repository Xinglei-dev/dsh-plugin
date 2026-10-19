# dsh-plugin

个人维护的 [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness)（DSH）插件集合。

**当前状态**：仓库刚刚初始化，还没有已发布的插件。下面列出的插件处于设计阶段，安装说明会在实现完成后补上。

## 插件

| 插件 | 状态 | 说明 |
|---|---|---|
| `dsh-fixed-pairing-token` | 设计中，未实现 | 用固定 token 替换 DSH Web 每次启动随机生成的启动 token，使收藏的 GUI 地址在重启后仍然有效。设计约束见 [docs/plans/fixed-pairing-token.md](docs/plans/fixed-pairing-token.md)。 |

## 仓库结构

每个插件是 `plugins/` 下独立的 npm 包，可以单独安装、单独发版：

```text
plugins/<name>/
├── package.json          # dsh.bundle.patch 指向自己的 cordis.patch.yml
├── cordis.patch.yml      # 向 DSH profile 插入一行 loader entry
├── lib/index.js          # 插件本体
├── test/                 # 离线测试，不依赖正在运行的 DSH
└── README.md             # 使用、配置与排障
```

## 安装

插件实现完成后，通过 DSH 自带的插件管理命令装入某个 profile：

```sh
dsh plugin --profile web add <包名或路径>
```

本地开发使用 `link:` 而不是 `file:`：`file:` 会把包拷贝成快照，改代码不生效。

## 兼容性

插件会针对具体的 DSH 版本发布，并在 `package.json` 中声明 `peerDependencies` 或 `engines.dsh`。DSH 仍处于 `0.2.x` 预发布阶段，内部接口可能变化；每个插件的 README 会写明它实测通过的版本，以及失效时的表现。

## 许可

[MIT](LICENSE)
