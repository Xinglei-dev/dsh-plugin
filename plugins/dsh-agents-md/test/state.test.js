import assert from 'node:assert/strict';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { after, before, describe, it } from 'node:test';

import { buildGlobalState, buildProjectState, buildState } from '../lib/state.js';

const temporary = await mkdtemp(path.join(tmpdir(), 'dsh-agents-md-state-'));
const project = path.join(temporary, 'project');
const workspace = path.join(project, 'sub');
const homes = {
  home: temporary,
  dshHome: path.join(temporary, '.dsh'),
  agentsHome: path.join(temporary, '.agents'),
  dshHomeDisplay: '~/.dsh',
  agentsHomeDisplay: '~/.agents',
};

before(async () => {
  await mkdir(path.join(homes.dshHome), { recursive: true });
  await writeFile(path.join(homes.dshHome, 'AGENTS.md'), '# global\n');
  await mkdir(workspace, { recursive: true });
  await writeFile(path.join(project, '.git'), 'gitdir: elsewhere\n');
  await writeFile(path.join(project, 'AGENTS.md'), '# project\n');
  await writeFile(path.join(project, 'CLAUDE.md'), '# claude\n');
  await writeFile(path.join(workspace, 'AGENTS.md'), '# workspace\n');
});

after(async () => {
  await rm(temporary, { recursive: true, force: true });
});

describe('buildGlobalState', () => {
  it('lists both global files in load order with their presence', async () => {
    const global = await buildGlobalState(homes);
    assert.deepEqual(global.map((entry) => entry.scope), ['global-dsh', 'global-agents']);
    assert.equal(global[0].exists, true);
    assert.equal(global[0].size, Buffer.byteLength('# global\n'));
    assert.equal(global[1].exists, false);
    assert.equal(global[1].size, 0);
  });
});

describe('buildProjectState', () => {
  it('discovers the root, orders levels, and lists only existing extras', async () => {
    const state = await buildProjectState({ id: 'ws1', path: workspace });
    assert.equal(state.available, true);
    assert.equal(state.projectRoot, project);
    assert.equal(state.rootDetected, true);
    assert.deepEqual(state.levels.map((level) => level.relDir), ['.', 'sub']);
    assert.deepEqual(state.levels[0].files.map((file) => file.name), ['AGENTS.md', 'CLAUDE.md']);
    assert.deepEqual(state.levels[1].files.map((file) => file.name), ['AGENTS.md']);
  });

  it('reports a missing workspace directory instead of inventing a chain', async () => {
    const state = await buildProjectState({ id: 'ws-missing', path: path.join(temporary, 'nope') });
    assert.equal(state.available, false);
    assert.equal(state.reason, 'missing');
    assert.deepEqual(state.levels, []);
  });
});

describe('buildState', () => {
  it('returns the global files without a project when none is selected', async () => {
    const state = await buildState({ homes });
    assert.equal(state.project, null);
    assert.deepEqual(state.candidates, ['AGENTS.md', 'CLAUDE.md', 'AGENTS.local.md', 'CLAUDE.local.md']);
    assert.deepEqual(state.baseCandidates, ['AGENTS.md', 'CLAUDE.md']);
    assert.equal(state.maxBytes, 1024 * 1024);
  });

  it('includes the project chain when a workspace is selected', async () => {
    const state = await buildState({ homes, workspace: { id: 'ws1', path: workspace } });
    assert.equal(state.project.workspaceId, 'ws1');
    assert.equal(state.project.levels.length, 2);
  });
});
