// Offline checks for the bundle manifest and its single Loader patch row.
// They read files only: no DSH service, GUI, or $DSH_HOME access.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const manifest = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
const patch = readFileSync(join(root, 'cordis.patch.yml'), 'utf8');
const en = JSON.parse(readFileSync(join(root, 'locale/en.json'), 'utf8'));
const zh = JSON.parse(readFileSync(join(root, 'locale/zh.json'), 'utf8'));

test('the manifest declares the bundle patch', () => {
  assert.equal(manifest.dsh?.bundle?.patch, './cordis.patch.yml');
  assert.equal(manifest.dsh.bundle.patch, `./${manifest.files[0]}`);
});

test('the patch inserts the session-scoped implementation row', () => {
  assert.match(patch, /- id: mcp-memorix/);
  assert.match(patch, /name: dsh-memorix-tools/);
  assert.match(patch, /baseUrl: http:\/\/127\.0\.0\.1:3211\/mcp/);
  // The stock client would bind one project per connection, which is exactly
  // what the implementation replaces.
  assert.doesNotMatch(patch, /@deepseek-ai\/dsh-mcp-client/);
  assert.doesNotMatch(patch, /transport:/);
});

test('display metadata exists in both locales', () => {
  for (const locale of [en, zh]) {
    assert.equal(typeof locale.meta.title, 'string');
    assert.ok(locale.meta.title.length > 0);
    assert.equal(typeof locale.meta.description, 'string');
    assert.ok(locale.meta.description.length > 0);
  }
});

test('the card is enabled independently of the implementation package', () => {
  // The implementation is a plain dependency composed by this patch; it must
  // not claim bundle metadata of its own, or installing it would insert a
  // second row for the same tool names.
  const implementation = JSON.parse(readFileSync(join(root, '..', 'dsh-memorix-tools', 'package.json'), 'utf8'));
  assert.equal(implementation.dsh?.bundle, undefined);
});
