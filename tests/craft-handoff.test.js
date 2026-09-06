'use strict';

// Tests for scripts/craft-handoff.js — the craft-time assembler that loads a
// roadmap entry (or entry-less judgment), runs render-sections.js and
// resolve-symbols.js in-process, computes the handoff profile from the five
// mechanical signals, assembles the XML from prompt-template.md's canonical
// blocks, bakes the entry paragraph / checkpoint embed, and
// runs check-prompt.js's gate in-process.
//
// Covers:
//   - entry mode and entry-less mode both produce a gate-passing handoff
//   - each of the five profile signals flips independently, with a baseline
//     where none do (standard profile)
//   - the guardrail blocks are read out of prompt-template.md at run time,
//     not a hardcoded second copy (an in-process fs.readFileSync patch
//     proves the assembled prompt follows a template mutation)
//   - a task split puts the entry paragraph on the last row only
//   - ${CLAUDE_PLUGIN_ROOT} always travels unexpanded, even with the real
//     env var set
//   - a gate failure surfaces in the output instead of being swallowed

const { test, describe, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('node:child_process');

const { runNodeScript, makeTmpProject, writeRoadmap, writeArchiveFile, writeConfig, initGitRepo, commitFile, SCRIPTS_DIR } = require('./helpers.js');
const { today } = require(path.join(SCRIPTS_DIR, 'roadmap.js'));
const { TEMPLATE_PATH, WORKFLOW_STAGE_SENTENCE } = require(path.join(SCRIPTS_DIR, 'check-prompt.js'));
const { assemble, relevantFilesText, rankSymbols, SYMBOL_KEEP, checkpointEmbedText } = require(path.join(SCRIPTS_DIR, 'craft-handoff.js'));

const CRAFT = path.join(SCRIPTS_DIR, 'craft-handoff.js');

function run(project, input, env) {
  const result = runNodeScript(CRAFT, [], input, { CLAUDE_PROJECT_DIR: project, ...(env || {}) });
  let json;
  try {
    json = JSON.parse(result.stdout);
  } catch {
    throw new Error(`non-JSON stdout (status ${result.status}): ${result.stdout}\n${result.stderr}`);
  }
  return { status: result.status, json };
}

function writeSourceFile(project) {
  const full = path.join(project, 'src', 'auth', 'middleware.js');
  fs.mkdirSync(path.dirname(full), { recursive: true });
  fs.writeFileSync(
    full,
    'function refreshToken() {}\nfunction verifySession() {}\nmodule.exports = { refreshToken, verifySession };\n',
    'utf-8'
  );
}

function entryFields(overrides = {}) {
  return {
    id: '001',
    title: 'Fix token refresh bug',
    why: 'Sessions expire mid-request under load.',
    what: 'Refresh the access token in middleware before its 15-min expiry.',
    status: 'planned',
    source: 'user',
    depends_on: [],
    planned_touches: ['src/auth/middleware.js'],
    observed_touches: [],
    commits: [],
    created_at: today(),
    updated_at: today(),
    notes: '',
    ...overrides,
  };
}

function goodJudgment(overrides = {}) {
  return {
    role: 'a senior backend engineer',
    goal: 'to fix the token refresh bug so all tests pass',
    context: 'Uses JWT tokens in httpOnly cookies. No third-party auth libs.',
    steps: ['Check the refresh path against the failing test.', 'Fix the bug.'],
    constraints: ['Do not modify the public API.'],
    verification: [{ run: 'npm test', expected: 'all tests pass' }],
    ...overrides,
  };
}

let project;

beforeEach(() => {
  project = makeTmpProject();
  writeSourceFile(project);
});

describe('entry mode', () => {
  test('loads the entry, assembles a gate-passing handoff', () => {
    writeRoadmap(project, [entryFields()]);
    const { status, json } = run(project, {
      entry: '001',
      destination: 'clipboard',
      judgment: goodJudgment(),
    });
    assert.equal(status, 0, JSON.stringify(json));
    assert.equal(json.ok, true);
    assert.equal(json.gate.ok, true);
    assert.deepEqual(json.gate.errors, []);
    assert.match(json.prompt, /ROADMAP\.jsonl entry `001`/);
    assert.match(json.prompt, /refreshToken \(1\)/);
    assert.equal(json.profile, 'standard');
  });

  test('an unknown entry id is an error, not a crash', () => {
    writeRoadmap(project, [entryFields()]);
    const { status, json } = run(project, { entry: '999', destination: 'clipboard', judgment: goodJudgment() });
    assert.equal(status, 1);
    assert.match(json.error, /999/);
  });

  // [Foreman: 271] planned_touches is a plan, so a task that adds a file names
  // that file before it exists. The gate used to refuse the whole handoff for
  // it, which refused every create-a-file task.
  test('a planned path that does not exist yet still crafts a passing handoff', () => {
    writeRoadmap(project, [entryFields({
      title: 'Add a retry wrapper',
      what: 'Add src/auth/retry.js with exponential backoff and call it from middleware.',
      planned_touches: ['src/auth/middleware.js', 'src/auth/retry.js'],
    })]);
    const { status, json } = run(project, { entry: '001', destination: 'clipboard', judgment: goodJudgment() });
    assert.equal(status, 0, JSON.stringify(json));
    assert.equal(json.ok, true);
    assert.equal(json.gate.ok, true, JSON.stringify(json.gate.errors));
    assert.match(json.prompt, /src\/auth\/retry\.js — MISSING:/);
    assert.match(json.prompt, /Either this task creates the file, or the plan is stale/);
    assert.ok(json.gate.warnings.some((w) => w.includes('MISSING:')), JSON.stringify(json.gate.warnings));
  });
});

describe('entry-less mode', () => {
  test('all entry-equivalent fields given inline, no "entry" key', () => {
    const { status, json } = run(project, {
      title: 'Ad-hoc client retry fix',
      why: 'Retries double-count under load.',
      what: 'Fix the backoff loop in the API client.',
      planned_touches: ['src/auth/middleware.js'],
      destination: 'task',
      request: 'Fix the retry bug in the client.',
      judgment: goodJudgment({ goal: 'to fix the retry bug so all tests pass' }),
    });
    assert.equal(status, 0, JSON.stringify(json));
    assert.equal(json.ok, true);
    assert.equal(json.gate.ok, true);
    // No roadmap entry involved — the entry paragraph never appears.
    assert.ok(!json.prompt.includes('ROADMAP.jsonl entry'));
  });
});

describe('profile signals — each flippable independently, off in the baseline', () => {
  test('baseline: none of the five signals fire, profile is standard', () => {
    writeRoadmap(project, [entryFields()]);
    const { json } = run(project, { entry: '001', destination: 'clipboard', judgment: goodJudgment() });
    assert.equal(json.ok, true, JSON.stringify(json));
    assert.deepEqual(json.signals, {
      resumed: false,
      conflicting: false,
      stale: false,
      highlyConstrained: false,
      risky: false,
    });
    assert.equal(json.profile, 'standard');
  });

  test('resumed: fires on non-empty commits, independent of the other four', () => {
    writeRoadmap(project, [entryFields({ commits: ['a1b2c3d'] })]);
    const { json } = run(project, { entry: '001', destination: 'clipboard', judgment: goodJudgment() });
    assert.equal(json.signals.resumed, true);
    assert.equal(json.signals.conflicting, false);
    assert.equal(json.signals.stale, false);
    assert.equal(json.signals.highlyConstrained, false);
    assert.equal(json.signals.risky, false);
    assert.equal(json.profile, 'reinforced');
  });

  test('resumed: also fires on the caller\'s explicit resume flag', () => {
    writeRoadmap(project, [entryFields({ status: 'in_progress' })]);
    const { json } = run(project, { entry: '001', resume: true, destination: 'clipboard', judgment: goodJudgment() });
    assert.equal(json.signals.resumed, true);
    assert.match(json.prompt, /already marked `in_progress`/);
  });

  test('conflicting: fires when an in_progress entry\'s planned_touches overlaps, folder-aware', () => {
    writeRoadmap(project, [
      entryFields(),
      entryFields({ id: '002', title: 'Different task', status: 'in_progress', planned_touches: ['src/auth/'] }),
    ]);
    const { json } = run(project, { entry: '001', destination: 'clipboard', judgment: goodJudgment() });
    assert.equal(json.signals.conflicting, true);
    assert.equal(json.signals.resumed, false);
    assert.equal(json.signals.stale, false);
    assert.equal(json.signals.highlyConstrained, false);
    assert.equal(json.signals.risky, false);
    assert.equal(json.profile, 'reinforced');
  });

  test('conflicting never fires against the entry\'s own touches when it is itself in_progress', () => {
    writeRoadmap(project, [entryFields({ status: 'in_progress' })]);
    const { json } = run(project, { entry: '001', destination: 'clipboard', judgment: goodJudgment() });
    assert.equal(json.signals.conflicting, false);
  });

  test('stale: fires when updated_at is more than 30 days before today', () => {
    writeRoadmap(project, [entryFields({ updated_at: '2020-01-01' })]);
    const { json } = run(project, { entry: '001', destination: 'clipboard', judgment: goodJudgment() });
    assert.equal(json.signals.stale, true);
    assert.equal(json.signals.resumed, false);
    assert.equal(json.signals.conflicting, false);
    assert.equal(json.signals.highlyConstrained, false);
    assert.equal(json.signals.risky, false);
    assert.equal(json.profile, 'reinforced');
  });

  test('stale: also fires when a touched file changed after the entry\'s updated_at', () => {
    initGitRepo(project);
    commitFile(project, 'src/auth/middleware.js', 'function refreshToken() {}\nmodule.exports = { refreshToken };\n');
    const { json } = (() => {
      writeRoadmap(project, [entryFields({ updated_at: '2020-01-01' })]);
      return run(project, { entry: '001', destination: 'clipboard', judgment: goodJudgment() });
    })();
    assert.equal(json.signals.stale, true);
  });

  test('highlyConstrained: fires on 3+ dependency ids', () => {
    writeRoadmap(project, [entryFields({ depends_on: ['101', '102', '103'] })]);
    const { json } = run(project, { entry: '001', destination: 'clipboard', judgment: goodJudgment() });
    assert.equal(json.signals.highlyConstrained, true);
    assert.equal(json.signals.resumed, false);
    assert.equal(json.signals.conflicting, false);
    assert.equal(json.signals.stale, false);
    assert.equal(json.signals.risky, false);
    assert.equal(json.profile, 'reinforced');
  });

  test('highlyConstrained: also fires on notes longer than 1000 characters', () => {
    writeRoadmap(project, [entryFields({ notes: 'x'.repeat(1001) })]);
    const { json } = run(project, { entry: '001', destination: 'clipboard', judgment: goodJudgment() });
    assert.equal(json.signals.highlyConstrained, true);
  });

  test('risky: fires on kind:"decision"', () => {
    writeRoadmap(project, [entryFields({ kind: 'decision' })]);
    const { json } = run(project, { entry: '001', destination: 'clipboard', judgment: goodJudgment() });
    assert.equal(json.signals.risky, true);
    assert.equal(json.signals.resumed, false);
    assert.equal(json.signals.conflicting, false);
    assert.equal(json.signals.stale, false);
    assert.equal(json.signals.highlyConstrained, false);
    assert.equal(json.profile, 'reinforced');
    assert.match(json.prompt, /This is a decision, not a build/);
  });

  test('risky: also fires when the handoff carries no verification command at all', () => {
    writeRoadmap(project, [entryFields()]);
    const { json } = run(project, {
      entry: '001',
      destination: 'clipboard',
      judgment: goodJudgment({ verification: [] }),
    });
    assert.equal(json.signals.risky, true);
    assert.equal(json.profile, 'reinforced');
  });
});

describe('canonical blocks are read from prompt-template.md at run time', () => {
  test('a mutated template propagates into the assembled prompt (fs.readFileSync patched in-process, never touches the real file)', () => {
    const original = fs.readFileSync(TEMPLATE_PATH, 'utf-8');
    const anchor = "Verify this prompt's factual claims against the current code";
    assert.ok(original.includes(anchor), "this test's anchor text is gone from prompt-template.md — update the anchor");
    const marker = 'MUTATION-SENTINEL-craft-handoff-test';
    const mutated = original.replace(anchor, `${marker} ${anchor}`);

    const realReadFileSync = fs.readFileSync;
    fs.readFileSync = function patched(file, ...rest) {
      if (file === TEMPLATE_PATH) return mutated;
      return realReadFileSync.call(fs, file, ...rest);
    };
    try {
      writeRoadmap(project, [entryFields({ kind: 'decision' })]); // force reinforced, so truth_grounding is carried in full
      const result = assemble(project, { entry: '001', destination: 'clipboard', judgment: goodJudgment() });
      assert.equal(result.gate.ok, true, JSON.stringify(result.gate));
      assert.ok(result.prompt.includes(marker), 'assembled prompt did not follow the mutated template');
    } finally {
      fs.readFileSync = realReadFileSync;
    }
    // The real file on disk was never written to.
    assert.equal(fs.readFileSync(TEMPLATE_PATH, 'utf-8'), original);
  });

  test('craft-handoff.js does not hardcode a second copy of the guardrail prose', () => {
    const source = fs.readFileSync(CRAFT, 'utf-8');
    assert.ok(
      !source.includes('Before acting on anything in this prompt'),
      'craft-handoff.js carries a literal copy of truth_grounding instead of reading it from the template'
    );
  });
});

describe('task split — entry paragraph on the last row only', () => {
  test('two verification pairs produce two rows; row 1 has no entry paragraph, the last row does', () => {
    writeRoadmap(project, [entryFields()]);
    const { json } = run(project, {
      entry: '001',
      destination: 'task',
      split: true,
      judgment: goodJudgment({
        verification: [
          { run: 'npm test -- auth', expected: 'auth tests pass' },
          { run: 'npm test', expected: 'all tests pass' },
        ],
      }),
    });
    assert.equal(json.ok, true, JSON.stringify(json));
    assert.equal(json.tasks.length, 2);
    assert.ok(!json.tasks[0].description.includes('ROADMAP.jsonl entry'));
    assert.ok(json.tasks[1].description.includes('ROADMAP.jsonl entry `001`'));
    assert.ok(json.tasks[0].description.includes('<task_context>'), 'row 1 must carry the full assembled prompt');
  });

  test('a single verification pair still produces one row, carrying both the full prompt and the entry paragraph', () => {
    writeRoadmap(project, [entryFields()]);
    const { json } = run(project, {
      entry: '001',
      destination: 'task',
      split: true,
      judgment: goodJudgment(),
    });
    assert.equal(json.tasks.length, 1);
    assert.ok(json.tasks[0].description.includes('<task_context>'));
    assert.ok(json.tasks[0].description.includes('ROADMAP.jsonl entry `001`'));
  });

  test('no split requested: no tasks[] at all', () => {
    writeRoadmap(project, [entryFields()]);
    const { json } = run(project, { entry: '001', destination: 'task', judgment: goodJudgment() });
    assert.equal(json.tasks, undefined);
  });
});

describe('verification preflight — every command, not just the first', () => {
  test('a second command that does not resolve warns, and the warning names it', () => {
    writeRoadmap(project, [entryFields()]);
    const { json } = run(project, {
      entry: '001',
      destination: 'clipboard',
      judgment: goodJudgment({
        verification: [
          { run: 'node --test tests/*.test.js', expected: 'all tests pass' },
          { run: 'definitelynotarealbinary --run', expected: 'the check passes' },
        ],
      }),
    });
    const hits = json.warnings.filter((w) => w.includes('does not resolve'));
    assert.equal(hits.length, 1, `expected one unresolvable-command warning, got ${JSON.stringify(json.warnings)}`);
    assert.ok(hits[0].includes('definitelynotarealbinary --run'), hits[0]);
  });

  test('the same command twice is one finding, not two', () => {
    writeRoadmap(project, [entryFields()]);
    const { json } = run(project, {
      entry: '001',
      destination: 'clipboard',
      judgment: goodJudgment({
        verification: [
          { run: 'definitelynotarealbinary --run', expected: 'the check passes' },
          { run: 'definitelynotarealbinary --run', expected: 'still passes' },
        ],
      }),
    });
    assert.equal(json.warnings.filter((w) => w.includes('does not resolve')).length, 1, JSON.stringify(json.warnings));
  });
});

describe('installed Codex plugin commands', () => {
  test('the emitted no-commit close preserves observed evidence and pre-existing staged work', () => {
    initGitRepo(project);
    commitFile(project, 'src/auth/middleware.js', fs.readFileSync(path.join(project, 'src/auth/middleware.js'), 'utf8'));
    commitFile(project, 'unrelated.txt', 'baseline\n');
    fs.writeFileSync(path.join(project, 'unrelated.txt'), 'pre-existing user change\n');
    const git = (...args) => {
      const result = spawnSync('git', args, { cwd: project, encoding: 'utf8' });
      assert.equal(result.status, 0, result.stderr);
      return result.stdout;
    };
    git('add', '--', 'unrelated.txt');
    const beforeHead = git('rev-parse', 'HEAD');
    const beforeIndex = git('diff', '--cached', '--binary');
    writeRoadmap(project, [entryFields()]);
    const { json } = run(project, { entry: '001', destination: 'task', judgment: goodJudgment({
      verification: [{ run: 'node --check src/auth/middleware.js', expected: 'exit code 0' }],
    }) });
    assert.equal(json.gate.ok, true);
    const start = json.prompt.match(/Command: .node '([^']+)' start --id '([^']+)'./);
    const opened = runNodeScript(start[1], ['start', '--id', start[2]], null, { FOREMAN_PROJECT_DIR: project });
    assert.equal(opened.status, 0, opened.stdout);
    const boundary = runNodeScript(path.join(SCRIPTS_DIR, 'safe-commit.js'), ['begin'], null, { FOREMAN_PROJECT_DIR: project });
    assert.equal(JSON.parse(boundary.stdout).dirty, true);
    fs.appendFileSync(path.join(project, 'src/auth/middleware.js'), '// task-owned edit\n');
    const verified = spawnSync(process.execPath, ['--check', 'src/auth/middleware.js'], { cwd: project, encoding: 'utf8' });
    assert.equal(verified.status, 0, verified.stderr);
    const close = [...json.prompt.matchAll(/Command: .node '([^']+)' update-status.\nJSON stdin: .([^\n]+)./g)]
      .map((match) => ({ script: match[1], payload: JSON.parse(match[2]) }))
      .find(({ payload }) => payload.status === '<status>');
    assert.ok(close, 'no emitted close payload');
    close.payload.status = 'awaiting_acceptance';
    close.payload.notes = 'node --check src/auth/middleware.js exited 0 after the task-owned edit.';
    // Fill the artifact's declared field, so a wrong command-field name loses
    // evidence and fails the stored-result assertion below.
    const touchesField = Object.keys(close.payload).find((key) => Array.isArray(close.payload[key]));
    close.payload[touchesField] = ['src/auth/middleware.js'];
    const closed = runNodeScript(close.script, ['update-status'], close.payload, { FOREMAN_PROJECT_DIR: project });
    assert.equal(closed.status, 0, closed.stdout + closed.stderr);
    const stored = fs.readFileSync(path.join(project, 'ROADMAP.jsonl'), 'utf8').trim().split('\n').map(JSON.parse).find((row) => row.id === '001');
    assert.deepEqual(stored.observed_touches, ['src/auth/middleware.js']);
    assert.deepEqual(stored.commits, []);
    assert.equal(stored.status, 'awaiting_acceptance');
    const checked = runNodeScript(start[1], ['check', '--id', start[2]], null, { FOREMAN_PROJECT_DIR: project });
    assert.equal(checked.status, 0, checked.stdout);
    assert.equal(JSON.parse(checked.stdout).complete, true);
    assert.equal(git('rev-parse', 'HEAD'), beforeHead);
    assert.equal(git('diff', '--cached', '--binary'), beforeIndex);
    assert.equal(fs.readFileSync(path.join(project, 'unrelated.txt'), 'utf8'), 'pre-existing user change\n');
  });

  test('emitted opening command runs from an installation with spaces and shell metacharacters', () => {
    writeRoadmap(project, [entryFields()]);
    const plugin = path.join(makeTmpProject(), "Foreman plugin $dollar 'quote & literal");
    fs.mkdirSync(plugin);
    fs.cpSync(SCRIPTS_DIR, path.join(plugin, 'scripts'), { recursive: true });
    fs.cpSync(path.join(SCRIPTS_DIR, '..', 'hooks'), path.join(plugin, 'hooks'), { recursive: true });
    fs.copyFileSync(TEMPLATE_PATH, path.join(plugin, 'prompt-template.md'));
    const crafted = runNodeScript(path.join(plugin, 'scripts', 'craft-handoff.js'), [], {
      entry: '001', destination: 'task', judgment: goodJudgment(),
    }, { FOREMAN_PROJECT_DIR: project });
    assert.equal(crafted.status, 0, crafted.stdout + crafted.stderr);
    const prompt = JSON.parse(crafted.stdout).prompt;
    const match = prompt.match(/Command: `([^\n]+)`/);
    assert.ok(match, 'no opening lifecycle command');
    const windows = process.platform === 'win32';
    const opened = spawnSync(windows ? 'powershell.exe' : 'sh', windows
      ? ['-NoProfile', '-NonInteractive', '-Command', match[1]]
      : ['-c', match[1]], {
      encoding: 'utf8', windowsHide: true, timeout: 30000,
      env: { ...process.env, FOREMAN_PROJECT_DIR: project },
    });
    assert.equal(opened.status, 0, opened.stdout + opened.stderr);
    assert.equal(JSON.parse(opened.stdout).dispatchReady, true);
    const entries = fs.readFileSync(path.join(project, 'ROADMAP.jsonl'), 'utf8').trim().split('\n').map(JSON.parse);
    assert.equal(entries.find((entry) => entry.id === '001').status, 'in_progress');
    const annotation = prompt.match(/Command: `([^\n]+ annotate)`\nJSON stdin: `([^\n]+)`/);
    assert.ok(annotation, 'no separate JSON annotation payload');
    const notes = "we've preserved $variables, $(expressions), `backticks`, and & pipes as data";
    const payload = path.join(project, 'payload $literal.json');
    fs.writeFileSync(payload, JSON.stringify({ ...JSON.parse(annotation[2]), notes }), 'utf8');
    const quotedPayload = windows
      ? "'" + payload.replace(/'/g, "''") + "'"
      : "'" + payload.replace(/'/g, "'\"'\"'") + "'";
    const command = (windows ? 'Get-Content -LiteralPath ' + quotedPayload + ' -Raw -Encoding utf8' : 'cat ' + quotedPayload) + ' | ' + annotation[1];
    const annotated = spawnSync(windows ? 'powershell.exe' : 'sh', windows
      ? ['-NoProfile', '-NonInteractive', '-Command', command]
      : ['-c', command], {
      encoding: 'utf8', windowsHide: true, timeout: 30000,
      env: { ...process.env, FOREMAN_PROJECT_DIR: project },
    });
    assert.equal(annotated.status, 0, annotated.stdout + annotated.stderr);
    const after = fs.readFileSync(path.join(project, 'ROADMAP.jsonl'), 'utf8').trim().split('\n').map(JSON.parse);
    assert.ok(after.find((entry) => entry.id === '001').notes.endsWith(notes));
  });

  test('resolves runnable paths independently of legacy root environment variables', () => {
    writeRoadmap(project, [entryFields()]);
    const {json} = run(project, {entry: '001', destination: 'task', judgment: goodJudgment()}, {CLAUDE_PLUGIN_ROOT: 'Z:/missing/legacy-plugin'});
    assert.equal(json.ok, true, JSON.stringify(json));
    assert.ok(json.prompt.includes(SCRIPTS_DIR.replace(/\\/g, '/') + '/roadmap.js'));
    assert.ok(!json.prompt.includes('Z:/missing'));
    assert.ok(!/\$\{(?:CLAUDE|CODEX)_PLUGIN_ROOT\}/.test(json.prompt));
    const command = json.prompt.match(/Command: .node '([^']+)' start --id '([^']+)'./);
    assert.ok(command, 'no runnable opening lifecycle command');
    assert.ok(fs.existsSync(command[1]));
    const opened = runNodeScript(command[1], ['start', '--id', command[2]], null, {FOREMAN_PROJECT_DIR: project});
    assert.equal(opened.status, 0, opened.stdout + opened.stderr);
    assert.equal(JSON.parse(opened.stdout).dispatchReady, true);
    const entries = fs.readFileSync(path.join(project, 'ROADMAP.jsonl'), 'utf8').trim().split('\n').map(JSON.parse);
    assert.equal(entries.find((entry) => entry.id === '001').status, 'in_progress');
  });
});

describe('the gate — pass and failure both surfaced, never swallowed', () => {
  test('a complete handoff passes clean', () => {
    writeRoadmap(project, [entryFields()]);
    const { json } = run(project, { entry: '001', destination: 'clipboard', judgment: goodJudgment() });
    assert.equal(json.ok, true);
    assert.equal(json.gate.ok, true);
    assert.deepEqual(json.gate.errors, []);
  });

  test('a broken handoff (no steps, no touches, no verification) fails the gate — errors ride along with the prompt, not swallowed', () => {
    const { status, json } = run(project, {
      title: 'Bad entry',
      why: 'x',
      what: 'y',
      destination: 'clipboard',
      request: 'Investigate.',
      judgment: { role: 'a senior engineer', goal: 'to investigate', context: '' },
    });
    assert.equal(status, 1);
    assert.equal(json.ok, false);
    assert.equal(json.gate.ok, false);
    assert.ok(json.gate.errors.length > 0);
    assert.ok(json.gate.errors.some((e) => e.error.includes('task_rules')));
    // The prompt is still returned even though the gate rejected it.
    assert.ok(typeof json.prompt === 'string' && json.prompt.length > 0);
  });

  test('missing destination is a clean error, not a crash', () => {
    const { status, json } = run(project, { title: 'x', why: 'x', what: 'x', judgment: goodJudgment() });
    assert.equal(status, 1);
    assert.match(json.error, /destination/);
  });

  test('malformed stdin JSON is a clean error', () => {
    const result = runNodeScript(CRAFT, [], '{not json', { CLAUDE_PROJECT_DIR: project });
    const json = JSON.parse(result.stdout);
    assert.equal(result.status, 1);
    assert.equal(json.ok, false);
    assert.ok(json.error);
  });
});

describe('decision entries and the clipboard checkpoint embed', () => {
  test('every finish choice preserves local checkpoints and ignores unsupported push settings', () => {
    for (const onFinish of ['ask', 'squash', 'merge', 'pr', 'keep']) {
      const config = { baseBranch: 'develop', branch: true, onFinish };
      const embed = checkpointEmbedText(config, 2, '001');
      assert.equal(checkpointEmbedText({ ...config, push: true }, 2, '001'), embed);
      assert.match(embed, /leave it local, never push/);
      assert.match(embed, /explicit user branch restrictions override/);
      assert.match(embed, /never merge into a branch the user forbids modifying/);
      assert.ok(onFinish === 'ask'
        ? embed.includes('ask the user squash/merge/PR/keep the branch')
        : embed.includes('apply `' + onFinish + '` directly'));
    }
  });

  test('a subagent never receives checkpoint or staging commands and returns integration to the coordinator', () => {
    writeRoadmap(project, [entryFields()]);
    const { json } = run(project, {
      entry: '001', destination: 'agent', judgment: goodJudgment({
        verification: [
          { run: 'node --version', expected: 'a Node version' },
          { run: 'node --help', expected: 'usage information' },
        ],
      }),
    });
    assert.equal(json.gate.ok, true);
    assert.ok(!json.prompt.includes('Checkpoint protocol'));
    assert.ok(!json.prompt.includes('safe-commit.js'));
    assert.match(json.prompt, /must not run these mutations, stage, or commit/);
    assert.match(json.prompt, /Do not create user-owned tasks, switch branches, stage files, or commit/);
    assert.match(json.prompt, /Return the result to the coordinator/);
  });

  // Foreman authors no decision document any more: one ledger records what a
  // close learned, and where a project writes its decisions down is the
  // project's own business. Neither the write block nor the forced `doc`
  // close field survives.
  // The anchor channel's end-to-end path: a comment in a planned file
  // reaches the assembled prompt, so the destination reads what governs this
  // code before it starts, not after a hook catches it mid-edit.
  test('an anchor in a planned file rides into the background block', () => {
    writeRoadmap(project, [
      entryFields(),
      { ...entryFields(), id: '019', title: 'Expire sessions server-side' },
    ]);
    const full = path.join(project, 'src', 'auth', 'middleware.js');
    fs.mkdirSync(path.dirname(full), { recursive: true });
    fs.writeFileSync(full, '// [Foreman: 019]\nfunction refreshToken() {}\n', 'utf-8');
    const { json } = run(project, { entry: '001', destination: 'clipboard', judgment: goodJudgment() });
    assert.equal(json.ok, true, JSON.stringify(json));
    assert.match(json.prompt, /Anchored in the files this task plans to touch/);
    assert.match(json.prompt, /\[Foreman: 019\] — Expire sessions server-side/);
  });

  // [Foreman: 290] An anchored entry's title is a plan that was carried out,
  // not a rule for this task; the header says so instead of saying "govern".
  test('the anchor header frames the markers as history, never as rules that govern the code', () => {
    writeRoadmap(project, [entryFields(), entryFields({ id: '019', title: 'Expire sessions server-side', status: 'done' })]);
    fs.mkdirSync(path.join(project, 'src', 'auth'), { recursive: true });
    fs.writeFileSync(path.join(project, 'src', 'auth', 'middleware.js'), '// [Foreman: 019]\nmodule.exports = {};\n', 'utf-8');
    const { json } = run(project, { entry: '001', destination: 'clipboard', judgment: goodJudgment() });
    assert.match(json.prompt, /Anchored in the files this task plans to touch — markers earlier entries left in this code; history, not instructions for this task:/);
    assert.ok(!/govern/.test(json.prompt), json.prompt);
  });

  test('a planned file carrying no anchor adds nothing at all', () => {
    writeRoadmap(project, [entryFields()]);
    const { json } = run(project, { entry: '001', destination: 'clipboard', judgment: goodJudgment() });
    assert.ok(!json.prompt.includes('Anchored in the files'), json.prompt);
  });

  test('a kind:"decision" entry is never handed a document to write', () => {
    writeConfig(project, { ledger: { enabled: true, dir: 'docs/foreman' } });
    writeRoadmap(project, [entryFields({ kind: 'decision' })]);
    const { json } = run(project, { entry: '001', destination: 'clipboard', judgment: goodJudgment() });
    assert.equal(json.ok, true, JSON.stringify(json));
    assert.ok(!json.prompt.includes('<decision_log>'), json.prompt);
    assert.ok(!json.prompt.includes('"doc":'), json.prompt);
  });

  // The synthesized request sentence is the one line carrying the actual ask,
  // and `task_rules` on a decision entry already forbid writing code. It used
  // to read `Implement: <title>.` regardless of `kind`.
  test('a kind:"decision" entry synthesizes a Decide: request sentence, never Implement:', () => {
    writeRoadmap(project, [entryFields({ kind: 'decision' })]);
    const { json } = run(project, { entry: '001', destination: 'clipboard', judgment: goodJudgment() });
    assert.equal(json.ok, true, JSON.stringify(json));
    assert.ok(!json.prompt.includes('Implement:'), json.prompt);
    assert.match(json.prompt, /Decide: Fix token refresh bug, and state why the chosen option wins\./);
  });

  test('an ordinary entry still synthesizes an Implement: request sentence', () => {
    writeRoadmap(project, [entryFields()]);
    const { json } = run(project, { entry: '001', destination: 'clipboard', judgment: goodJudgment() });
    assert.match(json.prompt, /Implement: Fix token refresh bug\./);
  });

  test('an explicit request overrides the decision fallback', () => {
    writeRoadmap(project, [entryFields({ kind: 'decision' })]);
    const { json } = run(project, {
      entry: '001',
      destination: 'clipboard',
      request: 'Pick a cache eviction policy and record it.',
      judgment: goodJudgment(),
    });
    assert.match(json.prompt, /Pick a cache eviction policy and record it\./);
    assert.ok(!json.prompt.includes('Decide: Fix token refresh bug'), json.prompt);
  });

  test('clipboard with 2+ verification pairs bakes the resolved checkpoints config into task_rules', () => {
    writeConfig(project, { checkpoints: { branch: true, onFinish: 'squash' } });
    writeRoadmap(project, [entryFields()]);
    const { json } = run(project, {
      entry: '001',
      destination: 'clipboard',
      judgment: goodJudgment({
        verification: [
          { run: 'npm test -- auth', expected: 'auth tests pass' },
          { run: 'npm test', expected: 'all tests pass' },
        ],
      }),
    });
    assert.equal(json.ok, true, JSON.stringify(json));
    assert.match(json.prompt, /Checkpoint protocol for this multi-task run/);
    assert.match(json.prompt, /apply `squash` directly/);
  });

  // [Foreman: 273] The embed used to say "chain each to the previous one" and
  // name no tool, so the ordering was advice. The pasted session is a Claude
  // Code session — the prompt already bakes ${CLAUDE_PLUGIN_ROOT} and names
  // AskUserQuestion — so naming the tools costs nothing and hands the ordering
  // to that session's own harness, the same way the task destination does.
  test('the embed preserves dependent acceptance rows without creating Codex tasks', () => {
    writeRoadmap(project, [entryFields()]);
    const { json } = run(project, {
      entry: '001',
      destination: 'clipboard',
      judgment: goodJudgment({
        verification: [
          { run: 'npm test -- auth', expected: 'auth tests pass' },
          { run: 'npm test', expected: 'all tests pass' },
        ],
      }),
    });
    assert.equal(json.ok, true, JSON.stringify(json));
    assert.match(json.prompt, /one local acceptance row per Run:\/Expected: pair \(2 total\)/);
    assert.match(json.prompt, /complete each row before its dependent successor/);
    assert.ok(!/TaskCreate|TaskUpdate|AskUserQuestion/.test(json.prompt));
    assert.ok(!json.prompt.includes('has no Foreman scripts to call'), json.prompt);
  });

  // [Foreman: 262] The embed and the entry paragraph used to contradict each
  // other on the last commit: the paragraph says commit once with a
  // `Foreman: <id>` trailer, the embed said commit `task <n>/<total>`. The
  // template reconciles them, but the pasted session never reads the
  // template — so the reconciliation is baked into the embed itself.
  test('the embed defers its last commit to the roadmap close, id baked in', () => {
    writeConfig(project, { checkpoints: { branch: true, onFinish: 'squash' } });
    writeRoadmap(project, [entryFields()]);
    const { json } = run(project, {
      entry: '001',
      destination: 'clipboard',
      judgment: goodJudgment({
        verification: [
          { run: 'npm test -- auth', expected: 'auth tests pass' },
          { run: 'npm test', expected: 'all tests pass' },
        ],
      }),
    });
    assert.equal(json.ok, true, JSON.stringify(json));
    assert.ok(json.prompt.includes("the last task carries the roadmap close instead of a `task <n>/<total>` commit"), json.prompt);
    assert.ok(json.prompt.includes("make that one commit with `Foreman: 001` as its final line"), json.prompt);
  });

  test('a handoff with no roadmap entry gets no roadmap-close bullet', () => {
    const embed = checkpointEmbedText({ baseBranch: null, branch: true, onFinish: 'ask' }, 2, null);
    assert.ok(!embed.includes('carries the roadmap close'), embed);
    assert.ok(embed.includes("commit `task <n>/<total>: <task subject>`"), embed);
  });
  test('clipboard with a single verification pair gets no checkpoint embed', () => {
    writeRoadmap(project, [entryFields()]);
    const { json } = run(project, { entry: '001', destination: 'clipboard', judgment: goodJudgment() });
    assert.ok(!json.prompt.includes('Checkpoint protocol for this multi-task run'));
  });

  // Defect 1 (adversarial review): the branch-settling line hardcoded "with
  // branch creation on, " ahead of branchAction, so branch:false produced
  // "...with branch creation on, checkpoint in place (branch creation is
  // off)" — self-contradicting.
  test('branch:true keeps the "with branch creation on" wording', () => {
    writeConfig(project, { checkpoints: { branch: true, onFinish: 'squash' } });
    writeRoadmap(project, [entryFields()]);
    const { json } = run(project, {
      entry: '001',
      destination: 'clipboard',
      judgment: goodJudgment({
        verification: [
          { run: 'npm test -- auth', expected: 'auth tests pass' },
          { run: 'npm test', expected: 'all tests pass' },
        ],
      }),
    });
    assert.equal(json.ok, true, JSON.stringify(json));
    assert.match(
      json.prompt,
      /settle the branch first: detect the base branch.*; with branch creation on, create `foreman\/<slug>`/
    );
  });

  test('branch:false drops the "with branch creation on" clause entirely — no contradiction', () => {
    writeConfig(project, { checkpoints: { baseBranch: 'develop', branch: false, onFinish: 'pr' } });
    writeRoadmap(project, [entryFields()]);
    const { json } = run(project, {
      entry: '001',
      destination: 'clipboard',
      judgment: goodJudgment({
        verification: [
          { run: 'npm test -- auth', expected: 'auth tests pass' },
          { run: 'npm test', expected: 'all tests pass' },
        ],
      }),
    });
    assert.equal(json.ok, true, JSON.stringify(json));
    assert.ok(!json.prompt.includes('with branch creation on'), 'branch:false must not carry the on-wording');
    assert.match(
      json.prompt,
      /settle the branch first: the base branch is `develop`; checkpoint in place \(branch creation is off\)/
    );
  });
});

// Defect 2 (adversarial review): the baked entry paragraph dropped the
// model/effort self-report channel roadmap-schema.md:112-113 documents.
describe('entry paragraph — model/effort self-report channel', () => {
  test('task/clipboard destinations get the self-report instruction for both fields', () => {
    writeRoadmap(project, [entryFields()]);
    const { json } = run(project, { entry: '001', destination: 'clipboard', judgment: goodJudgment() });
    assert.equal(json.ok, true, JSON.stringify(json));
    assert.match(json.prompt, /Also add `model` and `effort` to that close call — what actually ran this task/);
  });

  test('an agent destination gets the both-fields instruction', () => {
    writeRoadmap(project, [entryFields()]);
    const { json } = run(project, { entry: '001', destination: 'agent', judgment: goodJudgment() });
    assert.equal(json.ok, true, JSON.stringify(json));
    assert.match(json.prompt, /Also add `model` and `effort` to that close call/);
    assert.ok(!json.prompt.includes('"model":"'));
  });

  // [Foreman: 260] Foreman no longer asks which model should run a task, so
  // nothing upstream can know one to bake in. A caller passing `model` anyway
  // is passing a value nothing confirmed: it is ignored, and the destination
  // still self-reports what actually ran.
  test('a passed model is ignored — the destination always self-reports both', () => {
    writeRoadmap(project, [entryFields()]);
    const { json } = run(project, { entry: '001', destination: 'agent', model: 'sonnet', judgment: goodJudgment() });
    assert.equal(json.ok, true, JSON.stringify(json));
    assert.ok(!json.prompt.includes('"model":"sonnet"'), 'a passed model was baked into the close call');
    assert.match(json.prompt, /Also add `model` and `effort` to that close call/);
  });
});

// The autonomous-operation reminder bans asking; source-d pairs it with the
// policy that says when asking is still right. Shipping only the first half
// to the one destination with nobody watching leaves scope_discipline's
// "flag it to the user first" with no way to happen.
describe('background-agent autonomy paragraph — pause policy', () => {
  const PAUSE = 'If a decision, authorization, or input blocks progress';

  test('an agent handoff carries the pause policy alongside the reminder', () => {
    writeRoadmap(project, [entryFields()]);
    const { json } = run(project, { entry: '001', destination: 'agent', judgment: goodJudgment() });
    assert.equal(json.ok, true, JSON.stringify(json));
    assert.ok(json.prompt.includes('You are operating autonomously.'));
    assert.ok(json.prompt.includes(PAUSE), 'the reminder shipped without its pause policy');
    assert.match(json.prompt, /report it to the coordinator using the available collaboration tools/);
    assert.match(json.prompt, /must not run these mutations, stage, or commit/);
    // Both halves ride the one extracted block, so the policy must land after
    // the ban it answers, not somewhere else in the prompt.
    assert.ok(json.prompt.indexOf('You are operating autonomously.') < json.prompt.indexOf(PAUSE));
  });

  test('destinations with a user present carry neither half', () => {
    writeRoadmap(project, [entryFields()]);
    for (const destination of ['clipboard', 'task']) {
      const { json } = run(project, { entry: '001', destination, judgment: goodJudgment() });
      assert.equal(json.ok, true, JSON.stringify(json));
      assert.ok(!json.prompt.includes('You are operating autonomously.'), destination);
      assert.ok(!json.prompt.includes(PAUSE), destination);
    }
  });
});

// Reviewer style note (a): a malformed judgment field must fail loudly at
// assembly time, never ride through as "Run: undefined"/"undefined → undefined".
describe('judgment shape validation', () => {
  test('a verification pair missing run/expected is a clean error, never reaches the gate', () => {
    writeRoadmap(project, [entryFields()]);
    const { status, json } = run(project, {
      entry: '001',
      destination: 'clipboard',
      judgment: goodJudgment({ verification: [{ run: 'npm test' }] }),
    });
    assert.equal(status, 1);
    assert.equal(json.ok, false);
    assert.match(json.error, /judgment\.verification\[0\]/);
    assert.ok(!('prompt' in json), 'a validation failure must not assemble/return a prompt at all');
  });

  test('a non-object judgment.example is a clean error', () => {
    writeRoadmap(project, [entryFields()]);
    const { status, json } = run(project, {
      entry: '001',
      destination: 'clipboard',
      judgment: goodJudgment({ example: 'before -> after' }),
    });
    assert.equal(status, 1);
    assert.equal(json.ok, false);
    assert.match(json.error, /judgment\.example/);
  });
});

// entry 204: craft-prompt/SKILL.md's Workflow-stage output flavor needs
// this wired through — the gap flagged in entry 201's own header comment.
describe('workflow-stage flavor', () => {
  test('drops tone, replaces output_format with the fixed sentence, and passes the flag through to the gate', () => {
    // kind:"decision" forces `reinforced`, so tone/output_format would
    // otherwise both be included — proving workflowStage overrides that.
    writeRoadmap(project, [entryFields({ kind: 'decision' })]);
    const { json } = run(project, {
      entry: '001',
      destination: 'clipboard',
      workflowStage: true,
      judgment: goodJudgment(),
    });
    assert.equal(json.ok, true, JSON.stringify(json));
    assert.equal(json.gate.ok, true, JSON.stringify(json.gate));
    assert.deepEqual(json.gate.errors, []);
    assert.ok(!json.prompt.includes('<tone>'));
    assert.ok(!json.prompt.includes('<output_format>'));
    assert.ok(json.prompt.includes(WORKFLOW_STAGE_SENTENCE));
  });

  test('entry-less mode carries the flag the same way', () => {
    const { json } = run(project, {
      title: 'Ad-hoc research task',
      what: 'Investigate the retry bug.',
      planned_touches: ['src/auth/middleware.js'],
      destination: 'clipboard',
      workflowStage: true,
      request: 'Investigate the retry bug.',
      judgment: { role: 'a senior engineer', goal: 'to investigate', context: '', question: 'Does the retry path double-count?' },
    });
    assert.equal(json.ok, true, JSON.stringify(json));
    assert.ok(!json.prompt.includes('<output_format>'));
    assert.ok(json.prompt.includes(WORKFLOW_STAGE_SENTENCE));
  });

  test('without the flag, the same reinforced handoff carries tone and output_format as usual', () => {
    writeRoadmap(project, [entryFields({ kind: 'decision' })]);
    const { json } = run(project, { entry: '001', destination: 'clipboard', judgment: goodJudgment() });
    assert.equal(json.gate.ok, true, JSON.stringify(json.gate));
    assert.ok(json.prompt.includes('<tone>'));
    assert.ok(json.prompt.includes('<output_format>'));
    assert.ok(!json.prompt.includes(WORKFLOW_STAGE_SENTENCE));
  });
});

// Prior-work recall: a planned path only a handful of finished entries ever
// reached is a lead, so the handoff names them and what each recorded.
describe('prior-work recall', () => {
  const { priorWorkText, recallExcerpt } = require(path.join(SCRIPTS_DIR, 'craft-handoff.js'));

  function finished(id, observed, overrides = {}) {
    return entryFields({
      id,
      title: `Earlier work ${id}`,
      status: 'done',
      planned_touches: observed,
      observed_touches: observed,
      commits: ['abc1234'],
      ...overrides,
    });
  }

  // 20 finished entries so the 20% ceiling sits at 4: a path 2 entries
  // reached survives, one 9 reached does not.
  // Padding: finished entries touching nothing the picked task plans, there
  // only to give the 20% ceiling a corpus to be 20% of.
  function pad(count, base) {
    return Array.from({ length: count }, (_, i) => finished(String(base + i), [`src/pad-${base + i}.js`]));
  }

  function corpus() {
    const rows = [];
    for (let i = 0; i < 20; i += 1) {
      const id = String(200 + i);
      const observed = i < 9 ? ['src/common.js'] : [`src/other-${i}.js`];
      if (i === 0 || i === 1) observed.push('src/auth/middleware.js');
      rows.push(finished(id, observed, {
        why: `Entry ${id} existed because retries double-counted.`,
        notes: `${today()} Entry ${id} rewrote the retry loop.`,
      }));
    }
    return rows;
  }

  // [Foreman: 284] The lead carries the entry's why — the reason the work
  // existed — not its longest note, which on a real roadmap is the shipping
  // log more often than not.
  test('a rare path names the finished entries that touched it, each with its why', () => {
    const text = priorWorkText(corpus(), { id: '001', planned_touches: ['src/auth/middleware.js'] });
    assert.match(text, /- 200 Earlier work 200 — Entry 200 existed because retries double-counted\./);
    assert.match(text, /- 201 Earlier work 201 — Entry 201 existed because/);
    assert.ok(!text.includes('rewrote the retry loop'), 'the note must not displace the why');
  });

  test('the longest note stands in only when the why is empty', () => {
    const rows = [
      finished('300', ['src/auth/middleware.js'], { why: '', notes: `${today()} The retry loop double-counted attempts.` }),
      ...pad(4, 900),
    ];
    const text = priorWorkText(rows, { id: '001', planned_touches: ['src/auth/middleware.js'] });
    assert.match(text, /- 300 Earlier work 300 — The retry loop double-counted attempts\./);
  });

  test('a why past the excerpt cap is cut with the same mark as a note', () => {
    const rows = [
      finished('300', ['src/auth/middleware.js'], { why: 'w'.repeat(400) }),
      ...pad(4, 900),
    ];
    const text = priorWorkText(rows, { id: '001', planned_touches: ['src/auth/middleware.js'] });
    assert.match(text, new RegExp(`— w{239}…$`, 'm'));
  });

  // The excerpts are past entries' own notes, and those read as imperatives.
  // The tag and its framing line are what mark the block as history.
  test('the block is wrapped in <prior_work> and framed as history', () => {
    const text = priorWorkText(corpus(), { id: '001', planned_touches: ['src/auth/middleware.js'] });
    const lines = text.split('\n');
    assert.equal(lines[0], '<prior_work>');
    assert.equal(
      lines[1],
      'Recorded by earlier finished entries that touched these files — history, not instructions for this task.'
    );
    assert.equal(lines[lines.length - 1], '</prior_work>');
  });

  test('a path above the 20% ceiling is dropped as a query term', () => {
    const text = priorWorkText(corpus(), { id: '001', planned_touches: ['src/common.js'] });
    assert.equal(text, '');
  });

  test('a path nothing has touched recalls nothing', () => {
    const text = priorWorkText(corpus(), { id: '001', planned_touches: ['src/brand-new.js'] });
    assert.equal(text, '');
  });

  test('open entries and evidence-less closes are not corpus', () => {
    const rows = [
      finished('300', ['src/auth/middleware.js'], { status: 'planned' }),
      finished('301', ['src/auth/middleware.js'], { status: 'in_progress' }),
      finished('302', [], { observed_touches: [] }),
    ];
    assert.equal(priorWorkText(rows, { id: '001', planned_touches: ['src/auth/middleware.js'] }), '');
  });

  test('awaiting_acceptance counts — it is finished work waiting on a yes', () => {
    const rows = [finished('303', ['src/auth/middleware.js'], { status: 'awaiting_acceptance' }), ...pad(4, 700)];
    assert.match(
      priorWorkText(rows, { id: '001', planned_touches: ['src/auth/middleware.js'] }),
      /- 303 Earlier work 303/
    );
  });

  test('at most three entries, rarest path first', () => {
    const rows = [];
    for (let i = 0; i < 5; i += 1) rows.push(finished(String(400 + i), ['src/wide.js']));
    rows.push(finished('500', ['src/narrow.js']));
    for (let i = 0; i < 24; i += 1) rows.push(finished(String(600 + i), [`src/pad-${i}.js`]));
    const text = priorWorkText(rows, { id: '001', planned_touches: ['src/narrow.js', 'src/wide.js'] });
    const named = text.split('\n').filter((line) => line.startsWith('- '));
    assert.equal(named.length, 3);
    assert.match(named[0], /- 500 /);
  });

  // [Foreman: 284] Among entries that reached the same path, the newest lead:
  // the latest change is the one that explains the code as it stands, and it
  // used to be the first one dropped.
  test('among equals the newest entries lead and the oldest are the ones dropped', () => {
    const rows = [];
    for (let i = 0; i < 5; i += 1) rows.push(finished(String(400 + i), ['src/wide.js']));
    for (let i = 0; i < 24; i += 1) rows.push(finished(String(600 + i), [`src/pad-${i}.js`]));
    const text = priorWorkText(rows, { id: '001', planned_touches: ['src/wide.js'] });
    const ids = text.split('\n').filter((line) => line.startsWith('- ')).map((line) => line.slice(2, 5));
    assert.deepEqual(ids, ['404', '403', '402']);
  });

  test('the excerpt strips the date stamp and every machine-written line', () => {
    const notes = [
      `${today()} scope drift — untouched: src/a.js`,
      `${today()} correction applied: what`,
      `${today()} The retry loop double-counted attempts after a 429.`,
      `${today()} short`,
    ].join('\n');
    assert.equal(recallExcerpt(notes), 'The retry loop double-counted attempts after a 429.');
  });

  test('an excerpt is capped at 240 characters', () => {
    const long = `${today()} ${'x'.repeat(400)}`;
    assert.equal(recallExcerpt(long).length, 240);
  });

  test('notes that are entirely machine-written excerpt to nothing', () => {
    assert.equal(recallExcerpt(`${today()} scope drift — unpredicted: src/b.js`), null);
  });

  // Titles here are deliberately long. A real roadmap's titles run well past
  // 60 characters, and a short-title fixture passes the length assertion
  // below for the wrong reason.
  const LONG_TITLE = 'Rework the auth middleware refresh path and its expiry accounting end to end';

  test('it lands inside <background>, never inside <context>, and stays under 1200 chars', () => {
    writeRoadmap(project, [
      entryFields(),
      finished('300', ['src/auth/middleware.js'], {
        title: `${LONG_TITLE} (first pass)`,
        notes: `${today()} ${'The earlier pass moved the refresh call above the expiry check. '.repeat(6)}`,
      }),
      finished('301', ['src/auth/middleware.js'], {
        title: `${LONG_TITLE} (second pass)`,
        notes: `${today()} ${'It also renamed verifySession and left one caller behind. '.repeat(6)}`,
      }),
      finished('302', ['src/auth/middleware.js'], {
        title: `${LONG_TITLE} (third pass)`,
        notes: `${today()} ${'A third pass rewrote the cookie flags and nothing else. '.repeat(6)}`,
      }),
      ...pad(17, 800),
    ]);
    const { json } = run(project, { entry: '001', destination: 'clipboard', judgment: goodJudgment() });
    assert.equal(json.gate.ok, true, JSON.stringify(json.gate));

    const background = json.prompt.slice(
      json.prompt.indexOf('<background>'),
      json.prompt.indexOf('</background>')
    );
    const recallAt = background.indexOf('<prior_work>');
    assert.ok(recallAt > -1, 'recall never made it into <background>');
    const contextAt = background.indexOf('<context>');
    if (contextAt > -1) assert.ok(recallAt < contextAt, 'recall must sit outside <context>');

    const block = background.slice(recallAt).replace(/<context>[\s\S]*$/, '').trim();
    assert.ok(block.length < 1200, `recall payload was ${block.length} chars`);
  });

  // The 1200-character ceiling is the feature's contract, so it is enforced
  // rather than argued: maximal title, maximal excerpt, maximal entry count,
  // and a four-digit id on every row. The row count is pinned with it — a
  // ceiling that no longer fits RECALL_KEEP rows drops a lead in silence.
  test('the worst case a roadmap can produce still fits under 1200 chars', () => {
    const rows = [];
    for (let i = 0; i < 3; i += 1) {
      rows.push(finished(String(1000 + i), ['src/auth/middleware.js'], {
        title: 'T'.repeat(200),
        why: 'W'.repeat(600),
        notes: `${today()} ${'N'.repeat(600)}`,
      }));
    }
    rows.push(...pad(17, 2000));
    const text = priorWorkText(rows, { id: '001', planned_touches: ['src/auth/middleware.js'] });
    assert.ok(text.length > 0, 'the worst case must still recall something');
    assert.ok(text.length < 1200, `worst-case payload was ${text.length} chars`);
    assert.equal(
      text.split('\n').filter((l) => l.startsWith('- ')).length,
      3,
      'the worst case still carries every kept lead'
    );
    for (const line of text.split('\n').filter((l) => l.startsWith('- '))) {
      assert.ok(line.includes('T'.repeat(60)), 'the title is cut at 60, not dropped');
      assert.ok(!line.includes('T'.repeat(61)), 'the title must be cut at 60');
    }
  });

  test('a lead that would overflow the ceiling is dropped whole, never halved', () => {
    const rows = [
      finished('300', ['src/auth/middleware.js'], { title: 'A'.repeat(60), why: 'a'.repeat(240) }),
      finished('301', ['src/auth/middleware.js'], { title: 'B'.repeat(60), why: 'b'.repeat(240) }),
      finished('302', ['src/auth/middleware.js'], { title: 'C'.repeat(60), why: 'c'.repeat(240) }),
      ...pad(17, 3000),
    ];
    const text = priorWorkText(rows, { id: '001', planned_touches: ['src/auth/middleware.js'] });
    assert.ok(text.length < 1200);
    // Whatever survived is whole: every kept line still ends in its own
    // excerpt rather than a truncation of one.
    for (const line of text.split('\n').filter((l) => l.startsWith('- '))) {
      assert.match(line, /^- \d+ [ABC]{60} — [abc]{240}$/);
    }
  });

  // Every lead carries a three-valued freshness stamp. "unchanged" is the one
  // verdict git has to earn; every other outcome reads "unknown", because a
  // hard-repeated stale path is measured to anchor a session on the decoy.
  describe('freshness stamps', () => {
    test('an unresolvable anchor stamps unknown rather than fresh', () => {
      const bare = makeTmpProject();
      const rows = [
        finished('300', ['src/auth/middleware.js'], { commits: ['deadbee'] }),
        ...pad(4, 900),
      ];
      const text = priorWorkText(rows, { id: '001', planned_touches: ['src/auth/middleware.js'] }, bare);
      assert.match(text, /- 300 .*\[freshness unknown\]/);
      assert.ok(!text.includes('unchanged since'), 'an undatable lead must never read as fresh');
    });

    test('a lead whose recorded files have not changed reads as unchanged', () => {
      const repo = makeTmpProject();
      initGitRepo(repo);
      const sha = commitFile(repo, 'src/auth/middleware.js', 'function refreshToken() {}\n');
      commitFile(repo, 'src/unrelated.js', 'module.exports = 1;\n');
      const rows = [
        finished('300', ['src/auth/middleware.js'], { commits: [sha] }),
        ...pad(4, 900),
      ];
      const text = priorWorkText(rows, { id: '001', planned_touches: ['src/auth/middleware.js'] }, repo);
      assert.match(text, new RegExp(`- 300 .*\\[at ${sha} — its files unchanged since\\]`));
    });

    test('a lead whose recorded files changed since reads as possibly stale', () => {
      const repo = makeTmpProject();
      initGitRepo(repo);
      const sha = commitFile(repo, 'src/auth/middleware.js', 'function refreshToken() {}\n');
      commitFile(repo, 'src/auth/middleware.js', 'function refreshToken() { return 1; }\n');
      const rows = [
        finished('300', ['src/auth/middleware.js'], { commits: [sha] }),
        ...pad(4, 900),
      ];
      const text = priorWorkText(rows, { id: '001', planned_touches: ['src/auth/middleware.js'] }, repo);
      assert.match(text, /- 300 .*possibly stale: 1 of its 1 files changed since\]/);
    });

    // The P1 decoy: a lead recorded against a path that has since MOVED. The
    // recall still names the old path, which is exactly what anchors a session
    // on a file nothing imports any more — so the stamp has to fire. It does
    // because the diff runs without `-M`, which reports a rename as a delete.
    test('a moved file makes its lead read stale, not fresh', () => {
      const repo = makeTmpProject();
      initGitRepo(repo);
      const sha = commitFile(repo, 'src/parser.js', 'const split = (s) => s.split(/\\s+/);\n');
      spawnSync('git', ['mv', 'src/parser.js', 'src/tokenizer.js'], { cwd: repo });
      commitFile(repo, 'src/tokenizer.js', 'const split = (s) => s.split(/[^a-z0-9\']+/);\n');
      const rows = [
        finished('300', ['src/parser.js'], { commits: [sha] }),
        ...pad(4, 900),
      ];
      const text = priorWorkText(rows, { id: '001', planned_touches: ['src/parser.js'] }, repo);
      assert.match(text, /- 300 .*possibly stale: 1 of its 1 files changed since\]/);
    });

    test('with no root the block carries no stamp at all', () => {
      const rows = [finished('300', ['src/auth/middleware.js']), ...pad(4, 900)];
      const text = priorWorkText(rows, { id: '001', planned_touches: ['src/auth/middleware.js'] });
      assert.match(text, /- 300 /);
      assert.ok(!text.includes('['), 'selection-only callers get no freshness claim either way');
    });
  });

  // [Foreman: 285] The archive is history too. Session start offers archiving
  // at twenty terminal entries, so an active-only recall lost the oldest lead
  // — the one that created the code — first.
  test('an archived finished entry is still recalled, with its why', () => {
    writeRoadmap(project, [entryFields(), ...pad(4, 900)]);
    writeArchiveFile(project, [
      finished('300', ['src/auth/middleware.js'], { why: 'It was archived, not forgotten.' }),
    ]);
    const { json } = run(project, { entry: '001', destination: 'clipboard', judgment: goodJudgment() });
    assert.equal(json.gate.ok, true, JSON.stringify(json.gate));
    assert.match(json.prompt, /- 300 Earlier work 300 — It was archived, not forgotten\./);
  });

  test('a corrupt archive costs the archived leads, never the handoff', () => {
    writeRoadmap(project, [entryFields(), finished('300', ['src/auth/middleware.js']), ...pad(4, 900)]);
    fs.mkdirSync(path.join(project, '.foreman'), { recursive: true });
    fs.writeFileSync(path.join(project, '.foreman', 'archive.jsonl'), '{not json\n', 'utf-8');
    const { json } = run(project, { entry: '001', destination: 'clipboard', judgment: goodJudgment() });
    assert.equal(json.gate.ok, true, JSON.stringify(json.gate));
    assert.match(json.prompt, /- 300 Earlier work 300/);
  });

  test('a why that is not a string falls back to the note rather than printing it', () => {
    const rows = [
      finished('300', ['src/auth/middleware.js'], { why: { a: 1 }, notes: `${today()} The note stands in.` }),
      ...pad(4, 900),
    ];
    const text = priorWorkText(rows, { id: '001', planned_touches: ['src/auth/middleware.js'] });
    assert.match(text, /- 300 Earlier work 300 — The note stands in\./);
    assert.ok(!text.includes('[object Object]'));
  });

  test('recall never promotes a handoff to the reinforced profile', () => {
    writeRoadmap(project, [
      entryFields(),
      finished('300', ['src/auth/middleware.js'], { notes: `${today()} A real finding.` }),
      ...pad(4, 900),
    ]);
    const { json } = run(project, { entry: '001', destination: 'clipboard', judgment: goodJudgment() });
    assert.equal(json.profile, 'standard');
    assert.equal(Object.keys(json.signals).length, 5);
    assert.ok(json.prompt.includes('<prior_work>'));
  });
});

