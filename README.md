# dsh-plugin

个人维护的 [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness)（DSH）插件集合。

## 插件

下表列出正在设计的插件，目前都还不能安装。

| 插件 | 状态 | 说明 |
|---|---|---|
| `dsh-fixed-pairing-token` | 设计中 | 用固定 token 替换 DSH Web 每次启动随机生成的启动 token，使收藏的 GUI 地址在重启后仍然可用。设计约束见 [plugins/fixed-pairing-token/docs/design.md](plugins/fixed-pairing-token/docs/design.md)。 |

## 仓库结构

多个插件共用一个仓库，每个插件是 `plugins/` 下独立的 npm 包，可以单独安装、单独发版：

```text
plugins/<name>/
├── package.json          # dsh.bundle.patch 指向同目录的 cordis.patch.yml
├── cordis.patch.yml      # 向 DSH profile 插入一行 loader entry
├── lib/index.js          # 插件本体
├── test/                 # 离线测试，不依赖正在运行的 DSH
├── docs/design.md        # 实现前记录设计约束
└── README.md             # 安装、配置与排障
```

## 安装

插件装进某个 DSH profile：

```sh
dsh plugin --profile web add <包名>
```

本地开发时用 `link:` 而不是 `file:` 安装路径。`file:` 会把包拷贝成快照，改代码不生效。

## 兼容性

插件针对具体的 DSH 版本开发，在 `package.json` 里用 `peerDependencies` 或 `engines.dsh` 声明范围。DSH 目前处于 `0.2.x` 预发布阶段，内部接口仍会变化，因此每个插件的 README 会写明实测通过的版本以及失效时的表现。

## 许可

[MIT](LICENSE)
