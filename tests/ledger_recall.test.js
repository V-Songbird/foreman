'use strict';

// Tests for hooks/ledger-recall.js — PostToolUse hook that surfaces a
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
//   - a project with no ROADMAP.jsonl -> silence, anchors or not

const { test, describe, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const { spawnSync } = require('child_process');
const { runScriptRaw, makeTmpProject, writeConfig, writeRoadmap, initGitRepo } = require('./helpers');
const ledger = require(path.join(__dirname, '..', 'scripts', 'ledger.js'));
const anchors = require(path.join(__dirname, '..', 'hooks', 'ledger-recall.js'));

let project;
let env;

beforeEach(() => {
  project = makeTmpProject();
  writeRoadmap(project, []);
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
  const result = runScriptRaw('ledger-recall.js', body, env);
  assert.equal(result.status, 0, result.stderr);
  return result.stdout;
}

describe('ledger-recall hook', () => {
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

  test('no decision-log dir at all writes zero bytes, anchors or not', () => {
    const target = writeFile('src/thing.js', '// [Foreman: 025]\n');
    const out = run(payload(target, { session_id: 's-nodir' }));
    assert.equal(out, '');
  });

  test('anchors surface again once the decision-log dir exists — the skip latches nothing', () => {
    const target = writeFile('src/thing.js', '// [Foreman: 026]\n');
    assert.equal(run(payload(target, { session_id: 's-redir' })), '');
    writeFile('docs/foreman/026.md', '# decision');
    const out = run(payload(target, { session_id: 's-redir' }));
    assert.match(out, /026\.md/);
  });

  test('a project with no ROADMAP.jsonl writes zero bytes', () => {
    const target = writeFile('src/thing.js', '// [Foreman: 024]\n');
    writeFile('docs/foreman/024.md', '# decision');
    fs.rmSync(path.join(project, 'ROADMAP.jsonl'));
    assert.equal(run(payload(target, { session_id: 's-bare' })), '');
  });
});

// [Foreman: 928] Codex 0.157.1 reads files through Bash. Its PostToolUse
// payload (probe 328) carries tool_input {command} and the command output as
// a plain string in tool_response, with no path field.
describe('ledger-recall hook, Codex Bash output', () => {
  function bash(output, extra) {
    return {
      hook_event_name: 'PostToolUse',
      tool_name: 'Bash',
      tool_input: { command: 'cat notes.txt' },
      tool_response: output,
      ...(extra || {}),
    };
  }

  test('an anchor in the output names its decision doc', () => {
    writeFile('docs/foreman/019.md', '# decision');
    const out = run(bash('notes\n// [Foreman: 019]\nmore\n', { session_id: 's-bash' }));
    const context = JSON.parse(out).hookSpecificOutput.additionalContext;
    assert.match(context, /^This command's output carries decision docs \(docs\/foreman\/019\.md\)/);
  });

  test('an anchor with no doc, or no anchor, stays silent', () => {
    writeFile('docs/foreman/019.md', '# decision');
    assert.equal(run(bash('// [Foreman: 031]\n', { session_id: 's-bash-none' })), '');
    assert.equal(run(bash('plain output\n', { session_id: 's-bash-none' })), '');
  });

  test('the same anchors in the same session say it once', () => {
    writeFile('docs/foreman/019.md', '# decision');
    assert.notEqual(run(bash('[Foreman: 019]', { session_id: 's-bash-latch' })), '');
    assert.equal(run(bash('again [Foreman: 019]', { session_id: 's-bash-latch' })), '');
  });

  test('a response that is not a string stays silent', () => {
    writeFile('docs/foreman/019.md', '# decision');
    assert.equal(run(bash({ stdout: '[Foreman: 019]' }, { session_id: 's-bash-object' })), '');
  });

  test('the output names no file, so no lesson is served', () => {
    writeConfig(project, { areaNotes: { enabled: true } });
    writeFile('notes.txt', 'plain\n');
    ledger.append(project, { lesson: 'a claim', paths: ['notes.txt'], entry: '042', anchor: { kind: 'none' }, date: '2026-08-01' });
    assert.equal(run(bash('plain\n', { session_id: 's-bash-lesson' })), '');
  });
});

// [Foreman: 247] The second channel: a file with a lesson recorded about it
// surfaces that lesson at the moment it is touched, on the same hook and under
// the same once-per-session latch.
describe('ledger-recall hook, the lesson channel', () => {
  function recordLesson(relPath, lesson, overrides) {
    return ledger.append(project, {
      lesson,
      paths: [relPath],
      entry: '042',
      anchor: { kind: 'none' },
      date: '2026-08-01',
      ...(overrides || {}),
    });
  }

  // [Foreman: 525] An unanchored lesson cannot be checked, so the hook serves
  // what the handoff serves: the file names only, never the claim.
  test('an unanchored lesson is served as its file names, with its freshness label', () => {
    writeConfig(project, { areaNotes: { enabled: true } });
    const target = writeFile('src/parser.js', 'module.exports = {};\n');
    recordLesson('src/parser.js', 'punctuation is handled only in the word split');

    const out = run(payload(target, { session_id: 's-lesson' }));
    assert.doesNotMatch(out, /punctuation is handled only in the word split/);
    assert.match(out, /- src\/parser\.js \[entry 042, 2026-08-01 — anchor unresolvable, staleness unknown\]/);
    assert.match(out, /Recorded about src\/parser\.js/);
    // Never a bare claim: the ledger's rule is that every served line says how
    // stale it is, and this channel is not an exception to it.
    assert.match(out, /entry 042/);
  });

  test('says nothing when areaNotes is off, however many lessons the store holds', () => {
    const target = writeFile('src/parser.js', 'module.exports = {};\n');
    recordLesson('src/parser.js', 'punctuation is handled only in the word split');
    assert.equal(run(payload(target, { session_id: 's-off' })), '');
  });

  test('says nothing when no lesson names this file', () => {
    writeConfig(project, { areaNotes: { enabled: true } });
    const target = writeFile('src/parser.js', 'module.exports = {};\n');
    writeFile('src/other.js', 'module.exports = {};\n');
    recordLesson('src/other.js', 'unrelated');
    assert.equal(run(payload(target, { session_id: 's-nomatch' })), '');
  });

  test('matches the file exactly, never the folder it sits in', () => {
    writeConfig(project, { areaNotes: { enabled: true } });
    const target = writeFile('src/parser.js', 'module.exports = {};\n');
    recordLesson('src', 'something about the whole folder');
    assert.equal(run(payload(target, { session_id: 's-folder' })), '');
  });

  test('a retired lesson is not surfaced', () => {
    writeConfig(project, { areaNotes: { enabled: true } });
    const target = writeFile('src/parser.js', 'module.exports = {};\n');
    recordLesson('src/parser.js', 'this one proved wrong');
    const [stored] = ledger.read(project).records;
    ledger.supersede(project, { key: ledger.recordKey(stored), date: '2026-08-19' });
    assert.equal(run(payload(target, { session_id: 's-retired' })), '');
  });

  test('serves at most NOTE_LIMIT lessons, newest first', () => {
    writeConfig(project, { areaNotes: { enabled: true } });
    const target = writeFile('src/parser.js', 'module.exports = {};\n');
    recordLesson('src/parser.js', 'oldest claim', { date: '2026-07-01' });
    recordLesson('src/parser.js', 'middle claim', { date: '2026-07-15' });
    recordLesson('src/parser.js', 'newest claim', { date: '2026-08-01' });

    const out = run(payload(target, { session_id: 's-cap' }));
    assert.match(out, /entry 042, 2026-08-01/);
    assert.match(out, /entry 042, 2026-07-15/);
    assert.doesNotMatch(out, /entry 042, 2026-07-01/);
    assert.equal(anchors.NOTE_LIMIT, 2);
  });

  test('both channels ride one message when a file has a doc and a lesson', () => {
    writeConfig(project, { areaNotes: { enabled: true } });
    const target = writeFile('src/parser.js', '// [Foreman: 019]\n');
    writeFile('docs/foreman/019.md', '# decision');
    recordLesson('src/parser.js', 'punctuation is handled only in the word split');

    const out = run(payload(target, { session_id: 's-both' }));
    assert.match(out, /019\.md/);
    assert.match(out, /- src\/parser\.js \[entry 042/);
  });

  // [Foreman: 525] The handoff's graded rule on the file-open path too: a
  // possibly-stale lesson whose own prose names the file that changed under it
  // is not served; one that does not name it is served with its hedge.
  test('a possibly-stale lesson that names its changed file is not served', () => {
    const git = (...args) => {
      const r = spawnSync('git', args, { cwd: project, encoding: 'utf-8' });
      assert.equal(r.status, 0, r.stderr);
      return r.stdout;
    };
    writeConfig(project, { areaNotes: { enabled: true } });
    initGitRepo(project);
    const target = writeFile('src/parser.js', 'module.exports = {};\n');
    git('add', '-A');
    git('commit', '-q', '-m', 'base');
    const sha = git('rev-parse', 'HEAD').trim();
    recordLesson('src/parser.js', 'src/parser.js keeps the word split', { anchor: { kind: 'commit', sha } });
    recordLesson('src/parser.js', 'punctuation is handled only in the word split', { anchor: { kind: 'commit', sha }, date: '2026-08-02' });
    fs.writeFileSync(target, 'module.exports = { changed: true };\n');
    git('commit', '-q', '-a', '-m', 'change the parser');

    const out = run(payload(target, { session_id: 's-graded' }));
    assert.match(out, /- punctuation is handled only in the word split \[entry 042, 2026-08-02, at [0-9a-f]{7} — possibly stale/);
    assert.doesNotMatch(out, /keeps the word split/);
  });

  // [Foreman: 681] A hand-edited lesson carrying a hidden character is dropped;
  // the clean one beside it still serves.
  test('a lesson carrying a character a reader cannot see is not served', () => {
    writeConfig(project, { areaNotes: { enabled: true } });
    const target = writeFile('src/parser.js', 'module.exports = {};\n');
    recordLesson('src/parser.js', 'the clean claim', { entry: '043', date: '2026-08-02' });
    recordLesson('src/parser.js', 'hidden', { entry: `044${String.fromCodePoint(0x200b)}`, date: '2026-08-03' });

    const out = run(payload(target, { session_id: 's-hidden' }));
    assert.match(out, /- src\/parser\.js \[entry 043, 2026-08-02/);
    assert.doesNotMatch(out, /entry 044/);
  });

  test('the same file in the same session says it once', () => {
    writeConfig(project, { areaNotes: { enabled: true } });
    const target = writeFile('src/parser.js', 'module.exports = {};\n');
    recordLesson('src/parser.js', 'punctuation is handled only in the word split');
    assert.notEqual(run(payload(target, { session_id: 's-latch' })), '');
    assert.equal(run(payload(target, { session_id: 's-latch' })), '');
  });

  test('a store that will not parse is silence, never a crash', () => {
    writeConfig(project, { areaNotes: { enabled: true } });
    const target = writeFile('src/parser.js', 'module.exports = {};\n');
    recordLesson('src/parser.js', 'punctuation is handled only in the word split');
    fs.appendFileSync(ledger.notesPath(project), '<<<<<<< HEAD\n');
    assert.equal(run(payload(target, { session_id: 's-broken' })), '');
  });
});