// [Foreman: 287] The symbol chain: which entries shaped a function the task
// names, read from the trailers in its file's own history. No store, no
// prose from a model, and no path ceiling — a symbol is narrower than its file.
describe('the symbol chain', () => {
  function commitWith(cwd, relPath, content, message) {
    const full = path.join(cwd, relPath);
    fs.mkdirSync(path.dirname(full), { recursive: true });
    fs.writeFileSync(full, content, 'utf-8');
    spawnSync('git', ['add', relPath], { cwd });
    spawnSync('git', ['commit', '-q', '-m', message], { cwd });
  }

  function shapedProject(what = 'Rework `alpha` so it retries once.') {
    initGitRepo(project);
    commitWith(project, 'src/alpha.js', 'function alpha() {\n  return 1;\n}\n', 'Create alpha\n\nForeman: 041');
    commitWith(project, 'src/alpha.js', 'function alpha() {\n  return 2;\n}\n', 'Harden alpha\n\nForeman: 042');
    writeRoadmap(project, [
      entryFields({ what, planned_touches: ['src/alpha.js'] }),
      entryFields({ id: '041', title: 'Create alpha', why: 'The percentile math needed one home.', status: 'done', planned_touches: ['src/alpha.js'], observed_touches: ['src/alpha.js'] }),
      entryFields({ id: '042', title: 'Harden alpha', why: 'It crashed on an empty list.', status: 'done', planned_touches: ['src/alpha.js'], observed_touches: ['src/alpha.js'] }),
    ]);
  }

  test('names the entries whose commits shaped a symbol the task names, newest first, by id and title', () => {
    shapedProject();
    const { json } = run(project, { entry: '001', destination: 'clipboard', judgment: goodJudgment() });
    assert.equal(json.gate.ok, true, JSON.stringify(json.gate));
    assert.match(json.prompt, /- alpha \(src\/alpha\.js\): shaped by 042 Harden alpha; 041 Create alpha$/m);
  });

  // [Foreman: 290] The why is a plan written before the work, and a line in
  // this block is read as fact — a wrong why would bind as hard as a right one.
  test("a shaping entry's why never reaches the chain line", () => {
    shapedProject();
    const { json } = run(project, { entry: '001', destination: 'clipboard', judgment: goodJudgment() });
    assert.ok(!json.prompt.includes('It crashed on an empty list'), json.prompt);
    assert.ok(!json.prompt.includes('The percentile math needed one home'), json.prompt);
  });

  test('the header frames the chain as history, not instructions', () => {
    shapedProject();
    const { json } = run(project, { entry: '001', destination: 'clipboard', judgment: goodJudgment() });
    assert.match(json.prompt, /Entries whose commits shaped the symbols this task names — history, not instructions for this task;/);
  });

  test('a title past its cap is cut with the same mark the other blocks use', () => {
    const { symbolChainText } = require(path.join(SCRIPTS_DIR, 'craft-handoff.js'));
    initGitRepo(project);
    commitWith(project, 'src/alpha.js', 'function alpha() {}\n', 'Create alpha\n\nForeman: 041');
    writeRoadmap(project, [
      entryFields({ what: 'Rework `alpha`.', planned_touches: ['src/alpha.js'] }),
      entryFields({ id: '041', title: 'T'.repeat(80), why: 'W'.repeat(300), status: 'done' }),
    ]);
    const files = [{ path: 'src/alpha.js', symbols: [{ name: 'alpha', line: 1 }] }];
    const text = symbolChainText(project, { id: '001', title: 'x', what: 'Rework `alpha`.' }, files);
    assert.match(text, new RegExp(`shaped by 041 T{39}…$`, 'm'));
    assert.ok(!text.includes('W'), 'the why is not carried, cut or whole');
  });

  test('sits inside <background>, outside <context>, and never promotes the profile', () => {
    shapedProject();
    const { json } = run(project, { entry: '001', destination: 'clipboard', judgment: goodJudgment() });
    const background = json.prompt.slice(json.prompt.indexOf('<background>'), json.prompt.indexOf('</background>'));
    const at = background.indexOf('Entries whose commits shaped');
    assert.ok(at > -1, 'the chain must ride inside <background>');
    const contextAt = background.indexOf('<context>');
    if (contextAt > -1) assert.ok(at < contextAt, 'the chain must sit outside <context>');
    assert.equal(json.profile, 'standard');
  });

  test('a symbol the task never names is not traced', () => {
    shapedProject('Tidy the module header comment.');
    const { json } = run(project, { entry: '001', destination: 'clipboard', judgment: goodJudgment() });
    assert.ok(!json.prompt.includes('Entries whose commits shaped'));
  });

  test("a chain made only of the task's own id is silence", () => {
    initGitRepo(project);
    commitWith(project, 'src/alpha.js', 'function alpha() {}\n', 'Start alpha\n\nForeman: 001');
    writeRoadmap(project, [entryFields({ what: 'Finish `alpha`.', planned_touches: ['src/alpha.js'] })]);
    const { json } = run(project, { entry: '001', destination: 'clipboard', judgment: goodJudgment() });
    assert.ok(!json.prompt.includes('Entries whose commits shaped'));
  });

  test('a long chain keeps the newest two and the one that created it', () => {
    const { symbolChainText } = require(path.join(SCRIPTS_DIR, 'craft-handoff.js'));
    initGitRepo(project);
    const ids = ['011', '012', '013', '014', '015'];
    ids.forEach((id, i) => commitWith(project, 'src/alpha.js', `function alpha() {\n  return ${i};\n}\n`, `Step ${id}\n\nForeman: ${id}`));
    writeRoadmap(project, [
      entryFields({ what: 'Rework `alpha`.', planned_touches: ['src/alpha.js'] }),
      ...ids.map((id) => entryFields({ id, title: `Step ${id}`, status: 'done' })),
    ]);
    const files = [{ path: 'src/alpha.js', symbols: [{ name: 'alpha', line: 1 }] }];
    const text = symbolChainText(project, { id: '001', title: 'x', what: 'Rework `alpha`.' }, files);
    assert.match(text, /shaped by 015 Step 015; 014 Step 014; … 011 Step 011$/m);
    assert.ok(!text.includes('013'), 'the middle of a long chain is what the cap cuts');
  });

  test('with no git the block is simply absent', () => {
    const { symbolChainText } = require(path.join(SCRIPTS_DIR, 'craft-handoff.js'));
    writeRoadmap(project, [entryFields()]);
    const files = [{ path: 'src/alpha.js', symbols: [{ name: 'alpha', line: 1 }] }];
    assert.equal(symbolChainText(project, { id: '001', title: 'x', what: 'Rework `alpha`.' }, files), '');
  });
});

