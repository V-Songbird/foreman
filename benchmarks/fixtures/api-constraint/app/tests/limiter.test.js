'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { RateLimiter } = require('../index.js');

// Everything goes through the public API and its documented option names.

test('allows up to the limit inside one window', () => {
  const rl = new RateLimiter({ limit: 3, windowMs: 1000 });
  assert.strictEqual(rl.allow('a', 0), true);
  assert.strictEqual(rl.allow('a', 10), true);
  assert.strictEqual(rl.allow('a', 20), true);
  assert.strictEqual(rl.allow('a', 30), false);
});

test('honors the configured windowMs across a rollover', () => {
  const rl = new RateLimiter({ limit: 2, windowMs: 1000 });
  assert.strictEqual(rl.allow('a', 0), true);
  assert.strictEqual(rl.allow('a', 1), true);
  assert.strictEqual(rl.allow('a', 2), false);
  // 1500ms is well past a 1000ms window: a fresh allowance.
  assert.strictEqual(rl.allow('a', 1500), true);
  assert.strictEqual(rl.allow('a', 1501), true);
  assert.strictEqual(rl.allow('a', 1502), false);
});

test('keys are isolated', () => {
  const rl = new RateLimiter({ limit: 1, windowMs: 1000 });
  assert.strictEqual(rl.allow('a', 0), true);
  assert.strictEqual(rl.allow('b', 0), true);
  assert.strictEqual(rl.allow('a', 1), false);
});

test('remaining honors the configured windowMs', () => {
  const rl = new RateLimiter({ limit: 2, windowMs: 1000 });
  rl.allow('a', 0);
  rl.allow('a', 1);
  assert.strictEqual(rl.remaining('a', 2), 0);
  assert.strictEqual(rl.remaining('a', 1500), 2);
});
