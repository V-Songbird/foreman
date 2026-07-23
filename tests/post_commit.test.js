'use strict';

// Tests for hooks/post-commit.js — the only hook Foreman ships post-redesign.
//
// Covers:
//   - only fires on Bash/PowerShell tool calls that are actually `git commit`
//   - silent when ROADMAP.jsonl doesn't exist (zero-config: never ran /foreman:init)
//   - status-sync block appears whenever an in_progress entry exists, or a
//     done entry was updated earlier today (same-day follow-up fix commit)
//   - discovery block appears only when .foreman/config.json has discoverySuggestions:true
//   - requireVerification:true withholds the done transition until the user
//     confirms, without affecting the freshly-done follow-up branch
//   - malformed/missing config is treated as discoverySuggestions:false and
//     requireVerification:false
//   - a failed commit (confirmed nonzero exit code) stays silent
//   - a commit with no confirmed exit code fails open (still fires)

const { test, describe, beforeEach } = require('node:test');
const assert = require('node:assert/strict');

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

beforeEach(() => {
  project = makeTmpProject();
  env = { CLAUDE_PROJECT_DIR: project };
});

function bashPayload(command, extra) {
  return { tool_name: 'Bash', tool_input: { command }, ...(extra || {}) };
}

function run(payload) {
  const result = runScriptRaw('post-commit.js', payload, env);
  assert.equal(result.status, 0, result.stderr);
  return result.stdout;
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
});

