import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { Readable } from 'node:stream';
import { after, before, describe, it } from 'node:test';

import { createHandler, MAX_BODY_BYTES } from '../lib/handler.js';
import { hashContent } from '../lib/paths.js';

const temporary = await mkdtemp(path.join(tmpdir(), 'dsh-agents-md-handler-'));
const homes = {
  home: temporary,
  dshHome: path.join(temporary, '.dsh'),
  agentsHome: path.join(temporary, '.agents'),
  dshHomeDisplay: '~/.dsh',
  agentsHomeDisplay: '~/.agents',
};
const workspace = path.join(temporary, 'workspace');

before(async () => {
  await mkdir(workspace, { recursive: true });
  await writeFile(path.join(workspace, '.git'), 'gitdir: elsewhere\n');
  await writeFile(path.join(workspace, 'AGENTS.md'), '# workspace\n');
  await mkdir(homes.dshHome, { recursive: true });
  await writeFile(path.join(homes.dshHome, 'AGENTS.md'), '# global\n');
});

after(async () => {
  await rm(temporary, { recursive: true, force: true });
});

const registry = {
  get(id) {
    return id === 'ws1' ? { id: 'ws1', path: workspace } : undefined;
  },
};

/**
 * Build a request stream carrying an optional JSON body.
 * @param method - HTTP method.
 * @param url - request URL.
 * @param body - optional body value.
 * @returns the request stream with the fields the handler reads.
 */
function request(method, url, body) {
  const stream = Readable.from(body === undefined ? [] : [Buffer.from(JSON.stringify(body))]);
  stream.method = method;
  stream.url = url;
  stream.headers = {};
  return stream;
}

/**
 * Build a response recorder.
 * @returns the recorder and its captured state.
 */
function response() {
  const state = { status: 0, headers: {}, body: '' };
  return {
    state,
    writeHead(status, headers) {
      state.status = status;
      state.headers = headers ?? {};
    },
    end(chunk) {
      if (chunk !== undefined) state.body += String(chunk);
    },
  };
}

/**
 * Invoke one handler with a recorded response.
 * @param handler - route handler.
 * @param method - HTTP method.
 * @param url - request URL.
 * @param body - optional JSON body.
 * @returns the captured response and parsed body.
 */
async function call(handler, method, url, body) {
  const res = response();
  await handler(request(method, url, body), res);
  return { status: res.state.status, headers: res.state.headers, body: JSON.parse(res.state.body) };
}

const handler = createHandler({
  homes,
  registry: () => registry,
  connection: () => ({ requestRejection: () => undefined }),
  logger: { error() {} },
});

describe('trust fence', () => {
  it('answers 403 before any file work when the Connection refuses', async () => {
    const refused = createHandler({
      homes,
      registry: () => registry,
      connection: () => ({ requestRejection: () => 403 }),
      logger: { error() {} },
    });
    const result = await call(refused, 'GET', '/agents-md/state');
    assert.equal(result.status, 403);
    assert.equal(result.body.code, 'forbidden');
  });

  it('answers 401 for an unauthenticated request', async () => {
    const anonymous = createHandler({
      homes,
      registry: () => registry,
      connection: () => ({ requestRejection: () => 401 }),
      logger: { error() {} },
    });
    const read = await call(anonymous, 'GET', '/agents-md/state');
    assert.equal(read.status, 401);
    assert.equal(read.body.code, 'unauthorized');
    const write = await call(anonymous, 'POST', '/agents-md/save', {
      scope: 'global-dsh',
      name: 'AGENTS.md',
      content: '# nope\n',
      expectedHash: null,
    });
    assert.equal(write.status, 401);
  });
});

describe('geometry', () => {
  it('answers 404 for an unknown endpoint and 405 for a wrong method', async () => {
    assert.equal((await call(handler, 'GET', '/agents-md/nope')).status, 404);
    assert.equal((await call(handler, 'POST', '/agents-md/state', {})).status, 405);
    assert.equal((await call(handler, 'GET', '/agents-md/save')).status, 405);
  });

  it('returns the global state without a workspace', async () => {
    const result = await call(handler, 'GET', '/agents-md/state');
    assert.equal(result.status, 200);
    assert.equal(result.body.ok, true);
    assert.equal(result.body.project, null);
    assert.equal(result.body.global[0].exists, true);
    assert.equal(result.body.global[1].exists, false);
  });

  it('returns the project chain for a registered workspace', async () => {
    const result = await call(handler, 'GET', '/agents-md/state?workspaceId=ws1');
    assert.equal(result.status, 200);
    assert.equal(result.body.project.workspaceId, 'ws1');
    assert.deepEqual(result.body.project.levels.map((level) => level.relDir), ['.']);
  });

  it('answers 404 for an unregistered workspace', async () => {
    const result = await call(handler, 'GET', '/agents-md/state?workspaceId=nope');
    assert.equal(result.status, 404);
    assert.equal(result.body.code, 'workspace-unknown');
  });
});

