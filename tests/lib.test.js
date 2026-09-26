'use strict';

// Tests for hooks/lib.js readInput — the stdin reader every hook's main()
// starts from. Anything that is not a plain JSON object must come back as {},
// so a hook takes its empty-payload path instead of throwing on a property read.

const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');

const { runNodeScript } = require('./helpers');

const READ = `process.stdout.write(JSON.stringify(require(${JSON.stringify(
  path.join(__dirname, '..', 'hooks', 'lib.js')
)}).readInput()))`;

function readInputOf(stdin) {
  const res = runNodeScript('-e', [READ], stdin);
  assert.equal(res.status, 0, res.stderr);
  return JSON.parse(res.stdout);
}

test('readInput returns a JSON object payload as parsed', () => {
  assert.deepEqual(readInputOf('{"tool_name":"Bash"}'), { tool_name: 'Bash' });
});

test('readInput returns {} for a payload that is not a plain object', () => {
  for (const stdin of ['null', '42', '"text"', 'true', '[1,2]', '', 'not json']) {
    assert.deepEqual(readInputOf(stdin), {}, JSON.stringify(stdin));
  }
});
