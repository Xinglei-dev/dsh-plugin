# dsh-plugin

DeepSeek Harness 插件集合。DeepSeek Harness（下称 DSH）是一个插件化的编码代理运行时，该仓库收集本人维护的社区插件：它们补上官方暂未提供的使用体验，按 DSH 的插件机制安装，不修改 DSH 自身的安装文件。

## 插件

| 插件 | 状态 | 说明 |
|---|---|---|
| [dsh-fixed-pairing-token](plugins/dsh-fixed-pairing-token/) | 设计中，尚未实现 | 用固定 token 替换 DSH Web 每次启动随机生成的启动 token，让收藏的 GUI 地址在重启后仍然可用。设计说明见 [design.md](plugins/dsh-fixed-pairing-token/docs/design.md)。 |

插件尚未实现，所以下表之外没有可安装的内容。第一个插件发布后，这里会补上安装命令。

## 使用前提

- Node.js `^22.19.0 || >=24.0.0`（与 DSH 的要求一致）。
- 已经能用 `npx @deepseek-ai/dsh web` 启动 DSH，并知道自己的 profile 目录位于 `$DSH_HOME/profiles/<name>`，未设置 `DSH_HOME` 时为 `~/.dsh/profiles/<name>`。
- 每个插件按 DSH 的“插件包 + profile bundle”方式安装：包内自带 `cordis.patch.yml`，安装后由 `dsh plugin` 追加到 profile 的 `dsh.profile.bundles`。

## 安装插件

仓库是多个插件共用的 monorepo，每个插件是 `plugins/<包名>/` 下独立的 npm 包。安装单个插件时用 pnpm 的 git 子目录写法：

```sh
dsh plugin --profile web add \
  "git+https://github.com/Xinglei-dev/dsh-plugin.git#<commit>&path:/plugins/<包名>"
```

把 `<commit>` 换成该插件的发布提交，能避免上游仓库更新影响已部署环境。也可以安装默认分支：

```sh
dsh plugin --profile web add \
  "github:Xinglei-dev/dsh-plugin#path:/plugins/<包名>"
```

需要注意：

- 从仓库根直接 `add github:Xinglei-dev/dsh-plugin` 会把整个仓库当成一个包；仓库根没有 `package.json`，因此必须带 `path:` 片段。
- profile 不会自动安装 peer 依赖。插件 README 列出的 DSH 包如果在该 profile 中不存在，需要一并安装或从 profile 的 bundle 层获得。
- 安装或删除插件后重启 DSH 进程，新配置才会生效。

### 本地开发

```sh
git clone https://github.com/Xinglei-dev/dsh-plugin.git
cd dsh-plugin
dsh plugin --profile web add link:./plugins/dsh-fixed-pairing-token
```

`link:` 会在 profile 的 `node_modules` 里建立软链接，改代码后重启 DSH 即生效。`file:` 会把包拷贝成快照，不推荐用于开发。

## 仓库结构

```text
plugins/<包名>/
├── package.json          # 包名与插件目录名一致；dsh.bundle.patch 指向同目录的 cordis.patch.yml
├── cordis.patch.yml      # 向 profile 插入一行 loader entry
├── lib/index.js          # 插件本体
├── test/                 # 离线测试，不依赖正在运行的 DSH
├── docs/design.md        # 实现前的设计说明；实现完成后并入 README 并删除
└── README.md             # 安装、配置、排障与适用版本
```

新增插件和文档维护的约定见 [AGENTS.md](AGENTS.md)。

## 兼容性

插件针对具体 DSH 版本开发，在 `package.json` 中用 `peerDependencies` 或 `engines.dsh` 声明范围；每个插件的 README 写明实测通过的版本，以及依赖的非公开接口失效时的表现。DSH 处于 `0.2.x` 预发布阶段，内部接口仍会变化，升级 DSH 后建议重跑对应插件的离线测试。

## 参与与反馈

- 问题与建议开 [Issue](https://github.com/Xinglei-dev/dsh-plugin/issues)。
- 官方目前不接受外部 PR，社区插件的推荐做法是给自己的仓库加上 [`dsh-plugin`](https://github.com/topics/dsh-plugin) 话题。

## 许可

[MIT](LICENSE)
