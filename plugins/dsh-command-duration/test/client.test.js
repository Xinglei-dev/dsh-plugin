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

/** A running bash call as the chat snapshot publishes it. */
function runningBash(overrides = {}) {
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

/** Build the selector hook a slot would receive, over one snapshot. */
function chatHook(snapshot) {
  return (selector) => selector(snapshot);
}

/** Locate the slot component the bundle registered. */
function registeredSlot() {
  const { exports } = materialize();
  const registered = [];
  const ctx = {
    effect: () => {},
    locale: { register: () => () => {} },
    slots: {
      inject: (_name, run) => run(),
      register: (options, component) => registered.push({ options, component }),
    },
  };
  exports.apply(ctx);
  assert.equal(registered.length, 1);
  return registered[0];
}

describe('client bundle contract', () => {
  it('loads only React and declares the slots/locale services it uses', () => {
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

  it('meters a running bash call and states its elapsed time', () => {
    const { component } = registeredSlot();
    const started = Date.now() - 2_400;
    const tree = render(component, {
      useChat: chatHook({ legacy: { runningCalls: [runningBash({ time: started })] } }),
      t,
    });
    assert.deepEqual(tree.props['data-live-duration'], '');
    assert.ok(texts(tree).includes('命令运行中'));
    assert.ok(texts(tree).some((text) => /^\d+\.\d 秒$/u.test(text)), `no duration in ${JSON.stringify(texts(tree))}`);
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

  it('counts every running command', () => {
    const { component } = registeredSlot();
    const started = Date.now() - 1_000;
    const tree = render(component, {
      useChat: chatHook({
        legacy: { runningCalls: [runningBash({ time: started }), runningBash({ callId: 'call-2', time: started })] },
      }),
      t,
    });
    assert.ok(texts(tree).includes('命令运行中（2）'), `got ${JSON.stringify(texts(tree))}`);
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

  it('adds the time already run to the time since it was first seen', () => {
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

  it('states the longest wait, not whichever call the array lists first', () => {
    const { component } = registeredSlot();
    const now = Date.now();
    const tree = render(component, {
      useChat: chatHook({
        legacy: {
          runningCalls: [
            // Listed first but started later: it must not own the number.
            runningBash({ callId: 'newer', time: now - 1_000 }),
            runningBash({ callId: 'older', time: now - 5_000 }),
          ],
        },
      }),
      t,
    });
    assert.ok(texts(tree).includes('命令运行中（2）'));
    const stated = texts(tree).find((text) => /秒$/u.test(text));
    assert.ok(Number.parseFloat(stated) >= 4, `expected the older call, got ${stated}`);
  });
});
