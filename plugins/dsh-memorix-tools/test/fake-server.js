/**
 * A stand-in for `memorix serve-http`.
 *
 * The plugin's whole contract is the request it puts on the wire, so the tests
 * need a server that records what it received and can answer the ways the real
 * one does: a tool list, a tool result, a JSON-RPC rejection. Tests that
 * override the handler still get the recorded requests.
 *
 * @module test/fake-server
 */

import { createServer } from 'node:http';

/**
 * Two tools shaped like the ones memorix advertises: no output schema, a
 * description, and an object input schema.
 */
export const DEFAULT_TOOLS = [
  {
    name: 'memorix_store',
    description: 'Store a new observation.',
    inputSchema: {
      type: 'object',
      properties: { entityName: { type: 'string' }, title: { type: 'string' } },
      required: ['entityName', 'title'],
      additionalProperties: false,
    },
  },
  {
    name: 'memorix_search',
    description: 'Search project memory.',
    inputSchema: { type: 'object', properties: { query: { type: 'string' } }, required: ['query'] },
  },
];

/**
 * Start one fake server on a free loopback port.
 *
 * @param [options] - behaviour overrides.
 * @param [options.tools] - tools returned by `tools/list`.
 * @param [options.handler] - `(request, respond) => boolean`; returning true
 *   means the override answered. Receives the recorded request and a responder
 *   `(status, payload, contentType)`.
 * @returns the endpoint URL, recorded requests, and a close function.
 */
export async function startServer({ tools = DEFAULT_TOOLS, handler } = {}) {
  const requests = [];
  const server = createServer((request, response) => {
    const chunks = [];
    request.on('data', (chunk) => chunks.push(chunk));
    request.on('end', () => {
      const raw = Buffer.concat(chunks).toString('utf8');
      let body;
      try {
        body = raw === '' ? undefined : JSON.parse(raw);
      } catch {
        body = undefined;
      }
      const record = { method: request.method, url: request.url, headers: request.headers, body };
      requests.push(record);

      const respond = (status, payload, contentType = 'application/json') => {
        response.writeHead(status, { 'content-type': contentType });
        response.end(typeof payload === 'string' ? payload : JSON.stringify(payload));
      };

      if (handler?.(record, respond) === true) return;
      if (body?.method === 'tools/list') {
        respond(200, { jsonrpc: '2.0', id: body.id, result: { tools } });
        return;
      }
      if (body?.method === 'tools/call') {
        const root = request.headers['mcp-project-root'] ?? '(none)';
        respond(200, {
          jsonrpc: '2.0',
          id: body.id,
          result: { content: [{ type: 'text', text: `${String(body.params.name)}@${root}` }] },
        });
        return;
      }
      respond(400, { jsonrpc: '2.0', id: body?.id ?? null, error: { code: -32600, message: 'unsupported method' } });
    });
  });

  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  const { port } = server.address();
  return {
    url: `http://127.0.0.1:${String(port)}/mcp`,
    requests,
    close: () =>
      new Promise((resolve) => {
        server.closeAllConnections();
        server.close(() => {
          resolve();
        });
      }),
  };
}
