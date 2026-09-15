'use strict';

// Tests for hooks/guard-roadmap-edit.js — PreToolUse gate blocking direct
// Edit/Write of ROADMAP.jsonl so all writes go through scripts/roadmap.js.
//
// Covers:
//   - Edit/Write of a path basename ROADMAP.jsonl (any case) gets denied
//   - Edit/Write of anything else (including .foreman/config.json) is silent
//   - non-Edit/Write tools (e.g. Bash) are never even inspected — the
//     escape hatch for genuine corrupt-file repair stays open
//   - the denial names every mutation command roadmap.js's dispatcher
//     actually accepts, not a stale subset
//   - a project with no ROADMAP.jsonl gets zero bytes, whatever is edited
//   - archive.jsonl only counts inside this project's own .foreman directory

const { test, describe, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

const { runScriptRaw, makeTmpProject, writeRoadmap } = require('./helpers');

let project;

beforeEach(() => {
  project = makeTmpProject();
  writeRoadmap(project, []);
});

function run(payload, root = project) {
  const result = runScriptRaw('guard-roadmap-edit.js', payload, { CLAUDE_PROJECT_DIR: root });
  assert.equal(result.status, 0, result.stderr);
  return result.stdout;
}

function inProject(...segments) {
  return path.join(project, ...segments);
}

describe('blocks direct edits to ROADMAP.jsonl', () => {
  test('Edit is denied', () => {
    const out = run({ tool_name: 'Edit', tool_input: { file_path: inProject('ROADMAP.jsonl') } });
    const payload = JSON.parse(out);
    assert.equal(payload.hookSpecificOutput.permissionDecision, 'deny');
    assert.match(payload.hookSpecificOutput.permissionDecisionReason, /roadmap\.js/);
  });

  test('Write is denied', () => {
    const out = run({ tool_name: 'Write', tool_input: { file_path: inProject('ROADMAP.jsonl') } });
    const payload = JSON.parse(out);
    assert.equal(payload.hookSpecificOutput.permissionDecision, 'deny');
  });

  // roadmap.js's dispatcher (see its `main` switch / "unknown subcommand"
  // error) accepts: add, update-status, annotate, update-deps, correct,
  // reassign-id, archive, restore, list, next-candidates, check-duplicate,
  // doctor, migrate. A session blocked here has to be pointed at all of
  // them, not a stale subset — a fix for a stale entry needs "correct" in
  // this list to find its way there at all.
  test('names every mutation command the CLI actually accepts', () => {
    const out = run({ tool_name: 'Edit', tool_input: { file_path: inProject('ROADMAP.jsonl') } });
    const { permissionDecisionReason } = JSON.parse(out).hookSpecificOutput;
    for (const command of [
      'add', 'update-status', 'annotate', 'update-deps', 'correct',
      'reassign-id', 'archive', 'restore', 'list', 'next-candidates',
      'check-duplicate', 'doctor', 'migrate',
    ]) {
      assert.match(permissionDecisionReason, new RegExp(`(^|\\W)${command}(\\W|$)`));
    }
  });

  test('matches regardless of path prefix, only the basename matters', () => {
    const out = run({ tool_name: 'Edit', tool_input: { file_path: '/some/deep/nested/path/ROADMAP.jsonl' } });
    const payload = JSON.parse(out);
    assert.equal(payload.hookSpecificOutput.permissionDecision, 'deny');
  });

  test('case-insensitive basename match', () => {
    const out = run({ tool_name: 'Edit', tool_input: { file_path: inProject('roadmap.JSONL') } });
    const payload = JSON.parse(out);
    assert.equal(payload.hookSpecificOutput.permissionDecision, 'deny');
  });
});

describe('leaves everything else alone', () => {
  test('Edit of an unrelated file stays silent', () => {
    const out = run({ tool_name: 'Edit', tool_input: { file_path: inProject('src', 'foo.ts') } });
    assert.equal(out, '');
  });

  test('Write of .foreman/config.json stays silent — that file has no CLI path', () => {
    const out = run({ tool_name: 'Write', tool_input: { file_path: inProject('.foreman', 'config.json') } });
    assert.equal(out, '');
  });

  test('a filename that merely contains "roadmap" is not a match', () => {
    const out = run({ tool_name: 'Edit', tool_input: { file_path: inProject('docs', 'roadmap-notes.md') } });
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

// The lesson ledger is CLI-owned on exactly the archive's terms: the append
// rides the close's lock and carries a format marker and a hard length
// refusal, none of which a hand edit honors. The name is generic, so only
// this project's own copy is Foreman's to deny.
describe('the lesson ledger is guarded on the same terms as the archive', () => {
  test('editing this project\'s .foreman/notes.jsonl is denied', () => {
    const out = run({ tool_name: 'Edit', tool_input: { file_path: inProject('.foreman', 'notes.jsonl') } });
    const payload = JSON.parse(out);
    assert.equal(payload.hookSpecificOutput.permissionDecision, 'deny');
  });

  test('the denial names how to write and how to read the store', () => {
    const out = run({ tool_name: 'Write', tool_input: { file_path: inProject('.foreman', 'notes.jsonl') } });
    const { permissionDecisionReason } = JSON.parse(out).hookSpecificOutput;
    assert.match(permissionDecisionReason, /"lesson"/);
    assert.match(permissionDecisionReason, /update-status/);
    assert.match(permissionDecisionReason, /(^|\W)notes(\W|$)/);
  });

  test('some other tool\'s notes.jsonl elsewhere is not Foreman\'s to deny', () => {
    const out = run({ tool_name: 'Edit', tool_input: { file_path: inProject('vendor', 'notes.jsonl') } });
    assert.equal(out, '');
  });
});

describe('a project with no roadmap is not Foreman\'s to talk in', () => {
  test('editing ROADMAP.jsonl in an uninitialized project writes zero bytes', () => {
    const bare = makeTmpProject();
    const out = run(
      { tool_name: 'Edit', tool_input: { file_path: path.join(bare, 'ROADMAP.jsonl') } },
      bare
    );
    assert.equal(out, '');
  });
});
