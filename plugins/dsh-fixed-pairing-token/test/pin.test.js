import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { apply, locateLaunchToken, pinLaunchToken, verifyPinnedToken } from '../lib/index.js';

const RANDOM = 'x'.repeat(43);
const PINNED = 'MfDIwHr7iXvV0fQm2s7lwJp8Yb9dCkT4uN6zRa5e1gA';

/**
 * Build the smallest upstream stand-in this plugin can observe.
 * `authenticatedUrl` reads `browserAuth.launchToken` exactly like the real
 * BrowserAuth does, which is what makes the shape check meaningful.
 * @returns a fake `ctx.connection`.
 */
function fakeConnection() {
  const browserAuth = { launchToken: RANDOM };
  return {
    browserAuth,
    authenticatedUrl(baseUrl) {
      const url = new URL(baseUrl);
      url.searchParams.set('token', browserAuth.launchToken);
      return url.href;
    },
  };
}

/**
 * Minimal Cordis-shaped context that runs effects immediately and records the
 * registered cleanup, so `apply` can be tested without Cordis.
 */
function fakeContext(connection) {
  const cleanups = [];
  return {
    connection,
    cleanups,
    effect(execute) {
      cleanups.push(execute());
    },
  };
}

describe('locateLaunchToken', () => {
  it('returns the own descriptor of a real shape', () => {
    const connection = fakeConnection();
    const { browserAuth, descriptor } = locateLaunchToken(connection);
    assert.equal(browserAuth, connection.browserAuth);
    assert.equal(descriptor.value, RANDOM);
    assert.equal(descriptor.configurable, true);
  });

  it('fails when the connection carries no browserAuth', () => {
    for (const connection of [undefined, null, {}, { browserAuth: null }, { browserAuth: 'nope' }]) {
      assert.throws(() => locateLaunchToken(connection), {
        name: 'TypeError',
        message: /browserAuth is missing/u,
      });
    }
  });

  it('fails when launchToken moved to the prototype or was renamed', () => {
    const inherited = { browserAuth: Object.create({ launchToken: RANDOM }), authenticatedUrl: () => '' };
    assert.throws(() => locateLaunchToken(inherited), { message: /not an own property/u });
    assert.throws(() => locateLaunchToken({ browserAuth: { token: RANDOM } }), { message: /not an own property/u });
  });

  it('fails when the field became an accessor', () => {
    const connection = { browserAuth: { get launchToken() { return RANDOM; } } };
    assert.throws(() => locateLaunchToken(connection), { message: /accessor/u });
  });

  it('fails when the stored value is not a non-empty string', () => {
    for (const value of ['', 42, undefined, null]) {
      assert.throws(() => locateLaunchToken({ browserAuth: { launchToken: value } }), {
        message: /not a non-empty string/u,
      });
    }
  });
});

describe('verifyPinnedToken', () => {
  it('passes when the printed address carries the token once', () => {
    const connection = fakeConnection();
    pinLaunchToken(connection.browserAuth, locateLaunchToken(connection).descriptor, PINNED);
    assert.doesNotThrow(() => verifyPinnedToken(connection, PINNED));
  });

  it('fails when the URL builder ignores the field', () => {
    const connection = {
      browserAuth: { launchToken: PINNED },
      authenticatedUrl: (baseUrl) => `${baseUrl}?token=${RANDOM}`,
    };
    assert.throws(() => verifyPinnedToken(connection, PINNED), { message: /does not report the pinned token/u });
  });

  it('fails when the URL carries the token more than once or not at all', () => {
    for (const printed of ['http://dsh.invalid/?token=a&token=b', 'http://dsh.invalid/', 'http://dsh.invalid/?other=a']) {
      const connection = { browserAuth: { launchToken: PINNED }, authenticatedUrl: () => printed };
      assert.throws(() => verifyPinnedToken(connection, PINNED), { message: /does not report the pinned token/u });
    }
  });

  it('fails when authenticatedUrl is missing or throws', () => {
    assert.throws(() => verifyPinnedToken({ browserAuth: {} }, PINNED), { message: /authenticatedUrl is not a function/u });
    const throwing = { browserAuth: {}, authenticatedUrl() { throw new Error('upstream changed'); } };
    assert.throws(() => verifyPinnedToken(throwing, PINNED), { message: /authenticatedUrl\(\) failed.*cannot be confirmed/su });
  });
});

describe('pinLaunchToken', () => {
  it('keeps the descriptor attributes and swaps only the value', () => {
    const connection = fakeConnection();
    const { browserAuth, descriptor } = locateLaunchToken(connection);
    pinLaunchToken(browserAuth, descriptor, PINNED);
    const pinned = Object.getOwnPropertyDescriptor(browserAuth, 'launchToken');
    assert.deepEqual(pinned, { ...descriptor, value: PINNED });
    assert.equal(connection.authenticatedUrl('http://127.0.0.1:3080/'), `http://127.0.0.1:3080/?token=${PINNED}`);
  });

  it('restores the exact original descriptor and tolerates a second call', () => {
    const connection = fakeConnection();
    const before = Object.getOwnPropertyDescriptor(connection.browserAuth, 'launchToken');
    const { browserAuth, descriptor } = locateLaunchToken(connection);
    const unpin = pinLaunchToken(browserAuth, descriptor, PINNED);
    unpin();
    assert.deepEqual(Object.getOwnPropertyDescriptor(browserAuth, 'launchToken'), before);
    assert.equal(browserAuth.launchToken, RANDOM);
    assert.doesNotThrow(unpin);
    assert.equal(browserAuth.launchToken, RANDOM);
  });
});

describe('apply', () => {
  it('pins the token and un-pins it on disposal', () => {
    const connection = fakeConnection();
    const ctx = fakeContext(connection);
    apply(ctx, { token: PINNED });
    assert.equal(connection.browserAuth.launchToken, PINNED);
    assert.equal(ctx.cleanups.length, 1);
    ctx.cleanups[0]();
    assert.equal(connection.browserAuth.launchToken, RANDOM);
  });

  it('reads the fallback environment variable', () => {
    const connection = fakeConnection();
    const ctx = fakeContext(connection);
    const saved = process.env.DSH_PAIRING_TOKEN;
    process.env.DSH_PAIRING_TOKEN = PINNED;
    try {
      apply(ctx, {});
    } finally {
      if (saved === undefined) delete process.env.DSH_PAIRING_TOKEN;
      else process.env.DSH_PAIRING_TOKEN = saved;
    }
    assert.equal(connection.browserAuth.launchToken, PINNED);
  });

  it('rejects a missing token before registering any effect', () => {
    const ctx = fakeContext(fakeConnection());
    const saved = process.env.DSH_PAIRING_TOKEN;
    delete process.env.DSH_PAIRING_TOKEN;
    try {
      assert.throws(() => apply(ctx, {}), { message: /no launch token configured/u });
    } finally {
      if (saved !== undefined) process.env.DSH_PAIRING_TOKEN = saved;
    }
    assert.equal(ctx.cleanups.length, 0);
  });

  it('restores the original token when the load-time self-check fails', () => {
    const connection = fakeConnection();
    connection.authenticatedUrl = (baseUrl) => `${baseUrl}?token=${RANDOM}`;
    const ctx = fakeContext(connection);
    assert.throws(() => apply(ctx, { token: PINNED }), { message: /does not report the pinned token/u });
    assert.equal(connection.browserAuth.launchToken, RANDOM);
    assert.equal(ctx.cleanups.length, 0);
  });
});