describe('file reads', () => {
  it('reads a global file', async () => {
    const result = await call(handler, 'GET', '/agents-md/file?scope=global-dsh&name=AGENTS.md');
    assert.equal(result.status, 200);
    assert.equal(result.body.content, '# global\n');
    assert.equal(result.body.hash, hashContent('# global\n'));
  });

  it('reads a project file', async () => {
    const result = await call(handler, 'GET', '/agents-md/file?scope=project&workspaceId=ws1&dir=.&name=AGENTS.md');
    assert.equal(result.status, 200);
    assert.equal(result.body.content, '# workspace\n');
  });

  it('rejects an unknown candidate name or chain directory', async () => {
    assert.equal((await call(handler, 'GET', '/agents-md/file?scope=project&workspaceId=ws1&dir=.&name=README.md')).status, 400);
    assert.equal((await call(handler, 'GET', '/agents-md/file?scope=project&workspaceId=ws1&dir=../..&name=AGENTS.md')).status, 400);
    assert.equal((await call(handler, 'GET', '/agents-md/file?scope=global-dsh&name=CLAUDE.md')).status, 400);
  });
});

describe('writes', () => {
  it('creates a project file when the browser expected absence', async () => {
    const result = await call(handler, 'POST', '/agents-md/save', {
      scope: 'project',
      workspaceId: 'ws1',
      dir: '.',
      name: 'CLAUDE.local.md',
      content: '# local\n',
      expectedHash: null,
    });
    assert.equal(result.status, 200);
    assert.equal(result.body.hash, hashContent('# local\n'));
    assert.equal(await readFile(path.join(workspace, 'CLAUDE.local.md'), 'utf8'), '# local\n');
  });

  it('updates a file whose hash still matches', async () => {
    const before = await call(handler, 'GET', '/agents-md/file?scope=global-dsh&name=AGENTS.md');
    const result = await call(handler, 'POST', '/agents-md/save', {
      scope: 'global-dsh',
      name: 'AGENTS.md',
      content: '# global next\n',
      expectedHash: before.body.hash,
    });
    assert.equal(result.status, 200);
    assert.equal(result.body.hash, hashContent('# global next\n'));
    assert.equal(await readFile(path.join(homes.dshHome, 'AGENTS.md'), 'utf8'), '# global next\n');
  });

  it('reports a conflict with the current disk version', async () => {
    const result = await call(handler, 'POST', '/agents-md/save', {
      scope: 'global-dsh',
      name: 'AGENTS.md',
      content: '# stale\n',
      expectedHash: hashContent('# something else\n'),
    });
    assert.equal(result.status, 409);
    assert.equal(result.body.code, 'conflict');
    assert.equal(result.body.current.content, '# global next\n');
    assert.equal(await readFile(path.join(homes.dshHome, 'AGENTS.md'), 'utf8'), '# global next\n');
  });

  it('refuses to create over an existing file', async () => {
    const result = await call(handler, 'POST', '/agents-md/save', {
      scope: 'project',
      workspaceId: 'ws1',
      dir: '.',
      name: 'AGENTS.md',
      content: '# duplicate\n',
      expectedHash: null,
    });
    assert.equal(result.status, 409);
  });

  it('rejects an oversized body and an oversized draft', async () => {
    const huge = 'x'.repeat(MAX_BODY_BYTES + 1);
    const result = await call(handler, 'POST', '/agents-md/save', {
      scope: 'global-dsh',
      name: 'AGENTS.md',
      content: huge,
      expectedHash: null,
    });
    assert.equal(result.status, 413);

    const draft = 'y'.repeat(1024 * 1024 + 1);
    const second = await call(handler, 'POST', '/agents-md/save', {
      scope: 'global-dsh',
      name: 'AGENTS.md',
      content: draft,
      expectedHash: hashContent('# global next\n'),
    });
    assert.equal(second.status, 413);
  });

  it('rejects malformed bodies', async () => {
    const res = response();
    await handler(request('POST', '/agents-md/save'), res);
    assert.equal(res.state.status, 400);
    assert.equal(JSON.parse(res.state.body).code, 'bad-request');
  });

  it('refuses a directory standing where the instruction file should be', async () => {
    await mkdir(path.join(workspace, 'CLAUDE.md'), { recursive: true });
    const result = await call(handler, 'POST', '/agents-md/save', {
      scope: 'project',
      workspaceId: 'ws1',
      dir: '.',
      name: 'CLAUDE.md',
      content: '# not a file\n',
      expectedHash: null,
    });
    assert.equal(result.status, 409);
    assert.equal(result.body.code, 'not-a-file');
  });
});

describe('missing workspace directory', () => {
  it('answers 404 when the registered directory disappeared', async () => {
    const gone = createHandler({
      homes,
      registry: () => ({ get: () => ({ id: 'gone', path: path.join(temporary, 'gone') }) }),
      connection: () => undefined,
      logger: { error() {} },
    });
    const result = await call(gone, 'POST', '/agents-md/save', {
      scope: 'project',
      workspaceId: 'gone',
      dir: '.',
      name: 'AGENTS.md',
      content: '# x\n',
      expectedHash: null,
    });
    assert.equal(result.status, 404);
    assert.equal(result.body.code, 'workspace-missing');
  });
});
