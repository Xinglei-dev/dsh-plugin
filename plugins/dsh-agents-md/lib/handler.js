/**
 * dsh-agents-md — the same-origin HTTP endpoints behind the settings page.
 *
 * The browser half has no RPC channel of its own, so the page talks to this
 * handler over the Web server, exactly like the repository's other UI plugins.
 * The trust fence is the Connection handle: a request the Host rejects with
 * 403 never reaches any file operation.
 *
 * The handler never accepts a path from the browser. It accepts a scope name,
 * a workspace id, a chain-relative directory, and a candidate file name;
 * everything else is recomputed here and checked against the whitelist before
 * a single byte is written.
 *
 * @module dsh-agents-md/handler
 */
import nodeFs from 'node:fs/promises';
import path from 'node:path';
import {
  ALL_CANDIDATES,
  MAX_FILE_BYTES,
  assertWritableTarget,
  candidatePath,
  discoverProjectRoot,
  globalTargets,
  projectLevels,
  hashContent,
  readInstructionFile,
  writeInstructionFile,
} from './paths.js';
import { buildState } from './state.js';

/** Largest JSON request body accepted by the save endpoint. */
export const MAX_BODY_BYTES = MAX_FILE_BYTES + 64 * 1024;

/** Route paths registered on the Web server. */
export const ROUTE_STATE = '/agents-md/state';
export const ROUTE_FILE = '/agents-md/file';
export const ROUTE_SAVE = '/agents-md/save';

/** Scopes the page may address. */
export const SCOPES = ['global-dsh', 'global-agents', 'project'];

/**
 * One refusal that carries an HTTP status and a stable code.
 */
class HttpError extends Error {
  /**
   * @param status - HTTP status code.
   * @param code - stable machine-readable code.
   * @param message - human-readable explanation.
   */
  constructor(status, code, message) {
    super(message);
    this.name = 'HttpError';
    this.status = status;
    this.code = code;
  }
}

/**
 * The status the Connection handle refuses this request with.
 *
 * The handle answers 403 for a Host/Origin fence violation and 401 for a
 * request without an authenticated browser or API peer. Both must stop here;
 * a write endpoint must never run for an unauthenticated caller.
 * @param connection - Connection service, or undefined outside a Web host.
 * @param req - incoming request.
 * @returns 401, 403, or undefined when the request may proceed.
 */
function rejectionOf(connection, req) {
  if (connection === undefined || typeof connection.requestRejection !== 'function') return undefined;
  try {
    return connection.requestRejection(req) ?? undefined;
  } catch {
    return 403;
  }
}

/**
 * Send a JSON response.
 * @param res - server response.
 * @param status - HTTP status code.
 * @param body - JSON-serializable body.
 */
function sendJson(res, status, body) {
  const payload = JSON.stringify(body);
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
    'content-length': Buffer.byteLength(payload, 'utf8'),
  });
  res.end(payload);
}

/**
 * Read and parse a bounded JSON request body.
 * @param req - incoming request.
 * @returns the parsed body.
 * @throws {HttpError} on an empty, oversized, or malformed body.
 */
async function readJsonBody(req) {
  const chunks = [];
  let total = 0;
  for await (const chunk of req) {
    total += chunk.length;
    if (total > MAX_BODY_BYTES) throw new HttpError(413, 'too-large', 'the request body is too large');
    chunks.push(chunk);
  }
  if (total === 0) throw new HttpError(400, 'bad-request', 'the request body is empty');
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8'));
  } catch {
    throw new HttpError(400, 'bad-request', 'the request body is not valid JSON');
  }
}

/**
 * Read one required string field.
 * @param body - parsed request body.
 * @param field - field name.
 * @returns the trimmed value.
 * @throws {HttpError} when the field is missing or not a string.
 */
function requiredString(body, field) {
  const value = body?.[field];
  if (typeof value !== 'string' || value.trim() === '') {
    throw new HttpError(400, 'bad-request', `"${field}" must be a non-empty string`);
  }
  return value.trim();
}

/**
 * Resolve one workspace id through the registry.
 * @param registry - workspace registry service, or undefined.
 * @param id - workspace id from the query or body.
 * @returns the workspace path and id.
 * @throws {HttpError} when the registry or workspace is unavailable.
 */
