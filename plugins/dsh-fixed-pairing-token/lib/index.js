/**
 * dsh-fixed-pairing-token — replace the per-process random Web launch token
 * with one configured value.
 *
 * DSH mints a random launch token for every process and prints it in the
 * `dsh web:` URL, so that address changes on every restart. This plugin pins
 * the token, which makes the address stable, without touching cookie issuance
 * or verification.
 *
 * The field it rewrites, `connection.browserAuth.launchToken`, is a
 * `private readonly` member of the upstream BrowserAuth class and is not part
 * of the public `HostConnectionHandle`. Upstream may move it; when that
 * happens this plugin denies the shape and fails at load instead of silently
 * leaving the random token in place.
 *
 * The module's only runtime import is Schemastery, which the host installation
 * provides; the plugin declares it as a peer so the profile's linked-package
 * resolution routes it there.
 *
 * @module dsh-fixed-pairing-token
 */
import z from '@deepseek-ai/schemastery';

/** Stable Cordis plugin name. */
export const name = 'fixed-pairing-token';

/**
 * The plugin needs `connection` before it can pin anything. Cordis keeps the
 * entry pending until that service exists and re-runs `apply` when the
 * provider is replaced, so a Connection reload cannot leave the token random.
 */
export const inject = ['connection'];

/** Environment variable read when the profile configures no `token`. */
export const TOKEN_ENV = 'DSH_PAIRING_TOKEN';

/** Minimum accepted token length; an upstream random token is 43 characters. */
export const MIN_TOKEN_LENGTH = 16;

/**
 * Characters a token may use. Everything outside this set would not survive a
 * round trip through `URLSearchParams` byte for byte, which would make the
 * printed address disagree with the configured token.
 */
const TOKEN_PATTERN = /^[A-Za-z0-9_-]+$/u;

/**
 * Config for the profile patch layer. Schemastery is the schema the Loader,
 * the `Config.listConfigs` inspect provider, and `--dump-config-schema` read,
 * so the entry keeps a machine-readable configuration surface. This schema
 * only checks the declared shape; {@link resolveToken} enforces the
 * requirements that need a value from either config or the environment.
 */
export const Config = z.object({
  token: z.string().description('Launch token to pin. Defaults to DSH_PAIRING_TOKEN.').required(false),
});

/**
 * Read and validate the token from config or the environment.
 * @param config - normalized plugin config, possibly without `token`.
 * @param env - environment object supplying {@link TOKEN_ENV}.
 * @returns the configured token.
 * @throws {TypeError} when no source supplies a token, or the value is too
 * short, or it contains characters a printed URL cannot reproduce.
 */
export function resolveToken(config, env = process.env) {
  const configured = typeof config?.token === 'string' ? config.token.trim() : '';
  const fallback = typeof env?.[TOKEN_ENV] === 'string' ? env[TOKEN_ENV].trim() : '';
  const token = configured === '' ? fallback : configured;
  const source = configured === '' ? TOKEN_ENV : 'config.token';
  if (token === '') throw new TypeError(`${name}: no launch token configured; set config.token or ${TOKEN_ENV}. Refusing to start with the random token, because the bookmarked address would silently stop being fixed`);
  if (token.length < MIN_TOKEN_LENGTH) throw new TypeError(`${name}: ${source} is ${String(token.length)} characters long; use at least ${String(MIN_TOKEN_LENGTH)}`);
  if (!TOKEN_PATTERN.test(token)) throw new TypeError(`${name}: ${source} must use only A-Z, a-z, 0-9, "-" and "_" so the printed address carries it unchanged; a base64url random string does`);
  return token;
}

/**
 * Locate the upstream field and confirm it is the shape this plugin rewrites.
 * @param connection - value of `ctx.connection`.
 * @returns the BrowserAuth owner and its current `launchToken` descriptor.
 * @throws {TypeError} when the field is absent, inherited, an accessor, or not
 * a non-empty string.
 */
export function locateLaunchToken(connection) {
  const browserAuth = connection?.browserAuth;
  if (browserAuth === null || typeof browserAuth !== 'object') throw new TypeError(`${name}: connection.browserAuth is missing; this DSH version no longer exposes the launch token where this plugin expects it, so the token cannot be pinned`);
  const descriptor = Object.getOwnPropertyDescriptor(browserAuth, 'launchToken');
  if (descriptor === undefined) throw new TypeError(`${name}: connection.browserAuth.launchToken is not an own property; this DSH version moved the launch token, so the token cannot be pinned`);
  if (!('value' in descriptor) || 'get' in descriptor || 'set' in descriptor) throw new TypeError(`${name}: connection.browserAuth.launchToken is an accessor, not a stored value; this DSH version changed the field shape`);
  if (typeof descriptor.value !== 'string' || descriptor.value === '') throw new TypeError(`${name}: connection.browserAuth.launchToken is not a non-empty string; this DSH version changed the field shape`);
  return { browserAuth, descriptor };
}

/**
 * Confirm the pinned token reaches the URL DSH prints. A shape change that
 * leaves the field readable but ignored by the URL builder must fail the same
 * way a missing field does.
 * @param connection - value of `ctx.connection`.
 * @param token - token expected in the printed address.
 * @throws {TypeError} when the address omits or alters the token.
 */
export function verifyPinnedToken(connection, token) {
  if (typeof connection?.authenticatedUrl !== 'function') throw new TypeError(`${name}: connection.authenticatedUrl is not a function; this DSH version changed the Connection handle, so the pinned token cannot be confirmed`);
  let printed;
  try {
    printed = connection.authenticatedUrl('http://dsh.invalid/');
  } catch (cause) {
    throw new TypeError(`${name}: connection.authenticatedUrl() failed, so the pinned token cannot be confirmed`, { cause });
  }
  const tokens = new URL(printed).searchParams.getAll('token');
  if (tokens.length !== 1 || tokens[0] !== token) throw new TypeError(`${name}: connection.authenticatedUrl() does not report the pinned token; this DSH version changed how the launch token is read, so the printed address would not be fixed`);
}

/**
 * Pin one BrowserAuth owner's token and return the undo.
 * @param browserAuth - owner of the `launchToken` property.
 * @param descriptor - descriptor captured from that owner.
 * @param token - token to store.
 * @returns a disposer restoring the captured descriptor; calling it again does
 * nothing.
 */
export function pinLaunchToken(browserAuth, descriptor, token) {
  Object.defineProperty(browserAuth, 'launchToken', { ...descriptor, value: token });
  let restored = false;
  return () => {
    if (restored) return;
    restored = true;
    Object.defineProperty(browserAuth, 'launchToken', descriptor);
  };
}

/**
 * Pin the launch token for as long as the `connection` service exists.
 * @param ctx - plugin context carrying `connection`.
 * @param config - validated {@link Config}.
 * @throws {TypeError} when the token is unusable or upstream changed shape.
 */
export function apply(ctx, config) {
  const token = resolveToken(config);
  ctx.effect(() => {
    const { browserAuth, descriptor } = locateLaunchToken(ctx.connection);
    const unpin = pinLaunchToken(browserAuth, descriptor, token);
    try {
      verifyPinnedToken(ctx.connection, token);
    } catch (error) {
      unpin();
      throw error;
    }
    return unpin;
  }, `${name}: pin launch token`);
}
