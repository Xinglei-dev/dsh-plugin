/**
 * The real tool registry, not a fake.
 *
 * Everything else in this suite observes the plugin through a recording
 * context. This file answers the one question that a fake cannot: does
 * `@deepseek-ai/dsh-tools` accept these dynamically built definitions, enforce
 * their parameter schema, and render their output? It skips when the DSH
 * packages are not linked (see `test/link-peers.sh`).
 *
 * @module test/tool-runtime
 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import * as plugin from '../lib/index.js';
import { startServer } from './fake-server.js';

/**
 * Import the two DSH packages this test mounts.
 * @returns the constructors, or undefined when the packages are absent.
 */
async function upstream() {
  try {
    const [cordis, tools] = await Promise.all([import('@deepseek-ai/cordis'), import('@deepseek-ai/dsh-tools')]);
    return { Service: cordis.Service, Context: cordis.Context, ToolRuntime: tools.ToolRuntime };
  } catch (error) {
    if (error?.code === 'ERR_MODULE_NOT_FOUND') return undefined;
    throw error;
  }
}

const loaded = await upstream();

/**
 * The system-prompt slice `ToolRuntime` wires its catalog into. The call path
 * under test never reads it, so recording the registrations is enough.
 */
const FakeSystemPrompt = loaded === undefined ? undefined : class extends loaded.Service {
  /** @param ctx - mounting context. */
  constructor(ctx) {
    super(ctx, 'systemPrompt');
  }

  /** @returns a disposer, as the real registration does. */
  tools() {
    return () => {};
  }

  /** @returns a disposer, as the real registration does. */
  section() {
    return () => {};
  }

  /** @returns the order assigned to a named section. */
  getSectionOrder() {
    return 0;
  }
};

describe('the real tool registry', { skip: loaded === undefined ? 'link the DSH packages with test/link-peers.sh' : false }, () => {
  it('accepts the bridged definitions and runs one end to end', async () => {
    const server = await startServer({});
    try {
      const ctx = new loaded.Context();
      ctx.plugin(FakeSystemPrompt);
      ctx.plugin(loaded.ToolRuntime);
      for (let attempt = 0; attempt < 1_000 && ctx.tools === undefined; attempt += 1) {
        await new Promise((resolve) => setTimeout(resolve, 2));
      }
      assert.notEqual(ctx.tools, undefined, 'the tool runtime did not mount');

      await plugin.apply(ctx, { baseUrl: server.url, fallbackProjectRoot: '/root/project/registry' });

      const names = ctx.tools.schemas().map((schema) => schema.name);
      assert.ok(names.includes('mcp__memorix__memorix_search'), `registered tools were ${names.join(', ')}`);

      const result = await ctx.tools.execute({
        callId: 'call-1',
        name: 'mcp__memorix__memorix_search',
        arguments: { query: 'routes' },
        signal: new AbortController().signal,
      });

      assert.equal(result.isError, false);
      assert.equal(result.content[0].type, 'text');
      assert.equal(result.content[0].text, 'memorix_search@/root/project/registry');
    } finally {
      await server.close();
    }
  });

  it('passes the model arguments to the server unchanged', async () => {
    const server = await startServer({});
    try {
      const ctx = new loaded.Context();
      ctx.plugin(FakeSystemPrompt);
      ctx.plugin(loaded.ToolRuntime);
      for (let attempt = 0; attempt < 1_000 && ctx.tools === undefined; attempt += 1) {
        await new Promise((resolve) => setTimeout(resolve, 2));
      }
      await plugin.apply(ctx, { baseUrl: server.url, fallbackProjectRoot: '/root/project/registry' });

      await ctx.tools.execute({
        callId: 'call-2',
        name: 'mcp__memorix__memorix_store',
        arguments: { entityName: 'routes', title: 'A finding' },
        signal: new AbortController().signal,
      });

      const call = server.requests.find((request) => request.body?.method === 'tools/call');
      assert.deepEqual(call?.body.params.arguments, { entityName: 'routes', title: 'A finding' });
    } finally {
      await server.close();
    }
  });
});
