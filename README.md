# dsh-plugin

DeepSeek Harness（DSH）插件，每个插件是 `plugins/<包名>/` 下独立的 npm 包。

## 插件

| 插件 | 状态 | 说明 |
|---|---|---|
| [dsh-fixed-pairing-token](plugins/dsh-fixed-pairing-token/) | 设计中，尚未实现 | 用固定 token 替换 DSH Web 每次启动随机生成的启动 token，让收藏的 GUI 地址在重启后仍然可用。设计说明见 [design.md](plugins/dsh-fixed-pairing-token/docs/design.md)。 |

上表中的插件尚未实现，暂时没有可安装的内容。

## 使用前提

- Node.js `^22.19.0 || >=24.0.0`。
- 能运行 `npx @deepseek-ai/dsh web`。profile 目录位于 `$DSH_HOME/profiles/<name>`，未设置 `DSH_HOME` 时为 `~/.dsh/profiles/<name>`。

## 安装插件

安装单个插件用 pnpm 的 git 子目录写法：

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

- 不能省略 `path:` 片段。仓库根没有 `package.json`，省略后 pnpm 会把整个仓库当成一个包安装。
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
├── package.json          # 包名与目录名一致，dsh.bundle.patch 指向同目录的 cordis.patch.yml
├── cordis.patch.yml      # 安装时向 profile 插入的 loader entry
├── lib/index.js          # 插件本体
└── README.md             # 安装、配置、排障与适用的 DSH 版本
```

仓库的开发约定见 [AGENTS.md](AGENTS.md)。

## 兼容性

每个插件针对具体的 DSH 版本开发，适用的版本写在插件自己的 README 里。DSH 处于 `0.2.x` 预发布阶段，内部接口仍会变化；插件依赖的非公开接口一旦变化，插件会在加载阶段报错，不会继续按旧行为运行。升级 DSH 后先看插件 README 的版本范围，不兼容时升级插件。

## 参与与反馈

- 问题与建议开 [Issue](https://github.com/Xinglei-dev/dsh-plugin/issues)。
- 官方目前不接受外部 PR；插件仓库可以通过 [`dsh-plugin`](https://github.com/topics/dsh-plugin) 话题提高曝光。

## 许可

[MIT](LICENSE)
