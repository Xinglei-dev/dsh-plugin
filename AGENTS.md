# AGENTS.md

本仓库是个人维护的 DSH（DeepSeek Harness）插件集合。这里的约定面向在本仓库里工作的人和 AI 代理。

## 仓库形状

- 一个插件 = `plugins/` 下的一个独立 npm 包，有自己的 `package.json`、`cordis.patch.yml`、`lib/`、`test/` 和 `README.md`。
- 不在仓库根放置可发布包；根目录只放仓库级文档、许可和忽略规则。
- 插件之间不共享运行时依赖。需要共用的代码先复制，出现第三个重复副本再考虑抽包。

## 新增插件

1. 建 `plugins/<name>/`，`package.json` 里加 `"dsh": { "bundle": { "patch": "./cordis.patch.yml" } }`。
2. `cordis.patch.yml` 只插入一行 loader entry（`id` + `name`），插件自己的配置留在 profile 的 patch 层。
3. 在 `test/` 写离线测试：不启动 DSH 服务、不依赖正在运行的 GUI、不读写 `$DSH_HOME`。
4. 更新根 README 的插件表格。

## DSH 版本

- 插件针对具体的 DSH 版本开发，在 `package.json` 声明 `peerDependencies`（或 `engines.dsh`），并在 README 写明实测通过的版本。
- DSH 处于 `0.2.x` 预发布阶段，内部接口会变。依赖非公开字段时，必须让插件在字段缺失时**启动即报错**，不能静默退回旧行为。
- 升级 DSH 后重跑该插件的离线测试，再更新 README 中的版本声明。

## 测试与验证

- 默认使用离线测试：伪造服务对象、或在 `/tmp` 下复制上游实现后直接实例化，避免污染本机运行环境。
- 需要端到端验证时使用临时 `DSH_HOME` 和独立端口，不占用正在运行的 GUI 端口。
- 重启真实 GUI 进程属于需要使用者确认的操作，不默认执行。

## 文档

- 每个插件的 `README.md` 是该插件的权威说明：它做什么、怎么装、怎么配、怎么排障、适用版本。
- 尚未实现的设计放 `docs/plans/`，文件内明确标注未实现；实现完成后把仍然有效的内容合并进插件 README 并删除计划文件。
- 同一个规则只维护一份完整定义，其余位置链接过去。

## 提交

- 提交信息用 `type: 摘要` 形式（`feat` / `fix` / `docs` / `chore` / `test`），摘要使用中文或英文均可，保持一致。
- 一个提交对应一件可独立回滚的事；格式化、重构和功能改动分开提交。
- 提交前确认没有把 `$DSH_HOME` 下的凭据、启动 URL、token 或会话日志带进仓库。
