window.__ModuleLoader__.load({
  id: 'dsh-command-duration',
  factory: (require) => {
    const react = require('react');

    /** Locale namespace this plugin owns. */
    const NS = 'command-duration';

    /**
     * Tools whose running call is metered, matching the Host side's own
     * `TIMED_TOOLS`: `bash` for a foreground command, and `run_code` for a PTC
     * program, which the Host also times as one whole call. The root tool call
     * of a PTC run is `run_code` — the `bash` calls inside the program are
     * sub-calls — so without `run_code` here the meter stays blank for every
     * PTC run while the result text still carries a duration.
     */
    const METERED_TOOLS = new Set(['bash', 'run_code']);

    /**
     * Normalize a host timestamp into a finite number.
     * @param value - candidate timestamp.
     * @returns the number, or `undefined` when it is not usable as a clock reading.
     */
    function finiteTime(value) {
      return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
    }

    /**
     * Pick the running calls worth showing.
     *
     * A metered call is one whose `phase` is `start` (arguments are complete and
     * the tool body is running) and whose tool name is metered. A `preparing`
     * call has not been dispatched yet — its arguments are still streaming — so
     * it is deliberately skipped: a clock there would time the model, not the
     * command.
     *
     * @param runningCalls - `legacy.runningCalls` from the chat snapshot.
     * @returns the metered calls, in the order given.
     */
    function meteredCalls(runningCalls) {
      if (!Array.isArray(runningCalls)) return [];
      return runningCalls.filter(
        (call) =>
          typeof call === 'object' &&
          call !== null &&
          call.phase === 'start' &&
          METERED_TOOLS.has(call.name) &&
          finiteTime(call.time) !== undefined,
      );
    }

    /**
     * A monotonic millisecond reading, immune to the wall clock being set.
     *
     * `performance.now()` counts from page load instead of from the epoch, so
     * an NTP correction or a manual clock change cannot make it jump — unlike
     * `Date.now()`, which would make a 10-second command read as an hour if the
     * clock stepped in between two ticks.
     *
     * @returns monotonically nondecreasing milliseconds.
     */
    function monotonicNow() {
      return globalThis.performance?.now?.() ?? Date.now();
    }

    /**
     * Elapsed milliseconds for one call, from the moment the browser first saw
     * it plus how long the Host had already been running it.
     *
     * Both addends are durations measured by one clock each, so neither one
     * carries a clock seam:
     *
     * - `hostElapsed` is what the Host reported, already a duration.
     * - `browserElapsed` is a difference of two readings from this page's own
     *   monotonic clock.
     *
     * Adding two durations is valid whatever the two clocks say about the wall
     * time; subtracting two clocks is what breaks under a skewed clock, and
     * this function never does that.
     *
     * @param hostElapsed - milliseconds the call had already run on arrival.
     * @param browserElapsed - milliseconds this page has measured since then.
     * @returns a nonnegative duration.
     */
    function elapsedOf(hostElapsed, browserElapsed) {
      const elapsed = hostElapsed + browserElapsed;
      return Number.isFinite(elapsed) && elapsed > 0 ? elapsed : 0;
    }

    /**
     * State one elapsed time for a live readout.
     *
     * The meter redraws ten times a second, so it stays coarse on purpose:
     * sub-ten-second work reads in tenths, then whole seconds, then minutes.
     * A value that changed on every tick would be noise, not information.
     *
     * @param milliseconds - measured elapsed time.
     * @returns a short human-readable duration.
     */
    function formatLiveDuration(milliseconds) {
      const ms = Number.isFinite(milliseconds) && milliseconds > 0 ? milliseconds : 0;
      if (ms < 100) return '0.0 秒';
      if (ms < 10_000) return `${(ms / 1000).toFixed(1)} 秒`;
      const totalSeconds = Math.floor(ms / 1000);
      if (totalSeconds < 60) return `${totalSeconds} 秒`;
      const minutes = Math.floor(totalSeconds / 60);
      const seconds = totalSeconds % 60;
      if (minutes < 60) return `${minutes} 分 ${seconds} 秒`;
      const hours = Math.floor(minutes / 60);
      return `${hours} 小时 ${minutes % 60} 分`;
    }

    /** How often the readout redraws while a command runs, in milliseconds. */
    const TICK_MS = 100;

    /**
     * Host endpoint that answers how long one call has already been running.
     * Must match the Host half's `RPC_CHANNEL` / `RPC_ELAPSED`.
     */
    const RPC_CHANNEL = '/command-duration';
    const RPC_ELAPSED = 'elapsed';

    const zh = {
      label: '运行中',
      one: '命令运行中',
      many: '命令运行中（{count}）',
      settled: '已结束',
      title: '模型看不到这里的耗时，只影响界面显示',
    };

    const en = {
      label: 'Running',
      one: 'Command running',
      many: 'Commands running ({count})',
      settled: 'Finished',
      title: 'This readout is UI-only; the model never sees it',
    };

    const STYLE_METER = {
      display: 'inline-flex',
      alignItems: 'center',
      gap: '6px',
      height: '28px',
      padding: '0 8px',
      fontSize: '12px',
      lineHeight: '18px',
      color: 'var(--dsw-alias-label-secondary)',
      fontVariantNumeric: 'tabular-nums',
      whiteSpace: 'nowrap',
    };
    const STYLE_DOT = {
      flex: 'none',
      width: '6px',
      height: '6px',
      borderRadius: '999px',
      background: 'var(--dsw-alias-state-business-primary, currentColor)',
    };
    const STYLE_TIME = {
      fontFamily: 'var(--ds-font-family-code, ui-monospace, monospace)',
      color: 'var(--dsw-alias-label-primary)',
    };

    /**
     * Meter one running call, or state its final duration once it settles.
     *
     * The reading is assembled from two durations, never from two clocks:
     *
     * - When a call is first seen, the Host is asked how long it has already
     *   been running. That answer is a duration.
     * - From then on, this page measures the increment itself on its own
     *   monotonic clock.
     *
     * Asking the Host matters only for the join: on a fresh page a call may be
     * seconds old already, and starting every readout at zero would understate
     * it. Once the join is done the Host is not consulted again, so a running
     * readout keeps ticking even if the connection drops.
     *
     * @param props - the metered calls, the translator, and the elapsed reader.
     * @returns the elapsed readout.
     */
    function LiveMeter({ calls, t, readHostElapsed }) {
      // Ticks advance this; it is a monotonic reading, never the wall clock.
      const [now, setNow] = react.useState(monotonicNow);

      const running = calls.length > 0;
      // The readout one number can state is the longest wait in progress. The
      // Host stamps `time` for all calls from one clock, so comparing those
      // values against each other is sound even though this file never
      // subtracts them from a browser reading.
      const oldest = calls.reduce(
        (earliest, call) => (earliest === undefined || call.time < earliest.time ? call : earliest),
        undefined,
      );

      /**
       * Per-call baselines, kept across renders: `at` is when this page first
       * saw the call, `hostElapsed` is what the Host reported for it.
       * `pending` marks a call whose answer has not arrived yet.
       */
      const bases = react.useRef(new Map());
      // Bumped when a Host answer lands, so the meter redraws with it.
      const [, setRevision] = react.useState(0);

      if (oldest !== undefined && !bases.current.has(oldest.callId)) {
        // Seeded during render so the first frame already shows the right
        // number instead of flashing zero and then jumping.
        bases.current.set(oldest.callId, { at: now, hostElapsed: 0, pending: true });
        // The request runs after commit: `readHostElapsed` talks to the Host,
        // and a render must stay free of side effects.
        queueMicrotask(() => {
          Promise.resolve()
            .then(() => readHostElapsed?.(oldest.callId))
            .then((hostElapsed) => {
              const base = bases.current.get(oldest.callId);
              // A call that ended while the request was in flight keeps the
              // baseline it had; there is nothing left to correct.
              if (base === undefined) return;
              if (typeof hostElapsed === 'number' && Number.isFinite(hostElapsed) && hostElapsed > 0) {
                base.hostElapsed = hostElapsed;
              }
              base.pending = false;
              setRevision((revision) => revision + 1);
            })
            .catch(() => {
              // An unreachable or unhappy Host costs accuracy at the join, not
              // the readout: the local clock keeps the number moving.
              const base = bases.current.get(oldest.callId);
              if (base !== undefined) base.pending = false;
              setRevision((revision) => revision + 1);
            });
        });
      }

      react.useEffect(() => {
        const live = new Set(calls.map((call) => call.callId));
        for (const callId of [...bases.current.keys()]) if (!live.has(callId)) bases.current.delete(callId);
      }, [calls]);

      react.useEffect(() => {
        if (!running) return;
        const timer = setInterval(() => setNow(monotonicNow()), TICK_MS);
        return () => clearInterval(timer);
      }, [running]);

      if (oldest === undefined) return null;

      const base = bases.current.get(oldest.callId);
      // Until the Host answers, the local measurement alone is the honest
      // number: it is a correct lower bound rather than a wrong estimate.
      const elapsed = base === undefined ? 0 : elapsedOf(base.hostElapsed, now - base.at);
      const label = calls.length > 1 ? t('many', { count: calls.length }) : t('one');

      return react.createElement(
        'span',
        { style: STYLE_METER, title: t('title'), 'data-live-duration': '' },
        react.createElement('span', { style: STYLE_DOT, 'aria-hidden': true }),
        react.createElement('span', null, label),
        react.createElement('span', { style: STYLE_TIME }, formatLiveDuration(elapsed)),
      );
    }

    /**
     * The composer-slot host for {@link LiveMeter}.
     *
     * Reads running calls from the chat snapshot and renders nothing when the
     * meter has nothing to show, so the slot stays invisible at rest.
     *
     * @param props - the session-scoped `useChat` selector hook.
     * @returns the meter, or null.
     */
    function LiveDurationSlot({ useChat, t }) {
      const runningCalls = useChat((snapshot) => snapshot.legacy.runningCalls);
      const calls = react.useMemo(() => meteredCalls(runningCalls), [runningCalls]);
      // The Host answers a duration. A page served without that route simply
      // measures from when it first saw the call.
      const readHostElapsed = react.useMemo(
        () => async (callId) => {
          try {
            const response = await globalThis.fetch(`${RPC_CHANNEL}/${RPC_ELAPSED}?callId=${encodeURIComponent(callId)}`, {
              headers: { accept: 'application/json' },
              cache: 'no-store',
            });
            if (!response.ok) return undefined;
            const body = await response.json();
            return typeof body?.elapsedMs === 'number' ? body.elapsedMs : undefined;
          } catch {
            // An unreachable Host costs accuracy at the join, never the readout.
            return undefined;
          }
        },
        [],
      );
      // The slot is part of the composer row; staying out of the tree entirely
      // keeps the row's spacing identical when no command is running.
      if (calls.length === 0) return null;
      return react.createElement(LiveMeter, { calls, t, readHostElapsed });
    }

    /** Services this bundle needs: slot placement and locale copy. */
    const inject = ['slots', 'locale'];

    /**
     * Register the live meter.
     * @param ctx - the client plugin context.
     */
    function apply(ctx) {
      ctx.effect(() => ctx.locale.register(NS, { zh, en }), `${NS}: dictionaries`);
      ctx.slots.inject('conversation.input.right', () =>
        ctx.slots.register(
          {
            name: 'conversation.input.right',
            id: 'command-duration-live',
            order: 100,
            locale: NS,
          },
          // The slot's `inject` is owned by the slot's owner and cannot carry a
          // custom prop, so the service reaches the component through the
          // closure that builds it.
          LiveDurationSlot,
        ),
      );
    }

    // The pure readers are exported so the offline suite can assert the
    // formatting and selection rules without a DOM.
    return { inject, apply, meteredCalls, elapsedOf, formatLiveDuration };
  },
});
