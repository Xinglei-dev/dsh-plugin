import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { apply, Config, inject, locateLaunchToken, name } from '../lib/index.js';
import { missingReason, optionalImport } from './helpers.js';

const cordis = await optionalImport('@deepseek-ai/cordis');
const connection = await optionalImport('@deepseek-ai/dsh-client-connection');
const skip = cordis === undefined || connection === undefined;

/**
 * Mount the upstream Connection plugin over a credential provider that keeps
 * its records in memory, which is the smallest faithful stand-in for the
 * profile's local credential store.
 * @returns the settled root context and the Connection plugin's fiber, which
 * disposing simulates a Connection reload.
 */
async function mountConnection() {
  const ctx = new cordis.Context();
  const records = new Map();
  ctx.provide('credentials', {
    async modifyRecord(key, mutate) {
      const next = await mutate(records.get(key));
      if (next !== undefined) records.set(key, next);
      return records.get(key);
    },
  });
  const mounted = await ctx.plugin({ name: 'client-connection', inject: connection.inject, apply: connection.apply, Config: connection.Config }, { cookieMaxAgeDays: 30 });
  assert.notEqual(ctx.get('connection'), undefined, 'upstream Connection did not activate');
  return { ctx, mounted };
}

describe('real upstream BrowserAuth', { skip: skip && `${missingReason('@deepseek-ai/cordis')} / ${missingReason('@deepseek-ai/dsh-client-connection')}` }, () => {
  it('pins the token the upstream URL builder prints', async () => {
    const { ctx } = await mountConnection();
    try {
      const random = ctx.connection.browserAuth.launchToken;
      const token = 'MfDIwHr7iXvV0fQm2s7lwJp8Yb9dCkT4uN6zRa5e1gA';
      const fiber = ctx.plugin({ name, inject, apply, Config }, { token });
      await fiber;
      assert.equal(ctx.connection.browserAuth.launchToken, token);
      assert.match(ctx.connection.authenticatedUrl('http://127.0.0.1:3080/'), /\?token=MfDIwHr7iXvV0fQm2s7lwJp8Yb9dCkT4uN6zRa5e1gA$/u);
      await fiber.dispose();
      assert.equal(ctx.connection.browserAuth.launchToken, random);
    } finally {
      await ctx.fiber.dispose();
    }
  });

  it('fails the entry when upstream moves the private field', async () => {
    const { ctx } = await mountConnection();
    try {
      const browserAuth = ctx.connection.browserAuth;
      delete browserAuth.launchToken;
      const fiber = ctx.plugin({ name, inject, apply, Config }, { token: 'MfDIwHr7iXvV0fQm2s7lwJp8Yb9dCkT4uN6zRa5e1gA' });
      await assert.rejects(async () => { await fiber; }, { message: /launchToken is not an own property/u });
      assert.equal(fiber.state, 3);
    } finally {
      await ctx.fiber.dispose();
    }
  });

  it('re-pins after the connection provider is replaced', async () => {
    const { ctx, mounted } = await mountConnection();
    try {
      const token = 'MfDIwHr7iXvV0fQm2s7lwJp8Yb9dCkT4uN6zRa5e1gA';
      const fiber = ctx.plugin({ name, inject, apply, Config }, { token });
      await fiber;
      assert.equal(ctx.connection.browserAuth.launchToken, token);
      // Disposing the Connection provider makes this entry pending, exactly as
      // a Connection reload does; the next provider must be pinned again.
      await mounted.dispose();
      assert.equal(fiber.state, 0, 'the entry waits for Connection instead of keeping a stale pin');
      const second = { launchToken: 'another-random-token-from-a-fresh-process' };
      const replacer = ctx.plugin({
        name: 'connection-replacement',
        apply(inner) {
          inner.provide('connection', {
            browserAuth: second,
            authenticatedUrl(baseUrl) {
              const url = new URL(baseUrl);
              url.searchParams.set('token', second.launchToken);
              return url.href;
            },
          });
        },
      });
      await replacer;
      await fiber;
      assert.equal(second.launchToken, token);
    } finally {
      await ctx.fiber.dispose();
    }
  });
});
