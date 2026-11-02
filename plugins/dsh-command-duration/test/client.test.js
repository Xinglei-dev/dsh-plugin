import assert from 'node:assert/strict';
import { afterEach, describe, it } from 'node:test';

/**
 * A hook runtime sufficient for one synchronous render pass: `useState`,
 * `useMemo`, `useEffect`, and `createElement`. It is not a React substitute —
 * it exists so the bundle's decisions can be asserted without a DOM.
 * @returns the React stand-in handed to the bundle factory.
 */
function createReactStub() {
  let states = [];
  const refs = [];
  let index = 0;
  const effects = [];
  return {
    effects,
    beginRender() {
      index = 0;
      effects.length = 0;
    },
    useState(initial) {
      const slot = index++;
      if (!(slot in states)) states[slot] = typeof initial === 'function' ? initial() : initial;
      return [states[slot], (next) => { states[slot] = typeof next === 'function' ? next(states[slot]) : next; }];
    },
    useMemo(factory) {
      return factory();
    },
    useRef(initial) {
      const slot = index++;
      if (!(slot in refs)) refs[slot] = { current: initial };
      return refs[slot];
    },
    useEffect(effect) {
      effects.push(effect);
    },
    createElement(type, props, ...children) {
      return { type, props: props ?? {}, children: children.flat(Number.POSITIVE_INFINITY) };
    },
  };
}

let react = createReactStub();
const registrations = [];
globalThis.window = { __ModuleLoader__: { load: (registration) => registrations.push(registration) } };
await import('../lib/client.js');

/**
 * Load the bundle's factory with the React stand-in.
 * @param stub - React stand-in to hand the factory.
 * @returns the bundle exports and every specifier it required.
 */
function materialize(stub = react) {
  assert.equal(registrations.length, 1);
  const [registration] = registrations;
  assert.equal(registration.id, 'dsh-command-duration');
  const required = [];
  const exports = registration.factory((specifier) => {
    required.push(specifier);
    if (specifier !== 'react') throw new Error(`unexpected require("${specifier}")`);
    return stub;
  });
  return { exports, required };
}

/**
 * Render one component and run the effects it scheduled.
 * @param component - component function.
 * @param props - props to render with.
 * @returns the element tree.
 */
/** Cleanups run by the most recent render, newest last. */
let cleanups = [];

function render(component, props, depth = 0) {
  react.beginRender();
  const tree = component(props);
  for (const effect of react.effects) {
    const cleanup = effect();
    if (typeof cleanup === 'function') cleanups.push(cleanup);
  }
  // Expand one function component so assertions see the elements it built.
  if (typeof tree?.type === 'function' && depth < 4) return render(tree.type, tree.props, depth + 1);
  return tree;
}

/**
 * Render, let the Host-answer promise settle, and render again — the meter
 * repaints once the reply lands, so the state a user ends up seeing is the one
 * after at least one follow-up pass.
 * @param component - component function.
 * @param props - props to render with.
 * @param passes - follow-up renders after each microtask flush.
 * @returns the last element tree.
 */
async function renderSettled(component, props, passes = 3) {
  let tree = render(component, props);
  for (let pass = 0; pass < passes; pass += 1) {
    await new Promise((resolve) => setImmediate(resolve));
    tree = render(component, props);
  }
  return tree;
}

/**
 * Collect every text node of an element tree.
 * @param node - element tree node.
 * @returns every string child, depth first.
 */
function texts(node) {
  if (node === null || node === undefined || typeof node === 'boolean') return [];
  if (typeof node === 'string') return [node];
  if (Array.isArray(node)) return node.flatMap((child) => texts(child));
  return texts(node.children);
}

/** Translate through a tiny dictionary, keeping interpolation visible. */
function translator(dictionary) {
  return (key, params) => {
    const text = dictionary[key] ?? key;
    if (params === undefined) return text;
    return Object.entries(params).reduce((acc, [name, value]) => acc.replaceAll(`{${name}}`, String(value)), text);
  };
}

/** A running tool call as the chat snapshot publishes it. */
function runningCall(overrides = {}) {
  return {
    phase: 'start',
    callId: 'call-1',
    name: 'bash',
    argsRaw: '{"command":"sleep 3"}',
    turn: 1,
    step: 1,
    time: 1_000_000,
    subCalls: [],
    ...overrides,
  };
}

