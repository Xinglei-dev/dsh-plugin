/**
 * dsh-command-duration — put the wall-clock cost of a Bash call in the result
 * the model reads.
 *
 * A tool result already says whether a command succeeded; it does not say how
 * long it took. Without that number an agent cannot tell a 20 ms check from a
 * two-minute build, and may re-run the expensive one just to read a different
 * error line. This plugin appends one short line to Bash results, to the
 * terminal read of a background Bash job, and to a PTC `run_code` call.
 *
 * Three different measurements, deliberately kept apart:
 *
 * - A foreground Bash call reports how long *this call* waited. That is wall
 *   clock around dispatch, not CPU time and not the process's own runtime
 *   measurement.
 * - A background job reports its total runtime only when `job_output` returns
 *   the job's terminal state. The total comes from the registry's own
 *   `startedAt` / `finishedAt` fields, so a wait that timed out mid-job never
 *   turns into a fabricated total.
 * - A PTC `run_code` call is timed like one command: its own dispatch wall
 *   clock, covering the program and every tool call the program makes. Under
 *   PTC a sub-call's result never enters model history — the program receives
 *   only structured values and the model receives only the curated
 *   `run_code` result — so an inner Bash line would be invisible to the model.
 *   Timing the enclosing call is what puts a number in front of the model
 *   without a per-sub-call context message.
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
 * - The `run_code` tool's presence, which only a PTC presentation registers.
 *
 * @module dsh-command-duration
 */

/** Stable Cordis plugin name. */
export const name = 'command-duration';

/**
 * Both listeners run on events the ToolRuntime service dispatches. Declaring
 * the service keeps this plugin pending until the tool registry exists.
 *
 * The Web route below is mounted in a child scope that declares `webServer`
 * (see {@link apply}), so a terminal or API deployment without one still loads
 * this plugin and still times its commands.
 */
export const inject = ['tools'];

/**
 * RPC channel and endpoint the Web client uses to ask how long a call has
 * already been running. One channel, one endpoint, POST-only JSON — the shape
 * `ctx.connection.rpc` speaks.
 */
const RPC_CHANNEL = '/command-duration';
const RPC_ELAPSED = 'elapsed';

/** The tool whose results receive a call-duration line. */
const BASH_TOOL = 'bash';

/** The tool whose terminal reads receive a background total. */
const JOB_OUTPUT_TOOL = 'job_output';

/**
 * The one tool a PTC presentation exposes. Under `native` it is never
 * registered, so timing it costs nothing there.
 */
const RUN_CODE_TOOL = 'run_code';

/** Background job kind produced by the Bash tool. */
const BASH_JOB_KIND = 'bash';

/** Tools whose own dispatch wall clock is measured and reported. */
const TIMED_TOOLS = new Set([BASH_TOOL, RUN_CODE_TOOL]);

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
 * @param endMarker - pattern matching a trailing marker that must stay last,
 *   or `null` when the result has no such marker.
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
  const marker = endMarker === null ? null : endMarker.exec(text);
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
 * Describe one PTC `run_code` call.
 *
 * The number is the whole call's wall clock: the program plus every tool call
 * it makes. It is stated without a breakdown because the model only ever sees
 * the curated `run_code` result — an inner per-call figure would be a number
 * the model cannot attribute.
 *
 * @param elapsedMs - measured dispatch duration.
 * @returns the line for the model.
 */
