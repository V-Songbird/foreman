'use strict';

// Tests for hooks/post-commit.js — the only hook Foreman ships post-redesign.
//
// Covers:
//   - only fires on Bash/PowerShell tool calls that are actually `git commit`
//   - silent when ROADMAP.jsonl doesn't exist (zero-config: never ran /foreman:init)
//   - status-sync block appears whenever an in_progress entry exists, or a
//     done entry was updated earlier today (same-day follow-up fix commit)
//   - discovery block appears unless .foreman/config.json sets
//     discoverySuggestions:false, and carries no roadmap titles when it does
//   - requireVerification:true withholds the done transition until the user
//     confirms, without affecting the freshly-done follow-up branch
//   - malformed/missing config lands on every key's default, so both
//     discoverySuggestions and requireVerification read as on
//   - a failed commit (confirmed nonzero exit code) stays silent
//   - a commit with no confirmed exit code fails open (still fires)

const { test, describe, beforeEach } = require('node:test');
const assert = require('node:assert/strict');

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const {
  runScriptRaw,
  makeTmpProject,
  writeRoadmap,
  writeConfig,
  initGitRepo,
  commitFile,
} = require('./helpers');

let project;
let env;

// [Foreman: 193] The hook now resolves which repo scope the commit's own
// cwd belongs to before reading anything, so every fixture needs a real git
// repo at `project` for that resolution to land on the root scope — a
// project with no `.git` at all is no longer distinguishable from "this
// commit happened in some unrelated repository" and goes silent (see the
// dedicated 'commit scope resolution' suite below).
beforeEach(() => {
  project = makeTmpProject();
  initGitRepo(project);
  env = { CLAUDE_PROJECT_DIR: project };
});

// cwd mirrors the hook input's own field — the resolver matches it against
// `project`'s git toplevel to confirm the commit landed in this project's
// repo, not an unrelated one elsewhere on disk.
function bashPayload(command, extra) {
  return { tool_name: 'Bash', tool_input: { command }, cwd: project, ...(extra || {}) };
}

/** Commit with an explicit message, in `cwd`. Returns the short sha. */
function commitWithMessage(cwd, relPath, content, message) {
  const full = path.join(cwd, relPath);
  fs.mkdirSync(path.dirname(full), { recursive: true });
  fs.writeFileSync(full, content, 'utf-8');
  spawnSync('git', ['add', relPath], { cwd });
  spawnSync('git', ['commit', '-q', '-m', message], { cwd });
  return spawnSync('git', ['rev-parse', '--short', 'HEAD'], { cwd, encoding: 'utf-8' }).stdout.trim();
}

/**
 * A submodule the way the resolver actually finds one: `.gitmodules` names
 * the path and a real git repo sits there. Same pattern as
 * tests/commit_evidence.test.js's addSubmodule.
 */
function addSubmodule(root, name) {
  fs.appendFileSync(
    path.join(root, '.gitmodules'),
    `[submodule "${name}"]\n\tpath = ${name}\n\turl = ./${name}\n`,
    'utf-8'
  );
  const sub = path.join(root, name);
  fs.mkdirSync(sub, { recursive: true });
  initGitRepo(sub);
  return sub;
}

function run(payload) {
  const result = runScriptRaw('post-commit.js', payload, env);
  assert.equal(result.status, 0, result.stderr);
  return result.stdout;
}

// The emitted context with the JSON envelope's escaping undone — for
// assertions on the literal roadmap.js commands, which are full of quotes.
function context(payload) {
  const out = run(payload);
  return JSON.parse(out).hookSpecificOutput.additionalContext;
}

