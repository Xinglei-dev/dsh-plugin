/**
 * dsh-command-duration — put the wall-clock cost of a Bash call in the result
 * the model reads.
 *
 * A tool result already says whether a command succeeded; it does not say how
 * long it took. Without that number an agent cannot tell a 20 ms check from a
 * two-minute build, and may re-run the expensive one just to read a different
 * error line. This plugin appends one short line to Bash results and to the
 * terminal read of a background Bash job.
 *
 * Two different measurements, deliberately kept apart:
 *
 * - A foreground Bash call reports how long *this call* waited. That is wall
 *   clock around dispatch, not CPU time and not the process's own runtime
 *   measurement.
 * - A background job reports its total runtime only when `job_output` returns
 *   the job's terminal state. The total comes from the registry's own
 *   `startedAt` / `finishedAt` fields, so a wait that timed out mid-job never
 *   turns into a fabricated total.
 *
 * The plugin only appends text. It does not replace stdout/stderr, the exit
 * marker, the job id, or the `[status: ...]` line, and every failure inside
 * the plugin falls back to the original result.
 *
 * Upstream surfaces used:
 *
 * - `tools/pre-execute` marks when the call starts, before policy and approval.
 * - `tools/post-execute` appends the line to the accepted model content; the
 *   span between the two is the wall clock the caller waited.
 * - `job_output`'s canonical output `{ text, job }`, whose `job` carries
 *   `kind`, `status`, `startedAt`, and `finishedAt`.
 * - The `bash` tool's canonical output `kind`: `foreground`, `promoted`, or
 *   `background`.
 *
 * @module dsh-command-duration
 */

/** Stable Cordis plugin name. */
export const name = 'command-duration';

/**
 * Both listeners run on events the ToolRuntime service dispatches. Declaring
 * the service keeps this plugin pending until the tool registry exists.
 */
export const inject = ['tools'];

/** The tool whose results receive a call-duration line. */
const BASH_TOOL = 'bash';

/** The tool whose terminal reads receive a background total. */
const JOB_OUTPUT_TOOL = 'job_output';

/** Background job kind produced by the Bash tool. */
const BASH_JOB_KIND = 'bash';

/** Statuses that mean a job has settled and its total can be computed. */
const TERMINAL_STATUSES = new Set(['completed', 'killed', 'failed']);

/**
 * Status markers the Bash tool appends after its output. A terminal card reads
 * the exit marker off the end of the result, so the duration line goes before
 * it rather than after it.
 */
const BASH_END_MARKER = /\n\[(?:exit code: (?:-?\d+|null)|killed by signal: [^\]\n]+|timed out after \d+ms|stopped: [^\]\n]*|Command finished with exit code -?\d+|shell exited[^\]\n]*)\]$/u;

/** The `job_output` status line, which stays last in the model-facing text. */
const JOB_STATUS_LINE = /\n\[status: [^\]\n]*\]$/u;

/**
 * Render a duration for the model.
 *
 * Sub-second work is clearer in milliseconds; longer work uses the seconds
 * form. Never returns a negative or `NaN` value.
 *
 * @param milliseconds - measured wall-clock duration.
 * @returns a short human-readable duration.
 */
export function formatDuration(milliseconds) {
  const ms = Number.isFinite(milliseconds) && milliseconds > 0 ? milliseconds : 0;
  // Below the timer's own resolution a rounded "0 毫秒" would read as free.
  if (ms < 1) return '不到 1 毫秒';
  const rounded = Math.round(ms);
  if (rounded < 1000) return `${rounded} 毫秒`;
  const seconds = ms / 1000;
  if (seconds < 60) return `${seconds.toFixed(1)} 秒`;
  return `${Math.round(seconds)} 秒`;
}

/**
 * Insert one line into a result's text while keeping a trailing status marker
 * last.
 *
 * Content is frozen by the registry, so this returns a new array and a new
 * text block. Other blocks (images, for example) are carried over untouched.
 * When the result has no text block at all, the line becomes its own block.
 *
 * @param content - the accepted model-facing content.
 * @param line - the line to add, without a trailing newline.
 * @param endMarker - pattern matching a trailing marker that must stay last.
 * @returns new content with the line appended.
 */
export function withDurationLine(content, line, endMarker) {
  const blocks = [...content];
  let index = -1;
  for (let cursor = blocks.length - 1; cursor >= 0; cursor -= 1) {
    if (blocks[cursor]?.type === 'text') {
      index = cursor;
      break;
    }
  }
  if (index === -1) return [...blocks, { type: 'text', text: line }];

  const block = blocks[index];
  const text = block.text;
  const marker = endMarker.exec(text);
  if (marker === null) {
    const separator = text.length > 0 && !text.endsWith('\n') ? '\n' : '';
    blocks[index] = { ...block, text: `${text}${separator}${line}` };
    return blocks;
  }

  const body = text.slice(0, marker.index);
  const separator = body.length > 0 && !body.endsWith('\n') ? '\n' : '';
  blocks[index] = { ...block, text: `${body}${separator}${line}${marker[0]}` };
  return blocks;
}

/**
 * Describe how a finished background job's total runtime is stated.
 *
 * @param job - the `job` projection from a `job_output` result.
 * @returns the line, or `undefined` when a trustworthy total is unavailable.
 */
export function backgroundTotalLine(job) {
  if (typeof job !== 'object' || job === null) return undefined;
  if (job.kind !== BASH_JOB_KIND) return undefined;
  if (!TERMINAL_STATUSES.has(job.status)) return undefined;
  if (!Number.isFinite(job.startedAt) || !Number.isFinite(job.finishedAt)) return undefined;
  const elapsed = job.finishedAt - job.startedAt;
  // A negative span means the timestamps cannot be trusted; omit the line
  // rather than report a made-up near-zero total.
  if (!Number.isFinite(elapsed) || elapsed < 0) return undefined;
  return `【后台任务运行耗时：${formatDuration(elapsed)}】`;
}

