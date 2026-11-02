/**
 * dsh-memorix-tools / client — one JSON-RPC request per tool call.
 *
 * Memorix serves a stateless MCP dialect: a POST carries its own method, tool
 * name, and project root in headers, and the answer is a plain JSON response.
 * No `initialize` handshake, no `Mcp-Session-Id`, and no connection-level
 * binding exist, which is what lets one socket serve sessions that work in
 * different projects. This module is that transport and nothing else: it knows
 * the envelope, the timeout, and how a failure reads, but not which tools exist
 * or what to do with their results.
 *
 * The envelope is a wire contract, not a preference. Probed against memorix
 * 1.10.2, every one of these is load-bearing:
 *
 * - `Mcp-Protocol-Version` must name a revision the server supports. Without
 *   it the request falls into the sessionful legacy branch and fails with "No
 *   valid session ID provided"; with an unsupported value the server answers
 *   400 and lists what it does support.
 * - `params._meta` must carry both the protocol-version and the
 *   client-capabilities key. Missing either is a 400 naming the missing key.
 * - `tools/call` must send `Mcp-Name` equal to `params.name`. Omitting it or
 *   disagreeing with the body is a 400 that reports the mismatch.
 * - `Mcp-Project-Root` on each request is what routes that request to a
 *   project. Without it the server falls back to its own last-used project.
 *
 * @module dsh-memorix-tools/client
 */

/**
 * Protocol revision this client speaks. Pinned deliberately: the server
 * rejects unknown revisions, so a server upgrade that drops this one shows up
 * as a startup failure carrying the server's own supported list rather than as
 * silently different routing.
 */
export const PROTOCOL_VERSION = '2026-07-28';

/** Envelope key carrying the protocol revision inside `params._meta`. */
export const ENVELOPE_VERSION_KEY = 'io.modelcontextprotocol/protocolVersion';

/** Envelope key carrying the client's capabilities inside `params._meta`. */
export const ENVELOPE_CAPABILITIES_KEY = 'io.modelcontextprotocol/clientCapabilities';

/** Default per-request deadline, matching the MCP client's own default. */
export const DEFAULT_TOOL_CALL_TIMEOUT_MS = 60_000;

/**
 * Upper bound on `tools/list` pages. The server answers in one page today, but
 * a cursor chain that never ends must fail instead of looping forever.
 */
const MAX_LIST_PAGES = 32;

/**
 * Headers one request needs, including the ones that identify it.
 *
 * Header names are lower-case because `fetch` lower-cases them anyway; the
 * tests assert on what a server actually receives.
 *
 * @param options - request identity.
 * @param options.method - JSON-RPC method, sent as `Mcp-Method`.
 * @param [options.name] - tool name for `tools/call`, sent as `Mcp-Name`.
 * @param [options.projectRoot] - absolute project root, sent as `Mcp-Project-Root`.
 * @returns the complete header map.
 */
export function requestHeaders({ method, name, projectRoot } = {}) {
  const headers = {
    'content-type': 'application/json',
    accept: 'application/json, text/event-stream',
    'mcp-protocol-version': PROTOCOL_VERSION,
    'mcp-stateless': 'true',
  };
  if (method !== undefined) headers['mcp-method'] = method;
  if (name !== undefined) headers['mcp-name'] = name;
  if (projectRoot !== undefined) headers['mcp-project-root'] = projectRoot;
  return headers;
}

/**
 * Body of one request, with the per-request envelope.
 *
 * @param options - request identity.
 * @param options.id - JSON-RPC id; unique per client instance.
 * @param options.method - JSON-RPC method.
 * @param [options.params] - method parameters; `_meta` is added to them.
 * @returns the request body as lossless JSON data.
 */
export function requestBody({ id, method, params = {} }) {
  return {
    jsonrpc: '2.0',
    id,
    method,
    params: {
      ...params,
      _meta: {
        [ENVELOPE_VERSION_KEY]: PROTOCOL_VERSION,
        [ENVELOPE_CAPABILITIES_KEY]: {},
      },
    },
  };
}

/**
 * Prefix every failure from this package shares, so one match finds all of
 * them in a log.
 */
const ERROR_PREFIX = 'memorix-tools';

/**
 * Render one observable fact into a single readable line. Server diagnostics
 * are quoted verbatim: their wording, not ours, says what the envelope got
 * wrong.
 * @param message - sentence to report.
 * @returns the prefixed message.
 */
function failure(message) {
  return new Error(`${ERROR_PREFIX}: ${message}`);
}

/**
 * Translate a failed `fetch` into an error that names what actually happened.
 *
 * Three different things abort the same promise, and telling them apart is the
 * difference between "the server is down", "we waited too long", and "the user
 * cancelled".
 *
 * @param error - rejection from `fetch`.
 * @param context - what the request was doing.
 * @param context.method - JSON-RPC method that failed.
 * @param context.url - endpoint that was called.
 * @param context.timeoutMs - configured deadline.
 * @param context.timedOut - whether the deadline signal fired.
 * @param context.callerSignal - signal supplied by the caller, if any.
 * @returns the error to throw.
 */
function transportFailure(error, { method, url, timeoutMs, timedOut, callerSignal }) {
  if (callerSignal?.aborted === true) return failure(`${method} was cancelled before ${url} answered`);
  if (timedOut) return failure(`${method} timed out after ${String(timeoutMs)} ms calling ${url}`);
  const reason = error instanceof Error ? error.message : String(error);
  return failure(`${method} could not reach ${url}: ${reason}`);
}