// [Foreman: 074] The file list is the one interview answer that must produce a
// real path, and a hand-typed path aimed at the wrong file is the failure
// truth_grounding spends the destination's tokens rescuing. The skill now
// grounds that question in one Explore pass before it asks. This is prose, so
// the pin is on the properties that make it safe rather than on the wording.
describe('the standard profile output shape switch', () => {
  const shaped = { FOREMAN_STANDARD_OUTPUT_SHAPE: '1' };

  function standardRun(env) {
    // No signals set, so computeSignals leaves this on the standard profile.
    return run(project, {
      title: 'Fix the token refresh bug',
      what: 'Fix the retry path in the auth middleware so the failing test passes.',
      planned_touches: ['src/auth/middleware.js'],
      destination: 'clipboard',
      request: 'Fix the token refresh bug in the auth middleware.',
      judgment: goodJudgment(),
    }, env);
  }

  test('standard carries no output_format by default', () => {
    const { json } = standardRun();
    assert.equal(json.ok, true, JSON.stringify(json));
    assert.equal(json.profile, 'standard');
    assert.ok(!json.prompt.includes('<output_format>'));
    assert.equal(json.gate.ok, true, JSON.stringify(json.gate));
  });

  test('the switch adds it, and the prompt still passes the gate', () => {
    const { json } = standardRun(shaped);
    assert.equal(json.ok, true, JSON.stringify(json));
    assert.equal(json.profile, 'standard', 'the switch must not promote the profile');
    assert.ok(json.prompt.includes('<output_format>'), 'the switch did not add the block');
    assert.equal(json.gate.ok, true, JSON.stringify(json.gate));
  });

  test('the switch is the only difference the prompt shows', () => {
    const plain = standardRun().json.prompt;
    const withShape = standardRun(shaped).json.prompt;
    const removed = withShape.replace(/\n*<output_format>[\s\S]*?<\/output_format>/, '');
    assert.equal(removed.trim(), plain.trim(), 'the switch changed something other than the block');
  });

  test('an unset or unrecognised value keeps today behaviour', () => {
    for (const value of ['', '0', 'false', 'yes', 'on']) {
      const { json } = standardRun({ FOREMAN_STANDARD_OUTPUT_SHAPE: value });
      assert.ok(
        !json.prompt.includes('<output_format>'),
        `"${value}" turned the shape on; only 1 and true may`
      );
    }
  });

  test('omitSections still wins over the switch', () => {
    writeConfig(project, { omitSections: ['output_format'] });
    const { json } = standardRun(shaped);
    assert.ok(!json.prompt.includes('<output_format>'), 'the switch overrode an explicit opt-out');
    assert.equal(json.gate.ok, true, JSON.stringify(json.gate));
  });
});

