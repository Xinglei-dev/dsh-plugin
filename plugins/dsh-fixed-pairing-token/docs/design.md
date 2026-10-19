# dsh-fixed-pairing-token

Replaces the random Web start token DSH generates on every launch with a fixed one.

> **Status: not implemented.** This is a pre-implementation design note; the plugin cannot be installed yet. Offline verification on DSH `0.2.1-rc.2` is complete, with results at the end.

[English](design.md) | [中文](design.zh.md)

## What the plugin changes

When DSH Web starts, it generates a random start token and appends it to the URL printed by `dsh web:`:

```text
dsh web: http://127.0.0.1:3080/?token=<different on every launch>
```

The browser exchanges that token for a signed cookie on its first request and authenticates with the cookie afterwards, so a restart does not sign you out. The address itself changes every launch, though, which breaks bookmarks and any link written down elsewhere. This plugin takes the token from configuration, so the address stays the same.

The plugin does not touch cookie issuance or verification; it only changes where the start token comes from.

## Two credentials

| Credential | Lifetime | Stored in |
|---|---|---|
| Start token (the `?token=` in the URL) | Generated once per process | Process memory, [`BrowserAuth.launchToken`](https://github.com/deepseek-ai/deepseek-harness/blob/dsh-v0.2.1-rc.2/packages/client/connection/src/browser-auth.ts#L206-L215) |
| Signed cookie | 30 days by default, adjusted by connection's `cookieMaxAgeDays` | Signing key persisted in the `client-connection/browser-session` record of `$DSH_HOME/.credentials.yaml`; the config field is in [connection `Config`](https://github.com/deepseek-ai/deepseek-harness/blob/dsh-v0.2.1-rc.2/packages/client/connection/src/index.ts#L105-L116) |

The distinction matters: the start token is needed only for a new browser, a cleared cookie, or a `GET /connect` API cookie exchange. If the observed problem is being signed out after a restart, the cause is usually unrelated to the token: the cookie was cleared, or `cookieMaxAgeDays` is too short.

## Upstream references

These refer to DSH `0.2.1-rc.2`, the current `@deepseek-ai/dsh` version on npm. Links target that tag so later checks can tell what changed.

- [`processLaunchToken`](https://github.com/deepseek-ai/deepseek-harness/blob/dsh-v0.2.1-rc.2/packages/client/connection/src/browser-auth.ts#L61-L66) generates `launchToken`, caches it per root context, and returns 32 random bytes as base64url.
- Three consumers read the same field: `authenticatedUrl()`, `authorizeIndex()` and `authorizeConnect()`. Replacing the field changes URL generation, index token exchange and `/connect` cookie issuance together.
- Index authentication runs in [frontend-static](https://github.com/deepseek-ai/deepseek-harness/blob/dsh-v0.2.1-rc.2/packages/host/frontend-static/src/index.ts#L130-L138) through `ctx.connection.authorizeIndex(req, res)`; printing the URL and opening the browser runs in [web-app](https://github.com/deepseek-ai/deepseek-harness/blob/dsh-v0.2.1-rc.2/packages/bundle/web-app/src/index.ts#L224-L232) through `ctx.connection.authenticatedUrl(webUrl)`.
- On [`HostConnectionService`](https://github.com/deepseek-ai/deepseek-harness/blob/dsh-v0.2.1-rc.2/packages/client/connection/src/rpc-host.ts#L90), `browserAuth` is `private readonly` and absent from the public `HostConnectionHandle` type. The plugin depends on that non-public field, which is its weakest point.

## Design

Once the `connection` service is available, replace `connection.browserAuth.launchToken` with a getter returning the configured value via `Object.defineProperty`, and restore the original property descriptor when the plugin unloads.

Three hard requirements:

- Keep the original descriptor and restore it in the effect cleanup, so an HMR reload leaves no residue.
- Self-check at load time: request `connection.authenticatedUrl('http://dsh.invalid/')`, parse the `token` parameter, and throw when it differs from the configured value. If the upstream field changes shape, falling back to a random token silently would leave users with no way to notice, so loading must fail instead.
- Register with `ctx.inject(['connection'], …)`; the callback runs again when the provider is replaced.

## Configuration

Token resolution order: `config.token`, then the `DSH_PAIRING_TOKEN` environment variable; loading fails when both are absent. There is no auto-generate-and-persist mode, because configuration would then hide which token is in effect.

Minimum length is 16 characters; prefer 32 random bytes encoded as base64url:

```sh
node -e "console.log(require('node:crypto').randomBytes(32).toString('base64url'))"
```

## Security notes

A fixed token is a deliberate trade-off. Confirm you accept it before using the plugin:

- The start token stops being a one-shot launch credential and becomes a long-lived bearer credential. Anyone with the link can exchange it for a cookie valid for up to 30 days.
- When the listener serves plain HTTP (for example behind a reverse proxy that terminates HTTPS), the issued cookie carries no `Secure` attribute. That is DSH's existing behavior and the plugin does not change it.
- Accordingly: do not share startup logs publicly, use a long random token, add access control at the reverse proxy when needed, and rotate the token by changing configuration and restarting when revocation is required.

## Verification status

An offline check ran against a real `BrowserAuth` instance by copying upstream `dsh-client-connection/lib/index.js` into `/tmp`. On `0.2.1-rc.2`:

- after pinning, `authenticatedUrl()` returns the fixed token;
- `authorizeIndex` answers 303 with `set-cookie` for the correct token and 401 for a wrong one;
- `authorizeConnect` answers 302 to `./api/remote.mux`;
- restoring the descriptor brings back the original random token.

Those four steps become offline tests in `test/` at implementation time, plus one case asserting a load-time error when the upstream field changes shape. End-to-end verification on a live GUI requires restarting the DSH process and will happen only after confirmation.
