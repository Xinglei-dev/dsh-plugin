/**
 * dsh-pairing-entry — a bookmarked Web entry that trades its own key for the
 * current launch token.
 *
 * `dsh web` prints an address carrying a per-process launch token and mints a
 * signed cookie when a browser presents that token at `/`. The printed address
 * therefore changes on every restart. This plugin serves one extra exact route,
 * `/entry/<key>`, which redirects to `/` carrying the current launch token; the
 * browser then mints the cookie exactly as it would from the printed address.
 *
 * The key is ordinary plugin config. It is marked volatile so Web Settings can
 * read and write it while the entry runs. A volatile-only change does not reload
 * the entry (the Loader commits the new reference into the running fiber), so the
 * route follows `loader/volatile-update` and re-registers under the new key.
 *
 * The only upstream surface this plugin reads is public: `authenticatedUrl()`
 * and `requestRejection()` on the Connection handle, and `register()` on the
 * Web server. The launch token itself is taken from the address
 * `authenticatedUrl()` builds, so a renamed or reshaped token fails the load
 * instead of silently serving a stale redirect.
 *
 * @module dsh-pairing-entry
 */
import z from '@deepseek-ai/schemastery';

/** Stable Cordis plugin name. */
export const name = 'pairing-entry';

/**
 * The entry needs the Connection handle (token and trust fence) and the Web
 * server (the route itself). Cordis keeps this entry pending until both exist
 * and re-runs `apply` when either is replaced, so a Connection reload cannot
 * leave the route bound to a stale handle.
 */
export const inject = ['connection', 'webServer'];

/** Path prefix the entry page is served under. */
export const ENTRY_PATH_PREFIX = '/entry/';

/** Minimum accepted key length; the browser-side generator emits exactly this many characters. */
export const MIN_KEY_LENGTH = 32;

/**
 * Characters a key may use. The key is a path segment, so anything outside this
 * set would need escaping and could not be reproduced byte for byte in the
 * bookmarked address.
 */
const KEY_PATTERN = /^[A-Za-z0-9_-]+$/u;

/** Query parameter the launch token travels in. */
const TOKEN_QUERY = 'token';

/**
 * Config for the profile patch layer. The field is volatile, which is what makes
 * it visible to — and writable from — the Web Settings form while this entry is
 * running. Schemastery accepts a missing field, so an unconfigured install loads
 * without serving a route instead of failing the entry.
 */
export const Config = z.object({
  key: z
    .string()
    .description('Long-lived key of the /entry page. At least 32 characters from A-Z, a-z, 0-9, "-" and "_". Set it in Web Settings > Plugins > Pairing entry.')
    .volatile(),
});

/**
 * Read the configured key out of a resolved config.
 *
 * Volatile fields are resolved into a reference object with `get()`, so the raw
 * field is unwrapped before it is validated.
 * @param config - resolved plugin config, possibly without `key`.
 * @returns the trimmed key, or an empty string when none is configured.
 */
export function keyOf(config) {
  const raw = config?.key;
  const value = typeof raw?.get === 'function' ? raw.get() : raw;
  return typeof value === 'string' ? value.trim() : '';
}

/**
 * Report what is wrong with a key.
 * @param key - trimmed key from {@link keyOf}.
 * @returns a human-readable problem, or `undefined` when the key is usable.
 */
export function keyProblem(key) {
  if (key === '') return 'no key is configured';
  if (key.length < MIN_KEY_LENGTH) return `the key is ${String(key.length)} characters long; use at least ${String(MIN_KEY_LENGTH)}`;
  if (!KEY_PATTERN.test(key)) return 'the key must use only A-Z, a-z, 0-9, "-" and "_"';
  return undefined;
}

/**
 * Path the entry is served under for one key.
 * @param key - usable key.
 * @returns the exact route path.
 */
export function entryPath(key) {
  return `${ENTRY_PATH_PREFIX}${key}`;
}

/**
 * Read the launch token of the running process from the public Connection face.
 * @param connection - value of `ctx.connection`.
 * @returns the token carried by the address `authenticatedUrl()` builds.
 * @throws {TypeError} when the handle is gone, the call fails, or the address
 * does not carry exactly one non-empty token.
 */
