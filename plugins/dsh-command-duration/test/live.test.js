import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { missingReason, optionalImport } from './helpers.js';

const cordis = await optionalImport('@deepseek-ai/cordis');
const tools = await optionalImport('@deepseek-ai/dsh-tools');
const subprocess = await optionalImport('@deepseek-ai/dsh-subprocess-local');
const bashExecutor = await optionalImport('@deepseek-ai/dsh-bash-local');
const jobs = await optionalImport('@deepseek-ai/dsh-jobs-local');
const shellEnv = await optionalImport('@deepseek-ai/dsh-shell-env');
const toolBash = await optionalImport('@deepseek-ai/dsh-tool-bash');
const toolJobs = await optionalImport('@deepseek-ai/dsh-tool-jobs');

const missing = [
  ['@deepseek-ai/cordis', cordis],
  ['@deepseek-ai/dsh-tools', tools],
  ['@deepseek-ai/dsh-subprocess-local', subprocess],
  ['@deepseek-ai/dsh-bash-local', bashExecutor],
  ['@deepseek-ai/dsh-jobs-local', jobs],
  ['@deepseek-ai/dsh-shell-env', shellEnv],
  ['@deepseek-ai/dsh-tool-bash', toolBash],
  ['@deepseek-ai/dsh-tool-jobs', toolJobs],
]
  .filter(([, module]) => module === undefined)
  .map(([specifier]) => missingReason(specifier));
const skip = missing.length === 0 ? false : missing.join(' / ');

/**
 * Mount the installed DSH bash tool, job runtime, and job controls, then this
 * plugin, on one real ToolRuntime. Only the two services those packages read
 * for wiring (systemPrompt, workingDirectory) are stand-ins.
 *
 * @param options - whether to load the plugin under test.
 * @returns the mounted context.
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
  ctx.plugin(subprocess.LocalSubprocessRuntime);
  ctx.plugin(bashExecutor.default, { cwd: process.cwd() });
  ctx.plugin(shellEnv);
  ctx.plugin(jobs.LocalJobRegistry);
  ctx.plugin(toolJobs);
  ctx.plugin(toolBash);
  ctx.provide('workingDirectory', { ensure: async () => process.cwd() });
  if (withPlugin) {
    const { apply } = await import('../lib/index.js');
    await ctx.plugin({ name: 'command-duration', inject: ['tools'], apply });
  }
  for (let attempt = 0; attempt < 1000 && ctx.tools === undefined; attempt += 1) {
    await new Promise((resolve) => setTimeout(resolve, 2));
  }
  assert.notEqual(ctx.tools, undefined, 'the tool runtime did not mount');
  return ctx;
}

/** Dispatch one call through the real pipeline. */
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

/** Milliseconds stated by a `【…：12 毫秒】` / `【…：1.5 秒】` line. */
function statedMs(text, label) {
  const match = new RegExp(`【${label}：(\\d+(?:\\.\\d)?) (毫秒|秒)[^】]*】`, 'u').exec(text);
  assert.notEqual(match, null, `no "${label}" line in:\n${text}`);
  return match[2] === '毫秒' ? Number(match[1]) : Number(match[1]) * 1000;
}