// [Foreman 4.1] The testFirst branch is the one place a session authors the
// very check it is graded on. The anti-gaming clause names that shortcut, and
// the house's own recorded lesson is that naming a failure can prime it — so
// the clause ships behind a switch and a measurement decides the default.
describe('the anti-test-gaming clause', () => {
  const CLAUSE = 'The test verifies the rule; it does not define it.';
  const on = { FOREMAN_TEST_GAMING_CLAUSE: '1' };

  function testFirstRun(env, judgmentOverrides = {}) {
    return run(project, {
      title: 'Fix the token refresh bug',
      what: 'Fix the retry path in the auth middleware so the failing test passes.',
      planned_touches: ['src/auth/middleware.js'],
      destination: 'clipboard',
      request: 'Fix the token refresh bug in the auth middleware.',
      judgment: goodJudgment({ testFirst: true, ...judgmentOverrides }),
    }, env);
  }

  test('it is absent by default, even on the testFirst branch', () => {
    const { json } = testFirstRun();
    assert.equal(json.ok, true, JSON.stringify(json));
    assert.ok(json.prompt.includes('Write the invariant test first'), 'the branch did not fire');
    assert.ok(!json.prompt.includes(CLAUSE));
  });

  test('the switch adds it, and the prompt still passes the gate', () => {
    const { json } = testFirstRun(on);
    assert.equal(json.ok, true, JSON.stringify(json));
    assert.ok(json.prompt.includes(CLAUSE), 'the switch did not add the clause');
    assert.equal(json.gate.ok, true, JSON.stringify(json.gate));
  });

  test('it costs nothing on a handoff that is not testFirst', () => {
    const { json } = run(project, {
      title: 'Fix the token refresh bug',
      what: 'Fix the retry path in the auth middleware so the failing test passes.',
      planned_touches: ['src/auth/middleware.js'],
      destination: 'clipboard',
      request: 'Fix the token refresh bug in the auth middleware.',
      judgment: goodJudgment(),
    }, on);
    assert.equal(json.ok, true, JSON.stringify(json));
    assert.ok(!json.prompt.includes(CLAUSE), 'the clause leaked outside the testFirst branch');
  });

  test('the clause is the only difference the prompt shows', () => {
    const plain = testFirstRun().json.prompt;
    const clause = testFirstRun(on).json.prompt;
    assert.equal(clause.replace(CLAUSE + ' Write it to hold for every input the rule covers, not only the one named here.\n', ''), plain);
  });

  test('an unrecognised value keeps today behaviour', () => {
    for (const value of ['', '0', 'false', 'yes']) {
      const { json } = testFirstRun({ FOREMAN_TEST_GAMING_CLAUSE: value });
      assert.ok(!json.prompt.includes(CLAUSE), `"${value}" turned the clause on; only 1 and true may`);
    }
  });
});

