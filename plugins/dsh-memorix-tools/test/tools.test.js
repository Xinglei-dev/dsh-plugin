import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { createToolDefinition, publicToolName, textOfContent } from '../lib/tools.js';

describe('publicToolName', () => {
  it('uses the same mcp__<serverName>__<tool> shape as the stock client', () => {
    assert.equal(publicToolName('memorix', 'memorix_store'), 'mcp__memorix__memorix_store');
  });

  it('replaces characters the function-name contract forbids', () => {
    const name = publicToolName('memorix', 'memorix.store:1');

    assert.match(name, /^mcp__memorix__memorix_store_1_[0-9a-f]{12}$/u);
  });

  it('truncates an over-long name and keeps it unique with an identity hash', () => {
    const long = 'x'.repeat(80);
    const name = publicToolName('memorix', long);

    assert.equal(name.length, 64);
    assert.match(name, /_[0-9a-f]{12}$/u);
    assert.notEqual(name, publicToolName('memorix', `${long}y`));
  });
});

describe('textOfContent', () => {
  it('joins text blocks in order', () => {
    const text = textOfContent(
      [
        { type: 'text', text: 'first' },
        { type: 'text', text: 'second' },
      ],
      'memorix_search',
    );

    assert.equal(text, 'first\nsecond');
  });

  it('describes a block it cannot render instead of dropping it', () => {
    assert.match(textOfContent([{ type: 'image', mimeType: 'image/png', data: 'x' }], 'memorix_search'), /image block from "memorix_search"/u);
    assert.match(textOfContent([{ type: 'resource', resource: { uri: 'memorix://a' } }], 'memorix_search'), /memorix:\/\/a/u);
    assert.match(textOfContent([{ type: 'audio' }], 'memorix_search'), /unsupported audio block/u);
  });

  it('returns an empty string for an empty result', () => {
    assert.equal(textOfContent([], 'memorix_search'), '');
    assert.equal(textOfContent(undefined, 'memorix_search'), '');
  });
});

/**
 * Build a definition whose transport is a recorder.
 * @param overrides - fields to replace.
 * @returns the definition and the recorded calls.
 */
function build(overrides = {}) {
  const calls = [];
  const definition = createToolDefinition({
    publicName: 'mcp__memorix__memorix_search',
    rawName: 'memorix_search',
    description: 'Search project memory.',
    inputSchema: { type: 'object', properties: { query: { type: 'string' } }, required: ['query'] },
    callTool: async (name, args, options) => {
      calls.push({ name, args, options });
      return { content: [{ type: 'text', text: 'found' }] };
    },
    projectRootOf: () => '/root/project/alpha',
    ...overrides,
  });
  return { definition, calls };
}

describe('createToolDefinition', () => {
  it('exposes the server schema unchanged and the prefixed name', () => {
    const { definition } = build();

    assert.equal(definition.name, 'mcp__memorix__memorix_search');
    assert.equal(definition.description, 'Search project memory.');
    assert.equal(definition.parameters.properties.query.type, 'string');
    assert.deepEqual(definition.output.schema.required, ['content']);
  });

  it('calls the server with the resolved project root and the caller signal', async () => {
    const { definition, calls } = build();
    const controller = new AbortController();

    const value = await definition.execute({ query: 'routes' }, { signal: controller.signal, agent: {} });

    assert.deepEqual(value, { content: [{ type: 'text', text: 'found' }] });
    assert.equal(calls[0].name, 'memorix_search');
    assert.deepEqual(calls[0].args, { query: 'routes' });
    assert.equal(calls[0].options.projectRoot, '/root/project/alpha');
    assert.equal(calls[0].options.signal, controller.signal);
  });

  it('renders the text the model reads', () => {
    const { definition } = build();

    const blocks = definition.output.render({}, { content: [{ type: 'text', text: 'found' }] });

    assert.deepEqual(blocks, [{ type: 'text', text: 'found' }]);
  });

  it('turns a server-reported tool error into a failed call', async () => {
    const { definition } = build({
      callTool: async () => ({ isError: true, content: [{ type: 'text', text: 'no such entity' }] }),
    });

    await assert.rejects(definition.execute({ query: 'routes' }, {}), /no such entity/u);
  });

  it('keeps structured content in the canonical value', async () => {
    const { definition } = build({
      callTool: async () => ({ content: [{ type: 'text', text: 'ok' }], structuredContent: { total: 3 } }),
    });

    const value = await definition.execute({ query: 'routes' }, {});

    assert.deepEqual(value.structuredContent, { total: 3 });
  });
});