/**
 * Shorten a body for an error message; a wrong endpoint can answer with a whole
 * HTML page.
 * @param text - raw response body.
 * @returns at most 200 characters of it.
 */
function excerpt(text) {
  const flat = text.replaceAll(/\s+/gu, ' ').trim();
  return flat.length > 200 ? `${flat.slice(0, 200)}…` : flat;
}

/**
 * Create a client bound to one endpoint.
 *
 * @param options - endpoint and policy.
 * @param options.url - absolute `http(s)` URL of the MCP endpoint.
 * @param [options.timeoutMs] - per-request deadline in milliseconds.
 * @param [options.fetch] - fetch implementation; defaults to the global one.
 * @returns `listTools` and `callTool`.
 */
export function createClient({ url, timeoutMs = DEFAULT_TOOL_CALL_TIMEOUT_MS, fetch: fetchImpl = globalThis.fetch }) {
  if (typeof url !== 'string' || !/^https?:\/\//u.test(url)) {
    throw failure(`baseUrl must be an absolute http(s) URL, received ${JSON.stringify(url)}`);
  }
  if (typeof fetchImpl !== 'function') {
    throw failure('no fetch implementation is available in this runtime');
  }
  const endpoint = new URL(url).href;
  let nextId = 1;

  /**
   * Send one request and return its JSON-RPC result.
   *
   * @param request - request identity and cancellation.
   * @param request.method - JSON-RPC method.
   * @param [request.params] - method parameters, before the envelope.
   * @param [request.name] - tool name for `tools/call`.
   * @param [request.projectRoot] - project root this request belongs to.
   * @param [request.signal] - caller cancellation.
   * @returns the `result` object.
   */
  async function post({ method, params, name, projectRoot, signal }) {
    const id = nextId;
    nextId += 1;
    const timeout = AbortSignal.timeout(timeoutMs);
    const composed = signal === undefined ? timeout : AbortSignal.any([signal, timeout]);
    let response;
    try {
      response = await fetchImpl(endpoint, {
        method: 'POST',
        headers: requestHeaders({ method, name, projectRoot }),
        body: JSON.stringify(requestBody({ id, method, params })),
        signal: composed,
      });
    } catch (error) {
      throw transportFailure(error, { method, url: endpoint, timeoutMs, timedOut: timeout.aborted, callerSignal: signal });
    }

    const contentType = (response.headers.get('content-type') ?? '').toLowerCase();
    if (contentType.includes('text/event-stream')) {
      throw failure(`${method} answered with an event stream; this client reads JSON responses only`);
    }
    const text = await response.text();
    let payload;
    try {
      payload = JSON.parse(text);
    } catch {
      throw failure(`${method} answered ${String(response.status)} with a body that is not JSON: ${excerpt(text)}`);
    }
    if (payload?.error !== undefined && payload.error !== null) {
      const code = payload.error.code;
      const message = payload.error.message ?? 'the server reported an error without a message';
      throw failure(`${method} was rejected ${code === undefined ? '' : `(${String(code)}) `}${String(message)}`);
    }
    if (!response.ok) {
      throw failure(`${method} answered ${String(response.status)} ${response.statusText}`.trimEnd());
    }
    if (payload?.result === undefined || payload.result === null) {
      throw failure(`${method} answered without a result: ${excerpt(text)}`);
    }
    return payload.result;
  }

  return {
    /**
     * Read every tool the server advertises, following its cursors.
     *
     * @param [options] - cancellation.
     * @param [options.signal] - caller cancellation.
     * @returns the advertised tools, in server order.
     */
    async listTools({ signal } = {}) {
      const tools = [];
      let cursor;
      for (let page = 0; page < MAX_LIST_PAGES; page += 1) {
        const result = await post({ method: 'tools/list', params: cursor === undefined ? {} : { cursor }, signal });
        if (!Array.isArray(result.tools)) throw failure('tools/list answered without a tools array');
        for (const tool of result.tools) {
          if (typeof tool?.name !== 'string' || tool.name === '') {
            throw failure('tools/list advertised a tool without a name');
          }
          tools.push({
            name: tool.name,
            description: typeof tool.description === 'string' ? tool.description : '',
            inputSchema: tool.inputSchema ?? { type: 'object', properties: {} },
          });
        }
        if (typeof result.nextCursor !== 'string' || result.nextCursor === '') break;
        cursor = result.nextCursor;
        if (page === MAX_LIST_PAGES - 1) throw failure(`tools/list still had a cursor after ${String(MAX_LIST_PAGES)} pages`);
      }
      return tools;
    },

    /**
     * Call one tool as the given project.
     *
     * @param name - the server's own tool name.
     * @param args - tool arguments, already validated by the tool definition.
     * @param options - routing and cancellation.
     * @param options.projectRoot - absolute project root for this call.
     * @param [options.signal] - caller cancellation.
     * @returns the raw MCP result, whose `content` and `isError` the caller reads.
     */
    async callTool(name, args, { projectRoot, signal } = {}) {
      if (typeof projectRoot !== 'string' || projectRoot === '') {
        throw failure(`calling ${name} needs a project root, but none was supplied`);
      }
      return post({ method: 'tools/call', name, params: { name, arguments: args ?? {} }, projectRoot, signal });
    },
  };
}