// [Foreman 4a] The extras clause — "if you find a pre-existing bug next door,
// report it, don't fix it here" — was measured over 48 sessions and DECLINED:
// zero extras in either control on two task shapes and two models, and +40%
// output tokens on Sonnet. Unlike §4.1-4.3 no switch was kept, so nothing in
// the product emits it; the arms live entirely in the benchmark harness. This
// test guards the absence, so a future edit cannot reintroduce it silently.
describe('the extras clause is not in the product', () => {
  test('no crafted prompt carries it, on either profile', () => {
    const build = (judgmentOverrides) => run(project, {
      title: 'Fix the token refresh bug',
      what: 'Fix the retry path in the auth middleware so the failing test passes.',
      planned_touches: ['src/auth/middleware.js'],
      destination: 'clipboard',
      request: 'Fix the token refresh bug in the auth middleware.',
      judgment: goodJudgment(judgmentOverrides),
    }, { FOREMAN_EXTRAS_CLAUSE: '1' });

    for (const overrides of [{}, { testFirst: true }, { constraints: [] }]) {
      const { json } = build(overrides);
      assert.equal(json.ok, true, JSON.stringify(json));
      assert.ok(
        !json.prompt.includes('you find a pre-existing bug'),
        'the extras clause is back in the product — it was measured and declined'
      );
    }
  });
});


