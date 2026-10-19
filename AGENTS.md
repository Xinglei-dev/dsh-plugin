# AGENTS.md

以下约定面向修改代码的人和在本仓库工作的 AI 代理。

## 仓库形状

- 本仓库自行开发多个插件。每个插件是 `plugins/<包名>/` 下独立的 npm 包，目录名与 `package.json` 的 `name` 一致。
- 插件目录自带 `package.json`、`cordis.patch.yml`、`lib/`、`test/`、`docs/` 和 `README.md`，与它在 DSH profile 中安装后的形态一致。
- 仓库根目录只放仓库级文档、许可和忽略规则，不放可发布的包。仓库根没有 `package.json`。
- 插件之间不共享运行时依赖。需要复用的代码先各自复制，出现第三份重复时再抽包。

## 新增插件

1. 建 `plugins/<包名>/`，在 `package.json` 中声明 `"dsh": { "bundle": { "patch": "./cordis.patch.yml" } }`。
2. `cordis.patch.yml` 只插入一行 loader entry（`id` 加 `name`）；插件自身的配置留在使用者的 profile patch 层，不写死进包内。
3. 在 `test/` 写离线测试：不启动 DSH 服务，不依赖正在运行的 GUI，不读写 `$DSH_HOME`。
4. 写 `README.md`：安装命令、配置、排障、实测通过的 DSH 版本。更新根 README 的插件表格。

## DSH 版本

- 插件针对具体 DSH 版本开发，在 `package.json` 用 `peerDependencies` 或 `engines.dsh` 声明范围，README 写明实测通过的版本。
- DSH 处于 `0.2.x` 预发布阶段，内部接口会变。插件依赖非公开字段时，字段形状不符要在加载阶段抛错，不能静默退回旧行为。
- 引用上游实现时用 `dsh-v<版本>` tag 的 permalink，不用 `master`，否则链接会随上游变化而失配。
- 升级 DSH 后重跑该插件的离线测试，再更新 README 中的版本声明；README 只写使用者需要知道的适用版本，不写测试步骤。

## 安装方式

- 使用者从 GitHub 安装单个插件，必须带 pnpm 的 `path:` 片段，因为仓库根不是包：
  `dsh plugin --profile web add "github:Xinglei-dev/dsh-plugin#path:/plugins/<包名>"`
- 需要锁定版本时在 `#` 后写 commit，并用 `&` 连接 `path:` 片段。
- 本地开发用 `link:`；`file:` 会拷贝成快照，改代码不生效。
- 不把插件发布到 npm，除非明确决定要让 `dsh plugin add <包名>` 直接可用。

## 测试与验证

- 优先写离线测试：伪造服务对象，或在 `/tmp` 下复制上游实现后直接实例化，避免污染本机运行环境。
- 需要端到端验证时，使用临时 `DSH_HOME` 和独立端口，不占用正在运行的 GUI 端口。
- 重启使用者正在运行的 GUI 进程需要事先确认，不默认执行。

## 文档

- 每个插件的 `README.md` 是该插件的权威说明，面向使用者；`docs/design.md` 面向实现前的设计讨论，首行标注未实现，实现完成后把仍然有效的内容并入 README 并删除该文件。
- 根 README 只放仓库级信息：插件列表、安装前提、安装方法、参与方式。具体插件的用法写在插件目录内。
- 同一条规则只维护一份完整定义，其他位置链接过去。
- 文档面向公众读者，不写只有作者能看懂的上下文，也不把协作过程、本轮改动记录写进正文。

## 提交

- 提交信息用 `type: 摘要`（`feat` / `fix` / `docs` / `chore` / `test`）；语言在单个仓库内保持一致。
- 一个提交对应一件可独立回滚的事；格式化、重构与功能改动分开提交。
- 提交前确认没有把 `$DSH_HOME` 下的凭据、启动 URL、token 或会话日志带进仓库。