export function ptcCallLine(elapsedMs) {
  return `【本次 PTC 调用耗时：${formatDuration(elapsedMs)}】`;
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
  /**
   * The same starts keyed by call id, so the Web client can ask how long a call
   * it just discovered has already been running.
   *
   * Two indices rather than one because the two readers hold different things:
   * `tools/post-execute` receives the execution object itself, while the client
   * only knows the id it saw in a session event. `callId` is the same model-minted
   * id in both places — the agent loop stamps it on the execution and on the
   * `tool/call` event — so the id index is a faithful second view, not a guess.
   */
  const startsByCallId = new Map();
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

  /**
   * Forget one call's start in both indices.
   *
   * The id index is not weak, so every recorded call must be released here or
   * the table grows for the life of the process.
   * @param exec - the execution whose start is being consumed.
   */
  const takeStart = (exec) => {
    const started = starts.get(exec);
    starts.delete(exec);
    if (typeof exec.callId === 'string') startsByCallId.delete(exec.callId);
    return started;
  };

  ctx.on(
    'tools/pre-execute',
    (exec, next) => {
      if (TIMED_TOOLS.has(exec.name)) {
        const started = performance.now();
        starts.set(exec, started);
        // `exec.callId` is the id the client will see in the `tool/call` event.
        if (typeof exec.callId === 'string') startsByCallId.set(exec.callId, started);
      }
      return next();
    },
    { prepend: true },
  );

  ctx.on(
    'tools/post-execute',
    async (exec, result, next) => {
      const decision = await next();
      try {
        // The start is consumed first, before any branch can return early: the
        // id index is a plain Map, so a call that is blocked, replaced, or
        // annotated would otherwise leave its entry behind for the life of the
        // process. Every path below reads this one value.
        const started = TIMED_TOOLS.has(exec.name) ? takeStart(exec) : undefined;

        // A block is another policy's corrective feedback; leave it untouched.
        if (decision.kind !== 'accept') return decision;
        // A replaced value is re-rendered by the registry, so text added here
        // would be discarded. The registry also rejects content plus value.
        if (Object.hasOwn(decision, 'value')) return decision;

        let line;
        let endMarker;
        if (exec.name === BASH_TOOL) {
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
        } else if (exec.name === RUN_CODE_TOOL) {
          if (started === undefined) return decision;
          // A failed program reports its own error text; adding a duration
          // would read as if the expensive part had succeeded.
          if (result.isError) return decision;
          line = ptcCallLine(performance.now() - started);
          // `run_code` renders plain text with no trailing status marker.
          endMarker = null;
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

  /**
   * Answer "how long has this call been running?" for the Web client.
   *
   * The reply is a duration in milliseconds, never a timestamp. That choice is
   * the whole point of the endpoint: the browser holds its own clock, and a
   * timestamp minted here would have to be subtracted from that other clock,
   * so any disagreement between the two would land straight in the reading.
   * A duration carries no clock of its own and can be added to two readings
   * taken from one monotonic source.
   *
   * `performance.now()` is monotonic and process-relative, so both ends of the
   * subtraction below belong to this process. A restarted Host has no record —
   * its calls died with it — and answers `undefined` rather than inventing one.
   *
   * @param callId - the id the client saw in its `tool/call` event.
   * @returns elapsed milliseconds, or `undefined` when this call is unknown.
   */
  const elapsedOfCall = (callId) => {
    const started = typeof callId === 'string' ? startsByCallId.get(callId) : undefined;
    if (started === undefined) return undefined;
    const elapsed = performance.now() - started;
    // A clock that went backwards reports nothing rather than a negative wait.
    return Number.isFinite(elapsed) && elapsed >= 0 ? elapsed : undefined;
  };

  // The Web client reaches this host over the same plain route registry the
  // pairing-entry plugin uses: the browser half of a third-party plugin has no
  // RPC channel of its own (`ctx.connection` is a Host service, and the client
  // side has no `connection` service at all), so a small authenticated HTTP
  // route is the only transport available to both halves.
  //
  // `webServer` and `connection` are read optionally: a terminal or API
  // deployment has neither, and this plugin must still time its commands.
  // Mounted in a child scope declaring `webServer`, so this fiber stays pending
  // only where a Web server exists and never blocks a terminal deployment.
  ctx.inject(['webServer'], (webCtx) => {
    // Optional: only the trust fence uses it, and the route works without it.
    const connection = webCtx.get('connection', false);
    webCtx.effect(
      () =>
        webCtx.webServer.register({
          kind: 'exact',
          path: `${RPC_CHANNEL}/${RPC_ELAPSED}`,
          handler: (req, res) => {
            // Same fence as any other authenticated page request: only a
            // trusted Host/Origin with a live peer may read a call's start.
            if (connection !== undefined && connection.requestRejection?.(req) === 403) {
              res.writeHead(403, { 'cache-control': 'no-store' });
              res.end();
              return;
            }
            if (req.method !== 'GET') {
              res.writeHead(405, { allow: 'GET', 'cache-control': 'no-store' });
              res.end();
              return;
            }
            let callId;
            try {
              callId = new URL(req.url ?? '', 'http://dsh.invalid').searchParams.get('callId');
            } catch {
              callId = null;
            }
            const elapsedMs = typeof callId === 'string' && callId.length > 0 ? elapsedOfCall(callId) : undefined;
            res.writeHead(200, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
            // `null` means "this Host holds no record": the caller starts at 0.
            res.end(JSON.stringify({ elapsedMs: elapsedMs ?? null }));
          },
        }),
      'command-duration: elapsed route',
    );
  });
}
