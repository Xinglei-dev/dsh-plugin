import assert from 'node:assert/strict';
import { mkdtemp, mkdir, rm, writeFile, symlink, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { after, describe, it } from 'node:test';

import {
  ALL_CANDIDATES,
  MAX_FILE_BYTES,
  ancestorChain,
  assertWritableTarget,
  candidatePath,
  discoverProjectRoot,
  expandHomePath,
  hashContent,
  isPathInside,
  projectLevels,
  readInstructionFile,
  relativeDisplay,
  resolveHomes,
  writeInstructionFile,
} from '../lib/paths.js';

const temporary = await mkdtemp(path.join(tmpdir(), 'dsh-agents-md-paths-'));

after(async () => {
  await rm(temporary, { recursive: true, force: true });
});

/**
 * Create one directory under the test root.
 * @param name - relative directory name.
 * @returns the absolute directory.
 */
async function makeDir(name) {
  const target = path.join(temporary, name);
  await mkdir(target, { recursive: true });
  return target;
}

describe('resolveHomes', () => {
  it('uses the OS home defaults and symbolic labels', () => {
    const homes = resolveHomes({}, '/home/tester');
    assert.equal(homes.dshHome, path.resolve('/home/tester/.dsh'));
    assert.equal(homes.agentsHome, path.resolve('/home/tester/.agents'));
    assert.equal(homes.dshHomeDisplay, '~/.dsh');
    assert.equal(homes.agentsHomeDisplay, '~/.agents');
  });

  it('honors the environment overrides and labels them by variable', () => {
    const homes = resolveHomes({ DSH_HOME: '/srv/dsh', DSH_AGENTS_HOME: '~/shared-agents' }, '/home/tester');
    assert.equal(homes.dshHome, path.resolve('/srv/dsh'));
    assert.equal(homes.agentsHome, path.resolve('/home/tester/shared-agents'));
    assert.equal(homes.dshHomeDisplay, '$DSH_HOME');
    assert.equal(homes.agentsHomeDisplay, '$DSH_AGENTS_HOME');
  });

  it('treats a blank override as unset', () => {
    const homes = resolveHomes({ DSH_HOME: '   ', DSH_AGENTS_HOME: '' }, '/home/tester');
    assert.equal(homes.dshHome, path.resolve('/home/tester/.dsh'));
    assert.equal(homes.agentsHomeDisplay, '~/.agents');
  });
});

describe('expandHomePath', () => {
  it('expands the supported tilde prefixes only', () => {
    assert.equal(expandHomePath('~', '/home/tester'), '/home/tester');
    assert.equal(expandHomePath('~/work', '/home/tester'), path.join('/home/tester', 'work'));
    assert.equal(expandHomePath('~user', '/home/tester'), '~user');
    assert.equal(expandHomePath('/absolute', '/home/tester'), '/absolute');
  });
});

describe('discoverProjectRoot', () => {
  it('walks up to the nearest marker, accepting a file marker', async () => {
    const root = await makeDir('project-root');
    await writeFile(path.join(root, '.git'), 'gitdir: elsewhere\n');
    const nested = path.join(root, 'a', 'b');
    await mkdir(nested, { recursive: true });
    const discovered = await discoverProjectRoot(nested);
    assert.equal(discovered.root, root);
    assert.equal(discovered.detected, true);
  });

  it('falls back to the starting directory when no marker exists', async () => {
    const start = await makeDir('unmarked');
    const discovered = await discoverProjectRoot(start);
    assert.equal(discovered.root, start);
    assert.equal(discovered.detected, false);
  });
});

describe('ancestorChain', () => {
  it('orders the chain from broad to specific', () => {
    const chain = ancestorChain('/repo', '/repo/src/deep');
    assert.deepEqual(chain, ['/repo', '/repo/src', '/repo/src/deep']);
  });

  it('refuses to invent a chain when the leaf is outside the root', () => {
    assert.deepEqual(ancestorChain('/repo', '/elsewhere'), ['/elsewhere']);
  });
});

describe('projectLevels', () => {
  it('renders the root as "." and keeps slash separators', () => {
    const levels = projectLevels('/repo/src', '/repo');
    assert.deepEqual(levels.map((level) => level.relDir), ['.', 'src']);
  });
});

describe('isPathInside and relativeDisplay', () => {
  it('accepts the parent itself and rejects escapes', () => {
    assert.equal(isPathInside('/repo', '/repo'), true);
    assert.equal(isPathInside('/repo', '/repo/src'), true);
    assert.equal(isPathInside('/repo', '/repo-sibling'), false);
    assert.equal(isPathInside('/repo', '/etc/passwd'), false);
  });

  it('uses "." for the root itself', () => {
    assert.equal(relativeDisplay('/repo', '/repo'), '.');
    assert.equal(relativeDisplay('/repo', '/repo/src/agents'), 'src/agents');
  });
});

describe('file names', () => {
  it('lists the four candidates DSH loads', () => {
    assert.deepEqual(ALL_CANDIDATES, ['AGENTS.md', 'CLAUDE.md', 'AGENTS.local.md', 'CLAUDE.local.md']);
    assert.equal(candidatePath('/repo', 'AGENTS.md'), path.join('/repo', 'AGENTS.md'));
  });
});

describe('hashContent', () => {
  it('is stable and content-sensitive', () => {
    assert.equal(hashContent('a'), hashContent('a'));
    assert.notEqual(hashContent('a'), hashContent('b'));
    assert.match(hashContent('a'), /^[0-9a-f]{64}$/u);
  });
});

describe('readInstructionFile', () => {
  it('reports absence without throwing', async () => {
    const result = await readInstructionFile(path.join(temporary, 'missing', 'AGENTS.md'));
    assert.deepEqual(result, { exists: false, content: '', size: 0, mtimeMs: null, hash: null });
  });

  it('reads text and returns its hash and size', async () => {
    const file = path.join(temporary, 'read', 'AGENTS.md');
    await mkdir(path.dirname(file), { recursive: true });
    await writeFile(file, 'hello 世界\n');
    const result = await readInstructionFile(file);
    assert.equal(result.exists, true);
    assert.equal(result.content, 'hello 世界\n');
    assert.equal(result.size, Buffer.byteLength('hello 世界\n'));
    assert.equal(result.hash, hashContent('hello 世界\n'));
  });

  it('refuses a file above the configured ceiling', async () => {
    const file = path.join(temporary, 'large', 'AGENTS.md');
    await mkdir(path.dirname(file), { recursive: true });
    await writeFile(file, '0123456789');
    await assert.rejects(() => readInstructionFile(file, { maxBytes: 4 }), (error) => error.code === 'TOO_LARGE');
  });
});

describe('writeInstructionFile', () => {
  it('creates missing directories, writes UTF-8, and keeps the file readable', async () => {
    const file = path.join(temporary, 'write', 'nested', 'AGENTS.md');
    const written = await writeInstructionFile(file, '# 标题\n');
    assert.equal(written.size, Buffer.byteLength('# 标题\n'));
    const info = await stat(file);
    assert.equal(info.isFile(), true);
    assert.equal((await readInstructionFile(file)).content, '# 标题\n');
  });

  it('replaces existing content and preserves the file mode', async () => {
    const file = path.join(temporary, 'replace', 'AGENTS.md');
    await writeInstructionFile(file, 'old');
    const before = (await stat(file)).mode & 0o777;
    await writeInstructionFile(file, 'new');
    assert.equal((await readInstructionFile(file)).content, 'new');
    assert.equal((await stat(file)).mode & 0o777, before);
  });

  it('refuses content above the ceiling', async () => {
    const file = path.join(temporary, 'write-large', 'AGENTS.md');
    await assert.rejects(
      () => writeInstructionFile(file, '0123456789', { maxBytes: 4 }),
      (error) => error.code === 'TOO_LARGE',
    );
  });
});

describe('assertWritableTarget', () => {
  it('accepts a target under an allowed root', async () => {
    const root = await makeDir('allowed');
    await mkdir(path.join(root, 'sub'));
    await assertWritableTarget(path.join(root, 'sub', 'AGENTS.md'), [root]);
  });

  it('refuses a target outside every root', async () => {
    const root = await makeDir('allowed-2');
    const outside = await makeDir('outside-2');
    await assert.rejects(
      () => assertWritableTarget(path.join(outside, 'AGENTS.md'), [root]),
      (error) => error.code === 'OUTSIDE',
    );
  });

  it('refuses a symbolic-link target', { skip: process.platform === 'win32' }, async () => {
    const root = await makeDir('symlinked');
    const real = path.join(root, 'real.md');
    await writeFile(real, 'content');
    const link = path.join(root, 'AGENTS.md');
    await symlink(real, link);
    await assert.rejects(
      () => assertWritableTarget(link, [root]),
      (error) => error.code === 'SYMLINK',
    );
  });
});

describe('MAX_FILE_BYTES', () => {
  it('is one mebibyte', () => {
    assert.equal(MAX_FILE_BYTES, 1024 * 1024);
  });
});