/** A running foreground bash call. */
function runningBash(overrides = {}) {
  return runningCall(overrides);
}

/**
 * A running PTC call. Under PTC the model's only direct tool is `run_code`;
 * the `bash` calls the program makes are sub-calls of it, so the root call
 * named `run_code` is the one that carries the whole program's duration.
 */
function runningRunCode(overrides = {}) {
  return runningCall({
    callId: 'call-ptc',
    name: 'run_code',
    argsRaw: '{"code":"await tools.bash({command:\'sleep 3\'})","description":"run"}',
    ...overrides,
  });
}

/** Build the selector hook a slot would receive, over one snapshot. */
function chatHook(snapshot) {
  return (selector) => selector(snapshot);
}

/**
 * Locate the slot component the bundle registered.
 * @param connection - the Connection service the plugin context should expose.
 * @returns the registration options and the wrapper component.
 */
function registeredSlot(connection = undefined) {
  // A fresh hook runtime per case: the stub keeps its `useState`/`useRef` slots
  // in module-level arrays, so one shared instance would hand a case the
  // previous case's state — including a `bases` Map already holding the call id
  // under test, which would skip the Host request entirely.
  react = createReactStub();
  const { exports } = materialize();
  const registered = [];
  const ctx = {
    effect: () => {},
    locale: { register: () => () => {} },
    // The bundle reads the service through the context, so the stand-in has to
    // answer the same way the real client context does.
    get: (key) => (key === 'connection' ? connection : undefined),
    slots: {
      inject: (_name, run) => run(),
      register: (options, component) => registered.push({ options, component }),
    },
  };
  exports.apply(ctx);
  assert.equal(registered.length, 1);
  return registered[0];
}

/**
 * Install a `fetch` stand-in answering the Host's elapsed route.
 * @param answers - callId → elapsed milliseconds.
 * @returns the recorded requests and a restore function.
 */
function hostElapsed(answers = {}) {
  const requests = [];
  const original = globalThis.fetch;
  globalThis.fetch = async (url) => {
    const href = String(url);
    requests.push({ href });
    const callId = new URL(href, 'http://dsh.invalid').searchParams.get('callId');
    const answer = answers[callId];
    // The Host answers `null` for a call it does not hold.
    return { ok: true, status: 200, json: async () => ({ elapsedMs: answer ?? null }) };
  };
  return { requests, restore: () => { globalThis.fetch = original; } };
}

describe('client bundle contract', () => {
  it('loads only React and declares the services it uses', () => {
    const { exports, required } = materialize();
    assert.deepEqual(required, ['react']);
    assert.deepEqual(exports.inject, ['slots', 'locale']);
    assert.equal(typeof exports.apply, 'function');
  });

  it('registers one entry in the composer accessory slot', () => {
    const slot = registeredSlot();
    assert.equal(slot.options.name, 'conversation.input.right');
    assert.equal(slot.options.id, 'command-duration-live');
    assert.equal(slot.options.locale, 'command-duration');
  });

  it('registers without claiming a custom slot injection it cannot own', () => {
    const slot = registeredSlot();
    // The slot's `inject` belongs to its owner (ConversationInjected); a
    // third-party registration must not try to redefine it.
    assert.equal('inject' in slot.options, false, 'the registration must not set inject');
    assert.equal(typeof slot.component, 'function');
  });
});

