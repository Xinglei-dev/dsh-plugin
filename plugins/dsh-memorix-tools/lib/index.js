/**
 * dsh-memorix-tools — Memorix tools that follow the calling session's project.
 *
 * Memorix binds a project to a connection by default: one HTTP session, one
 * `session_start`, one current project. DSH opens exactly one such connection
 * for the whole host, so every browser session shares it and the last binding
 * wins. Two sessions in two projects therefore read each other's memory.
 *
 * Memorix also serves a stateless dialect in which each request names its own
 * project root. That removes the shared mutable binding entirely: N sessions,
 * N answers, one socket. This plugin is that dialect expressed as a DSH tool
 * bridge — it advertises the server's own tools under their usual
 * `mcp__<serverName>__<name>` names and attaches the calling session's working
 * directory to every call.
 *
 * What the plugin reads from DSH is only the public execution surface:
 * `ctx.tools.register` for the bridge and `exec.agent.session.header.cwd` for
 * the project root. That cwd is the session's creation directory, recorded in
 * its durable header, so a forked or resumed session keeps the project it was
 * created in.
 *
 * Replacing the stock MCP client is a deliberate one-for-one swap: the tool
 * names are identical, so this row and a `@deepseek-ai/dsh-mcp-client` row for
 * the same `serverName` cannot both be mounted. Remove the old row when adding
 * this one.
 *
 * @module dsh-memorix-tools
 */

import z from '@deepseek-ai/schemastery';

import { createClient, DEFAULT_TOOL_CALL_TIMEOUT_MS, PROTOCOL_VERSION } from './client.js';
import { createToolDefinition, publicToolName } from './tools.js';

/** Stable Cordis plugin name. */
export const name = 'memorix-tools';

/**
 * The bridge registers tools, so it waits for the tool registry. Declaring the
 * dependency keeps the plugin pending on a slow start instead of dropping the
 * registrations.
 */
export const inject = ['tools'];

/** Endpoint of a locally started `memorix serve-http`. */
export const DEFAULT_BASE_URL = 'http://127.0.0.1:3211/mcp';

/** Valid `serverName`: it becomes part of a tool name and a namespace. */
const SERVER_NAME_PATTERN = /^[A-Za-z0-9_-]{1,32}$/u;

/**
 * Config for the profile patch layer.
 *
 * The endpoint and the fallback root are machine facts, so they live in the
 * user's patch and survive plugin upgrades. `failOnStartupError` defaults to
 * true: a memorix row that silently registers nothing is harder to diagnose
 * than one that fails loudly with the server's own error.
 */
export const Config = z.object({
  baseUrl: z
    .string()
    .default(DEFAULT_BASE_URL)
    .description('Absolute URL of the memorix streamable-http endpoint.'),
  serverName: z
    .string()
    .default('memorix')
    .pattern(SERVER_NAME_PATTERN)
    .description('Namespace of the registered tools; produces mcp__<serverName>__<tool> names. Keep "memorix" to preserve existing tool names.'),
  toolCallTimeoutMs: z
    .number()
    .step(1)
    .min(1)
    .default(DEFAULT_TOOL_CALL_TIMEOUT_MS)
    .description('Deadline of one tool call in milliseconds; the caller can still cancel earlier.'),
  fallbackProjectRoot: z
    .string()
    .default('')
    .description('Absolute project root used when a call has no session working directory. Empty means such a call is an error instead of a guess.'),
  failOnStartupError: z
    .boolean()
    .default(true)
    .description('When the initial tool list cannot be read: true fails this plugin row, false loads without tools and logs the error.'),
});

/**
 * Resolve the project root a call belongs to.
 *
 * The session header is the authority: it is the directory the session was
 * created in, written once and never rewritten. A missing header (a subagent
 * composed without one, or a future DSH that stops recording it) is not a
 * reason to fall back to the server's last-used project — that is exactly the
 * cross-project leak this plugin exists to remove. It is a configured fallback
 * or an error.
 *
 * @param exec - the tool execution, carrying the calling agent.
 * @param fallback - configured fallback project root, possibly empty.
 * @returns the absolute project root for this call.
 * @throws {Error} when neither the session nor the config supplies one.
 */
