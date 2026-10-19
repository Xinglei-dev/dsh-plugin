# dsh-plugin

DeepSeek Harness（DSH）插件，每个插件是 `plugins/<包名>/` 下独立的 npm 包。

## 插件

| 插件 | 说明 |
|---|---|
| [dsh-fixed-pairing-token](plugins/dsh-fixed-pairing-token/) | 把 DSH Web 的启动 token 固定成配置值，重启后收藏的 GUI 地址仍然可用。 |

## 使用前提

- Node.js `^22.19.0 || >=24.0.0`。
- 能运行 `dsh web`。profile 目录位于 `$DSH_HOME/profiles/<name>`，未设置 `DSH_HOME` 时为 `~/.dsh/profiles/<name>`。

## 安装插件

从本仓库安装单个插件：

```sh
dsh plugin --profile web add \
  "github:Xinglei-dev/dsh-plugin#path:/plugins/<包名>"
```

需要锁定版本时在 `#` 后写 commit，并用 `&` 连接 `path:` 片段：

```sh
dsh plugin --profile web add \
  "git+https://github.com/Xinglei-dev/dsh-plugin.git#<commit>&path:/plugins/<包名>"
```

需要注意：

- 不能省略 `path:` 片段。仓库根没有 `package.json`，省略后 pnpm 会把整个仓库当成一个包安装。
- 安装或删除插件后重启 DSH 进程，新配置才会生效。

各插件的配置方法写在该插件目录的 README 里。

## 仓库结构

```text
plugins/<包名>/
├── package.json          # 包名与目录名一致，dsh.bundle.patch 指向同目录的 cordis.patch.yml
├── cordis.patch.yml      # 安装时向 profile 插入的 loader entry
├── lib/index.js          # 插件本体
├── test/                 # 离线测试
└── README.md             # 安装、配置、排障与适用的 DSH 版本
```

仓库的开发约定见 [AGENTS.md](AGENTS.md)。

## 兼容性

每个插件针对具体的 DSH 版本开发，适用的版本写在插件自己的 README 里。DSH 处于 `0.2.x` 预发布阶段，内部接口仍会变化；插件依赖的非公开接口一旦变化，插件会在加载阶段报错，不会继续按旧行为运行。升级 DSH 后先看插件 README 的版本范围，不兼容时升级插件。

## 反馈

问题和建议提到 [Issues](https://github.com/Xinglei-dev/dsh-plugin/issues)。

## 许可

[MIT](LICENSE)
