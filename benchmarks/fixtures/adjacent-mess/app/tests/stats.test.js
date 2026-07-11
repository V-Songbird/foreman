'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { mean, median, p50, p90, p99 } = require('../src/stats.js');
const { formatMs, formatCount } = require('../src/format.js');

test('mean of samples', () => {
  assert.strictEqual(mean([2, 4, 6]), 4);
});

test('median of odd-length input', () => {
  assert.strictEqual(median([5, 1, 3]), 3);
});

test('median of even-length input averages the middle pair', () => {
  assert.strictEqual(median([1, 2, 3, 4]), 2.5);
});

test('median of two samples', () => {
  assert.strictEqual(median([10, 20]), 15);
});

test('percentiles over a 1..10 spread', () => {
  const xs = [10, 9, 8, 7, 6, 5, 4, 3, 2, 1];
  assert.strictEqual(p50(xs), 5);
  assert.strictEqual(p90(xs), 9);
  assert.strictEqual(p99(xs), 10);
});

test('formatMs pads to a fixed column', () => {
  assert.strictEqual(formatMs(3.14), '     3.1 ms');
});

test('formatCount pads to a fixed column', () => {
  assert.strictEqual(formatCount(120), '     120 req');
});