/**
 * Describe one Bash call.
 *
 * `kind` comes from the Bash tool's canonical value. A brief launch that
 * started a background job says so, so it can never be read as that job's
 * runtime; a promoted call says its wait ended while the task continues.
 *
 * @param kind - the canonical result kind.
 * @param elapsedMs - measured dispatch duration.
 * @returns the line for the model.
 */
export function callDurationLine(kind, elapsedMs) {
  const duration = formatDuration(elapsedMs);
  if (kind === 'background') {
    return `【命令调用耗时：${duration}（仅启动后台 Job，不含任务运行时间）】`;
  }
  if (kind === 'promoted') {
    return `【命令调用耗时：${duration}（前台等待，任务在后台继续运行）】`;
  }
  return `【命令调用耗时：${duration}】`;
}

/**
 * Resolve the kind of one Bash result.
 *
 * A forced background call is recognized from its arguments as well as from
 * the value, so a brief launch is never described as a task runtime even if a
 * future value shape stops naming its kind.
 *
 * @param value - the canonical value returned by the Bash tool.
 * @param args - the call's parsed arguments.
 * @returns `background`, `promoted`, `foreground`, or `undefined` for a value
 *   shape this plugin does not recognize well enough to label.
 */
export function bashResultKind(value, args) {
  const forcedBackground = typeof args === 'object' && args !== null && args.run_in_background === true;
  if (typeof value === 'object' && value !== null && typeof value.kind === 'string') {
    if (value.kind === 'background' || value.kind === 'promoted' || value.kind === 'foreground') {
      return value.kind;
    }
    return forcedBackground ? 'background' : undefined;
  }
  if (forcedBackground) return 'background';
  // The persistent Bash tool returns plain text; it is still a Bash call.
  if (typeof value === 'string') return 'foreground';
  return undefined;
}

/**
 * Mount the start marker and the result annotator.
 *
 * The start listener stores one timestamp per execution object.
 * `tools/post-execute` receives that same object, so no global call-id table is
 * needed and a disposed plugin leaves no state behind.
 *
 * Both listeners run outermost (`prepend: true`): the start is taken before
 * another policy can deny the call, and the line is added after any
 * result-rewriting policy has run, so a truncating policy cannot cut it off.
 *
 * @param ctx - plugin context carrying the `tools` service.
 */
export function apply(ctx) {
  /** Wall-clock start per execution object, written by the start listener. */
  const starts = new WeakMap();
  /** Diagnostics already reported, so one bad shape does not flood the log. */
  const warned = new Set();

  /**
   * Report an unexpected upstream shape once. Duration display is optional,
   * so the original result still stands.
   * @param key - stable diagnostic key.
   * @param message - what was expected and what was observed.
   */
  const warnOnce = (key, message) => {
    if (warned.has(key)) return;
    warned.add(key);
    // Logging is best-effort: a broken logger must never fail the command.
    try {
      ctx.logger?.warn?.(`command-duration: ${message}`);
    } catch {
      // Ignored: the diagnostic is optional.
    }
  };

  ctx.on(
    'tools/pre-execute',
    (exec, next) => {
      if (exec.name === BASH_TOOL) starts.set(exec, performance.now());
      return next();
    },
    { prepend: true },
  );

  ctx.on(
    'tools/post-execute',
    async (exec, result, next) => {
      const decision = await next();
      try {
        // A block is another policy's corrective feedback; leave it untouched.
        if (decision.kind !== 'accept') return decision;
        // A replaced value is re-rendered by the registry, so text added here
        // would be discarded. The registry also rejects content plus value.
        if (Object.hasOwn(decision, 'value')) return decision;

        let line;
        let endMarker;
        if (exec.name === BASH_TOOL) {
          const started = starts.get(exec);
          starts.delete(exec);
          // No start was recorded when another policy short-circuited earlier.
          if (started === undefined) return decision;
          // A denial, cancellation, or dispatch failure is an error result:
          // the original message stays exactly as it was.
          if (result.isError) return decision;
          const kind = bashResultKind(result.value, exec.arguments);
          if (kind === undefined) {
            warnOnce(
              'bash-value',
              'bash returned a result shape without a recognized kind; no call duration was shown',
            );
            return decision;
          }
          line = callDurationLine(kind, performance.now() - started);
          endMarker = BASH_END_MARKER;
        } else if (exec.name === JOB_OUTPUT_TOOL) {
          if (result.isError) return decision;
          const value = result.value;
          if (typeof value !== 'object' || value === null || typeof value.job !== 'object' || value.job === null) {
            warnOnce(
              'job-output-value',
              'job_output result is not the expected { text, job } shape; no total runtime was shown',
            );
            return decision;
          }
          line = backgroundTotalLine(value.job);
          if (line === undefined) {
            if (value.job.kind === BASH_JOB_KIND && TERMINAL_STATUSES.has(value.job.status)) {
              warnOnce(
                'job-times',
                'job_output returned a terminal bash job without usable startedAt/finishedAt; no total runtime was shown',
              );
            }
            return decision;
          }
          endMarker = JOB_STATUS_LINE;
        } else {
          return decision;
        }

        const content = decision.content ?? result.content;
        return {
          ...decision,
          content: withDurationLine(content, line, endMarker),
        };
      } catch (error) {
        warnOnce('annotate', `result annotation failed (${String(error)}); the original result was kept`);
        return decision;
      }
    },
    { prepend: true },
  );
}
