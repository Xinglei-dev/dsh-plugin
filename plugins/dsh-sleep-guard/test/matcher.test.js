import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { BLOCK_REASON, commandOf, inject, name, shouldBlock } from '../lib/index.js';

describe('shouldBlock', () => {
  // The cases the implementation was specified against, one row each.
  const blocked = [
    ['sleep 300; cat /tmp/test.log', 'a fixed wait then a log read'],
    ['sleep 120 && grep PASS /tmp/test.log', 'a fixed wait chained with &&'],
    ['sleep 30', 'a bare wait'],
    ['  sleep 1m; echo done', 'an indented wait with a minute suffix'],
    ['sleep 0.5 && echo ready', 'a fractional wait'],
    ['sleep 2h', 'an hours suffix'],
    ['sleep 1d', 'a days suffix'],
    ['sleep .5; echo ready', 'a fraction without a leading digit'],
    ['sleep\t30', 'a tab after the command name'],
    ['\n\nsleep 30', 'leading blank lines'],
    ['sleep 30 # waiting for the build', 'a wait with a trailing comment'],
    ['sleep 30 | cat', 'a wait piped somewhere'],
    ['sleep 30 > /dev/null', 'a wait with a redirection'],
    ['sleep 30)', 'a wait closing a subshell'],
  ];

  const allowed = [
    ['pytest tests/', 'an ordinary command'],
    ['echo sleep 300', 'the word sleep as an argument'],
    ['sleepy 300', 'a different command that starts with "sleep"'],
    ['sleepfree 30', 'another command sharing the prefix'],
    ['cd project && sleep 60', 'a wait that is not at the start of the command'],
    ["bash -c 'sleep 60'", 'a wait inside a nested shell'],
    ['sleep $DELAY', 'a duration the shell expands, not a number'],
    ['sleep -5', 'a negative duration'],
    ['sleep 10abc', 'a number glued to trailing text'],
    ['sleep 30sfoo', 'a suffix glued to trailing text'],
    ['sleep', 'no duration at all'],
    ['', 'an empty command'],
    ['   ', 'only whitespace'],
    ['nohup sleep 30 &', 'a wait behind another command'],
    ['sudo sleep 30', 'a wait behind a privilege wrapper'],
  ];

  for (const [command, description] of blocked) {
    it(`blocks ${description}`, () => {
      assert.equal(shouldBlock(command), true, command);
    });
  }

  for (const [command, description] of allowed) {
    it(`allows ${description}`, () => {
      assert.equal(shouldBlock(command), false, command);
    });
  }

  it('only considers a command-leading sleep, not later ones', () => {
    assert.equal(shouldBlock('sleep 10; sleep 20'), true);
    assert.equal(shouldBlock('echo hi; sleep 10'), false);
  });

  it('treats a non-string as no command rather than throwing', () => {
    for (const value of [undefined, null, 30, {}, [], true]) {
      assert.equal(shouldBlock(value), false, String(value));
    }
  });
});

describe('commandOf', () => {
  it('reads the command out of parsed bash arguments', () => {
    assert.equal(commandOf({ command: 'ls', description: 'List files' }), 'ls');
  });

  it('reports no command for a shape it does not recognize', () => {
    assert.equal(commandOf(undefined), undefined);
    assert.equal(commandOf(null), undefined);
    assert.equal(commandOf('ls'), undefined);
    assert.equal(commandOf({ command: 30 }), undefined);
    assert.equal(commandOf({}), undefined);
  });
});

describe('plugin contract', () => {
  it('declares the tool registry it hooks into', () => {
    assert.deepEqual(inject, ['tools']);
    assert.equal(name, 'sleep-guard');
  });

  it('tells the agent which mechanism replaces the refused wait', () => {
    assert.match(BLOCK_REASON, /sleep N/u);
    assert.match(BLOCK_REASON, /job_output\(wait=true\)/u);
    assert.match(BLOCK_REASON, /run_in_background/u);
    assert.match(BLOCK_REASON, /timeoutMs/u);
  });

  it('does not tell the agent to use job_output for a job it may not have', () => {
    assert.match(BLOCK_REASON, /Job ID/u);
    assert.match(BLOCK_REASON, /还没启动/u);
  });
});
