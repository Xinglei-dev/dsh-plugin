import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { Context, Service } from '@deepseek-ai/cordis';
import { ToolRuntime } from '@deepseek-ai/dsh-tools';

import * as plugin from '../lib/index.js';
import { BLOCK_REASON } from '../lib/index.js';

/**
 * The system-prompt slice `ToolRuntime` writes its tool catalog into.
 *
 * The runtime registers its schema wiring through this service at construction.
 * The hook path under test never reads it, so recording the calls is enough.
 */
class FakeSystemPrompt extends Service {
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
}

/**
 * Mount the real ToolRuntime and the plugin under test on one context.
 *
 * The registry is what materializes a `deny` decision into the tool result the
 * agent reads, so using it is the point: a fake `ctx` would only prove this
 * plugin returns an object.
 *
 * @returns the mounted context and the record of which tool bodies ran.
 */
async function mount() {
  const ctx = new Context();
  ctx.plugin(FakeSystemPrompt);
  ctx.plugin(ToolRuntime);
  ctx.plugin(plugin);

  for (let attempt = 0; attempt < 1000 && ctx.tools === undefined; attempt += 1) {
    await new Promise((resolve) => setTimeout(resolve, 2));
  }
  assert.notEqual(ctx.tools, undefined, 'the tool runtime did not mount');

  const ran = [];
  const tool = (toolName) => ({
    name: toolName,
    description: `fake ${toolName}`,
    parameters: { command: { type: 'string', required: true } },
    output: { schema: { type: 'object' }, render: () => [] },
    execute: async (args) => {
      ran.push({ tool: toolName, args });
      return { ok: true };
    },
  });
  ctx.tools.register(tool('bash'));
  ctx.tools.register(tool('read'));

  return { ctx, ran };
}

/**
 * Dispatch one call through the real pipeline.
 * @param ctx - mounted context.
 * @param toolName - tool to call.
 * @param args - arguments for that tool.
 * @returns the materialized tool result the caller observes.
 */
function call(ctx, toolName, args) {
  return ctx.tools.execute({
    name: toolName,
    arguments: args,
    signal: new AbortController().signal,
  });
}

describe('the registered tools/pre-execute listener', () => {
  it('denies a command-leading sleep before anything runs', async () => {
    const { ctx, ran } = await mount();

    const result = await call(ctx, 'bash', { command: 'sleep 30; echo done' });

    assert.equal(result.isError, true);
    assert.deepEqual(ran, [], 'the refused command reached a tool body');
    // The reason is what the agent sees, wrapped by the registry as an error text.
    assert.equal(result.error.message, BLOCK_REASON);
    assert.equal(result.content[0].type, 'text');
    assert.match(result.content[0].text, /job_output\(wait=true\)/u);
  });

  it('runs a command it does not match', async () => {
    const { ctx, ran } = await mount();

    const result = await call(ctx, 'bash', { command: 'echo ok' });

    assert.equal(result.isError, false);
    assert.equal(ran.length, 1);
    assert.equal(ran[0].args.command, 'echo ok');
  });

  it('leaves a later sleep in the same command alone', async () => {
    const { ctx, ran } = await mount();

    const result = await call(ctx, 'bash', { command: 'cd project && sleep 60' });

    assert.equal(result.isError, false);
    assert.equal(ran.length, 1);
  });

  it('does not touch a non-bash tool', async () => {
    const { ctx, ran } = await mount();

    const result = await call(ctx, 'read', { command: 'sleep 30' });

    assert.equal(result.isError, false);
    assert.equal(ran.length, 1);
  });

  it('passes calls whose arguments carry no command through the chain', async () => {
    const { ctx, ran } = await mount();

    const result = await call(ctx, 'bash', { description: 'no command here' });

    assert.equal(result.isError, false);
    assert.equal(ran.length, 1);
  });

  it('reaches a listener registered after it when it allows the command', async () => {
    const { ctx } = await mount();
    const seen = [];
    ctx.on('tools/pre-execute', (exec, next) => {
      seen.push(exec.name);
      return next();
    });

    await call(ctx, 'bash', { command: 'echo ok' });

    assert.deepEqual(seen, ['bash'], 'a later listener was skipped on the allow path');
  });

  it('stops a listener registered after it when it denies the command', async () => {
    const { ctx } = await mount();
    const seen = [];
    ctx.on('tools/pre-execute', (exec, next) => {
      seen.push(exec.name);
      return next();
    });

    await call(ctx, 'bash', { command: 'sleep 5' });

    assert.deepEqual(seen, [], 'a later listener ran for a denied command');
  });
});
