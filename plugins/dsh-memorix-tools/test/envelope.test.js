import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  createClient,
  ENVELOPE_CAPABILITIES_KEY,
  ENVELOPE_VERSION_KEY,
  PROTOCOL_VERSION,
  requestBody,
  requestHeaders,
} from '../lib/client.js';

describe('requestHeaders', () => {
  it('sends the stateless dialect markers on every request', () => {
    const headers = requestHeaders({ method: 'tools/list' });

    assert.equal(headers['content-type'], 'application/json');
    assert.equal(headers.accept, 'application/json, text/event-stream');
    assert.equal(headers['mcp-protocol-version'], PROTOCOL_VERSION);
    assert.equal(headers['mcp-stateless'], 'true');
    assert.equal(headers['mcp-method'], 'tools/list');
    assert.equal(headers['mcp-name'], undefined);
    assert.equal(headers['mcp-project-root'], undefined);
  });

  it('adds the tool and project identity a call needs', () => {
    const headers = requestHeaders({
      method: 'tools/call',
      name: 'memorix_search',
      projectRoot: '/root/project/example',
    });

    assert.equal(headers['mcp-name'], 'memorix_search');
    assert.equal(headers['mcp-project-root'], '/root/project/example');
  });
});

describe('requestBody', () => {
  it('carries the per-request envelope alongside the method parameters', () => {
    const body = requestBody({ id: 7, method: 'tools/call', params: { name: 'memorix_search', arguments: { query: 'x' } } });

    assert.equal(body.jsonrpc, '2.0');
    assert.equal(body.id, 7);
    assert.equal(body.method, 'tools/call');
    assert.equal(body.params.name, 'memorix_search');
    assert.deepEqual(body.params.arguments, { query: 'x' });
    assert.equal(body.params._meta[ENVELOPE_VERSION_KEY], PROTOCOL_VERSION);
    assert.deepEqual(body.params._meta[ENVELOPE_CAPABILITIES_KEY], {});
  });

  it('still carries the envelope when a method takes no parameters', () => {
    const body = requestBody({ id: 1, method: 'tools/list' });

    assert.deepEqual(Object.keys(body.params), ['_meta']);
  });
});

describe('createClient endpoint validation', () => {
  it('rejects a URL that is not absolute http(s)', () => {
    assert.throws(() => createClient({ url: '127.0.0.1:3211' }), /absolute http\(s\) URL/u);
  });

  it('accepts the default endpoint', () => {
    assert.doesNotThrow(() => createClient({ url: 'http://127.0.0.1:3211/mcp' }));
  });
});
