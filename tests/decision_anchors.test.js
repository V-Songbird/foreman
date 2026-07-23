'use strict';

// Tests for hooks/decision-anchors.js — PostToolUse hook that surfaces a
// touched file's decision-log docs (ADRs anchored via `[Foreman: 019]`
// comments) as additionalContext, once per session per file per id-set.
//
// Covers:
//   - anchored file with an existing doc -> context emitted, doc path listed
//   - anchor with no matching doc file -> silence (stray bracket text)
//   - no anchors at all -> silence
//   - missing tool_input.file_path -> silence
//   - target file missing on disk -> silence
//   - custom decisionLog.dir from config is honored
//   - repeat Read of the same unchanged anchor set, same session -> latched silent
//   - a different session id still emits

const { test, describe, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const { runScriptRaw, makeTmpProject, writeConfig } = require('./helpers');

let project;
let env;

beforeEach(() => {
  project = makeTmpProject();
  env = { CLAUDE_PROJECT_DIR: project };
});

function writeFile(relPath, content) {
  const full = path.join(project, relPath);
  fs.mkdirSync(path.dirname(full), { recursive: true });
  fs.writeFileSync(full, content, 'utf-8');
  return full;
}

function payload(filePath, extra) {
  return { tool_name: 'Read', tool_input: { file_path: filePath }, ...(extra || {}) };
}

function run(body) {
  const result = runScriptRaw('decision-anchors.js', body, env);
  assert.equal(result.status, 0, result.stderr);
  return result.stdout;
}

describe('decision-anchors hook', () => {
  test('anchored file with an existing doc emits context listing the doc path', () => {
    const target = writeFile('src/thing.js', '// [Foreman: 019]\nconsole.log(1);\n');
    writeFile('docs/foreman/019.md', '# decision');
    const out = run(payload(target, { session_id: 's1' }));
    assert.match(out, /hookSpecificOutput/);
    assert.match(out, /docs\/foreman\/019\.md/);
  });

  test('anchor with no matching doc file stays silent', () => {
    const target = writeFile('src/thing.js', '// [Foreman: 020]\n');
    const out = run(payload(target, { session_id: 's1' }));
    assert.equal(out, '');
  });

  test('no anchors at all stays silent', () => {
    const target = writeFile('src/thing.js', 'console.log(1);\n');
    const out = run(payload(target, { session_id: 's1' }));
    assert.equal(out, '');
  });

  test('missing tool_input.file_path stays silent', () => {
    const out = run({ tool_name: 'Read', tool_input: {} });
    assert.equal(out, '');
  });

  test('target file missing on disk stays silent', () => {
    const missing = path.join(project, 'src', 'ghost.js');
    const out = run(payload(missing, { session_id: 's1' }));
    assert.equal(out, '');
  });

  test('custom decisionLog.dir from config is honored', () => {
    const target = writeFile('src/thing.js', '// [Foreman: 021]\n');
    writeFile('adr/021.md', '# decision');
    writeConfig(project, { decisionLog: { dir: 'adr' } });
    const out = run(payload(target, { session_id: 's1' }));
    assert.match(out, /adr\/021\.md/);
  });

  test('a repeat Read of the same unchanged anchor set, same session, stays silent', () => {
    const target = writeFile('src/thing.js', '// [Foreman: 022]\n');
    writeFile('docs/foreman/022.md', '# decision');
    const first = run(payload(target, { session_id: 's-latch' }));
    assert.match(first, /022\.md/);
    const second = run(payload(target, { session_id: 's-latch' }));
    assert.equal(second, '');
  });

  test('a different session id still emits', () => {
    const target = writeFile('src/thing.js', '// [Foreman: 023]\n');
    writeFile('docs/foreman/023.md', '# decision');
    run(payload(target, { session_id: 's-a' }));
    const out = run(payload(target, { session_id: 's-b' }));
    assert.match(out, /023\.md/);
  });
});
