import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  backgroundTotalLine,
  bashResultKind,
  callDurationLine,
  formatDuration,
  name,
  ptcCallLine,
  withDurationLine,
} from '../lib/index.js';

describe('formatDuration', () => {
  it('uses milliseconds for sub-second work and seconds above it', () => {
    assert.equal(formatDuration(12), '12 毫秒');
    assert.equal(formatDuration(999), '999 毫秒');
    assert.equal(formatDuration(999.6), '1.0 秒');
    assert.equal(formatDuration(1000), '1.0 秒');
    assert.equal(formatDuration(2431), '2.4 秒');
    assert.equal(formatDuration(59_800), '59.8 秒');
    assert.equal(formatDuration(148_000), '148 秒');
  });

  it('never produces a negative or unusable value', () => {
    assert.equal(formatDuration(0), '不到 1 毫秒');
    assert.equal(formatDuration(0.4), '不到 1 毫秒');
    assert.equal(formatDuration(-5), '不到 1 毫秒');
    assert.equal(formatDuration(Number.NaN), '不到 1 毫秒');
  });
});

describe('withDurationLine', () => {
  const exitMarker = /\n\[(?:exit code: (?:-?\d+|null)|killed by signal: [^\]\n]+|Command finished with exit code -?\d+|shell exited[^\]\n]*)\]$/u;

  it('keeps the exit marker as the last line so the terminal card still reads it', () => {
    const content = [{ type: 'text', text: 'out\n[exit code: 2]' }];
    assert.deepEqual(withDurationLine(content, '【命令调用耗时：2.4 秒】', exitMarker), [
      { type: 'text', text: 'out\n【命令调用耗时：2.4 秒】\n[exit code: 2]' },
    ]);
  });

  it('keeps the exit-code marker last when the code is null', () => {
    const content = [{ type: 'text', text: 'out\n[exit code: null]' }];
    assert.deepEqual(withDurationLine(content, 'line', exitMarker), [
      { type: 'text', text: 'out\nline\n[exit code: null]' },
    ]);
  });

  it('keeps a killed-by-signal marker last as well', () => {
    const content = [{ type: 'text', text: 'out\n[killed by signal: SIGKILL]' }];
    assert.deepEqual(withDurationLine(content, '【命令调用耗时：1 毫秒】', exitMarker), [
      { type: 'text', text: 'out\n【命令调用耗时：1 毫秒】\n[killed by signal: SIGKILL]' },
    ]);
  });

  it('keeps the persistent shell marker last as well', () => {
    const content = [{ type: 'text', text: 'out\n[Command finished with exit code 0]' }];
    assert.deepEqual(withDurationLine(content, 'line', exitMarker), [
      { type: 'text', text: 'out\nline\n[Command finished with exit code 0]' },
    ]);
  });

  it('appends on its own line when there is no status marker', () => {
    const content = [{ type: 'text', text: 'started background job bash-123' }];
    assert.deepEqual(withDurationLine(content, '【命令调用耗时：1 毫秒】', exitMarker), [
      { type: 'text', text: 'started background job bash-123\n【命令调用耗时：1 毫秒】' },
    ]);
  });

  it('does not double the newline when the text already ends with one', () => {
    const content = [{ type: 'text', text: 'out\n' }];
    assert.deepEqual(withDurationLine(content, 'line', exitMarker), [{ type: 'text', text: 'out\nline' }]);
  });

  it('keeps non-text blocks and adds a text block when none exists', () => {
    const image = { type: 'image', source: { type: 'base64', media_type: 'image/png', data: 'AA' } };
    assert.deepEqual(withDurationLine([image], 'line', exitMarker), [image, { type: 'text', text: 'line' }]);
  });

  it('touches only the last text block', () => {
    const content = [
      { type: 'text', text: 'first' },
      { type: 'text', text: 'second\n[exit code: 0]' },
    ];
    assert.deepEqual(withDurationLine(content, 'line', exitMarker), [
      { type: 'text', text: 'first' },
      { type: 'text', text: 'second\nline\n[exit code: 0]' },
    ]);
  });

  it('appends at the very end when the result has no status marker', () => {
    const content = [{ type: 'text', text: '42' }];
    assert.deepEqual(withDurationLine(content, '【本次 PTC 调用耗时：2.4 秒】', null), [
      { type: 'text', text: '42\n【本次 PTC 调用耗时：2.4 秒】' },
    ]);
  });
});