function resolveWorkspace(registry, id) {
  if (registry === undefined || typeof registry.get !== 'function') {
    throw new HttpError(503, 'workspace-unavailable', 'this Host has no workspace registry');
  }
  const workspace = registry.get(id);
  if (workspace === undefined || workspace === null || typeof workspace.path !== 'string') {
    throw new HttpError(404, 'workspace-unknown', `no workspace "${id}" is registered`);
  }
  return { id: workspace.id ?? id, path: workspace.path };
}

/**
 * Resolve one project-level target inside a workspace's chain.
 * @param registry - workspace registry service.
 * @param workspaceId - registered workspace id.
 * @param relDir - chain-relative directory ("." for the project root).
 * @param name - candidate file name.
 * @returns the absolute target path and the roots a write may stay under.
 * @throws {HttpError} when the directory, name, or workspace cannot be used.
 */
async function resolveProjectTarget(registry, workspaceId, relDir, name, fs) {
  if (!ALL_CANDIDATES.includes(name)) {
    throw new HttpError(400, 'bad-request', `"${name}" is not an instruction file name`);
  }
  const workspace = resolveWorkspace(registry, workspaceId);
  const info = await fs.stat(workspace.path).catch((error) => {
    if (error?.code === 'ENOENT' || error?.code === 'ENOTDIR') return null;
    throw error;
  });
  if (info === null || !info.isDirectory()) {
    throw new HttpError(404, 'workspace-missing', `the directory of workspace "${workspaceId}" does not exist`);
  }
  const discovered = await discoverProjectRoot(workspace.path, { fs });
  const levels = projectLevels(workspace.path, discovered.root);
  const level = levels.find((entry) => entry.relDir === relDir);
  if (level === undefined) {
    throw new HttpError(400, 'bad-request', `"${relDir}" is not a directory in this project's instruction chain`);
  }
  return { target: candidatePath(level.dir, name), roots: [discovered.root] };
}

/**
 * Resolve one user-global target.
 * @param homes - resolved home roots.
 * @param scope - `global-dsh` or `global-agents`.
 * @returns the absolute target path and its allowed root.
 * @throws {HttpError} for any other scope.
 */
function resolveGlobalTarget(homes, scope) {
  const target = globalTargets(homes).find((entry) => entry.scope === scope);
  if (target === undefined) throw new HttpError(400, 'bad-request', `"${scope}" is not a known global scope`);
  return { target: target.path, roots: [scope === 'global-dsh' ? homes.dshHome : homes.agentsHome] };
}

/**
 * Resolve any scope into an absolute target and its allowed roots.
 * @param options - homes, registry, and the request's scope coordinates.
 * @returns the resolved target.
 */
async function resolveTarget(options) {
  const { homes, registry, scope, workspaceId, relDir, name, fs } = options;
  if (!SCOPES.includes(scope)) throw new HttpError(400, 'bad-request', `"${scope}" is not a known scope`);
  if (scope === 'project') {
    if (typeof workspaceId !== 'string' || workspaceId === '') {
      throw new HttpError(400, 'bad-request', '"workspaceId" is required for a project scope');
    }
    const directory = typeof relDir === 'string' && relDir !== '' ? relDir : '.';
    return resolveProjectTarget(registry, workspaceId, directory, name, fs);
  }
  if (name !== 'AGENTS.md') {
    throw new HttpError(400, 'bad-request', 'the user-global location only holds AGENTS.md');
  }
  return resolveGlobalTarget(homes, scope);
}

/**
 * Compare the current file against the version the browser edited.
 * @param current - result of {@link readInstructionFile}.
 * @param expectedHash - hash the browser read, or null for "must not exist".
 * @returns nothing when the write may proceed.
 * @throws {HttpError} with the current version when the file moved.
 */
function assertExpectedVersion(current, expectedHash) {
  if (expectedHash === null) {
    if (current.exists) {
      throw new HttpError(409, 'conflict', 'the file now exists; reload before saving');
    }
    return;
  }
  if (typeof expectedHash !== 'string' || expectedHash === '') {
    throw new HttpError(400, 'bad-request', '"expectedHash" must be a SHA-256 string or null');
  }
  if (!current.exists) {
    throw new HttpError(409, 'conflict', 'the file was removed; reload before saving');
  }
  if (current.hash !== expectedHash) {
    throw new HttpError(409, 'conflict', 'the file changed on disk; reload before saving');
  }
}

/**
 * Create the route handler.
 * @param options - resolved homes, service getters, filesystem, and logger.
 * @returns an HTTP handler owning the full response lifecycle.
 */
