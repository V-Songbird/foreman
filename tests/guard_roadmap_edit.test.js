'use strict';

// Tests for hooks/guard-roadmap-edit.js — PreToolUse gate blocking direct
// Edit/Write of ROADMAP.jsonl so all writes go through scripts/roadmap.js.
//
// Covers:
//   - Edit/Write of a path basename ROADMAP.jsonl (any case) gets denied
//   - Edit/Write of anything else (including .foreman/config.json) is silent
//   - non-Edit/Write tools (e.g. Bash) are never even inspected — the
//     escape hatch for genuine corrupt-file repair stays open

const { test, describe } = require('node:test');
const assert = require('node:assert/strict');

const { runScriptRaw } = require('./helpers');

function run(payload) {
  const result = runScriptRaw('guard-roadmap-edit.js', payload, {});
  assert.equal(result.status, 0, result.stderr);
  return result.stdout;
}

describe('blocks direct edits to ROADMAP.jsonl', () => {
  test('Edit is denied', () => {
    const out = run({ tool_name: 'Edit', tool_input: { file_path: 'D:/project/ROADMAP.jsonl' } });
    const payload = JSON.parse(out);
    assert.equal(payload.hookSpecificOutput.permissionDecision, 'deny');
    assert.match(payload.hookSpecificOutput.permissionDecisionReason, /roadmap\.js/);
  });

  test('Write is denied', () => {
    const out = run({ tool_name: 'Write', tool_input: { file_path: 'D:/project/ROADMAP.jsonl' } });
    const payload = JSON.parse(out);
    assert.equal(payload.hookSpecificOutput.permissionDecision, 'deny');
  });

  test('matches regardless of path prefix, only the basename matters', () => {
    const out = run({ tool_name: 'Edit', tool_input: { file_path: '/some/deep/nested/path/ROADMAP.jsonl' } });
    const payload = JSON.parse(out);
    assert.equal(payload.hookSpecificOutput.permissionDecision, 'deny');
  });

  test('case-insensitive basename match', () => {
    const out = run({ tool_name: 'Edit', tool_input: { file_path: 'D:/project/roadmap.JSONL' } });
    const payload = JSON.parse(out);
    assert.equal(payload.hookSpecificOutput.permissionDecision, 'deny');
  });
});

describe('leaves everything else alone', () => {
  test('Edit of an unrelated file stays silent', () => {
    const out = run({ tool_name: 'Edit', tool_input: { file_path: 'D:/project/src/foo.ts' } });
    assert.equal(out, '');
  });

  test('Write of .foreman/config.json stays silent — that file has no CLI path', () => {
    const out = run({ tool_name: 'Write', tool_input: { file_path: 'D:/project/.foreman/config.json' } });
    assert.equal(out, '');
  });

  test('a filename that merely contains "roadmap" is not a match', () => {
    const out = run({ tool_name: 'Edit', tool_input: { file_path: 'D:/project/docs/roadmap-notes.md' } });
    assert.equal(out, '');
  });

  test('Bash is not a watched tool — repairing a corrupt file stays possible', () => {
    const out = run({ tool_name: 'Bash', tool_input: { command: 'echo fix > ROADMAP.jsonl' } });
    assert.equal(out, '');
  });

  test('missing file_path stays silent', () => {
    const out = run({ tool_name: 'Edit', tool_input: {} });
    assert.equal(out, '');
  });
});
