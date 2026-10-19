import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { apply, Config, createHandler, entryPath, ENTRY_PATH_PREFIX, inject, keyOf, keyProblem, launchTokenOf, MIN_KEY_LENGTH, name } from '../lib/index.js';

const TOKEN = 'MfDIwHr7iXvV0fQm2s7lwJp8Yb9dCkT4uN6zRa5e1gA';
const KEY = 'Zx9Qm2Lr7Tb4Wc8Yd1Fg6Hj3Kn5Pp0Ss';

/**
 * Build a response stand-in that records what the handler wrote.
 * @returns the response and its recorded status, headers, and end call.
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
 * Build the smallest Connection stand-in the handler observes: one token and one
 * trust verdict, both mutable so a request-time failure can be simulated.
 * @param options - initial token and request rejection.
 * @returns a fake `ctx.connection`.
 */
function fakeConnection({ token = TOKEN, rejection } = {}) {
  const state = { token, rejection, tokenFailure: undefined };
  return {
    state,
    authenticatedUrl(baseUrl) {
      if (state.tokenFailure !== undefined) throw state.tokenFailure;
      const url = new URL(baseUrl);
      url.searchParams.set('token', state.token);
      return url.href;
    },
    requestRejection() {
      return state.rejection;
    },
  };
}

/**
 * Build a Web server stand-in that records exact routes.
 * @returns the server, its route map, and the paths it was asked to register.
 */
function fakeWebServer() {
  const routes = new Map();
  const attempted = [];
  return {
    routes,
    attempted,
    protocol: 'http:',
    register(route) {
      attempted.push(route.path);
      routes.set(route.path, route);
      return () => routes.delete(route.path);
    },
  };
}

/**
 * Minimal Cordis-shaped context: effects run immediately, their disposers are
 * kept, and log records are collected.
 * @param options - connection and web server to expose.
 * @returns a fake `ctx`.
 */
function fakeContext({ connection = fakeConnection(), webServer = fakeWebServer() } = {}) {
  const warnings = [];
  const errors = [];
  const effects = [];
  const events = new Map();
  return {
    connection,
    webServer,
    warnings,
    errors,
    effects,
    logger: {
      warn: (message) => warnings.push(String(message)),
      error: (message) => errors.push(String(message)),
    },
    effect(execute, label) {
      const dispose = execute();
      effects.push({ label, dispose });
      return dispose;
    },
    on(event, handler) {
      const handlers = events.get(event) ?? [];
      handlers.push(handler);
      events.set(event, handlers);
      return () => handlers.splice(handlers.indexOf(handler), 1);
    },
    emit(event, ...args) {
      for (const handler of events.get(event) ?? []) handler(...args);
    },
  };
}

describe('keyOf', () => {
  it('unwraps the volatile reference the loader resolves', () => {
    assert.equal(keyOf({ key: { get: () => KEY } }), KEY);
  });

  it('accepts a plain string and trims it', () => {
    assert.equal(keyOf({ key: `  ${KEY}\n` }), KEY);
  });

  it('reports an empty key when nothing is configured', () => {
    for (const config of [undefined, {}, { key: undefined }, { key: 42 }, { key: '' }]) {
      assert.equal(keyOf(config), '');
    }
  });
});

describe('keyProblem', () => {
  it('accepts a key of the documented shape', () => {
    assert.equal(keyProblem(KEY), undefined);
    assert.equal(keyProblem('a'.repeat(MIN_KEY_LENGTH)), undefined);
  });

  it('names each unusable shape', () => {
    assert.match(keyProblem(''), /no key is configured/u);
    assert.match(keyProblem('a'.repeat(MIN_KEY_LENGTH - 1)), /characters long; use at least/u);
    assert.match(keyProblem(`${'a'.repeat(MIN_KEY_LENGTH - 1)}+`), /only A-Z/u);
  });
});

describe('entryPath', () => {
  it('places the key as one path segment under the prefix', () => {
    assert.equal(entryPath(KEY), `${ENTRY_PATH_PREFIX}${KEY}`);
  });
});

