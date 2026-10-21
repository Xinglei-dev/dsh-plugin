import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import * as plugin from '../lib/index.js';
import { missingReason, optionalImport } from './helpers.js';

const cordis = await optionalImport('@deepseek-ai/cordis');
const tools = await optionalImport('@deepseek-ai/dsh-tools');

const skip = cordis === undefined
  ? missingReason('@deepseek-ai/cordis')
  : tools === undefined
    ? missingReason('@deepseek-ai/dsh-tools')
    : false;

/**
 * Mount the real ToolRuntime and this plugin on one context.
 *
 * The registry is what materializes content after `tools/post-execute`, so a
 * fake `ctx` would only prove the listener returns an object.
 *
 * @param options - whether to load the plugin.
 * @returns the mounted context and the fake tools' call log.
 */
async function mount({ withPlugin = true } = {}) {
  const { Context } = cordis;
  const { ToolRuntime } = tools;
  const ctx = new Context();
  ctx.provide('systemPrompt', {
    tools: () => () => {},
    section: () => () => {},
    getSectionOrder: () => 0,
  });
  ctx.plugin(ToolRuntime);
  for (let attempt = 0; attempt < 1000 && ctx.tools === undefined; attempt += 1) {
    await new Promise((resolve) => setTimeout(resolve, 2));
  }
  assert.notEqual(ctx.tools, undefined, 'the tool runtime did not mount');
  if (withPlugin) {
    const fiber = ctx.plugin(plugin);
    await fiber;
  }

  const calls = [];
  const register = (definition) => ctx.tools.register(definition);

  /** A stand-in for the bash tool with its canonical value union. */
  register({
    name: 'bash',
    description: 'fake bash',
    parameters: {
      command: { type: 'string', required: true },
      description: { type: 'string' },
      run_in_background: { type: 'boolean' },
      timeoutMs: { type: 'number' },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: true,
        properties: {
          kind: { type: 'string' },
          jobId: { type: 'string' },
          text: { type: 'string' },
          delayMs: { type: 'number' },
        },
      },
      render: (_args, value) => [{ type: 'text', text: value.text }],
    },
    async execute(args) {
      calls.push({ tool: 'bash', args });
      if (args.delayMs !== undefined) await new Promise((resolve) => setTimeout(resolve, args.delayMs));
      if (args.run_in_background === true) {
        return { kind: 'background', cwd: '/tmp', jobId: 'bash-0123456789abcdef', text: 'started background job bash-0123456789abcdef' };
      }
      return {
        kind: 'foreground',
        cwd: '/tmp',
        text: 'hello\n[exit code: 2]',
      };
    },
  });

  /** A stand-in for the job controls with the public job projection. */
  register({
    name: 'job_output',
    description: 'fake job output',
    parameters: { job_id: { type: 'string', required: true } },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        required: ['text', 'job'],
        properties: {
          text: { type: 'string' },
          job: {
            type: 'object',
            additionalProperties: false,
            required: ['id', 'kind', 'label', 'status', 'startedAt'],
            properties: {
              id: { type: 'string' },
              kind: { type: 'string' },
              label: { type: 'string' },
              status: { type: 'string' },
              detail: { type: 'string' },
              startedAt: { type: 'integer' },
              finishedAt: { type: 'integer' },
            },
          },
        },
      },
      render: (_args, value) => [
        {
          type: 'text',
          text: `${value.text.length > 0 ? `${value.text}\n` : '(no new output)\n'}[status: ${value.job.status}${value.job.detail === undefined ? '' : `, ${value.job.detail}`}]`,
        },
      ],
    },
    execute(args) {
      calls.push({ tool: 'job_output', args });
      if (args.job_id === 'bash-running') {
        return { text: '', job: { id: 'bash-running', kind: 'bash', label: 'slow', status: 'running', startedAt: 1_000 } };
      }
      if (args.job_id === 'bash-finished') {
        return {
          text: 'done\n',
          job: {
            id: 'bash-finished',
            kind: 'bash',
            label: 'sleep 0.1',
            status: 'completed',
            detail: 'exit code: 0',
            startedAt: 1_000_000,
            finishedAt: 1_002_400,
          },
        };
      }
      if (args.job_id === 'terminal-finished') {
        return {
          text: 'pty output\n',
          job: {
            id: 'terminal-finished',
            kind: 'terminal',
            label: 'a shell',
            status: 'completed',
            startedAt: 1_000_000,
            finishedAt: 1_120_000,
          },
        };
      }
      throw new Error(`unknown fake job ${args.job_id}`);
    },
  });

  /** A non-bash tool whose result must stay untouched. */
  register({
    name: 'read',
    description: 'fake read',
    parameters: { path: { type: 'string', required: true } },
    output: {
      schema: { type: 'object', additionalProperties: true, properties: { text: { type: 'string' } } },
      render: (_args, value) => [{ type: 'text', text: value.text }],
    },
    execute(args) {
      calls.push({ tool: 'read', args });
      return { text: 'file contents\n' };
    },
  });

  return { ctx, calls };
}