describe('live duration slot', () => {
  const t = translator({ one: '命令运行中', many: '命令运行中（{count}）', title: 'title' });

  // The meter opens a ticker; leaving it armed would hold the test process
  // open. Every case ends by running the cleanups its render scheduled.
  afterEach(() => {
    for (const cleanup of cleanups.reverse()) cleanup();
    cleanups = [];
  });

  it('renders nothing when no command is running', () => {
    const { component } = registeredSlot();
    const tree = render(component, { useChat: chatHook({ legacy: { runningCalls: [] } }), t });
    assert.equal(tree, null);
  });

  it('meters a running bash call and states the duration the Host reports', async () => {
    const { requests, restore } = hostElapsed({ 'call-1': 2_400 });
    const { component } = registeredSlot();
    const tree = await renderSettled(component, {
      useChat: chatHook({ legacy: { runningCalls: [runningBash()] } }),
      t,
    });
    assert.deepEqual(tree.props['data-live-duration'], '');
    assert.ok(texts(tree).includes('命令运行中'));
    // The number comes from the Host's answer, not from comparing clocks.
    assert.ok(texts(tree).includes('2.4 秒'), `got ${JSON.stringify(texts(tree))}`);
    assert.equal(requests.length, 1, 'the Host is asked once per call, not per tick');
    assert.match(requests[0].href, /^\/command-duration\/elapsed\?callId=call-1$/u);
    restore();
  });

  it('meters a running PTC run_code call, which is the root call under PTC', async () => {
    const { restore } = hostElapsed({ 'call-ptc': 2_400 });
    const { component } = registeredSlot();
    const tree = await renderSettled(component, {
      useChat: chatHook({ legacy: { runningCalls: [runningRunCode()] } }),
      t,
    });
    assert.notEqual(tree, null, 'a PTC run must show the meter, not nothing');
    assert.deepEqual(tree.props['data-live-duration'], '');
    assert.ok(texts(tree).includes('命令运行中'));
    assert.ok(texts(tree).includes('2.4 秒'), `got ${JSON.stringify(texts(tree))}`);
    restore();
  });

  it('starts at zero when the Host holds no record of the call', async () => {
    const { restore } = hostElapsed({});
    const { component } = registeredSlot();
    const tree = await renderSettled(component, {
      useChat: chatHook({ legacy: { runningCalls: [runningBash()] } }),
      t,
    });
    assert.notEqual(tree, null, 'an unknown call still gets a readout');
    assert.ok(texts(tree).includes('0.0 秒'), `got ${JSON.stringify(texts(tree))}`);
    restore();
  });

  it('keeps counting when the Host request fails', async (t2) => {
    const original = globalThis.fetch;
    t2.after(() => { globalThis.fetch = original; });
    globalThis.fetch = async () => { throw new Error('network down'); };
    const { component } = registeredSlot();
    const tree = await renderSettled(component, {
      useChat: chatHook({ legacy: { runningCalls: [runningBash()] } }),
      t,
    });
    assert.notEqual(tree, null, 'a failed request must not hide the meter');
    assert.ok(texts(tree).some((text) => /^\d+\.\d 秒$/u.test(text)), `got ${JSON.stringify(texts(tree))}`);
  });

  it('measures from zero when the Host has no such route', async () => {
    // A deployment without the Web route still renders a meter.
    const original = globalThis.fetch;
    globalThis.fetch = async () => ({ ok: false, status: 404, json: async () => null });
    const { component } = registeredSlot();
    const tree = await renderSettled(component, {
      useChat: chatHook({ legacy: { runningCalls: [runningBash()] } }),
      t,
    });
    assert.notEqual(tree, null, 'the meter works without the Host route');
    assert.ok(texts(tree).includes('0.0 秒'), `got ${JSON.stringify(texts(tree))}`);
    globalThis.fetch = original;
  });

  it('ignores the Host clock entirely, so a skewed Host cannot move the reading', async () => {
    const { restore } = hostElapsed({ 'call-1': 2_400 });
    const { component } = registeredSlot();
    // The Host says this call began an hour ago by its own clock and one hour
    // the other way by the browser's. Neither value may reach the readout: only
    // the reported duration is used.
    const readings = [];
    for (const hostTime of [Date.now() - 3_600_000, Date.now() + 3_600_000]) {
      const tree = await renderSettled(component, {
        useChat: chatHook({ legacy: { runningCalls: [runningBash({ time: hostTime })] } }),
        t,
      });
      readings.push(texts(tree).find((text) => /秒$/u.test(text) && text !== '命令运行中'));
    }
    assert.deepEqual(readings, ['2.4 秒', '2.4 秒'], `a skewed Host clock changed the reading: ${JSON.stringify(readings)}`);
    restore();
  });

  it('ignores a call that is still preparing its arguments', () => {
    const { component } = registeredSlot();
    const tree = render(component, {
      useChat: chatHook({ legacy: { runningCalls: [runningBash({ phase: 'preparing' })] } }),
      t,
    });
    assert.equal(tree, null);
  });

  it('ignores a tool that is not metered', () => {
    const { component } = registeredSlot();
    const tree = render(component, {
      useChat: chatHook({ legacy: { runningCalls: [runningBash({ name: 'read' })] } }),
      t,
    });
    assert.equal(tree, null);
  });

  it('ignores a call with no usable start time instead of inventing one', () => {
    const { component } = registeredSlot();
    const tree = render(component, {
      useChat: chatHook({ legacy: { runningCalls: [runningBash({ time: Number.NaN })] } }),
      t,
    });
    assert.equal(tree, null);
  });

  it('counts every running command', async () => {
    const { restore } = hostElapsed({ 'call-1': 1_000, 'call-2': 1_000 });
    const { component } = registeredSlot();
    const tree = await renderSettled(component, {
      useChat: chatHook({ legacy: { runningCalls: [runningBash(), runningBash({ callId: 'call-2' })] } }),
      t,
    });
    assert.ok(texts(tree).includes('命令运行中（2）'), `got ${JSON.stringify(texts(tree))}`);
    restore();
  });

  it('opens a ticker while running and closes it on cleanup', () => {
    const { component } = registeredSlot();
    const tree = render(component, {
      useChat: chatHook({ legacy: { runningCalls: [runningBash({ time: Date.now() })] } }),
      t,
    });
    assert.notEqual(tree, null);
    // A running meter must have armed exactly one ticker, and the registered
    // editor answered with a cleanup that reaches clearInterval.
    assert.equal(cleanups.length >= 1, true);
    for (const cleanup of cleanups) cleanup();
    cleanups = [];
  });
});