// [Foreman: 259] The symbol list was the one block this assembler printed
// without a ceiling — prior work has RECALL_MAX_CHARS, notes NOTES_KEEP,
// anchors ANCHOR_KEEP. A long single-file module resolved to hundreds of
// names and buried the handful the task touches.
describe('relevant_files symbol cap', () => {
  function file(count) {
    return {
      path: 'src/big.js',
      symbols: Array.from({ length: count }, (_, i) => ({ name: 'sym' + i, line: i + 1 })),
    };
  }

  test('a file at or under the cap prints every symbol and no tail', () => {
    const text = relevantFilesText([file(SYMBOL_KEEP)], [], []);
    assert.equal(text.split(', ').length, SYMBOL_KEEP);
    assert.ok(!text.includes('more top-level definitions'), text);
  });

  test('a file over the cap prints exactly the cap and states what was cut', () => {
    const text = relevantFilesText([file(SYMBOL_KEEP + 30)], [], []);
    assert.ok(text.includes('sym' + (SYMBOL_KEEP - 1) + ' (' + SYMBOL_KEEP + ')'), text);
    assert.ok(!text.includes('sym' + SYMBOL_KEEP + ' '), 'a symbol past the cap was printed');
    assert.ok(text.includes('and 30 more top-level definitions — read the file'), text);
  });

  test("names the entry's own prose uses lead, however late they sit in the file", () => {
    const record = { title: 'Fix it', what: 'Make `sym99` call `sym98` before returning' };
    const text = relevantFilesText([file(120)], [], [], record);
    assert.match(text, /^src\/big\.js — sym98 \(99\), sym99 \(100\), sym0 \(1\)/);
    assert.ok(text.includes('and 108 more top-level definitions'), text);
  });

  // [Foreman: 293] The why is the entry's prose too: a live handoff left out the
  // one function the task was about because only the why named it.
  test("a name the entry's why uses leads as well", () => {
    const record = { title: 'Fix it', why: '`sym77` returns the wrong value for even-length input.', what: 'Fix the branch.' };
    const text = relevantFilesText([file(120)], [], [], record);
    assert.match(text, /^src\/big\.js — sym77 \(78\), sym0 \(1\)/);
  });

  // Review of 293: a why that names earlier symbols must not push the what's
  // own symbol down the list or out of the chain's four slots.
  test("what-named symbols lead why-named ones, whatever their file order", () => {
    const record = { title: 'Fix it', why: 'Callers `sym1`, `sym2`, `sym3`, `sym4` all break on it.', what: 'Fix `sym50`.' };
    const text = relevantFilesText([file(120)], [], [], record);
    assert.match(text, /^src\/big\.js — sym50 \(51\), sym1 \(2\), sym2 \(3\), sym3 \(4\), sym4 \(5\), sym0 \(1\)/);
  });

  test('the chain traces what-named symbols before why-named ones, then caps', () => {
    const { chainCandidates, CHAIN_MAX_SYMBOLS } = require(path.join(SCRIPTS_DIR, 'craft-handoff.js'));
    const record = { title: 'Fix it', why: 'Callers `sym1`, `sym2`, `sym3`, `sym4` all break on it.', what: 'Fix `sym50`.' };
    const pairs = chainCandidates(record, [file(120)]);
    assert.equal(pairs.length, CHAIN_MAX_SYMBOLS);
    assert.deepEqual(pairs.map((p) => p.name), ['sym50', 'sym1', 'sym2', 'sym3']);
    assert.ok(pairs.every((p) => !('rank' in p)), 'rank is internal to the ranking');
  });

  // [Foreman: 276] A split row after the first carries only goal/files/Run/
  // Expected, so a pair with neither goal nor files becomes a task whose whole
  // description is a command. Splitting on typecheck/test/lint is the case
  // that found this: one task holds the work, two hold nothing.
  test('a split whose later rows carry no work warns, and one that slices does not', () => {
    const project = makeTmpProject();
    writeSourceFile(project);
    writeRoadmap(project, [entryFields()]);
    const gates = [
      { run: 'npm run typecheck', expected: 'exits 0' },
      { run: 'npm test', expected: 'all tests pass' },
      { run: 'npm run lint', expected: 'exits 0' },
    ];

    const { json } = run(project, {
      entry: '001',
      destination: 'task',
      split: true,
      judgment: goodJudgment({ verification: gates }),
    });
    assert.equal(json.ok, true, JSON.stringify(json));
    const warned = json.warnings.find((w) => w.includes('carrying no work'));
    assert.ok(warned, JSON.stringify(json.warnings));
    assert.ok(warned.includes('2 tasks'), warned);
    assert.ok(warned.includes('`npm test`') && warned.includes('`npm run lint`'), warned);

    // [Foreman: 277] The clipboard embed asks the pasted session for the same
    // one-task-per-check rows, so it carries the same exposure. The first cut
    // of this warning was gated on `tasks`, which only exists for the task
    // destination, so the clipboard door was silent.
    const clip = run(project, {
      entry: '001',
      destination: 'clipboard',
      judgment: goodJudgment({ verification: gates }),
    });
    assert.ok(
      clip.json.warnings.some((w) => w.includes('carrying no work')),
      JSON.stringify(clip.json.warnings)
    );

    // [Foreman: 280] A pair carrying its own `subject` and nothing else is a
    // real row — buildTaskRows writes `pair.goal || subject`. The first cut of
    // this filter read only goal and files, so a live split whose rows read
    // "Cover the two counts with a fixture test" was reported as empty.
    const subjects = run(project, {
      entry: '001',
      destination: 'task',
      split: true,
      judgment: goodJudgment({
        verification: gates.map((g, i) => ({ ...g, subject: `Slice ${i + 1} of the work` })),
      }),
    });
    assert.ok(
      !subjects.json.warnings.some((w) => w.includes('carrying no work')),
      JSON.stringify(subjects.json.warnings)
    );

    const sliced = run(project, {
      entry: '001',
      destination: 'task',
      split: true,
      judgment: goodJudgment({
        verification: [
          { run: 'npm run typecheck', expected: 'exits 0' },
          { run: 'npm test', expected: 'all tests pass', goal: 'Cover the new branch', files: ['src/auth/middleware.js'] },
        ],
      }),
    });
    assert.ok(!sliced.json.warnings.some((w) => w.includes('carrying no work')), JSON.stringify(sliced.json.warnings));
  });

  // [Foreman: 274] relevant_files ships on BOTH profiles, and it tells the
  // session a MISSING: path may be one this task creates. The no-invention
  // rule told it the opposite, in the same prompt. Entry 271 fixed the gate
  // and left the clause, so every prompt planning a new file carried both.
  test('both profiles except a MISSING: path from the no-invention rule', () => {
    const project = makeTmpProject();
    writeSourceFile(project);

    writeRoadmap(project, [entryFields()]);
    const standard = run(project, { entry: '001', destination: 'clipboard', judgment: goodJudgment() });
    assert.equal(standard.json.profile, 'standard');
    assert.ok(standard.json.prompt.includes('unless `relevant_files` marks that path `MISSING:`'), standard.json.prompt);

    writeRoadmap(project, [entryFields({ commits: ['a1b2c3d'] })]);
    const reinforced = run(project, { entry: '001', destination: 'clipboard', judgment: goodJudgment() });
    assert.equal(reinforced.json.profile, 'reinforced');
    assert.ok(reinforced.json.prompt.includes('is the exception: that marker says the plan named the file before it existed'), reinforced.json.prompt);
  });

  // [Foreman: 275] References are per-symbol, so several symbols living in one
  // file printed that file once each. A live prompt carried 11 Pattern lines
  // naming 5 files.
  test('references sharing a file print one Pattern line, not one per symbol', () => {
    const refs = [
      { files: ['electron/main/workspace/kinds.ts'] },
      { files: ['electron/main/workspace/kinds.ts'] },
      { files: ['electron/main/workspace/sessions.ts'] },
      { files: ['electron/main/workspace/kinds.ts'] },
    ];
    const lines = relevantFilesText([], refs, []).split('\n');
    assert.deepEqual(lines, [
      "Pattern: electron/main/workspace/kinds.ts — shares an import with this task's files; read it as the existing analogue before writing new code",
      "Pattern: electron/main/workspace/sessions.ts — shares an import with this task's files; read it as the existing analogue before writing new code",
    ]);
  });

  // [Foreman: 292] The script-added Pattern line names the shared import it
  // rests on instead of instructing the session to build the same way.
  test('a Pattern line states the shared import, never a bare directive', () => {
    const refs = [{ helper: 'src/lib/sign.ts', files: ['src/webhooks/github.ts', 'src/webhooks/slack.ts'] }];
    const lines = relevantFilesText([], refs, []).split('\n');
    assert.deepEqual(lines, [
      "Pattern: src/webhooks/github.ts — imports src/lib/sign.ts, as this task's files do; read it as the existing analogue before writing new code",
    ]);
    assert.ok(!lines[0].includes('build the new code the same way'));
  });

  test('rankSymbols reports the count it dropped, never a silent truncation', () => {
    const { kept, dropped } = rankSymbols(file(40).symbols, new Set());
    assert.equal(kept.length, SYMBOL_KEEP);
    assert.equal(dropped, 40 - SYMBOL_KEEP);
  });

  test('an entry with no prose still caps, in file order', () => {
    const text = relevantFilesText([file(20)], [], [], { title: '', what: '' });
    assert.match(text, /^src\/big\.js — sym0 \(1\), sym1 \(2\)/);
    assert.ok(text.includes('and 8 more top-level definitions'), text);
  });

  test('a real assembled handoff carries the capped block', () => {
    const project = makeTmpProject();
    fs.writeFileSync(
      path.join(project, 'big.js'),
      Array.from({ length: 60 }, (_, i) => 'function widget' + i + '() {}').join('\n')
    );
    writeConfig(project, {});
    writeRoadmap(project, [{
      id: '001',
      title: 'Rework widget3',
      why: 'it is wrong',
      what: 'Make `widget3` return early',
      status: 'planned',
      source: 'user',
      depends_on: [],
      planned_touches: ['big.js'],
      observed_touches: [],
      commits: [],
      created_at: today(),
      updated_at: today(),
      notes: '',
    }]);
    const { prompt } = assemble(project, { entry: '001', destination: 'task', judgment: goodJudgment() });
    assert.ok(prompt.includes('widget3 ('), 'the prose-named symbol is missing');
    assert.ok(prompt.includes('more top-level definitions — read the file'), 'the cap note is missing');
    assert.ok(!prompt.includes('widget59 ('), 'the whole file surface leaked into the prompt');
  });
});

