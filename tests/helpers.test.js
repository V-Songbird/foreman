'use strict';

// [Foreman: 499] runNodeScript's spawn limit is 90 s unless the suite runs
// with FOREMAN_TEST_SPAWN_TIMEOUT_MS set higher; a lower value never applies.

const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const HELPERS = path.join(__dirname, 'helpers.js');

// The limit is read when helpers.js loads, so each value needs its own process.
function limit(value) {
  const env = { ...process.env };
  delete env.FOREMAN_TEST_SPAWN_TIMEOUT_MS;
  if (value !== undefined) env.FOREMAN_TEST_SPAWN_TIMEOUT_MS = value;
  const probe = spawnSync(process.execPath, ['-e', `process.stdout.write(String(require(${JSON.stringify(HELPERS)}).SPAWN_TIMEOUT_MS))`], {
    encoding: 'utf-8',
    env,
  });
  assert.equal(probe.status, 0, probe.stderr);
  return Number(probe.stdout);
}

test('runNodeScript waits 90 s unless the environment raises it', () => {
  assert.equal(limit(undefined), 90000);
  assert.equal(limit('30000'), 90000);
  assert.equal(limit('not a number'), 90000);
  assert.equal(limit('120000'), 120000);
});

// [Foreman: 568] A hung child names itself and the limit when it is killed.
test('a child killed at its limit fails with a message naming it', () => {
  const { unlessTimedOut } = require(HELPERS);
  const hung = spawnSync(process.execPath, ['-e', 'setTimeout(() => {}, 10000)'], { timeout: 200 });
  assert.throws(() => unlessTimedOut(hung, 'hang.js', 200), /^Error: hang\.js timed out after 200 ms$/);
  const done = spawnSync(process.execPath, ['-e', '']);
  assert.equal(unlessTimedOut(done, 'noop.js'), done);
});