describe('bashResultKind', () => {
  it('reads the kinds the bash tool declares', () => {
    assert.equal(bashResultKind({ kind: 'foreground' }, {}), 'foreground');
    assert.equal(bashResultKind({ kind: 'background' }, {}), 'background');
    assert.equal(bashResultKind({ kind: 'promoted' }, {}), 'promoted');
  });

  it('treats a forced background call as a launch even without a known value kind', () => {
    assert.equal(bashResultKind({ kind: 'something-new' }, { run_in_background: true }), 'background');
    assert.equal(bashResultKind(undefined, { run_in_background: true }), 'background');
  });

  it('treats the persistent tool\'s plain text result as a foreground call', () => {
    assert.equal(bashResultKind('output\n[Command finished with exit code 0]', {}), 'foreground');
  });

  it('declines to label a value shape it does not know', () => {
    assert.equal(bashResultKind({ kind: 'something-new' }, {}), undefined);
    assert.equal(bashResultKind({}, {}), undefined);
    assert.equal(bashResultKind(undefined, {}), undefined);
  });
});

describe('callDurationLine', () => {
  it('states a plain call duration without claiming to be process run time', () => {
    assert.equal(callDurationLine('foreground', 2400), '【命令调用耗时：2.4 秒】');
  });

  it('marks a background launch as the launch call only', () => {
    assert.equal(
      callDurationLine('background', 3),
      '【命令调用耗时：3 毫秒（仅启动后台 Job，不含任务运行时间）】',
    );
  });

  it('marks a promoted call as the foreground wait only', () => {
    assert.equal(
      callDurationLine('promoted', 120_000),
      '【命令调用耗时：120 秒（前台等待，任务在后台继续运行）】',
    );
  });
});

describe('backgroundTotalLine', () => {
  const finished = {
    id: 'bash-0123456789abcdef',
    kind: 'bash',
    label: 'sleep 0.1',
    status: 'completed',
    startedAt: 1_000_000,
    finishedAt: 1_148_000,
  };

  it('uses the job start and finish times for a settled bash job', () => {
    assert.equal(backgroundTotalLine(finished), '【后台任务运行耗时：148 秒】');
  });

  it('reports a settled kill as its total runtime too', () => {
    assert.equal(
      backgroundTotalLine({ ...finished, status: 'killed', finishedAt: 1_002_000 }),
      '【后台任务运行耗时：2.0 秒】',
    );
  });

  it('does not invent a total while the job is still running', () => {
    assert.equal(backgroundTotalLine({ ...finished, status: 'running', finishedAt: undefined }), undefined);
    assert.equal(backgroundTotalLine({ ...finished, status: 'stopping', finishedAt: undefined }), undefined);
    // A settled status without a finish time is still not a usable total.
    assert.equal(backgroundTotalLine({ ...finished, status: 'completed', finishedAt: undefined }), undefined);
    // Nor are timestamps that run backwards.
    assert.equal(backgroundTotalLine({ ...finished, startedAt: 2_000_000 }), undefined);
  });

  it('leaves other job kinds alone', () => {
    assert.equal(backgroundTotalLine({ ...finished, kind: 'terminal' }), undefined);
    assert.equal(backgroundTotalLine({ ...finished, kind: 'workflow' }), undefined);
  });

  it('ignores a shape it cannot read', () => {
    assert.equal(backgroundTotalLine(undefined), undefined);
    assert.equal(backgroundTotalLine(null), undefined);
  });
});

describe('ptcCallLine', () => {
  it('states one PTC call as one command without a breakdown', () => {
    assert.equal(ptcCallLine(65), '【本次 PTC 调用耗时：65 毫秒】');
    assert.equal(ptcCallLine(2400), '【本次 PTC 调用耗时：2.4 秒】');
  });

  it('shares the same never-negative policy as every other line', () => {
    assert.equal(ptcCallLine(-1), '【本次 PTC 调用耗时：不到 1 毫秒】');
    assert.equal(ptcCallLine(Number.NaN), '【本次 PTC 调用耗时：不到 1 毫秒】');
  });

  it('does not claim to be a bash call duration', () => {
    assert.doesNotMatch(ptcCallLine(10), /命令调用耗时/u);
  });
});

describe('plugin contract', () => {
  it('declares the tool registry it hooks into', () => {
    assert.equal(name, 'command-duration');
  });
});
