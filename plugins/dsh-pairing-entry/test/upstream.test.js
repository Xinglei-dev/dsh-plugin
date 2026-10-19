import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { apply, Config, inject, name } from '../lib/index.js';
import { missingReason, optionalImport } from './helpers.js';

const cordis = await optionalImport('@deepseek-ai/cordis');
const connection = await optionalImport('@deepseek-ai/dsh-client-connection');
/**
 * Resolve the settings package's schema module, which its `exports` map does not
 * publish; the tests read it from the installed file next to the package entry.
 * @returns the module namespace, or `undefined` when the package is absent.
 */
async function importSettingsSchema() {
  let url;
  try {
    url = new URL('./types/schema.js', import.meta.resolve('@deepseek-ai/dsh-settings')).href;
  } catch (_error) {
    return undefined;
  }
  return await optionalImport(url);
}

const settingsSchema = await importSettingsSchema();
const skip = cordis === undefined || connection === undefined;

const KEY = 'Zx9Qm2Lr7Tb4Wc8Yd1Fg6Hj3Kn5Pp0Ss';

/**
 * Response stand-in that records the handler's answer.
 * @returns the response.
 */
function fakeResponse() {
  const res = {
    status: undefined,
    headers: undefined,
    body: undefined,
    ended: false,
    writeHead(status, headers) {
      res.status = status;
      res.headers = headers ?? {};
      return res;
    },
    end(body) {
      res.ended = true;
      res.body = body;
    },
  };
  return res;
}

/**
 * Mount the real Connection over an in-memory credential store, provide a Web
 * server stand-in that records routes, then mount this plugin on top.
 * @param config - plugin config to mount with.
 * @returns the root context, the plugin fiber, the routes, and captured configs.
 */
async function mountPairingEntry(config = { key: KEY }) {
  const ctx = new cordis.Context();
  const records = new Map();
  ctx.provide('credentials', {
    async modifyRecord(key, mutate) {
      const next = await mutate(records.get(key));
      if (next !== undefined) records.set(key, next);
      return records.get(key);
    },
  });
  const routes = new Map();
  ctx.provide('webServer', {
    protocol: 'http:',
    host: '127.0.0.1',
    register(route) {
      routes.set(route.path, route);
      return () => routes.delete(route.path);
    },
  });
  await ctx.plugin({ name: 'client-connection', inject: connection.inject, apply: connection.apply, Config: connection.Config }, { cookieMaxAgeDays: 30 });
  assert.notEqual(ctx.get('connection'), undefined, 'upstream Connection did not activate');
  const captured = [];
  const fiber = ctx.plugin({
    name,
    inject,
    Config,
    apply(inner, resolved) {
      captured.push(resolved);
      return apply(inner, resolved);
    },
  }, config);
  await fiber;
  return { ctx, fiber, routes, captured };
}

describe('real settings projection', {
  skip: settingsSchema === undefined && missingReason('@deepseek-ai/dsh-settings'),
}, () => {
  it('projects the key as the one editable field and reads its value back', async () => {
    const { ctx, captured } = await mountPairingEntry();
    try {
      const form = settingsSchema.volatileForm(Config);
      assert.notEqual(form, undefined);
      assert.deepEqual(Object.keys(form.dict), ['key']);
      assert.equal(settingsSchema.isVolatilePath(Config, ['key']), true);
      assert.equal(settingsSchema.isVolatilePath(Config, ['token']), false);
      const value = settingsSchema.projectForm(form, settingsSchema.plainConfig(captured[0]));
      assert.deepEqual(value, { key: KEY });
    } finally {
      await ctx.fiber.dispose();
    }
  });

  it('keeps the field editable when the key is absent', async () => {
    const { ctx, captured } = await mountPairingEntry({});
    try {
      const form = settingsSchema.volatileForm(Config);
      assert.deepEqual(Object.keys(form.dict), ['key']);
      assert.deepEqual(settingsSchema.projectForm(form, settingsSchema.plainConfig(captured[0])), {});
    } finally {
      await ctx.fiber.dispose();
    }
  });
});

describe('real upstream Connection', {
  skip: skip && `${missingReason('@deepseek-ai/cordis')} / ${missingReason('@deepseek-ai/dsh-client-connection')}`,
}, () => {
  it('resolves the key into the volatile reference apply unwraps', async () => {
    const { ctx, captured } = await mountPairingEntry();
    try {
      assert.equal(typeof captured[0].key.get, 'function');
      assert.equal(captured[0].key.get(), KEY);
    } finally {
      await ctx.fiber.dispose();
    }
  });

  it('registers one exact route and removes it on unload', async () => {
    const { ctx, routes, fiber } = await mountPairingEntry();
    try {
      assert.deepEqual([...routes.keys()].filter((path) => path.startsWith('/entry/')), [`/entry/${KEY}`]);
      assert.equal(routes.get(`/entry/${KEY}`).kind, 'exact');
      await fiber.dispose();
      assert.equal(routes.has(`/entry/${KEY}`), false);
    } finally {
      await ctx.fiber.dispose();
    }
  });

  it('redirects a trusted loopback request to the real launch token', async () => {
    const { ctx, routes } = await mountPairingEntry();
    try {
      const expected = new URL(ctx.connection.authenticatedUrl('http://dsh.invalid/')).searchParams.get('token');
      const res = fakeResponse();
      await routes.get(`/entry/${KEY}`).handler({ method: 'GET', url: `/entry/${KEY}`, headers: { host: '127.0.0.1:3080' } }, res);
      assert.equal(res.status, 303);
      assert.equal(res.headers.location, `../?token=${expected}`);
      assert.equal(res.headers['referrer-policy'], 'no-referrer');
    } finally {
      await ctx.fiber.dispose();
    }
  });

  it('lets the real trust fence refuse a foreign Host and a cross-site fetch', async () => {
    const { ctx, routes } = await mountPairingEntry();
    try {
      const handler = routes.get(`/entry/${KEY}`).handler;
      for (const headers of [{ host: 'evil.example' }, { host: '127.0.0.1:3080', 'sec-fetch-site': 'cross-site' }]) {
        const res = fakeResponse();
        await handler({ method: 'GET', url: `/entry/${KEY}`, headers }, res);
        assert.equal(res.status, 403);
        assert.equal(res.headers.location, undefined);
      }
    } finally {
      await ctx.fiber.dispose();
    }
  });

  it('refuses a cross-origin Origin header', async () => {
    const { ctx, routes } = await mountPairingEntry();
    try {
      const res = fakeResponse();
      await routes.get(`/entry/${KEY}`).handler({
        method: 'GET',
        url: `/entry/${KEY}`,
        headers: { host: '127.0.0.1:3080', origin: 'https://evil.example' },
      }, res);
      assert.equal(res.status, 403);
    } finally {
      await ctx.fiber.dispose();
    }
  });

  it('stays loaded without a key under the real schema', async () => {
    const { ctx, routes } = await mountPairingEntry({});
    try {
      assert.deepEqual([...routes.keys()].filter((path) => path.startsWith('/entry/')), []);
      assert.equal(ctx.fiber.state, 2);
    } finally {
      await ctx.fiber.dispose();
    }
  });
});
