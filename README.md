# dsh-plugin

Community plugins for [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) (DSH), a plugin-driven coding-agent runtime. Each plugin adds something DSH does not ship yet, installs through DSH's own plugin mechanism, and leaves the DSH installation untouched.

[English](README.md) | [中文](README.zh.md)

## Plugins

| Plugin | Status | What it does |
|---|---|---|
| [dsh-fixed-pairing-token](plugins/dsh-fixed-pairing-token/) | Design stage, not implemented | Replaces the per-launch random Web start token with a fixed one, so a bookmarked GUI address keeps working across restarts. Design notes: [design.md](plugins/dsh-fixed-pairing-token/docs/design.md). |

Nothing here is installable yet. Install commands will be added with the first release.

## Requirements

- Node.js `^22.19.0 || >=24.0.0`, matching DSH.
- A working DSH installation (`npx @deepseek-ai/dsh web`) and knowledge of where its profile lives: `$DSH_HOME/profiles/<name>`, or `~/.dsh/profiles/<name>` when `DSH_HOME` is unset.
- Plugins ship as a normal package plus a `cordis.patch.yml` bundle layer. `dsh plugin` adds the package to the profile and appends it to `dsh.profile.bundles`.

## Installing a plugin

This repository is a monorepo; each plugin is an independent npm package under `plugins/<package-name>/`. Install one plugin with pnpm's git subdirectory syntax:

```sh
dsh plugin --profile web add \
  "git+https://github.com/Xinglei-dev/dsh-plugin.git#<commit>&path:/plugins/<package-name>"
```

Pin `<commit>` to the release commit of that plugin so later repository changes cannot alter a deployed setup. Tracking the default branch also works:

```sh
dsh plugin --profile web add \
  "github:Xinglei-dev/dsh-plugin#path:/plugins/<package-name>"
```

Notes:

- `dsh plugin add github:Xinglei-dev/dsh-plugin` without a `path:` fragment treats the whole repository as one package. The repository root has no `package.json`, so the fragment is required.
- Profiles do not install peer dependencies automatically. Any DSH package a plugin README lists must already be present in that profile.
- Restart the DSH process after installing or removing a plugin.

### Local development

```sh
git clone https://github.com/Xinglei-dev/dsh-plugin.git
cd dsh-plugin
dsh plugin --profile web add link:./plugins/dsh-fixed-pairing-token
```

`link:` creates a symlink in the profile's `node_modules`, so source edits take effect on the next DSH restart. `file:` copies a snapshot instead and is not suitable for development.

## Repository layout

```text
plugins/<package-name>/
├── package.json          # package name matches the directory; dsh.bundle.patch points at cordis.patch.yml
├── cordis.patch.yml      # inserts one loader entry into the profile
├── lib/index.js          # the plugin
├── test/                 # offline tests, no running DSH required
├── docs/design.md        # pre-implementation design notes (design.zh.md for Chinese)
└── README.md             # install, configuration, troubleshooting, tested DSH versions
```

Conventions for adding plugins and maintaining docs are in [AGENTS.md](AGENTS.md).

## Compatibility

Plugins target specific DSH versions and declare a range through `peerDependencies` or `engines.dsh`. Each plugin README names the versions it was tested against and how it fails when a non-public interface it depends on changes. DSH is at `0.2.x` pre-release, so internal interfaces still move; rerun a plugin's offline tests after upgrading DSH.

## Feedback

- File questions and bugs in [Issues](https://github.com/Xinglei-dev/dsh-plugin/issues).
- DSH does not accept external pull requests today; adding the [`dsh-plugin`](https://github.com/topics/dsh-plugin) topic to your own plugin repository is the recommended way to make it discoverable.

## License

[MIT](LICENSE)