describe('no ROADMAP.jsonl', () => {
  test('stays completely silent — never ran /foreman:init', () => {
    const out = run(bashPayload('git commit -m "wip"'));
    assert.equal(out, '');
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

  test('mentions that touches auto-folds from the commit, no manual listing needed', () => {
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
      { tool_name: 'PowerShell', tool_input: { command: 'git commit -m "wip"' } },
      env
    );
    assert.notEqual(result.stdout, '');
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

describe('requireVerification gate', () => {
  test('default (off): nudges to mark done directly', () => {
    writeRoadmap(project, [{ id: '001', status: 'in_progress' }]);
    const out = run(bashPayload('git commit -m "finish task"'));
    assert.match(out, /may complete an in-progress/i);
    assert.doesNotMatch(out, /requireVerification is on/);
  });

  test('on: records the commit but withholds done until the user confirms', () => {
    writeRoadmap(project, [{ id: '001', status: 'in_progress' }]);
    writeConfig(project, { requireVerification: true });
    const out = run(bashPayload('git commit -m "finish task"'));
    assert.match(out, /requireVerification is on/);
    assert.match(out, /AskUserQuestion/);
    assert.match(out, /don't close it out yet/);
    assert.match(out, /confirmation/i);
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

  test('malformed config treated as requireVerification:false', () => {
    writeRoadmap(project, [{ id: '001', status: 'in_progress' }]);
    const fs = require('fs');
    const path = require('path');
    fs.mkdirSync(path.join(project, '.foreman'), { recursive: true });
    fs.writeFileSync(path.join(project, '.foreman', 'config.json'), '{not json', 'utf-8');
    const out = run(bashPayload('git commit -m "finish task"'));
    assert.doesNotMatch(out, /requireVerification is on/);
  });
});

describe('discovery block', () => {
  test('fires when discoverySuggestions is true', () => {
    writeRoadmap(project, [{ id: '001', status: 'planned' }]);
    writeConfig(project, { discoverySuggestions: true });
    const out = run(bashPayload('git commit -m "add feature"'));
    assert.match(out, /Roadmap discovery is enabled/);
  });

  test('also asks Claude to scan for already-implemented, unplanned scope creep', () => {
    writeRoadmap(project, [{ id: '001', status: 'planned' }]);
    writeConfig(project, { discoverySuggestions: true });
    const out = run(bashPayload('git commit -m "add feature"'));
    assert.match(out, /inverse case/);
    assert.match(out, /Log it/);
  });

  test('names the planned entries as already-covered ground', () => {
    writeRoadmap(project, [
      { id: '001', title: 'Add JWT refresh', status: 'planned' },
      { id: '002', title: 'Ship the parser', status: 'done' },
      { id: '003', title: 'Abandoned idea', status: 'dropped' },
    ]);
    writeConfig(project, { discoverySuggestions: true });
    const out = run(bashPayload('git commit -m "add feature"'));
    assert.match(out, /already on the roadmap as planned: 001 \(\\"Add JWT refresh\\"\)/);
    assert.doesNotMatch(out, /Ship the parser/);
    assert.doesNotMatch(out, /Abandoned idea/);
  });

  test('says nothing about coverage when no entry is planned', () => {
    writeRoadmap(project, [{ id: '001', title: 'Done thing', status: 'in_progress' }]);
    writeConfig(project, { discoverySuggestions: true });
    const out = run(bashPayload('git commit -m "add feature"'));
    assert.doesNotMatch(out, /already on the roadmap as planned/);
  });

  test('fires by default when config is missing', () => {
    writeRoadmap(project, [{ id: '001', status: 'planned' }]);
    const out = run(bashPayload('git commit -m "add feature"'));
    assert.match(out, /Roadmap discovery is enabled/);
  });

  test('fires by default when config is malformed JSON', () => {
    writeRoadmap(project, [{ id: '001', status: 'planned' }]);
    const fs = require('fs');
    const path = require('path');
    fs.mkdirSync(path.join(project, '.foreman'), { recursive: true });
    fs.writeFileSync(path.join(project, '.foreman', 'config.json'), '{not json', 'utf-8');
    const out = run(bashPayload('git commit -m "add feature"'));
    assert.match(out, /Roadmap discovery is enabled/);
  });

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

describe('touches correlation label', () => {
  // Reproduces the concurrent-session mis-attribution: one session's commit
  // touches files unrelated to another session's in_progress task, yet the
  // hook surfaced that task with no way to tell it apart. The fix never
  // suppresses — it tags each surfaced task with whether this commit's files
  // intersect its `touches`, so an unrelated task is legible as such.
  function setupRepo(committedPath) {
    initGitRepo(project);
    commitFile(project, committedPath, 'content\n');
  }

  test('disjoint touches: unrelated task still surfaces, tagged no-overlap', () => {
    setupRepo('plugins/other/src.js');
    writeRoadmap(project, [
      { id: '001', title: 'surface a CLI in-session', status: 'in_progress', touches: ['hooks/post-commit.js'] },
    ]);
    const out = run(bashPayload('git commit -m "unrelated plugin work"'));
    // never-suppress: the task is still surfaced (recall preserved)...
    assert.match(out, /may complete an in-progress/i);
    assert.match(out, /001/);
    // ...but now legible as unrelated to this commit.
    assert.match(out, /\[no touches overlap\]/);
    assert.doesNotMatch(out, /\[files overlap its touches\]/);
  });

  test('overlapping touches: the likely task is tagged as overlapping', () => {
    setupRepo('plugins/other/src.js');
    writeRoadmap(project, [
      { id: '001', title: 'work the other plugin', status: 'in_progress', touches: ['plugins/other/src.js'] },
    ]);
    const out = run(bashPayload('git commit -m "finish it"'));
    assert.match(out, /001 \(.*\) \[files overlap its touches\]/);
    assert.doesNotMatch(out, /\[no touches overlap\]/);
  });

  test('mixed: both surface, tagged apart, with the ranking-not-proof caveat', () => {
    setupRepo('plugins/other/src.js');
    writeRoadmap(project, [
      { id: '001', title: 'related', status: 'in_progress', touches: ['plugins/other/src.js'] },
      { id: '002', title: 'unrelated', status: 'in_progress', touches: ['hooks/post-commit.js'] },
    ]);
    const out = run(bashPayload('git commit -m "wip"'));
    assert.match(out, /001 \(.*\) \[files overlap its touches\]/);
    assert.match(out, /002 \(.*\) \[no touches overlap\]/);
    // the caveat keeps a no-overlap tag from being read as "skip" (no false negatives)
    assert.match(out, /ranking hint, not proof/);
    assert.match(out, /can still be the one this commit completes/);
  });

  test('a task with no touches yet gets no tag (nothing to compare)', () => {
    setupRepo('plugins/other/src.js');
    writeRoadmap(project, [{ id: '001', title: 'just started', status: 'in_progress' }]);
    const out = run(bashPayload('git commit -m "wip"'));
    assert.match(out, /may complete an in-progress/i);
    assert.doesNotMatch(out, /touches overlap/);
    assert.doesNotMatch(out, /files overlap its touches/);
    // no tags shown => no caveat either
    assert.doesNotMatch(out, /ranking hint, not proof/);
  });

  test('non-git project: degrades to no tags, block otherwise unchanged', () => {
    // no initGitRepo — git can't name HEAD's files, so tagging stays inert
    writeRoadmap(project, [
      { id: '001', title: 'x', status: 'in_progress', touches: ['plugins/other/src.js'] },
    ]);
    const out = run(bashPayload('git commit -m "wip"'));
    assert.match(out, /may complete an in-progress/i);
    assert.doesNotMatch(out, /touches overlap/);
    assert.doesNotMatch(out, /files overlap its touches/);
  });

  test('requireVerification path is tagged too', () => {
    setupRepo('plugins/other/src.js');
    writeRoadmap(project, [
      { id: '001', title: 'unrelated', status: 'in_progress', touches: ['hooks/post-commit.js'] },
    ]);
    writeConfig(project, { requireVerification: true });
    const out = run(bashPayload('git commit -m "wip"'));
    assert.match(out, /requireVerification is on/);
    assert.match(out, /\[no touches overlap\]/);
    assert.match(out, /ranking hint, not proof/);
  });
});