// [Foreman] `<context>` renders on the reinforced profile only. That is
// deliberate, but it used to be silent: a crafting session could put a
// load-bearing fact in `judgment.context` and never learn the standard
// handoff shipped without it. Found by rendering a benchmark arm and diffing
// it against the facts it was built from — the `fix location:` line was gone.
describe('judgment.context and the standard profile', () => {
  const dropped = (json) => (json.warnings || []).some((w) => w.includes('judgment.context was dropped'));

  test('standard preserves observable invariants even if the project omits background', () => {
    writeRoadmap(project, [entryFields()]);
    writeConfig(project, { omitSections: ['background'] });
    const invariants = ['An expired token returns HTTP 401.', 'A valid token preserves the session.'];
    const { json } = run(project, { entry: '001', destination: 'task', judgment: goodJudgment({ invariants }) });
    assert.equal(json.profile, 'standard');
    assert.equal(json.gate.ok, true);
    assert.ok(!json.prompt.includes('<background>'));
    const actual = json.prompt.match(/<invariants>\n([\s\S]*?)\n<\/invariants>/);
    assert.ok(actual);
    assert.deepEqual(actual[1].split('\n'), invariants);
  });

  test('standard retains supplied evidence and context without profile inflation', () => {
    writeRoadmap(project, [entryFields()]);
    const { json } = run(project, { entry: '001', destination: 'clipboard', judgment: goodJudgment() });
    assert.equal(json.profile, 'standard');
    assert.ok(json.prompt.includes('<context>'));
    assert.ok(json.prompt.includes(goodJudgment().context));
    assert.ok(!dropped(json));
  });

  test('reinforced renders it and stays quiet', () => {
    writeRoadmap(project, [entryFields({ commits: ['a1b2c3d'] })]);
    const { json } = run(project, { entry: '001', destination: 'clipboard', judgment: goodJudgment() });
    assert.equal(json.profile, 'reinforced');
    assert.ok(json.prompt.includes('<context>'), 'reinforced dropped <context>');
    assert.ok(!dropped(json), `warned on a profile that carries it: ${JSON.stringify(json.warnings)}`);
  });

  test('no context supplied, nothing to warn about', () => {
    writeRoadmap(project, [entryFields()]);
    const { json } = run(project, {
      entry: '001',
      destination: 'clipboard',
      judgment: goodJudgment({ context: '' }),
    });
    assert.equal(json.ok, true, JSON.stringify(json));
    assert.ok(!dropped(json), `warned with no context given: ${JSON.stringify(json.warnings)}`);
  });
});

