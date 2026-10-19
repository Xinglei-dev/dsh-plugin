# AGENTS.md

本仓库是个人维护的 DSH（DeepSeek Harness）插件集合。以下约定面向在本仓库里工作的人和 AI 代理。

## 仓库形状

- 一个仓库容纳多个插件，每个插件是 `plugins/<name>/` 下独立的 npm 包，有自己的 `package.json`、`cordis.patch.yml`、`lib/`、`test/` 和 `README.md`。
- 仓库根目录只放仓库级文档、许可和忽略规则，不放可发布的包。
- 插件之间不共享运行时依赖。需要共用的代码先各自复制，出现第三份重复时再抽包。

## 新增插件

1. 建 `plugins/<name>/`，在 `package.json` 里声明 `"dsh": { "bundle": { "patch": "./cordis.patch.yml" } }`。
2. `cordis.patch.yml` 只插入一行 loader entry（`id` 加 `name`）；插件自身的配置留在使用者的 profile patch 层。
3. 在 `test/` 写离线测试：不启动 DSH 服务，不依赖正在运行的 GUI，不读写 `$DSH_HOME`。
4. 更新根 README 的插件表格。

## DSH 版本

- 插件针对具体的 DSH 版本开发，在 `package.json` 用 `peerDependencies` 或 `engines.dsh` 声明范围，README 写明实测通过的版本。
- DSH 处于 `0.2.x` 预发布阶段，内部接口会变。插件依赖非公开字段时，字段形状不符要在加载阶段抛错，不能静默退回旧行为。
- 升级 DSH 后重跑该插件的离线测试，再更新 README 中的版本声明。

## 测试与验证

- 优先写离线测试：伪造服务对象，或在 `/tmp` 下复制上游实现后直接实例化，避免污染本机运行环境。
- 需要端到端验证时，使用临时 `DSH_HOME` 和独立端口，不占用正在运行的 GUI 端口。
- 重启使用者正在运行的 GUI 进程需要事先确认，不默认执行。

## 文档

- 每个插件的 `README.md` 是该插件的权威说明：做什么、怎么装、怎么配、怎么排障、适用哪个 DSH 版本。
- 实现前的设计约束写在 `plugins/<name>/docs/design.md`，文件首行标注未实现。实现完成后，仍然有效的内容并入该插件 README，design 文件删除。
- 同一条规则只维护一份完整定义，其他位置链接过去。

## 提交

- 提交信息用 `type: 摘要`（`feat` / `fix` / `docs` / `chore` / `test`）；语言在单个仓库内保持一致。
- 一个提交对应一件可独立回滚的事；格式化、重构与功能改动分开提交。
- 提交前确认没有把 `$DSH_HOME` 下的凭据、启动 URL、token 或会话日志带进仓库。