describe('real bash tool and job runtime', { skip }, () => {
  it('keeps a successful command result and states this call\'s wall-clock duration', async () => {
    const ctx = await mount();
    try {
      const result = await call(ctx, 'bash', { command: 'echo hello', description: 'say hello' });
      const text = textOf(result);
      assert.equal(result.isError, false);
      assert.match(text, /^hello\n【命令调用耗时：\d+(?:\.\d)? (?:毫秒|秒)】$/u);
    } finally {
      await ctx.fiber.dispose();
    }
  });

  it('keeps a failing command result, its exit code, and adds the duration before the marker', async () => {
    const ctx = await mount();
    try {
      const result = await call(ctx, 'bash', { command: 'echo bad; exit 7', description: 'fail with seven' });
      const text = textOf(result);
      assert.equal(result.isError, false, 'a nonzero exit is a result, not a tool error');
      assert.match(text, /^bad\n【命令调用耗时：[^\n]+】\n\[exit code: 7\]$/u);
    } finally {
      await ctx.fiber.dispose();
    }
  });

  it('labels a background launch as the launch call and reports the total only after settlement', async () => {
    const ctx = await mount();
    try {
      const started = await call(ctx, 'bash', {
        command: 'sleep 0.15; echo late',
        description: 'finish after a short wait',
        run_in_background: true,
      });
      const startText = textOf(started);
      assert.match(startText, /^started background job bash-[0-9a-f]{16}\n【命令调用耗时：[^\n]+（仅启动后台 Job，不含任务运行时间）】$/u);
      assert.doesNotMatch(startText, /后台任务运行耗时/u);

      const jobId = started.value.jobId;

      const running = await call(ctx, 'job_output', { job_id: jobId });
      assert.match(textOf(running), /\[status: running\]$/u);
      assert.doesNotMatch(textOf(running), /后台任务运行耗时/u);

      const finished = await call(ctx, 'job_output', { job_id: jobId, wait: true });
      const text = textOf(finished);
      assert.match(text, /late\n【后台任务运行耗时：\d+(?:\.\d)? (?:毫秒|秒)】\n\[status: completed, exit code: 0\]$/u);
      assert.doesNotMatch(text, /命令调用耗时/u);
      assert.ok(statedMs(text, '后台任务运行耗时') >= 100, 'the total must cover the command, not the launch');
    } finally {
      await ctx.fiber.dispose();
    }
  });

  it('does not state a total when a job_output wait times out on a running job', async () => {
    const ctx = await mount();
    try {
      const started = await call(ctx, 'bash', {
        command: 'sleep 0.4',
        description: 'still working',
        run_in_background: true,
      });
      const timedOut = await call(ctx, 'job_output', {
        job_id: started.value.jobId,
        wait: true,
        timeout_ms: 80,
      });
      assert.match(textOf(timedOut), /\[status: running\]$/u);
      assert.doesNotMatch(textOf(timedOut), /后台任务运行耗时/u);

      const finished = await call(ctx, 'job_output', { job_id: started.value.jobId, wait: true });
      assert.match(textOf(finished), /【后台任务运行耗时：\d+(?:\.\d)? (?:毫秒|秒)】/u);
      assert.ok(
        statedMs(textOf(finished), '后台任务运行耗时') >= 350,
        'the total is the whole task, not the last wait',
      );
    } finally {
      await ctx.fiber.dispose();
    }
  });

  it('gives a promoted command its own foreground wait and the job its own total', async () => {
    const ctx = await mount();
    try {
      const promoted = await call(ctx, 'bash', {
        command: 'sleep 0.5; echo late',
        description: 'outlive the foreground wait',
        timeoutMs: 100,
      });
      const promotedText = textOf(promoted);
      assert.match(promotedText, /\[still running after 100ms; moved to background job bash-[0-9a-f]{16}\]/u);
      assert.match(promotedText, /【命令调用耗时：[^\n]+（前台等待，任务在后台继续运行）】$/u);
      assert.doesNotMatch(promotedText, /后台任务运行耗时/u);

      const jobId = promoted.value.jobId;
      const finished = await call(ctx, 'job_output', { job_id: jobId, wait: true });
      const total = statedMs(textOf(finished), '后台任务运行耗时');
      assert.ok(total >= 450, `the total covers the whole task, got ${total}ms`);
      assert.ok(
        total > statedMs(promotedText, '命令调用耗时'),
        'the foreground wait must not be reported as the task runtime',
      );
      assert.match(textOf(finished), /late\n【后台任务运行耗时：[^\n]+】\n\[status: completed, exit code: 0\]$/u);
    } finally {
      await ctx.fiber.dispose();
    }
  });

  it('leaves a settled job of another kind without a bash runtime line', async () => {
    const ctx = await mount();
    try {
      const id = ctx.jobs.start({
        kind: 'workflow',
        label: 'a workflow job',
        run(job) {
          return {
            cancel() {},
            done: (async () => {
              job.append('workflow done\n');
              return { status: 'completed' };
            })(),
          };
        },
      });
      await new Promise((resolve) => setTimeout(resolve, 20));
      const result = await call(ctx, 'job_output', { job_id: id });
      assert.doesNotMatch(textOf(result), /后台任务运行耗时/u);
      assert.match(textOf(result), /workflow done\n\[status: completed\]$/u);
    } finally {
      await ctx.fiber.dispose();
    }
  });

  it('leaves a non-bash tool result untouched and keeps the job status line last', async () => {
    const ctx = await mount();
    try {
      ctx.tools.register({
        name: 'read',
        description: 'fake read',
        parameters: { path: { type: 'string', required: true } },
        output: {
          schema: { type: 'object', additionalProperties: true, properties: { text: { type: 'string' } } },
          render: (_args, value) => [{ type: 'text', text: value.text }],
        },
        execute: () => ({ text: 'file contents\n' }),
      });
      const result = await call(ctx, 'read', { path: '/tmp/x' });
      assert.equal(textOf(result), 'file contents\n');
    } finally {
      await ctx.fiber.dispose();
    }
  });
});