describe('launchTokenOf', () => {
  it('reads the token from the address the public handle builds', () => {
    assert.equal(launchTokenOf(fakeConnection()), TOKEN);
  });

  it('fails when the handle is gone or reshaped', () => {
    for (const connection of [undefined, null, {}, { authenticatedUrl: 'nope' }]) {
      assert.throws(() => launchTokenOf(connection), { name: 'TypeError', message: /authenticatedUrl is not a function/u });
    }
  });

  it('fails when the address builder throws', () => {
    const connection = fakeConnection();
    connection.state.tokenFailure = new Error('upstream changed');
    assert.throws(() => launchTokenOf(connection), { message: /authenticatedUrl\(\) failed/u });
  });

  it('fails when the address does not carry exactly one non-empty token', () => {
    const printed = [
      'http://dsh.invalid/',
      'http://dsh.invalid/?token=',
      'http://dsh.invalid/?token=a&token=b',
      'http://dsh.invalid/?other=a',
      'not a url',
    ];
    for (const value of printed) {
      assert.throws(() => launchTokenOf({ authenticatedUrl: () => value }), { message: /launch token|not parse/u });
    }
  });
});

describe('createHandler', () => {
  it('refuses a request the trust fence rejects', () => {
    const connection = fakeConnection({ rejection: 403 });
    const res = fakeResponse();
    createHandler({ connection, logger: { error() {} } })({ method: 'GET', headers: {} }, res);
    assert.equal(res.status, 403);
    assert.equal(res.headers.location, undefined);
    assert.equal(res.ended, true);
  });

  it('redirects an unauthenticated request to the current token', () => {
    const connection = fakeConnection({ rejection: 401 });
    const res = fakeResponse();
    createHandler({ connection, logger: { error() {} } })({ method: 'GET', headers: {} }, res);
    assert.equal(res.status, 303);
    assert.equal(res.headers.location, `../?token=${TOKEN}`);
    assert.equal(res.headers['cache-control'], 'no-store');
    assert.equal(res.headers['referrer-policy'], 'no-referrer');
    assert.equal(res.ended, true);
  });

  it('redirects a request that already carries a valid credential the same way', () => {
    const connection = fakeConnection({ rejection: undefined });
    const res = fakeResponse();
    createHandler({ connection, logger: { error() {} } })({ method: 'GET', headers: {} }, res);
    assert.equal(res.status, 303);
    assert.equal(res.headers.location, `../?token=${TOKEN}`);
  });

  it('keeps the redirect relative so no Host header reaches the address', () => {
    const connection = fakeConnection({ rejection: 401 });
    const res = fakeResponse();
    createHandler({ connection, logger: { error() {} } })({ method: 'GET', headers: { host: '127.0.0.1:3080' } }, res);
    assert.equal(res.headers.location.startsWith('../?'), true);
    assert.equal(res.headers.location.includes('127.0.0.1'), false);
  });

  it('answers HEAD with the same redirect and no body', () => {
    const connection = fakeConnection({ rejection: 401 });
    const res = fakeResponse();
    createHandler({ connection, logger: { error() {} } })({ method: 'HEAD', headers: {} }, res);
    assert.equal(res.status, 303);
    assert.equal(res.body, undefined);
  });

  it('rejects other methods before touching the token', () => {
    const connection = fakeConnection({ rejection: 401 });
    const res = fakeResponse();
    createHandler({ connection, logger: { error() {} } })({ method: 'POST', headers: {} }, res);
    assert.equal(res.status, 405);
    assert.equal(res.headers.allow, 'GET, HEAD');
    assert.equal(res.headers.location, undefined);
  });

  it('answers 503 and logs when the token stops being readable at request time', () => {
    const connection = fakeConnection({ rejection: 401 });
    connection.state.tokenFailure = new Error('upstream changed');
    const errors = [];
    const res = fakeResponse();
    createHandler({ connection, logger: { error: (error) => errors.push(error) } })({ method: 'GET', headers: {} }, res);
    assert.equal(res.status, 503);
    assert.equal(res.ended, true);
    assert.equal(errors.length, 1);
  });
});

