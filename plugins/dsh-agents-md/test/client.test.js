import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

/** Registrations received from the browser module loader. */
const registrations = [];
globalThis.window = {
  __ModuleLoader__: {
    load(registration) {
      registrations.push(registration);
    },
  },
};

await import('../lib/client.js');

/**
 * Materialize the registered bundle with a minimal React stand-in.
 * @returns the bundle exports.
 */
function materialize() {
  assert.equal(registrations.length, 1);
  const [registration] = registrations;
  assert.equal(registration.id, 'dsh-agents-md');
  return registration.factory((specifier) => {
    if (specifier !== 'react') throw new Error(`unexpected require("${specifier}")`);
    return {
      createElement(type, props, ...children) {
        return { type, props: props ?? {}, children };
      },
    };
  });
}

const bundle = materialize();

describe('formatSize', () => {
  it('uses bytes, kilobytes, and megabytes at their boundaries', () => {
    assert.equal(bundle.formatSize(0), '0 B');
    assert.equal(bundle.formatSize(1023), '1023 B');
    assert.equal(bundle.formatSize(1024), '1.0 KB');
    assert.equal(bundle.formatSize(1536), '1.5 KB');
    assert.equal(bundle.formatSize(1024 * 1024), '1.0 MB');
    assert.equal(bundle.formatSize(Number.NaN), '0 B');
  });
});

describe('defaultTarget', () => {
  it('opens the most specific project AGENTS.md when a project is available', () => {
    const target = bundle.defaultTarget({ project: { available: true, levels: [{ relDir: '.' }, { relDir: 'src' }] } });
    assert.deepEqual(target, { scope: 'project', dir: 'src', name: 'AGENTS.md' });
  });

  it('falls back to the harness-home file without a project', () => {
    assert.deepEqual(bundle.defaultTarget({ project: null }), { scope: 'global-dsh', dir: '', name: 'AGENTS.md' });
    assert.deepEqual(
      bundle.defaultTarget({ project: { available: false, levels: [] } }),
      { scope: 'global-dsh', dir: '', name: 'AGENTS.md' },
    );
  });
});

describe('initialWorkspaceId', () => {
  it('waits for the ready phase before choosing a project', () => {
    assert.equal(bundle.initialWorkspaceId('loading', [{ workspaceId: 'w1' }]), null);
    assert.equal(bundle.initialWorkspaceId('pending', []), null);
    assert.equal(bundle.initialWorkspaceId('ready', []), '');
    assert.equal(bundle.initialWorkspaceId('ready', [{ workspaceId: 'w1' }, { workspaceId: 'w2' }]), 'w1');
  });
});

describe('stillExists', () => {
  it('keeps a global selection that is still listed', () => {
    const selected = { scope: 'global-agents', dir: '', name: 'AGENTS.md' };
    assert.equal(bundle.stillExists(selected, { global: [{ scope: 'global-dsh' }, { scope: 'global-agents' }], project: null }), true);
    assert.equal(bundle.stillExists(selected, { global: [{ scope: 'global-dsh' }], project: null }), false);
  });

  it('keeps a project selection only when its directory and file remain', () => {
    const selected = { scope: 'project', dir: 'src', name: 'AGENTS.md' };
    const data = { global: [], project: { available: true, levels: [{ relDir: '.', files: [] }, { relDir: 'src', files: [{ name: 'AGENTS.md' }] }] } };
    assert.equal(bundle.stillExists(selected, data), true);
    assert.equal(bundle.stillExists(selected, { global: [], project: { available: true, levels: [{ relDir: '.', files: [] }] } }), false);
    assert.equal(bundle.stillExists(selected, { global: [], project: { available: false, levels: [] } }), false);
  });
});

describe('request builders', () => {
  it('addresses a global file without a workspace', () => {
    const url = bundle.buildFileUrl({ scope: 'global-dsh', dir: '', name: 'AGENTS.md' }, 'ws1');
    assert.equal(url, '/agents-md/file?scope=global-dsh&name=AGENTS.md');
  });

  it('addresses a project file with its chain directory', () => {
    const url = bundle.buildFileUrl({ scope: 'project', dir: 'src', name: 'AGENTS.md' }, 'ws1');
    assert.equal(url, '/agents-md/file?scope=project&name=AGENTS.md&workspaceId=ws1&dir=src');
  });

  it('builds a save body with and without project coordinates', () => {
    assert.deepEqual(
      bundle.buildSaveBody({ scope: 'global-dsh', dir: '', name: 'AGENTS.md' }, '', '# x\n', 'abc'),
      { scope: 'global-dsh', name: 'AGENTS.md', content: '# x\n', expectedHash: 'abc' },
    );
    assert.deepEqual(
      bundle.buildSaveBody({ scope: 'project', dir: '.', name: 'AGENTS.md' }, 'ws1', '# y\n', null),
      { scope: 'project', name: 'AGENTS.md', content: '# y\n', expectedHash: null, workspaceId: 'ws1', dir: '.' },
    );
  });
});

describe('apply', () => {
  it('registers the locale dictionaries and one settings section', () => {
    const registrations = [];
    const ctx = {
      effect(callback) {
        return callback();
      },
      locale: {
        register(ns, dicts) {
          registrations.push({ kind: 'locale', ns, dicts });
          return () => {};
        },
        bind() {
          return (key) => key;
        },
      },
      slots: {
        inject(key, callback) {
          registrations.push({ kind: 'inject', key });
          callback();
        },
        register(spec, component) {
          registrations.push({ kind: 'register', spec, component });
          return () => {};
        },
      },
    };
    bundle.apply(ctx);
    const dictionary = registrations.find((entry) => entry.kind === 'locale');
    assert.equal(dictionary.ns, 'agents-md');
    assert.ok(dictionary.dicts.zh.tab);
    assert.ok(dictionary.dicts.en.tab);
    assert.equal(registrations.find((entry) => entry.kind === 'inject').key, 'settings.section');
    const section = registrations.find((entry) => entry.kind === 'register');
    assert.equal(section.spec.id, 'agents-md');
    assert.equal(section.spec.order, 30);
    assert.equal(typeof section.component, 'function');
  });
});