export function createHandler(options) {
  const fs = options.fs ?? nodeFs;
  const homes = options.homes;
  const registryOf = options.registry ?? (() => undefined);
  const connectionOf = options.connection ?? (() => undefined);
  const logger = options.logger;

  /**
   * Serve one request.
   * @param req - incoming request.
   * @param res - server response.
   * @returns nothing.
   */
  return async function handle(req, res) {
    try {
      const rejection = rejectionOf(connectionOf(), req);
      if (rejection !== undefined) {
        sendJson(res, rejection, {
          ok: false,
          code: rejection === 401 ? 'unauthorized' : 'forbidden',
          message: rejection === 401 ? 'the request is not authenticated' : 'the Host refused this request',
        });
        return;
      }
      const url = new URL(req.url ?? '/', 'http://dsh.invalid');
      const method = req.method ?? 'GET';
      if (url.pathname === ROUTE_STATE) {
        if (method !== 'GET') return sendJson(res, 405, { ok: false, code: 'method', message: 'GET only' });
        const workspaceId = url.searchParams.get('workspaceId')?.trim() ?? '';
        const workspace = workspaceId === ''
          ? undefined
          : resolveWorkspace(registryOf(), workspaceId);
        const state = await buildState({ homes, workspace, fs });
        sendJson(res, 200, { ok: true, ...state });
        return;
      }
      if (url.pathname === ROUTE_FILE) {
        if (method !== 'GET') return sendJson(res, 405, { ok: false, code: 'method', message: 'GET only' });
        const scope = url.searchParams.get('scope') ?? '';
        const name = url.searchParams.get('name') ?? '';
        const resolved = await resolveTarget({
          homes,
          registry: registryOf(),
          scope,
          workspaceId: url.searchParams.get('workspaceId') ?? '',
          relDir: url.searchParams.get('dir') ?? '',
          name,
          fs,
        });
        const current = await readInstructionFile(resolved.target, { fs });
        sendJson(res, 200, {
          ok: true,
          scope,
          name,
          path: resolved.target,
          ...current,
        });
        return;
      }
      if (url.pathname === ROUTE_SAVE) {
        if (method !== 'POST') return sendJson(res, 405, { ok: false, code: 'method', message: 'POST only' });
        const body = await readJsonBody(req);
        const scope = requiredString(body, 'scope');
        const name = requiredString(body, 'name');
        if (typeof body.content !== 'string') {
          throw new HttpError(400, 'bad-request', '"content" must be a string');
        }
        const expectedHash = body.expectedHash ?? null;
        const resolved = await resolveTarget({
          homes,
          registry: registryOf(),
          scope,
          workspaceId: body.workspaceId ?? '',
          relDir: body.dir ?? '',
          name,
          fs,
        });
        const current = await readInstructionFile(resolved.target, { fs });
        try {
          assertExpectedVersion(current, expectedHash);
        } catch (error) {
          if (error instanceof HttpError && error.status === 409) {
            sendJson(res, 409, {
              ok: false,
              code: error.code,
              message: error.message,
              current: { exists: current.exists, content: current.content, hash: current.hash },
            });
            return;
          }
          throw error;
        }
        await fs.mkdir(path.dirname(resolved.target), { recursive: true });
        await assertWritableTarget(resolved.target, resolved.roots, { fs });
        const written = await writeInstructionFile(resolved.target, body.content, { fs });
        sendJson(res, 200, {
          ok: true,
          path: resolved.target,
          exists: true,
          hash: hashContent(body.content),
          ...written,
        });
        return;
      }
      sendJson(res, 404, { ok: false, code: 'not-found', message: 'no such endpoint' });
    } catch (error) {
      if (error instanceof HttpError) {
        sendJson(res, error.status, { ok: false, code: error.code, message: error.message });
        return;
      }
      if (error?.code === 'TOO_LARGE') {
        sendJson(res, 413, { ok: false, code: 'too-large', message: error.message });
        return;
      }
      if (error?.code === 'OUTSIDE' || error?.code === 'SYMLINK') {
        sendJson(res, 403, { ok: false, code: error.code.toLowerCase(), message: error.message });
        return;
      }
      if (error?.code === 'NOT_FILE') {
        sendJson(res, 409, { ok: false, code: 'not-a-file', message: error.message });
        return;
      }
      logger?.error?.(error);
      sendJson(res, 500, { ok: false, code: 'internal', message: 'the Host failed to answer' });
    }
  };
}
