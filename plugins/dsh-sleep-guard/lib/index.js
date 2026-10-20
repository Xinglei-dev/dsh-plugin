/**
 * dsh-sleep-guard — refuse a Bash call that opens with a fixed `sleep N` wait.
 *
 * A command such as `sleep 300; cat /tmp/test.log` waits whether or not the
 * work it polls for has already finished. DSH already has the mechanism it is
 * standing in for: a background job hands back a job id, and `job_output` with
 * `wait: true` returns as soon as that job settles. This plugin refuses the
 * fixed wait before the command runs and tells the agent which mechanism to use
 * instead.
 *
 * The rule is deliberately narrow: only a `sleep` in command-leading position
 * with a numeric duration is refused. A `sleep` anywhere else in the line —
 * after `cd project &&`, inside `bash -c '...'`, in quoted text — is left alone,
 * because deciding that would need a shell parser this plugin does not have.
 *
 * The only upstream surface this plugin touches is the `tools/pre-execute`
 * waterfall: `exec.name` and `exec.arguments.command` going in, a
 * `{ kind: 'deny', reason }` decision going out. Nothing else in DSH changes.
 *
 * @module dsh-sleep-guard
 */

/** Stable Cordis plugin name. */
export const name = 'sleep-guard';

/**
 * The listener runs on the `tools/pre-execute` event, which Cordis dispatches
 * through the ToolRuntime service. Declaring it keeps this plugin pending until
 * the tool registry exists, so the listener cannot be missed on a slow start.
 */
export const inject = ['tools'];

/** The one tool whose commands this plugin inspects. */
const BASH_TOOL = 'bash';

/**
 * A command-leading `sleep` with a numeric duration.
 *
 * - `^\s*` — leading whitespace, so an indented command still matches.
 * - `sleep` followed by horizontal whitespace — `sleepy` and `sleepfree` are
 *   different commands, and a bare `sleep` with no argument is a usage error
 *   rather than a wait.
 * - A duration: digits with an optional fraction, or a bare fraction, plus one
 *   of the `sleep` suffixes `s`, `m`, `h`, `d`. No suffix means seconds.
 * - A boundary after the duration: end of command, whitespace, a shell
 *   separator or redirection, or a `#` starting a comment. This is what keeps
 *   `sleep 10abc` out — `abc` is a duration `sleep` itself would reject.
 *
 * `\r\n` is excluded from the horizontal-whitespace class so a multi-line
 * heredoc body is not treated as continuing the command.
 */
const LEADING_SLEEP = /^\s*sleep[^\S\r\n]+(?:\d+(?:\.\d+)?|\.\d+)[smhd]?(?=\s|$|[;&|()<>#])/u;

/**
 * Text returned to the agent as the denial reason.
 *
 * It names the mechanism that replaces the refused wait and stays short enough
 * to read as a tool result. `job_output` is offered only for a job that already
 * exists: a command whose task has not started yet should be run directly, so
 * the instructions do not tell the agent to wait on a job id it may not have.
 */
export const BLOCK_REASON = [
  '已拦截：不要用 `sleep N` 固定等待任务完成。',
  '',
  '- 任务已在后台运行、且你手上有 Job ID：用 `job_output(wait=true)` 等它结束并读取结果。',
  '- 任务还没启动：直接执行实际命令；需要时用 Bash 的 `timeoutMs` 控制前台等待，或用 `run_in_background: true` 起后台任务。',
  '- 不要用 `sleep N; cat/grep ...` 这类「先等再读日志」的方式轮询任务。',
].join('\n');

/**
 * Decide whether a command opens with a fixed wait.
 *
 * Pure and total: any value that is not a string is not a command, and a
 * command that does not match the leading-`sleep` rule is allowed through.
 *
 * @param command - candidate Bash command, usually `exec.arguments.command`.
 * @returns whether the command starts with a numeric `sleep`.
 */
export function shouldBlock(command) {
  return typeof command === 'string' && LEADING_SLEEP.test(command);
}

/**
 * Read the command out of a tool call's arguments.
 *
 * Arguments arrive already parsed and JSON-snapshotted by the tool registry, so
 * this only has to tolerate a shape it does not recognize: a non-object, or a
 * `command` that is not a string, yields `undefined` and a matching no-op.
 *
 * @param args - the pending call's `arguments`.
 * @returns the command string, or `undefined` when there is none.
 */
export function commandOf(args) {
  if (typeof args !== 'object' || args === null) return undefined;
  const command = args.command;
  return typeof command === 'string' ? command : undefined;
}

/**
 * Refuse a command-leading `sleep`, and let everything else through.
 *
 * `tools/pre-execute` is a waterfall: a listener that is not the decision owner
 * must call `next()` so the remaining listeners and the tool itself still run.
 * Only the deny branch answers directly, which stops dispatch before the command
 * starts — the refused `sleep` never reaches the shell.
 *
 * The listener is registered with `prepend: true` so the denial is reached before
 * listeners that do work of their own on a call they would otherwise let run.
 *
 * @param ctx - plugin context, carrying the `tools` service.
 */
export function apply(ctx) {
  ctx.on(
    'tools/pre-execute',
    (exec, next) => {
      if (exec.name !== BASH_TOOL) return next();
      if (!shouldBlock(commandOf(exec.arguments))) return next();
      return { kind: 'deny', reason: BLOCK_REASON };
    },
    { prepend: true },
  );
}
