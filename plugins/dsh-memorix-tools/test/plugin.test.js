import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { apply, DEFAULT_BASE_URL, projectRootOf } from '../lib/index.js';
import { startServer } from './fake-server.js';

/**
 * A context with the only surfaces the plugin uses: the tool registry, effect
 * cleanup, and a logger.
 *
 * The real registry is exercised in `tool-runtime.test.js`; this one exists to
 * observe registration, rollback, and disposal, which a fake makes exact.
 *
 * @returns the fake context and the records it keeps.
 */
function fakeContext() {
  const tools = new Map();
  const cleanups = [];
  const logs = { info: [], warn: [], error: [] };
  const ctx = {
    tools: {
      register(definition) {
        if (tools.has(definition.name)) throw new Error(`tool "${definition.name}" is already registered`);
        tools.set(definition.name, definition);
        return () => {
          tools.delete(definition.name);
        };
      },
    },
    effect(setup) {
      const dispose = setup();
      if (typeof dispose === 'function') cleanups.push(dispose);
      return dispose;
    },
    logger: {
      info: (message) => logs.info.push(message),
      warn: (message) => logs.warn.push(message),
      error: (message) => logs.error.push(message),
    },
  };
  return {
    ctx,
    tools,
    logs,
    dispose() {
      for (const cleanup of cleanups.splice(0)) cleanup();
    },
  };
}

/**
 * Run one test body with a fake memorix server.
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

describe('apply', () => {
  it('registers every advertised tool under the mcp__<serverName>__ name', async () => {
    await withServer({}, async (server) => {
      const { ctx, tools, logs } = fakeContext();

      await apply(ctx, { baseUrl: server.url });

      assert.deepEqual([...tools.keys()], ['mcp__memorix__memorix_store', 'mcp__memorix__memorix_search']);
      assert.match(logs.info[0], /registered 2 tools/u);
    });
  });

  it('unregisters every tool when the row is disposed', async () => {
    await withServer({}, async (server) => {
      const { ctx, tools, dispose } = fakeContext();
      await apply(ctx, { baseUrl: server.url });

      dispose();

      assert.equal(tools.size, 0);
    });
  });

  it('sends the calling session working directory as the project root', async () => {
    await withServer({}, async (server) => {
      const { ctx, tools } = fakeContext();
      await apply(ctx, { baseUrl: server.url });
      const definition = tools.get('mcp__memorix__memorix_search');

      const value = await definition.execute(
        { query: 'routes' },
        { signal: new AbortController().signal, agent: { session: { header: { cwd: '/root/project/beta' } } } },
      );

      assert.equal(value.content[0].text, 'memorix_search@/root/project/beta');
      assert.equal(server.requests.at(-1).headers['mcp-project-root'], '/root/project/beta');
    });
  });

  it('uses fallbackProjectRoot when the call has no session directory', async () => {
    await withServer({}, async (server) => {
      const { ctx, tools } = fakeContext();
      await apply(ctx, { baseUrl: server.url, fallbackProjectRoot: '/root/project/fallback' });
      const definition = tools.get('mcp__memorix__memorix_search');

      await definition.execute({ query: 'routes' }, {});

      assert.equal(server.requests.at(-1).headers['mcp-project-root'], '/root/project/fallback');
    });
  });

  it('refuses a call with neither a session directory nor a fallback', async () => {
    await withServer({}, async (server) => {
      const { ctx, tools } = fakeContext();
      await apply(ctx, { baseUrl: server.url });
      const definition = tools.get('mcp__memorix__memorix_search');

      await assert.rejects(definition.execute({ query: 'routes' }, {}), /refusing to let the server choose a project/u);
      assert.equal(server.requests.filter((request) => request.body?.method === 'tools/call').length, 0);
    });
  });

  it('fails startup by default when the tool list cannot be read', async () => {
    const server = await startServer({});
    await server.close();
    const { ctx, tools } = fakeContext();

    await assert.rejects(apply(ctx, { baseUrl: server.url, toolCallTimeoutMs: 2_000 }), /could not read the tool list/u);
    assert.equal(tools.size, 0);
  });

  it('loads without tools when startup failure is configured away', async () => {
    const server = await startServer({});
    await server.close();
    const { ctx, tools, logs } = fakeContext();

    await apply(ctx, { baseUrl: server.url, toolCallTimeoutMs: 2_000, failOnStartupError: false });

    assert.equal(tools.size, 0);
    assert.match(logs.error[0], /loading without memorix tools/u);
  });

  it('rolls back tools it already registered when a name is taken', async () => {
    await withServer({}, async (server) => {
      const { ctx, tools } = fakeContext();
      // A second tool's name collides, so the first registration must be undone.
      tools.set('mcp__memorix__memorix_search', { name: 'mcp__memorix__memorix_search' });

      await assert.rejects(apply(ctx, { baseUrl: server.url }), /already registered/u);
      assert.deepEqual([...tools.keys()], ['mcp__memorix__memorix_search'], 'the tool registered before the conflict stayed behind');
    });
  });

  it('rejects a serverName that cannot be part of a tool name', async () => {
    const { ctx } = fakeContext();

    await assert.rejects(apply(ctx, { serverName: 'memorix tools' }), /serverName/u);
  });
});

describe('projectRootOf', () => {
  it('prefers the session header over the fallback', () => {
    const exec = { agent: { session: { header: { cwd: '/root/project/session' } } } };

    assert.equal(projectRootOf(exec, '/root/project/fallback'), '/root/project/session');
  });

  it('ignores an empty fallback', () => {
    assert.throws(() => projectRootOf({}, '  '), /no session working directory/u);
  });
});

describe('defaults', () => {
  it('points at the local serve-http endpoint', () => {
    assert.equal(DEFAULT_BASE_URL, 'http://127.0.0.1:3211/mcp');
  });
});