export function projectRootOf(exec, fallback) {
  const cwd = exec?.agent?.session?.header?.cwd;
  if (typeof cwd === 'string' && cwd !== '') return cwd;
  const configured = typeof fallback === 'string' ? fallback.trim() : '';
  if (configured !== '') return configured;
  throw new Error('memorix-tools: this call has no session working directory, and no fallbackProjectRoot is configured; refusing to let the server choose a project');
}

/**
 * Register every tool the server advertises.
 *
 * Registration is all-or-nothing: a conflict on one name would otherwise leave
 * a partially bridged server whose missing tools look like a server-side
 * change. On any failure the tools registered so far are disposed again.
 *
 * @param ctx - plugin context carrying the tool registry.
 * @param options - bridge identity.
 * @param options.client - connected client.
 * @param options.serverName - namespace for the public names.
 * @param options.fallbackProjectRoot - configured fallback root.
 * @param options.disposers - map the caller owns; receives one disposer per tool.
 * @returns the registered names.
 * @throws {Error} when the server is unreachable or a name is taken.
 */
export async function registerTools(ctx, { client, serverName, fallbackProjectRoot, disposers }) {
  let tools;
  try {
    tools = await client.listTools();
  } catch (error) {
    const detail = String(error.message).replace(/^memorix-tools: /u, '');
    throw new Error(`memorix-tools: could not read the tool list (protocol ${PROTOCOL_VERSION}): ${detail}`, { cause: error });
  }

  try {
    for (const tool of tools) {
      const definition = createToolDefinition({
        publicName: publicToolName(serverName, tool.name),
        rawName: tool.name,
        description: tool.description,
        inputSchema: tool.inputSchema,
        callTool: (rawName, args, options) => client.callTool(rawName, args, options),
        projectRootOf: (exec) => projectRootOf(exec, fallbackProjectRoot),
      });
      disposers.set(definition.name, ctx.tools.register(definition));
    }
  } catch (error) {
    for (const dispose of disposers.values()) dispose();
    disposers.clear();
    throw new Error(`memorix-tools: registering the server's tools failed, so none are available (another plugin may already own these tool names): ${error.message}`, { cause: error });
  }
  return [...disposers.keys()];
}

/**
 * Mount the bridge.
 *
 * Tools are registered on this plugin's context, so disposing the row — plugin
 * unload, profile change, or HMR — unregisters them again.
 *
 * @param ctx - plugin context.
 * @param [config] - resolved plugin config.
 * @returns startup readiness once the initial tool generation is registered.
 */
export async function apply(ctx, config) {
  const baseUrl = config?.baseUrl ?? DEFAULT_BASE_URL;
  const serverName = config?.serverName ?? 'memorix';
  const timeoutMs = config?.toolCallTimeoutMs ?? DEFAULT_TOOL_CALL_TIMEOUT_MS;
  const fallbackProjectRoot = config?.fallbackProjectRoot ?? '';
  const failOnStartupError = config?.failOnStartupError ?? true;

  if (!SERVER_NAME_PATTERN.test(serverName)) {
    throw new Error(`memorix-tools: serverName ${JSON.stringify(serverName)} is invalid; use 1-32 characters from A-Z, a-z, 0-9, "-" and "_"`);
  }

  const client = createClient({ url: baseUrl, timeoutMs });

  const disposers = new Map();
  let disposed = false;
  ctx.effect(() => () => {
    disposed = true;
    for (const dispose of disposers.values()) dispose();
    disposers.clear();
  }, 'memorix-tools.registration');

  let names;
  try {
    names = await registerTools(ctx, { client, serverName, fallbackProjectRoot, disposers });
  } catch (error) {
    if (failOnStartupError) throw error;
    ctx.logger?.error?.(`${error.message}; loading without memorix tools`);
    return;
  }

  if (disposed) {
    // The row was disposed while discovery was in flight; the effect cleanup
    // ran before these registrations existed, so release them here.
    for (const dispose of disposers.values()) dispose();
    disposers.clear();
    return;
  }

  ctx.logger?.info?.(`memorix-tools: registered ${String(names.length)} tools from ${baseUrl} as "${serverName}"`);
}
