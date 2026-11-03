import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { createClient, PROTOCOL_VERSION } from '../lib/client.js';
import { startServer } from './fake-server.js';

/**
 * Run one test body with a fake server that is closed afterwards.
 * @param options - fake-server options.
 * @param body - receives the server.
 */
async function withServer(options, body) {
  const server = await startServer(options);
  try {
    await body(server);
  } finally {
    await server.close();
  }
}

describe('listTools', () => {
  it('sends the stateless list request and returns the advertised tools', async () => {
    await withServer({}, async (server) => {
      const client = createClient({ url: server.url });
      const tools = await client.listTools();

      assert.deepEqual(tools.map((tool) => tool.name), ['memorix_store', 'memorix_search']);
      const [request] = server.requests;
      assert.equal(request.headers['mcp-method'], 'tools/list');
      assert.equal(request.headers['mcp-stateless'], 'true');
      assert.equal(request.headers['mcp-protocol-version'], PROTOCOL_VERSION);
      assert.equal(request.headers['mcp-project-root'], undefined, 'listing tools must not pin a project');
      assert.equal(request.body.method, 'tools/list');
      assert.deepEqual(Object.keys(request.body.params), ['_meta']);
    });
  });

  it('follows the server cursor until the last page', async () => {
    await withServer(
      {
        handler(request, respond) {
          if (request.body?.method !== 'tools/list') return false;
          const second = request.body.params.cursor === 'page-2';
          respond(200, {
            jsonrpc: '2.0',
            id: request.body.id,
            result: second
              ? { tools: [{ name: 'memorix_search', description: 'second page', inputSchema: { type: 'object' } }] }
              : { tools: [{ name: 'memorix_store', description: 'first page', inputSchema: { type: 'object' } }], nextCursor: 'page-2' },
          });
          return true;
        },
      },
      async (server) => {
        const client = createClient({ url: server.url });
        const tools = await client.listTools();

        assert.deepEqual(tools.map((tool) => tool.name), ['memorix_store', 'memorix_search']);
        assert.equal(server.requests.length, 2);
        assert.equal(server.requests[1].body.params.cursor, 'page-2');
      },
    );
  });
});

describe('callTool', () => {
  it('sends the tool name and the project root it was given', async () => {
    await withServer({}, async (server) => {
      const client = createClient({ url: server.url });
      const result = await client.callTool('memorix_search', { query: 'routes' }, { projectRoot: '/root/project/alpha' });

      assert.equal(result.content[0].text, 'memorix_search@/root/project/alpha');
      const [request] = server.requests;
      assert.equal(request.headers['mcp-name'], 'memorix_search');
      assert.equal(request.headers['mcp-project-root'], '/root/project/alpha');
      assert.equal(request.body.params.name, 'memorix_search');
      assert.deepEqual(request.body.params.arguments, { query: 'routes' });
    });
  });

  it('refuses to call without a project root', async () => {
    await withServer({}, async (server) => {
      const client = createClient({ url: server.url });

      await assert.rejects(client.callTool('memorix_search', {}, {}), /needs a project root/u);
      assert.equal(server.requests.length, 0);
    });
  });

  it('keeps structured content when the server sends it', async () => {
    await withServer(
      {
        handler(request, respond) {
          if (request.body?.method !== 'tools/call') return false;
          respond(200, {
            jsonrpc: '2.0',
            id: request.body.id,
            result: { content: [{ type: 'text', text: 'ok' }], structuredContent: { count: 2 } },
          });
          return true;
        },
      },
      async (server) => {
        const client = createClient({ url: server.url });
        const result = await client.callTool('memorix_search', {}, { projectRoot: '/root/project/alpha' });

        assert.deepEqual(result.structuredContent, { count: 2 });
      },
    );
  });
});

describe('failures', () => {
  it('reports the server rejection verbatim, including its code', async () => {
    await withServer(
      {
        handler(request, respond) {
          if (request.body?.method !== 'tools/call') return false;
          respond(400, {
            jsonrpc: '2.0',
            id: request.body.id,
            error: { code: -32020, message: 'the required Mcp-Name header is absent' },
          });
          return true;
        },
      },
      async (server) => {
        const client = createClient({ url: server.url });

        await assert.rejects(client.callTool('memorix_search', {}, { projectRoot: '/root/project/alpha' }), (error) => {
          assert.match(error.message, /tools\/call was rejected \(-32020\)/u);
          assert.match(error.message, /Mcp-Name header is absent/u);
          return true;
        });
      },
    );
  });

  it('names an event-stream answer instead of failing on a parse', async () => {
    await withServer(
      {
        handler(_request, respond) {
          respond(200, 'event: message\ndata: {}\n\n', 'text/event-stream');
          return true;
        },
      },
      async (server) => {
        const client = createClient({ url: server.url });

        await assert.rejects(client.listTools(), /event stream/u);
      },
    );
  });

  it('reports a body that is not JSON', async () => {
    await withServer(
      {
        handler(_request, respond) {
          respond(200, '<html>not an mcp server</html>', 'text/html');
          return true;
        },
      },
      async (server) => {
        const client = createClient({ url: server.url });

        await assert.rejects(client.listTools(), /not JSON/u);
      },
    );
  });

  it('distinguishes its own deadline from a cancellation', async () => {
    await withServer(
      {
        handler() {
          // Never answer: the client has to give up on its own.
          return true;
        },
      },
      async (server) => {
        const client = createClient({ url: server.url, timeoutMs: 40 });

        await assert.rejects(client.listTools(), /timed out after 40 ms/u);
      },
    );
  });

  it('reports a caller cancellation as cancelled, not as a timeout', async () => {
    await withServer(
      {
        handler() {
          return true;
        },
      },
      async (server) => {
        const client = createClient({ url: server.url, timeoutMs: 5_000 });
        const controller = new AbortController();
        const pending = client.listTools({ signal: controller.signal });
        setTimeout(() => {
          controller.abort();
        }, 20);

        await assert.rejects(pending, /was cancelled/u);
      },
    );
  });

  it('reports an unreachable endpoint', async () => {
    const server = await startServer({});
    const client = createClient({ url: server.url, timeoutMs: 2_000 });
    await server.close();

    await assert.rejects(client.listTools(), /could not reach/u);
  });
});