// [Foreman: 291] Two facts the entry already carries now reach the handoff
// mechanically instead of through the crafting session's memory: the why, as
// the task's stated intention, and planned_touches, as the scope baseline.
describe('the entry relays its own why and file surface', () => {
  test("task_context carries the entry's why word for word, under the goal", () => {
    writeRoadmap(project, [entryFields({ why: 'Sessions   expire mid-request under load.' })]);
    const { json } = run(project, { entry: '001', destination: 'clipboard', judgment: goodJudgment() });
    assert.equal(json.ok, true, JSON.stringify(json));
    const block = json.prompt.slice(json.prompt.indexOf('<task_context>'), json.prompt.indexOf('</task_context>'));
    assert.match(block, /Your goal is to fix the token refresh bug so all tests pass\.\nWhy this task exists: Sessions expire mid-request under load\.\n$/);
  });

  test('the why wins over a purpose the crafting session passed for an entry, and says so', () => {
    writeRoadmap(project, [entryFields()]);
    const { json } = run(project, { entry: '001', destination: 'clipboard', judgment: goodJudgment({ purpose: 'This informs a PR description.' }) });
    assert.ok(json.prompt.includes('Why this task exists: Sessions expire mid-request under load.'));
    assert.ok(!json.prompt.includes('This informs a PR description.'));
    assert.ok(json.warnings.some((w) => w.startsWith('judgment.purpose was dropped')), JSON.stringify(json.warnings));
  });

  test('no purpose passed, no drop warning', () => {
    writeRoadmap(project, [entryFields()]);
    const { json } = run(project, { entry: '001', destination: 'clipboard', judgment: goodJudgment() });
    assert.ok(!json.warnings.some((w) => w.startsWith('judgment.purpose was dropped')), JSON.stringify(json.warnings));
  });

  // The gate reads the opener only, so an entry whose why quotes "you are"
  // still assembles in a usePersona:false project.
  test('a why quoting "you are" passes the gate in a usePersona:false project', () => {
    writeConfig(project, { usePersona: false });
    writeRoadmap(project, [entryFields({ why: 'Support tickets keep saying "you are a slow app" whenever a token expires mid-request.' })]);
    const { json } = run(project, { entry: '001', destination: 'clipboard', judgment: goodJudgment() });
    assert.equal(json.ok, true, JSON.stringify(json.gate));
    assert.ok(json.prompt.includes('Domain: a senior backend engineer.'));
  });

  test('an entry-less handoff keeps the purpose line the interview gathered', () => {
    writeRoadmap(project, []);
    const { json } = run(project, {
      title: 'Fix token refresh',
      what: 'Refresh before expiry.',
      touches: ['src/auth/middleware.js'],
      destination: 'clipboard',
      judgment: goodJudgment({ purpose: 'This informs a PR description.' }),
    });
    assert.equal(json.ok, true, JSON.stringify(json));
    assert.ok(json.prompt.includes('Your goal is to fix the token refresh bug so all tests pass.\nThis informs a PR description.'));
    assert.ok(!json.prompt.includes('Why this task exists:'));
  });

  test('an entry-less handoff with neither why nor purpose adds no line', () => {
    writeRoadmap(project, []);
    const { json } = run(project, {
      title: 'Fix token refresh',
      what: 'Refresh before expiry.',
      touches: ['src/auth/middleware.js'],
      destination: 'clipboard',
      judgment: goodJudgment(),
    });
    assert.match(json.prompt, /Your goal is to fix the token refresh bug so all tests pass\.\n<\/task_context>/);
  });

  test('the expected file surface is filled from planned_touches when the judgment names none', () => {
    writeRoadmap(project, [entryFields({ planned_touches: ['src/auth/middleware.js', 'src/auth/'] })]);
    const { json } = run(project, { entry: '001', destination: 'clipboard', judgment: goodJudgment() });
    assert.equal(json.ok, true, JSON.stringify(json));
    assert.ok(
      json.prompt.includes('Expected file surface: src/auth/middleware.js, src/auth/. Anything beyond this list gets flagged to the user before it is written, not after.'),
      json.prompt
    );
  });

  test('a judgment expectedFileSurface still wins over planned_touches', () => {
    writeRoadmap(project, [entryFields()]);
    const { json } = run(project, { entry: '001', destination: 'clipboard', judgment: goodJudgment({ expectedFileSurface: 'src/auth/middleware.js only' }) });
    assert.ok(json.prompt.includes('Expected file surface: src/auth/middleware.js only.'));
    assert.equal((json.prompt.match(/Expected file surface:/g) || []).length, 1);
  });

  test('an entry-less handoff derives the surface from touches the same way', () => {
    writeRoadmap(project, []);
    const { json } = run(project, {
      title: 'Fix token refresh',
      what: 'Refresh before expiry.',
      touches: ['src/auth/middleware.js'],
      destination: 'clipboard',
      judgment: goodJudgment(),
    });
    assert.ok(json.prompt.includes('Expected file surface: src/auth/middleware.js.'), json.prompt);
  });
});
