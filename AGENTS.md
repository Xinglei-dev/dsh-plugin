# AGENTS.md

This repository collects community plugins for DSH (DeepSeek Harness). Readers are plugin users, developers changing the code, and AI agents working in this repository.

中文约定见 [AGENTS.zh.md](AGENTS.zh.md)。

## Repository shape

- One repository hosts several plugins. Each plugin is an independent npm package at `plugins/<package-name>/`, and the directory name matches the `name` field in its `package.json`.
- A plugin directory carries `package.json`, `cordis.patch.yml`, `lib/`, `test/`, `docs/` and `README.md`, mirroring its installed form inside a DSH profile.
- The repository root holds only repository-level documents, the license and ignore rules. It has no `package.json`.
- Plugins do not share runtime dependencies. Copy code between plugins first; extract a shared package once a third copy appears.

## Adding a plugin

1. Create `plugins/<package-name>/` and declare `"dsh": { "bundle": { "patch": "./cordis.patch.yml" } }` in `package.json`.
2. `cordis.patch.yml` inserts one loader entry (`id` plus `name`). Plugin configuration belongs to the user's profile patch layer, never baked into the package.
3. Put offline tests in `test/`: no running DSH server, no live GUI, no reads or writes under `$DSH_HOME`.
4. Write `README.md` covering installation, configuration, troubleshooting and tested DSH versions, then update the plugin table in the root README.

## DSH versions

- Target a specific DSH version, declare the range through `peerDependencies` or `engines.dsh`, and state the tested version in the plugin README.
- DSH is at `0.2.x` pre-release, so internal interfaces move. When a plugin depends on a non-public field, a shape mismatch must fail at load time instead of silently falling back to the old behavior.
- Cite upstream implementation through `dsh-v<version>` tag permalinks, not `master`, so links do not drift with upstream changes.
- After upgrading DSH, rerun the plugin's offline tests and update the version statement in its README.

## Installation

- Installing one plugin from GitHub requires pnpm's `path:` fragment, because the repository root is not a package:
  `dsh plugin --profile web add "github:Xinglei-dev/dsh-plugin#path:/plugins/<package-name>"`
- To pin a version, put the commit after `#` and join the `path:` fragment with `&`.
- Use `link:` for local development; `file:` copies a snapshot and ignores later source edits.
- Plugins are not published to npm unless publishing is explicitly decided, which would make `dsh plugin add <package-name>` work directly.

## Testing and verification

- Prefer offline tests: fake the service objects, or copy the upstream implementation into `/tmp` and instantiate it there, so the local environment stays clean.
- For end-to-end checks, use a temporary `DSH_HOME` and a separate port; never take over the port of a running GUI.
- Restarting a GUI process the user is running requires explicit confirmation.

## Documentation

- Each plugin's `README.md` is the authoritative user-facing description. `docs/design.md` covers pre-implementation design, starts with a not-implemented notice, and is merged into the README and deleted on release.
- The root README holds repository-level information only: plugin list, requirements, installation, feedback. Per-plugin usage lives inside the plugin directory.
- Keep one complete definition of each rule and link to it from elsewhere.
- Write for public readers: no context only the author has, and no work-in-progress log in the body.

## Commits

- Use `type: summary` messages (`feat` / `fix` / `docs` / `chore` / `test`) and one language consistently across the repository.
- One commit per independently revertible change; keep formatting, refactoring and behavior changes separate.
- Before committing, confirm no credentials, startup URLs, tokens or session logs from `$DSH_HOME` entered the repository.