describe('apply', () => {
  it('serves the exact route while the key is usable', () => {
    const ctx = fakeContext();
    apply(ctx, { key: KEY });
    const route = ctx.webServer.routes.get(`/entry/${KEY}`);
    assert.notEqual(route, undefined);
    assert.equal(route.kind, 'exact');
    assert.equal(ctx.effects.length, 1);
    assert.match(ctx.effects[0].label, /entry route/u);
    assert.equal(ctx.warnings.length, 0);
  });

  it('removes the route on disposal', () => {
    const ctx = fakeContext();
    apply(ctx, { key: KEY });
    assert.equal(ctx.webServer.routes.size, 1);
    ctx.effects[0].dispose();
    assert.equal(ctx.webServer.routes.size, 0);
  });

  it('reads the volatile reference handed to apply', () => {
    const ctx = fakeContext();
    apply(ctx, { key: { get: () => KEY } });
    assert.notEqual(ctx.webServer.routes.get(`/entry/${KEY}`), undefined);
  });

  it('stays loadable without a key and serves no route', () => {
    const ctx = fakeContext();
    assert.doesNotThrow(() => apply(ctx, {}));
    assert.equal(ctx.webServer.attempted.length, 0);
    assert.equal(ctx.effects.length, 1);
    assert.equal(ctx.warnings.length, 1);
    assert.match(ctx.warnings[0], /no key is configured/u);
    assert.match(ctx.warnings[0], /Web Settings/u);
  });

  it('stays loadable with an unusable key and says why', () => {
    for (const key of ['short', `${'a'.repeat(MIN_KEY_LENGTH - 1)}+`]) {
      const ctx = fakeContext();
      assert.doesNotThrow(() => apply(ctx, { key }));
      assert.equal(ctx.webServer.attempted.length, 0);
      assert.equal(ctx.warnings.length, 1);
    }
  });

  it('fails the load when the launch token cannot be read, before registering anything', () => {
    const ctx = fakeContext();
    ctx.connection = { authenticatedUrl: () => 'http://dsh.invalid/' };
    assert.throws(() => apply(ctx, { key: KEY }), { message: /exactly one launch token/u });
    assert.equal(ctx.webServer.attempted.length, 0);
  });

  it('follows a volatile key change without being reloaded', () => {
    const ctx = fakeContext();
    let current = KEY;
    const config = { key: { get: () => current } };
    apply(ctx, config);
    assert.equal(ctx.webServer.routes.has(`/entry/${KEY}`), true);

    current = 'Ab3Df6Hj9Kl2Mn5Pq8St1Vw4Xy7Za0Bc';
    ctx.emit('loader/volatile-update');
    assert.equal(ctx.webServer.routes.has(`/entry/${KEY}`), false);
    assert.equal(ctx.webServer.routes.has(`/entry/${current}`), true);

    current = '';
    ctx.emit('loader/volatile-update');
    assert.equal(ctx.webServer.routes.size, 0);
    assert.equal(ctx.warnings.length, 1);

    current = KEY;
    ctx.emit('loader/volatile-update');
    assert.equal(ctx.webServer.routes.has(`/entry/${KEY}`), true);
  });

  it('leaves the route alone when a volatile update keeps the same key', () => {
    const ctx = fakeContext();
    let current = KEY;
    apply(ctx, { key: { get: () => current } });
    const route = ctx.webServer.routes.get(`/entry/${KEY}`);
    ctx.emit('loader/volatile-update');
    assert.equal(ctx.webServer.routes.get(`/entry/${KEY}`), route);
    assert.equal(ctx.webServer.attempted.length, 1);
  });

  it('declares the identity and services the entry depends on', () => {
    assert.equal(name, 'pairing-entry');
    assert.deepEqual(inject, ['connection', 'webServer']);
    assert.equal(Config.dict.key.meta.volatile, true);
  });

  it('is registered under the client-facing entry id', () => {
    assert.equal(name, 'pairing-entry');
  });
});
