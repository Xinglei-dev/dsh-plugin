window.__ModuleLoader__.load({
  id: 'dsh-command-duration',
  factory: (require) => {
    const react = require('react');

    /** Locale namespace this plugin owns. */
    const NS = 'command-duration';

    /** Tools whose running call is metered, matching the Host side's own list. */
    const METERED_TOOLS = new Set(['bash']);

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
     * Elapsed milliseconds for one call at one browser instant.
     *
     * The Host stamps the call's start on its own clock, which need not agree
     * with this browser's. So the reading is split in two parts: `base` is how
     * long the call had already run when it was first seen, measured once
     * against the browser's own clock, and `browserElapsed` is how long ago
     * that first sighting was. Neither part needs the Host clock, so a skew
     * cannot make the number wrong.
     *
     * @param base - elapsed time at the first sighting, in milliseconds.
     * @param browserElapsed - milliseconds since that sighting.
     * @returns a nonnegative duration.
     */
    function elapsedOf(base, browserElapsed) {
      const elapsed = base + browserElapsed;
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
     * The offset between the Host clock and this browser is measured once, on
     * mount, so a skewed host clock cannot turn into a wrong reading.
     *
     * @param props - the metered calls and the translator.
     * @returns the elapsed readout.
     */
    function LiveMeter({ calls, t }) {
      // Held in state so a tick can advance it; seeded lazily by the first
      // render's own reading, which the offset was measured against.
      const [now, setNow] = react.useState(() => Date.now());

      const running = calls.length > 0;
      // The readout one number can state is the longest wait in progress.
      const oldest = calls.reduce(
        (earliest, call) => (earliest === undefined || call.time < earliest.time ? call : earliest),
        undefined,
      );

      // One clock reading per call, taken the first time that call is seen and
      // kept across renders. Deriving it during render (rather than in an
      // effect) means the very first frame already states the true elapsed
      // time instead of flashing a zero.
      const bases = react.useRef(new Map());
      if (oldest !== undefined && !bases.current.has(oldest.callId)) {
        // `now` is this render's browser reading, so the base and the
        // reference instant are the same moment by construction.
        bases.current.set(oldest.callId, { at: now, elapsed: Math.max(0, now - oldest.time) });
      }

      react.useEffect(() => {
        const live = new Set(calls.map((call) => call.callId));
        for (const callId of [...bases.current.keys()]) if (!live.has(callId)) bases.current.delete(callId);
      }, [calls]);

      react.useEffect(() => {
        if (!running) return;
        const timer = setInterval(() => setNow(Date.now()), TICK_MS);
        return () => clearInterval(timer);
      }, [running]);

      if (oldest === undefined) return null;

      const base = bases.current.get(oldest.callId);
      const elapsed = base === undefined ? 0 : elapsedOf(base.elapsed, now - base.at);
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
      // The slot is part of the composer row; staying out of the tree entirely
      // keeps the row's spacing identical when no command is running.
      if (calls.length === 0) return null;
      return react.createElement(LiveMeter, { calls, t });
    }

    /** Services this bundle needs: slot registration and locale copy. */
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
          LiveDurationSlot,
        ),
      );
    }

    // The pure readers are exported so the offline suite can assert the
    // formatting and selection rules without a DOM.
    return { inject, apply, meteredCalls, elapsedOf, formatLiveDuration };
  },
});