export function launchTokenOf(connection) {
  if (typeof connection?.authenticatedUrl !== 'function') {
    throw new TypeError(`${name}: connection.authenticatedUrl is not a function; this DSH version changed the Connection handle, so the entry cannot learn the launch token`);
  }
  let printed;
  try {
    printed = connection.authenticatedUrl('http://dsh.invalid/');
  } catch (cause) {
    throw new TypeError(`${name}: connection.authenticatedUrl() failed, so the entry cannot learn the launch token`, { cause });
  }
  let url;
  try {
    url = new URL(printed);
  } catch (cause) {
    throw new TypeError(`${name}: connection.authenticatedUrl() returned an address this plugin cannot parse`, { cause });
  }
  const tokens = url.searchParams.getAll(TOKEN_QUERY);
  if (tokens.length !== 1 || tokens[0] === '') {
    throw new TypeError(`${name}: connection.authenticatedUrl() did not report exactly one launch token; this DSH version changed how the token reaches the address`);
  }
  return tokens[0];
}

/**
 * Build the route handler.
 *
 * The first answer is always the trust fence: a request whose Host, Origin, or
 * fetch metadata the Connection rejects gets that refusal, so this route cannot
 * be used to reflect a token back to a DNS-rebinding page. Any request the fence
 * lets through — authenticated or not — receives the same relative redirect,
 * because the cookie minted by `/connect` (version 2) supersedes the index
 * cookie (version 1) and would otherwise make "already signed in" skip the token
 * exchange this page exists to perform.
 *
 * @param connection - Connection handle supplying the trust fence and token.
 * @param logger - logger for the one failure that can only happen at request
 * time.
 * @returns an HTTP handler that owns its response.
 */
export function createHandler({ connection, logger }) {
  return (req, res) => {
    if (connection.requestRejection(req) === 403) {
      res.writeHead(403, { 'cache-control': 'no-store' });
      res.end();
      return;
    }
    if (req.method !== 'GET' && req.method !== 'HEAD') {
      res.writeHead(405, { allow: 'GET, HEAD', 'cache-control': 'no-store' });
      res.end();
      return;
    }
    let token;
    try {
      token = launchTokenOf(connection);
    } catch (error) {
      logger.error(error);
      res.writeHead(503, { 'cache-control': 'no-store' });
      res.end();
      return;
    }
    res.writeHead(303, {
      'cache-control': 'no-store',
      location: `../?${TOKEN_QUERY}=${encodeURIComponent(token)}`,
      'referrer-policy': 'no-referrer',
    });
    res.end();
  };
}

/**
 * Serve the entry route while the configured key is usable.
 *
 * A missing or malformed key is a configuration state, not a load failure: the
 * entry stays alive and configurable (the Settings form is only offered for
 * running entries), it just serves no route. A launch token this DSH version
 * cannot read is a version mismatch and does fail the load.
 *
 * `key` is volatile, and a volatile-only config change does not reload this
 * entry: the Loader commits the new reference into the running fiber instead of
 * re-running `apply`. The route therefore follows `loader/volatile-update` and
 * re-registers under the new path, which is what makes a save from the Settings
 * form take effect immediately.
 * @param ctx - plugin context carrying `connection` and `webServer`.
 * @param config - validated {@link Config}.
 */
export function apply(ctx, config) {
  launchTokenOf(ctx.connection);

  let served;
  const stop = () => {
    served?.dispose();
    served = undefined;
  };
  const sync = () => {
    const key = keyOf(config);
    const problem = keyProblem(key);
    if (problem !== undefined) {
      stop();
      ctx.logger.warn(`${name}: ${problem}. No ${ENTRY_PATH_PREFIX}<key> page is served; set the key in Web Settings > Plugins > Pairing entry.`);
      return;
    }
    const path = entryPath(key);
    if (served?.path === path) return;
    stop();
    served = {
      path,
      dispose: ctx.webServer.register({
        kind: 'exact',
        path,
        handler: createHandler({ connection: ctx.connection, logger: ctx.logger }),
      }),
    };
  };

  ctx.effect(() => {
    sync();
    return stop;
  }, `${name}: entry route`);
  ctx.on('loader/volatile-update', () => {
    try {
      sync();
    } catch (error) {
      ctx.logger.error(error);
    }
  });
}