/**
 * Dispatch one call through the real pipeline.
 * @param ctx - mounted context.
 * @param name - tool name.
 * @param args - tool arguments.
 * @returns the materialized result the caller observes.
 */
function call(ctx, name, args) {
  return ctx.tools.execute({
    callId: `call-${Math.random().toString(16).slice(2)}`,
    name,
    arguments: args,
    signal: new AbortController().signal,
  });
}

/** Read the single text block of a result. */
const textOf = (result) => result.content.map((block) => (block.type === 'text' ? block.text : '')).join('\n');

describe('real ToolRuntime result pipeline', { skip }, () => {
  it('keeps a successful bash result and states this call\'s duration before the exit marker', async () => {
    const { ctx } = await mount();
    try {
      const result = await call(ctx, 'bash', { command: 'echo hello', description: 'say hello' });
      const text = textOf(result);
      assert.equal(result.isError, false);
      assert.match(text, /hello/u);
      assert.match(text, /【命令调用耗时：[^\n]+】/u);
      assert.match(text, /【命令调用耗时：[^\n]+】\n\[exit code: 2\]$/u);
    } finally {
      await ctx.fiber.dispose();
    }
  });

  it('measures the wait, not a fixed estimate', async () => {
    const { ctx } = await mount();
    try {
      const result = await call(ctx, 'bash', { command: 'sleep', description: 'wait', delayMs: 120 });
      assert.match(textOf(result), /【命令调用耗时：1\d{2} 毫秒】/u);
    } finally {
      await ctx.fiber.dispose();
    }
  });

  it('shows a background launch as the launch call, never as the task runtime', async () => {
    const { ctx } = await mount();
    try {
      const result = await call(ctx, 'bash', { command: 'build', description: 'build', run_in_background: true });
      assert.match(textOf(result), /【命令调用耗时：[^\n]+（仅启动后台 Job，不含任务运行时间）】$/u);
      assert.doesNotMatch(textOf(result), /后台任务运行耗时/u);
    } finally {
      await ctx.fiber.dispose();
    }
  });

  it('adds the total runtime to a finished bash job read, before the status line', async () => {
    const { ctx } = await mount();
    try {
      const result = await call(ctx, 'job_output', { job_id: 'bash-finished' });
      assert.match(textOf(result), /done\n【后台任务运行耗时：2\.4 秒】\n\[status: completed, exit code: 0\]$/u);
      assert.doesNotMatch(textOf(result), /命令调用耗时/u);
    } finally {
      await ctx.fiber.dispose();
    }
  });

  it('does not state a total while the job is still running', async () => {
    const { ctx } = await mount();
    try {
      const result = await call(ctx, 'job_output', { job_id: 'bash-running' });
      assert.doesNotMatch(textOf(result), /后台任务运行耗时/u);
      assert.match(textOf(result), /\[status: running\]$/u);
    } finally {
      await ctx.fiber.dispose();
    }
  });

  it('leaves a finished job of another kind without a bash runtime line', async () => {
    const { ctx } = await mount();
    try {
      const result = await call(ctx, 'job_output', { job_id: 'terminal-finished' });
      assert.doesNotMatch(textOf(result), /后台任务运行耗时/u);
      assert.match(textOf(result), /\[status: completed\]$/u);
    } finally {
      await ctx.fiber.dispose();
    }
  });

  it('leaves a non-bash tool result untouched', async () => {
    const { ctx } = await mount();
    try {
      const result = await call(ctx, 'read', { path: '/tmp/x' });
      assert.equal(textOf(result), 'file contents\n');
    } finally {
      await ctx.fiber.dispose();
    }
  });

  it('changes nothing when the plugin is not loaded', async () => {
    const { ctx } = await mount({ withPlugin: false });
    try {
      const bash = await call(ctx, 'bash', { command: 'echo hello', description: 'say hello' });
      assert.equal(textOf(bash), 'hello\n[exit code: 2]');
      const job = await call(ctx, 'job_output', { job_id: 'bash-finished' });
      // The fake renderer adds one newline after text that already ends with
      // one; the point is that nothing was inserted before the status line.
      assert.equal(textOf(job), 'done\n\n[status: completed, exit code: 0]');
    } finally {
      await ctx.fiber.dispose();
    }
  });

  it('stops annotating once the plugin fiber is disposed', async () => {
    const { ctx } = await mount({ withPlugin: false });
    const fiber = ctx.plugin(plugin);
    await fiber;
    await fiber.dispose();
    try {
      const result = await call(ctx, 'bash', { command: 'echo hello', description: 'say hello' });
      assert.doesNotMatch(textOf(result), /命令调用耗时/u);
    } finally {
      await ctx.fiber.dispose();
    }
  });

  it('adds the line after a content-rewriting policy, not before it', async () => {
    const { ctx } = await mount();
    try {
      // A downstream policy that truncates long bash output, as the spill
      // policy does. The duration line must survive it.
      ctx.on('tools/post-execute', async (exec, result, next) => {
        const decision = await next();
        if (exec.name !== 'bash' || decision.kind !== 'accept') return decision;
        return {
          kind: 'accept',
          content: [{ type: 'text', text: 'truncated preview\n[exit code: 2]' }],
        };
      });
      const result = await call(ctx, 'bash', { command: 'echo hello', description: 'say hello' });
      assert.match(textOf(result), /truncated preview\n【命令调用耗时：[^\n]+】\n\[exit code: 2\]$/u);
    } finally {
      await ctx.fiber.dispose();
    }
  });

  it('leaves a value-replacing policy alone instead of mixing content with a value', async () => {
    const { ctx } = await mount();
    try {
      ctx.on('tools/post-execute', async (exec, result, next) => {
        const decision = await next();
        if (exec.name !== 'bash' || decision.kind !== 'accept') return decision;
        return { kind: 'accept', value: { kind: 'foreground', cwd: '/tmp', text: 'replaced value' } };
      });
      const result = await call(ctx, 'bash', { command: 'echo hello', description: 'say hello' });
      assert.equal(result.isError, false);
      assert.equal(textOf(result), 'replaced value');
    } finally {
      await ctx.fiber.dispose();
    }
  });

  it('leaves a result another policy blocks untouched', async () => {
    const { ctx } = await mount();
    try {
      ctx.on('tools/post-execute', async (exec, result, next) => {
        const decision = await next();
        if (exec.name !== 'bash') return decision;
        return { kind: 'block', feedback: [{ type: 'text', text: 'not allowed' }] };
      });
      const result = await call(ctx, 'bash', { command: 'echo hello', description: 'say hello' });
      assert.equal(result.isError, true);
      assert.equal(textOf(result), 'not allowed');
    } finally {
      await ctx.fiber.dispose();
    }
  });
});