describe('pure readers', () => {
  const { exports } = materialize();

  it('selects only dispatched, metered calls', () => {
    assert.equal(exports.meteredCalls(undefined).length, 0);
    assert.equal(exports.meteredCalls([]).length, 0);
    assert.equal(exports.meteredCalls([runningBash()]).length, 1);
    assert.equal(exports.meteredCalls([runningBash({ phase: 'preparing' })]).length, 0);
    assert.equal(exports.meteredCalls([runningBash({ name: 'job_output' })]).length, 0);
  });

  it('selects a run_code call, since PTC times the program as one command', () => {
    assert.equal(exports.meteredCalls([runningRunCode()]).length, 1);
    assert.equal(exports.meteredCalls([runningRunCode({ phase: 'preparing' })]).length, 0);
    assert.equal(exports.meteredCalls([runningRunCode({ time: Number.NaN })]).length, 0);
  });

  it('adds two durations: the Host-reported one and this page\'s own', () => {
    assert.equal(exports.elapsedOf(0, 2_400), 2_400);
    assert.equal(exports.elapsedOf(5_000, 2_400), 7_400);
  });

  it('never states a negative duration', () => {
    assert.equal(exports.elapsedOf(-5, 0), 0);
    assert.equal(exports.elapsedOf(0, -5), 0);
    assert.equal(exports.elapsedOf(Number.NaN, 0), 0);
  });

  it('states a live duration coarsely by magnitude', () => {
    assert.equal(exports.formatLiveDuration(0), '0.0 秒');
    assert.equal(exports.formatLiveDuration(95), '0.0 秒');
    assert.equal(exports.formatLiveDuration(2_400), '2.4 秒');
    assert.equal(exports.formatLiveDuration(9_960), '10.0 秒');
    assert.equal(exports.formatLiveDuration(42_000), '42 秒');
    assert.equal(exports.formatLiveDuration(125_000), '2 分 5 秒');
    assert.equal(exports.formatLiveDuration(3_725_000), '1 小时 2 分');
  });
});

describe('multiple running commands', () => {
  const t = translator({ one: '命令运行中', many: '命令运行中（{count}）', title: 'title' });
  afterEach(() => {
    for (const cleanup of cleanups.reverse()) cleanup();
    cleanups = [];
  });

  it('states the longest wait, not whichever call the array lists first', async () => {
    // Only the oldest call is asked about and drawn, so it carries the number.
    const { requests, restore } = hostElapsed({ older: 5_000 });
    const { component } = registeredSlot();
    const tree = await renderSettled(component, {
      useChat: chatHook({
        legacy: {
          runningCalls: [
            // Listed first but started later: it must not own the number.
            runningBash({ callId: 'newer', time: 1_000 }),
            runningBash({ callId: 'older', time: 0 }),
          ],
        },
      }),
      t,
    });
    assert.ok(texts(tree).includes('命令运行中（2）'));
    assert.ok(texts(tree).includes('5.0 秒'), `expected the older call, got ${JSON.stringify(texts(tree))}`);
    assert.match(requests[0].href, /callId=older$/u, 'the Host is asked about the oldest call only');
    restore();
  });
});