describe('non-matching tool calls', () => {
  test('non-Bash/PowerShell tool stays silent', () => {
    const out = run({ tool_name: 'Read', tool_input: { file_path: 'x' } });
    assert.equal(out, '');
  });

  test('Bash command that is not a git commit stays silent', () => {
    writeRoadmap(project, [{ id: '001', status: 'in_progress' }]);
    const out = run(bashPayload('git status'));
    assert.equal(out, '');
  });

  test('git commit as a substring of another word stays silent', () => {
    writeRoadmap(project, [{ id: '001', status: 'in_progress' }]);
    const out = run(bashPayload('echo "not-a-git-commit-invocation"'));
    assert.equal(out, '');
  });

  // The subcommand is the first token that is not a global option, so a
  // `commit` sitting anywhere else on the line is not this commit.
  test('a git subcommand that only mentions commit stays silent', () => {
    writeRoadmap(project, [{ id: '001', status: 'in_progress' }]);
    assert.equal(run(bashPayload('git log --grep commit')), '');
    assert.equal(run(bashPayload('git -c commit.gpgsign=false log')), '');
  });
});

describe('no ROADMAP.jsonl', () => {
  test('stays completely silent — never ran /foreman:init', () => {
    const out = run(bashPayload('git commit -m "wip"'));
    assert.equal(out, '');
  });
});

