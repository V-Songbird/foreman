'use strict';

// The staged close + `Foreman: <id>` commit trailer — the inverse pointer
// that lets a roadmap close land inside its own commit:
//   - update-status staged:true derives touches from the index, stages
//     ROADMAP.jsonl itself, returns the trailer line, and records no sha
//   - staged and commit are mutually exclusive
//   - trailerIdsIn parses trailer lines, not anchor comments or prose
//   - post-commit.js: a done-today entry named by HEAD's trailer gets no
//     follow-up nudge (this commit IS its close); an in_progress entry
//     named by the trailer is tagged as the one this commit completes
//   - task-completed.js decision-log audit resolves trailer-linked commits
//     when commits[] is empty, instead of skipping the anchor check

const { test, describe, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const {
  runScriptRaw,
  runRoadmap,
  makeTmpProject,
  writeRoadmap,
  writeConfig,
  initGitRepo,
} = require('./helpers');

const { trailerIdsIn, commitTrailerFor } = require('../scripts/roadmap');

let project;
let env;

beforeEach(() => {
  project = makeTmpProject();
  env = { CLAUDE_PROJECT_DIR: project };
});

function entry(id, status, extra) {
  return {
    id,
    title: 'ship the thing',
    status,
    why: '',
    what: '',
    notes: '',
    commits: [],
    touches: [],
    depends_on: [],
    ...(extra || {}),
  };
}

function localToday() {
  const d = new Date();
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

function writeFile(rel, content) {
  const full = path.join(project, rel);
  fs.mkdirSync(path.dirname(full), { recursive: true });
  fs.writeFileSync(full, content, 'utf-8');
}

function git(...args) {
  const r = spawnSync('git', args, { cwd: project, encoding: 'utf-8' });
  assert.equal(r.status, 0, `git ${args.join(' ')} failed: ${r.stderr}`);
  return r.stdout;
}

function commitAllWithMessage(message) {
  git('add', '-A');
  git('commit', '-q', '-m', message);
}

describe('update-status staged mode', () => {
  test('staged and commit together is an error', () => {
    writeRoadmap(project, [entry('001', 'in_progress')]);
    const r = runRoadmap(['update-status'], { id: '001', status: 'done', staged: true, commit: 'abc1234' }, env);
    assert.equal(r.status, 1);
    assert.match(JSON.parse(r.stdout).error, /mutually exclusive/);
  });

  test('staged close derives touches from the index, stages the roadmap, returns the trailer', () => {
    initGitRepo(project);
    writeRoadmap(project, [entry('001', 'in_progress')]);
    writeFile('src/thing.js', 'x\n');
    git('add', '-A'); // stages src/thing.js AND ROADMAP.jsonl

    const r = runRoadmap(['update-status'], { id: '001', status: 'done', staged: true }, env);
    assert.equal(r.status, 0, r.stderr);
    const json = JSON.parse(r.stdout);
    assert.equal(json.ok, true);
    assert.equal(json.entry.status, 'done');
    assert.ok(json.entry.touches.includes('src/thing.js'), JSON.stringify(json.entry.touches));
    assert.ok(!json.entry.touches.includes('ROADMAP.jsonl'), 'the roadmap itself is not task footprint');
    assert.deepEqual(json.entry.commits, [], 'a staged close records no sha');
    assert.equal(json.trailer, 'Foreman: 001');
    assert.equal(json.roadmap_staged, true);

    // The rewritten ROADMAP.jsonl is staged, so one commit carries both.
    const staged = git('diff', '--cached', '--name-only');
    assert.ok(staged.split('\n').includes('ROADMAP.jsonl'), staged);
  });

  test('staged close outside a git repo fails soft', () => {
    writeRoadmap(project, [entry('001', 'in_progress')]);
    const r = runRoadmap(['update-status'], { id: '001', status: 'done', staged: true }, env);
    assert.equal(r.status, 0, r.stderr);
    const json = JSON.parse(r.stdout);
    assert.equal(json.ok, true);
    assert.equal(json.entry.status, 'done');
    assert.equal(json.trailer, 'Foreman: 001');
    assert.equal(json.roadmap_staged, false);
    assert.equal(json.derived_touches, undefined);
  });
});

describe('trailer parsing', () => {
  test('parses single and multi-id trailer lines, first-seen order, deduped', () => {
    assert.deepEqual(trailerIdsIn('fix the bug\n\nForeman: 042'), ['042']);
    assert.deepEqual(trailerIdsIn('msg\n\nForeman: 041, 042\nForeman: 042'), ['041', '042']);
  });

  test('ignores anchor comments, inline mentions, and non-3-digit ids', () => {
    assert.deepEqual(trailerIdsIn('code has [Foreman: 042] anchors'), []);
    assert.deepEqual(trailerIdsIn('see Foreman: 042 for details, mid-sentence'), []);
    assert.deepEqual(trailerIdsIn('Foreman: 1042'), []);
    assert.deepEqual(trailerIdsIn(''), []);
  });

  test('commitTrailerFor produces the line trailerIdsIn parses', () => {
    assert.deepEqual(trailerIdsIn(`subject\n\n${commitTrailerFor('007')}`), ['007']);
  });
});

describe('post-commit.js trailer behavior', () => {
  function bashPayload(command) {
    return { tool_name: 'Bash', tool_input: { command } };
  }

  function runHook() {
    const result = runScriptRaw('post-commit.js', bashPayload('git commit -m "wip"'), env);
    assert.equal(result.status, 0, result.stderr);
    return result.stdout;
  }

  test('a done-today entry named by HEAD trailer gets no follow-up nudge', () => {
    initGitRepo(project);
    writeConfig(project, { discoverySuggestions: false });
    writeRoadmap(project, [entry('001', 'done', { updated_at: localToday() })]);
    writeFile('src/thing.js', 'x\n');
    commitAllWithMessage('task 1/1: ship the thing\n\nForeman: 001');
    assert.equal(runHook(), '');
  });

  test('a done-today entry NOT named by HEAD trailer still nudges', () => {
    initGitRepo(project);
    writeConfig(project, { discoverySuggestions: false });
    writeRoadmap(project, [entry('001', 'done', { updated_at: localToday() })]);
    writeFile('src/thing.js', 'x\n');
    commitAllWithMessage('unrelated later work');
    assert.match(runHook(), /follow-up fix/);
  });

  test('an in_progress entry named by HEAD trailer is tagged as the one', () => {
    initGitRepo(project);
    writeConfig(project, { discoverySuggestions: false });
    writeRoadmap(project, [entry('001', 'in_progress')]);
    writeFile('src/thing.js', 'x\n');
    commitAllWithMessage('finish it\n\nForeman: 001');
    assert.match(runHook(), /named in this commit's Foreman: trailer/);
  });
});

describe('task-completed.js decision-log audit resolves trailer commits', () => {
  const MARKER = 'This task is ROADMAP.jsonl entry `001`. Mark it in_progress before doing anything else.';

  function runHook(sessionId) {
    const result = runScriptRaw(
      'task-completed.js',
      {
        hook_event_name: 'TaskCompleted',
        session_id: sessionId,
        task_id: '1',
        task_subject: 'Do the thing',
        task_description: MARKER,
      },
      env
    );
    assert.equal(result.status, 0, result.stderr);
    return result.stdout;
  }

  function dlSetup(doc) {
    initGitRepo(project);
    writeConfig(project, { decisionLog: { enabled: true, gate: 'nudge' } });
    writeFile('docs/foreman/001.md', '# decision\n');
    writeRoadmap(project, [entry('001', 'done', { doc })]);
  }

  test('a staged close whose trailer commit carries the anchor is compliant', () => {
    dlSetup('docs/foreman/001.md');
    writeFile('src/thing.js', 'code(); // [Foreman: 001]\n');
    commitAllWithMessage('close it\n\nForeman: 001');
    assert.equal(runHook('session-trailer-ok'), '');
  });

  test('a staged close whose trailer commit lacks the anchor is flagged', () => {
    dlSetup('docs/foreman/001.md');
    writeFile('src/thing.js', 'code();\n');
    commitAllWithMessage('close it\n\nForeman: 001');
    assert.match(runHook('session-trailer-miss'), /anchor comment/);
  });

  test('empty commits and no trailer commit stays an investigation-only pass', () => {
    dlSetup('docs/foreman/001.md');
    writeFile('src/thing.js', 'code();\n');
    commitAllWithMessage('no trailer here');
    assert.equal(runHook('session-no-trailer'), '');
  });
});
