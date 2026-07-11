'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { tokenize } = require('../index.js');

test('strips punctuation off words', () => {
  assert.deepStrictEqual(tokenize('Hello, world!'), ['hello', 'world']);
});

test('lowercases everything', () => {
  assert.deepStrictEqual(tokenize('Foo BAR baz'), ['foo', 'bar', 'baz']);
});

test('keeps apostrophes inside words', () => {
  assert.deepStrictEqual(tokenize("Don't panic"), ["don't", 'panic']);
});

test('whitespace-only input gives no tokens', () => {
  assert.deepStrictEqual(tokenize('   '), []);
});

test('collapses runs of separators', () => {
  assert.deepStrictEqual(tokenize('one -- two ... three'), ['one', 'two', 'three']);
});