describe('corrupt ROADMAP.jsonl', () => {
  test('nudges toward doctor (read-only) instead of staying silent', () => {
    const fs = require('fs');
    const path = require('path');
    fs.writeFileSync(path.join(project, 'ROADMAP.jsonl'), 'not json at all\n', 'utf-8');
    const out = run(bashPayload('git commit -m "wip"'));
    assert.match(out, /could not be parsed/i);
    assert.match(out, /roadmap\.js\\?" doctor/);
    assert.match(out, /only reports, it never rewrites/);
    assert.doesNotMatch(out, /update-status/);
  });

  test('a healthy file is unaffected', () => {
    writeRoadmap(project, [{ id: '001', status: 'in_progress' }]);
    const out = run(bashPayload('git commit -m "finish task"'));
    assert.doesNotMatch(out, /could not be parsed/);
    assert.match(out, /may complete an in-progress/i);
  });
});

describe('status-sync block', () => {
  test('fires when an in_progress entry exists, discovery off', () => {
    writeRoadmap(project, [{ id: '001', status: 'in_progress' }]);
    writeConfig(project, { discoverySuggestions: false });
    const out = run(bashPayload('git commit -m "finish task"'));
    assert.match(out, /status-sync|in-progress ROADMAP/i);
    assert.doesNotMatch(out, /Roadmap discovery is enabled/);
  });

  test('does not fire when nothing is in_progress', () => {
    writeRoadmap(project, [{ id: '001', status: 'planned' }]);
    writeConfig(project, { discoverySuggestions: false });
    const out = run(bashPayload('git commit -m "unrelated"'));
    assert.equal(out, '');
  });

  test('mentions that observed_touches auto-folds from the commit, no manual listing needed', () => {
    writeRoadmap(project, [{ id: '001', status: 'in_progress' }]);
    const out = run(bashPayload('git commit -m "finish task"'));
    assert.match(out, /auto-folds/);
  });

  test('git commit --amend still fires', () => {
    writeRoadmap(project, [{ id: '001', status: 'in_progress' }]);
    const out = run(bashPayload('git commit --amend --no-edit'));
    assert.notEqual(out, '');
  });

  test('git commit inside a && chain still fires', () => {
    writeRoadmap(project, [{ id: '001', status: 'in_progress' }]);
    const out = run(bashPayload('git add -A && git commit -m "wip"'));
    assert.notEqual(out, '');
  });

  test('PowerShell tool_name also matches', () => {
    writeRoadmap(project, [{ id: '001', status: 'in_progress' }]);
    const result = runScriptRaw(
      'post-commit.js',
      { tool_name: 'PowerShell', tool_input: { command: 'git commit -m "wip"' }, cwd: project },
      env
    );
    assert.notEqual(result.stdout, '');
  });

  // `git -C <dir> commit` and friends carry their value in a separate token,
  // which a flags-only skip walked straight past.
  test('global options before the subcommand still read as a commit', () => {
    writeRoadmap(project, [{ id: '001', status: 'in_progress' }]);
    for (const command of [
      'git -C . commit -m "wip"',
      'git -c user.name=a commit -m "wip"',
      'git --git-dir .git commit -m "wip"',
      'git --no-pager commit -m "wip"',
    ]) {
      assert.notEqual(run(bashPayload(command)), '', command);
    }
  });
});

describe('freshly-done follow-up fix', () => {
  // Local date, matching roadmap.js's today() — toISOString() is the UTC
  // day, which diverges from the hook's comparison for a few hours around
  // midnight UTC and made these tests time-of-day-dependent.
  function todayStr() {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  }

  test('fires when a done entry was updated earlier today', () => {
    writeRoadmap(project, [
      { id: '001', title: 'ship the thing', status: 'done', updated_at: todayStr() },
    ]);
    const out = run(bashPayload('git commit -m "fix bug found right after"'));
    assert.match(out, /follow-up fix/i);
    assert.match(out, /001/);
    assert.match(out, /auto-folds/);
  });

  test('does not fire for a done entry updated on an earlier day', () => {
    writeRoadmap(project, [
      { id: '001', title: 'ship the thing', status: 'done', updated_at: '2020-01-01' },
    ]);
    writeConfig(project, { discoverySuggestions: false });
    const out = run(bashPayload('git commit -m "unrelated later work"'));
    assert.equal(out, '');
  });

  test('in_progress and freshly-done both surface together', () => {
    writeRoadmap(project, [
      { id: '001', title: 'older task', status: 'in_progress' },
      { id: '002', title: 'ship the thing', status: 'done', updated_at: todayStr() },
    ]);
    const out = run(bashPayload('git commit -m "wip"'));
    assert.match(out, /in-progress ROADMAP/i);
    assert.match(out, /follow-up fix/i);
  });
});

// [Foreman: 194] Under the default requireVerification:true, a finished
// entry sits in awaiting_acceptance — neither in_progress nor done-today —
// so a follow-up fix commit landing while it waits used to get no nudge at
// all and its SHA was silently lost. Unlike done-today, no date filter: an
// awaiting entry can sit for days before the user answers.
describe('awaiting-acceptance follow-up nudge', () => {
  function todayStr() {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  }

  test('fires for an awaiting_acceptance entry no matter how long it has waited', () => {
    writeRoadmap(project, [
      { id: '001', title: 'ship the thing', status: 'awaiting_acceptance', updated_at: '2020-01-01' },
    ]);
    const out = run(bashPayload('git commit -m "fix bug found while it waits"'));
    assert.match(out, /follow-up fix/i);
    assert.match(out, /001/);
  });

  test('the recording command keeps each id at its own current status, not a blanket one', () => {
    writeConfig(project, { discoverySuggestions: false });
    writeRoadmap(project, [
      { id: '001', title: 'ship the thing', status: 'done', updated_at: todayStr() },
      { id: '002', title: 'wait for yes', status: 'awaiting_acceptance' },
    ]);
    const out = context(bashPayload('git commit -m "fix bug"'));
    assert.match(out, /001 \("ship the thing", status: done\)/);
    assert.match(out, /002 \("wait for yes", status: awaiting_acceptance\)/);
    // no blanket "status":"done" template that would silently close 002
    assert.doesNotMatch(out, /"status":"done","commit":"<sha>"/);
  });
});

describe('requireVerification gate', () => {
  test('default (on): records the commit but withholds done, with no config at all', () => {
    writeRoadmap(project, [{ id: '001', status: 'in_progress' }]);
    const out = run(bashPayload('git commit -m "finish task"'));
    assert.match(out, /may complete an in-progress/i);
    assert.match(out, /requireVerification is on/);
  });

  test('off: an explicit false nudges to mark done directly', () => {
    writeRoadmap(project, [{ id: '001', status: 'in_progress' }]);
    writeConfig(project, { requireVerification: false });
    const out = run(bashPayload('git commit -m "finish task"'));
    assert.match(out, /may complete an in-progress/i);
    assert.doesNotMatch(out, /requireVerification is on/);
  });

  test('on: records the commit but withholds done until the user confirms', () => {
    writeRoadmap(project, [{ id: '001', status: 'in_progress' }]);
    writeConfig(project, { requireVerification: true });
    const out = run(bashPayload('git commit -m "finish task"'));
    assert.match(out, /requireVerification is on/);
    assert.match(out, /ask the user/);
    assert.match(out, /don't close it out yet/);
    assert.match(out, /confirmation/i);
  });

  // [Foreman: 131] The recorded step now stores what is true — finished,
  // waiting on the user — instead of leaving the entry looking mid-work.
  // The question mechanics are unchanged either side of it.
  test('on: the recorded step stores awaiting_acceptance, and confirming still closes done', () => {
    writeRoadmap(project, [{ id: '001', status: 'in_progress' }]);
    writeConfig(project, { requireVerification: true });
    const out = context(bashPayload('git commit -m "finish task"'));
    assert.match(out, /"status":"awaiting_acceptance","commit":"<sha>"/);
    assert.match(out, /"status":"done"/);
  });

  test('on: a declined confirmation sends the entry back to in_progress', () => {
    writeRoadmap(project, [{ id: '001', status: 'in_progress' }]);
    writeConfig(project, { requireVerification: true });
    const out = context(bashPayload('git commit -m "finish task"'));
    assert.match(out, /If they say it's not ready, send it back/);
    assert.match(out, /"status":"in_progress","notes":"<what they said>"/);
  });

  test('on: a session with no user leaves it awaiting, not in_progress', () => {
    writeRoadmap(project, [{ id: '001', status: 'in_progress' }]);
    writeConfig(project, { requireVerification: true });
    const out = run(bashPayload('git commit -m "finish task"'));
    assert.match(out, /background\s+agent\), leave it awaiting_acceptance/);
  });

  test('off: the direct-close nudge never mentions the awaiting state', () => {
    writeRoadmap(project, [{ id: '001', status: 'in_progress' }]);
    writeConfig(project, { requireVerification: false });
    const out = context(bashPayload('git commit -m "finish task"'));
    assert.doesNotMatch(out, /awaiting_acceptance/);
    assert.match(out, /"status":"done","commit":"<sha>"/);
  });

  test('on: does not affect the freshly-done follow-up branch', () => {
    const d = new Date();
    const localToday = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    writeRoadmap(project, [
      { id: '001', title: 'ship the thing', status: 'done', updated_at: localToday },
    ]);
    writeConfig(project, { requireVerification: true });
    const out = run(bashPayload('git commit -m "fix bug found right after"'));
    assert.match(out, /follow-up fix/i);
    assert.doesNotMatch(out, /requireVerification is on/);
  });

  // A config nobody can parse is not a project opting out — it falls to the
  // same safe default an absent config gets.
  test('malformed config treated as requireVerification:true', () => {
    writeRoadmap(project, [{ id: '001', status: 'in_progress' }]);
    const fs = require('fs');
    const path = require('path');
    fs.mkdirSync(path.join(project, '.foreman'), { recursive: true });
    fs.writeFileSync(path.join(project, '.foreman', 'config.json'), '{not json', 'utf-8');
    const out = run(bashPayload('git commit -m "finish task"'));
    assert.match(out, /requireVerification is on/);
  });
});

describe('discovery block', () => {
  test('fires when discoverySuggestions is true', () => {
    writeRoadmap(project, [{ id: '001', status: 'planned' }]);
    writeConfig(project, { discoverySuggestions: true });
    const out = run(bashPayload('git commit -m "add feature"'));
    assert.match(out, /Roadmap discovery is enabled/);
  });

  test('also offers logging of separately authorized work already implemented', () => {
    writeRoadmap(project, [{ id: '001', status: 'planned' }]);
    writeConfig(project, { discoverySuggestions: true });
    const out = run(bashPayload('git commit -m "add feature"'));
    assert.match(out, /separate authorized work already implemented inline/);
    assert.match(out, /Log it/);
  });

  // [Foreman: 127] The planned titles used to be inlined as a negative list,
  // so the block grew with the backlog. Dedup now rides entirely on the
  // compact check-duplicate CLI — no roadmap content in the context at all.
  test('injects no roadmap titles, and mandates the check-duplicate call instead', () => {
    writeRoadmap(project, [
      { id: '001', title: 'Zorptastic JWT refresh', status: 'planned' },
      { id: '002', title: 'Quibbleframe the parser', status: 'planned' },
      { id: '003', title: 'Ship the flumaxinator', status: 'done' },
      { id: '004', title: 'Abandoned wugglesnort', status: 'dropped' },
    ]);
    writeConfig(project, { discoverySuggestions: true });
    const out = run(bashPayload('git commit -m "add feature"'));
    assert.match(out, /Roadmap discovery is enabled/);
    for (const title of [
      'Zorptastic',
      'Quibbleframe',
      'flumaxinator',
      'wugglesnort',
      'already on the roadmap as planned',
    ]) {
      assert.doesNotMatch(out, new RegExp(title));
    }
    assert.match(out, /check-duplicate/);
    assert.ok(JSON.parse(out).hookSpecificOutput.additionalContext.includes(require('../scripts/discovery').discoveryInstructions()));
  });

  test('fires by default when config is missing', () => {
    writeRoadmap(project, [{ id: '001', status: 'planned' }]);
    const out = run(bashPayload('git commit -m "add feature"'));
    assert.match(out, /Roadmap discovery is enabled/);
  });

  // A config nobody can parse holds no opt-out, so it lands on the default —
  // the same reading requireVerification already takes.
  test('fires when config is malformed JSON', () => {
    writeRoadmap(project, [{ id: '001', status: 'planned' }]);
    const fs = require('fs');
    const path = require('path');
    fs.mkdirSync(path.join(project, '.foreman'), { recursive: true });
    fs.writeFileSync(path.join(project, '.foreman', 'config.json'), '{not json', 'utf-8');
    const out = run(bashPayload('git commit -m "add feature"'));
    assert.match(out, /Roadmap discovery is enabled/);
  });

  test('the status-sync block still fires alongside it, unconfigured', () => {
    writeRoadmap(project, [{ id: '001', title: 'Wugglesnort the thing', status: 'in_progress' }]);
    const out = run(bashPayload('git commit -m "finish task"'));
    assert.match(out, /may complete an in-progress/i);
    assert.match(out, /Wugglesnort the thing/);
    assert.match(out, /Roadmap discovery is enabled/);
  });

  // The one way out, and the only value that takes it.
  test('does not fire when discoverySuggestions is explicitly false', () => {
    writeRoadmap(project, [{ id: '001', status: 'planned' }]);
    writeConfig(project, { discoverySuggestions: false });
    const out = run(bashPayload('git commit -m "add feature"'));
    assert.equal(out, '');
  });

  test('both blocks fire together when applicable', () => {
    writeRoadmap(project, [{ id: '001', status: 'in_progress' }]);
    writeConfig(project, { discoverySuggestions: true });
    const out = run(bashPayload('git commit -m "wip"'));
    assert.match(out, /Roadmap discovery is enabled/);
    assert.match(out, /in-progress ROADMAP/i);
  });
});

describe('freshly-done nudge fires once per entry per day', () => {
  function todayStr() {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  }

  test('second commit the same day stays silent for an already-nudged entry', () => {
    writeRoadmap(project, [{ id: '001', title: 'done today', status: 'done', updated_at: todayStr() }]);
    writeConfig(project, { discoverySuggestions: false });
    const first = run(bashPayload('git commit -m "fix 1"'));
    assert.match(first, /follow-up fix/);
    const second = run(bashPayload('git commit -m "fix 2"'));
    assert.equal(second, '');
  });

  test('a different freshly-done entry still nudges after another was deduped', () => {
    writeRoadmap(project, [{ id: '001', title: 'a', status: 'done', updated_at: todayStr() }]);
    run(bashPayload('git commit -m "fix 1"'));
    writeRoadmap(project, [
      { id: '001', title: 'a', status: 'done', updated_at: todayStr() },
      { id: '002', title: 'b', status: 'done', updated_at: todayStr() },
    ]);
    const out = run(bashPayload('git commit -m "fix 2"'));
    assert.match(out, /002/);
    assert.doesNotMatch(out, /001 \(/);
  });

  test('the in_progress block is unaffected by freshly-done dedup', () => {
    writeRoadmap(project, [
      { id: '001', title: 'a', status: 'done', updated_at: todayStr() },
      { id: '002', title: 'b', status: 'in_progress' },
    ]);
    run(bashPayload('git commit -m "fix 1"'));
    const out = run(bashPayload('git commit -m "fix 2"'));
    assert.match(out, /in-progress ROADMAP/i);
    assert.doesNotMatch(out, /follow-up fix/);
  });

  // [Foreman: 194] Same dedup state file, same once-per-day key — an
  // awaiting_acceptance entry is just another id in the same population.
  test('second commit the same day stays silent for an already-nudged awaiting_acceptance entry', () => {
    writeRoadmap(project, [{ id: '001', title: 'waiting', status: 'awaiting_acceptance' }]);
    writeConfig(project, { discoverySuggestions: false });
    const first = run(bashPayload('git commit -m "fix 1"'));
    assert.match(first, /follow-up fix/);
    const second = run(bashPayload('git commit -m "fix 2"'));
    assert.equal(second, '');
  });
});

describe('exit-code gating (best-effort)', () => {
  test('confirmed nonzero exit code stays silent', () => {
    writeRoadmap(project, [{ id: '001', status: 'in_progress' }]);
    const out = run(bashPayload('git commit -m "wip"', { exit_code: 1 }));
    assert.equal(out, '');
  });

  test('confirmed zero exit code still fires', () => {
    writeRoadmap(project, [{ id: '001', status: 'in_progress' }]);
    const out = run(bashPayload('git commit -m "wip"', { exit_code: 0 }));
    assert.notEqual(out, '');
  });

  test('missing exit code field fails open (still fires)', () => {
    writeRoadmap(project, [{ id: '001', status: 'in_progress' }]);
    const out = run(bashPayload('git commit -m "wip"'));
    assert.notEqual(out, '');
  });

  // An exit-preserving wrapper (hush) forces the shell exit to 0 and embeds
  // the real code in the output text — the marker beats the top-level field.
  test('wrapped nonzero exit in output text stays silent despite exit_code 0', () => {
    writeRoadmap(project, [{ id: '001', status: 'in_progress' }]);
    const out = run(
      bashPayload('git commit -m "wip"', {
        exit_code: 0,
        tool_response: 'pre-commit hook failed\n[[hush:exit=\n1\n]]\n',
      })
    );
    assert.equal(out, '');
  });

  test('wrapped zero exit still fires', () => {
    writeRoadmap(project, [{ id: '001', status: 'in_progress' }]);
    const out = run(
      bashPayload('git commit -m "wip"', {
        exit_code: 0,
        tool_response: '[main abc1234] wip\n[[hush:exit=\n0\n]]\n',
      })
    );
    assert.notEqual(out, '');
  });

  test('compressed wrapper form is recognized too', () => {
    writeRoadmap(project, [{ id: '001', status: 'in_progress' }]);
    const out = run(
      bashPayload('git commit -m "wip"', {
        exit_code: 0,
        tool_response: 'pre-commit hook failed\n[hush: exit 1]',
      })
    );
    assert.equal(out, '');
  });

  test('marker inside an object tool_response stdout field is found', () => {
    writeRoadmap(project, [{ id: '001', status: 'in_progress' }]);
    const out = run(
      bashPayload('git commit -m "wip"', {
        exit_code: 0,
        tool_response: { stdout: 'hook failed\n[[hush:exit=\n2\n]]\n', stderr: '' },
      })
    );
    assert.equal(out, '');
  });

  test('malformed marker is ignored — falls back to the field, fails open', () => {
    writeRoadmap(project, [{ id: '001', status: 'in_progress' }]);
    const out = run(
      bashPayload('git commit -m "wip"', {
        exit_code: 0,
        tool_response: '[[hush:exit=\nnot-a-number\n]]\n',
      })
    );
    assert.notEqual(out, '');
  });
});

// [Foreman: 130] The PREDICTED half is what the tag compares against: the
// observed half is derived from commits the entry was already credited with,
// so matching on it would widen the net with every close.
describe('planned-files correlation label', () => {
  // Reproduces the concurrent-session mis-attribution: one session's commit
  // touches files unrelated to another session's in_progress task, yet the
  // hook surfaced that task with no way to tell it apart. The fix never
  // suppresses — it tags each surfaced task with whether this commit's files
  // intersect its `touches`, so an unrelated task is legible as such.
  function setupRepo(committedPath) {
    initGitRepo(project);
    commitFile(project, committedPath, 'content\n');
  }

  test('disjoint planned files: unrelated task still surfaces, tagged no-overlap', () => {
    setupRepo('plugins/other/src.js');
    writeRoadmap(project, [
      { id: '001', title: 'surface a CLI in-session', status: 'in_progress', planned_touches: ['hooks/post-commit.js'] },
    ]);
    const out = run(bashPayload('git commit -m "unrelated plugin work"'));
    // never-suppress: the task is still surfaced (recall preserved)...
    assert.match(out, /may complete an in-progress/i);
    assert.match(out, /001/);
    // ...but now legible as unrelated to this commit.
    assert.match(out, /\[no overlap with its planned files\]/);
    assert.doesNotMatch(out, /\[files overlap its planned files\]/);
  });

  test('an observed-only overlap is NOT a match — the tag reads the prediction', () => {
    // The entry already committed this exact file on an earlier close, so it
    // sits in observed_touches. That is history, not evidence about THIS
    // commit, and the tag must not treat it as a match.
    setupRepo('plugins/other/src.js');
    writeRoadmap(project, [
      {
        id: '001',
        title: 'already been here',
        status: 'in_progress',
        planned_touches: ['hooks/post-commit.js'],
        observed_touches: ['plugins/other/src.js'],
      },
    ]);
    const out = run(bashPayload('git commit -m "wip"'));
    assert.match(out, /\[no overlap with its planned files\]/);
    assert.doesNotMatch(out, /\[files overlap its planned files\]/);
  });

  test('overlapping planned files: the likely task is tagged as overlapping', () => {
    setupRepo('plugins/other/src.js');
    writeRoadmap(project, [
      { id: '001', title: 'work the other plugin', status: 'in_progress', planned_touches: ['plugins/other/src.js'] },
    ]);
    const out = run(bashPayload('git commit -m "finish it"'));
    assert.match(out, /001 \(.*\) \[files overlap its planned files\]/);
    assert.doesNotMatch(out, /\[no overlap with its planned files\]/);
  });

  test('mixed: both surface, tagged apart, with the ranking-not-proof caveat', () => {
    setupRepo('plugins/other/src.js');
    writeRoadmap(project, [
      { id: '001', title: 'related', status: 'in_progress', planned_touches: ['plugins/other/src.js'] },
      { id: '002', title: 'unrelated', status: 'in_progress', planned_touches: ['hooks/post-commit.js'] },
    ]);
    const out = run(bashPayload('git commit -m "wip"'));
    assert.match(out, /001 \(.*\) \[files overlap its planned files\]/);
    assert.match(out, /002 \(.*\) \[no overlap with its planned files\]/);
    // the caveat keeps a no-overlap tag from being read as "skip" (no false negatives)
    assert.match(out, /ranking hint, not proof/);
    assert.match(out, /can still be the one this commit completes/);
  });

  test('a task with no planned files yet gets no tag (nothing to compare)', () => {
    setupRepo('plugins/other/src.js');
    writeRoadmap(project, [{ id: '001', title: 'just started', status: 'in_progress' }]);
    const out = run(bashPayload('git commit -m "wip"'));
    assert.match(out, /may complete an in-progress/i);
    assert.doesNotMatch(out, /planned files\]/);
    // no tags shown => no caveat either
    assert.doesNotMatch(out, /ranking hint, not proof/);
  });

  test('no commits yet: degrades to no tags, block otherwise unchanged', () => {
    // beforeEach already gives `project` a repo (the resolver needs one to
    // land on the root scope) but nothing is committed — HEAD doesn't
    // resolve, so git can't name any files and tagging stays inert.
    writeRoadmap(project, [
      { id: '001', title: 'x', status: 'in_progress', planned_touches: ['plugins/other/src.js'] },
    ]);
    const out = run(bashPayload('git commit -m "wip"'));
    assert.match(out, /may complete an in-progress/i);
    assert.doesNotMatch(out, /planned files\]/);
  });

  test('requireVerification path is tagged too', () => {
    setupRepo('plugins/other/src.js');
    writeRoadmap(project, [
      { id: '001', title: 'unrelated', status: 'in_progress', planned_touches: ['hooks/post-commit.js'] },
    ]);
    writeConfig(project, { requireVerification: true });
    const out = run(bashPayload('git commit -m "wip"'));
    assert.match(out, /requireVerification is on/);
    assert.match(out, /\[no overlap with its planned files\]/);
    assert.match(out, /ranking hint, not proof/);
  });
});

// [Foreman: 193] Nothing used to establish which repository the commit that
// fired this hook actually landed in — CLAUDE_PROJECT_DIR names the project
// regardless of where the commit happened, so a commit anywhere else (an
// unrelated repo, or a submodule inside this project) was read against the
// wrong git history entirely.
describe('commit scope resolution', () => {
  test('a cwd outside every repo scope produces no output at all', () => {
    const outsideRepo = makeTmpProject();
    initGitRepo(outsideRepo);
    commitFile(outsideRepo, 'unrelated.js', 'unrelated');
    writeRoadmap(project, [{ id: '001', status: 'in_progress' }]);
    const out = run(bashPayload('git commit -m "wip"', { cwd: outsideRepo }));
    assert.equal(out, '');
  });

  test('a commit inside a submodule reads that submodule\'s own files and trailer, not the parent\'s', () => {
    commitFile(project, 'root.js', 'root content');
    const sub = addSubmodule(project, 'lib');
    commitWithMessage(sub, 'inner.js', 'inner content', 'work in submodule\n\nForeman: 001');
    writeRoadmap(project, [
      { id: '001', title: 'the submodule task', status: 'in_progress', planned_touches: ['lib/inner.js'] },
    ]);
    const out = run(bashPayload('git commit -m "work in submodule"', { cwd: sub }));
    // the submodule's own trailer names this entry directly...
    assert.match(out, /named in this commit's Foreman: trailer/);
    // ...and the submodule's changed file, prefixed, overlaps its planned
    // files — neither would be true reading the parent's last commit
    // ("root.js", no trailer at all).
    assert.doesNotMatch(out, /\[no overlap with its planned files\]/);
  });

  test('a root-repo commit resolves to the root scope and behaves exactly as before', () => {
    commitFile(project, 'src/a.js', 'content');
    writeRoadmap(project, [
      { id: '001', title: 'root work', status: 'in_progress', planned_touches: ['src/a.js'] },
    ]);
    const out = run(bashPayload('git commit -m "finish root work"'));
    assert.match(out, /may complete an in-progress/i);
    assert.match(out, /\[files overlap its planned files\]/);
  });
});

// Hooks and explicit checkpoints must deliver one policy, without a hidden
// environment switch changing the threshold or the authorization contract.
describe('shared discovery policy', () => {
  test('a successful commit delivers the same policy as an explicit no-commit close', () => {
    const { discoveryInstructions } = require('../scripts/discovery');
    const { checkpoint } = require('../hooks/codex-task');
    writeRoadmap(project, [{ id: '001', status: 'awaiting_acceptance', commits: [] }]);
    const before = fs.readFileSync(path.join(project, 'ROADMAP.jsonl'), 'utf8');
    const out = run(bashPayload('git commit -m "finish work"'));
    const checked = checkpoint('check', { id: '001', root: project, session: '' });
    assert.equal(checked.complete, true);
    assert.equal(checked.discovery, discoveryInstructions());
    assert.ok(JSON.parse(out).hookSpecificOutput.additionalContext.includes(checked.discovery));
    assert.equal(fs.readFileSync(path.join(project, 'ROADMAP.jsonl'), 'utf8'), before);
  });
});
