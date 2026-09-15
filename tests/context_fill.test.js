'use strict';

// Tests for hooks/context-fill.js — PostToolUse hook that reads how full the
// session's context window is and, at or above Foreman's line, hands the
// destination question that fact as additionalContext.
//
// Covers:
//   - the command filter: pre-question scripts only, on Bash/PowerShell only
//   - occupancy = the last non-sidechain assistant usage, every *_tokens field
//   - sidechain records (a subagent's own window) are skipped
//   - torn lines, a missing transcript, an empty one -> null, never a throw
//   - the threshold decision against a configured compaction point
//   - no configured window is silence: the share is unknowable, so nothing
//     is claimed about it
//   - end to end: emits above the line, silent below it, and silent on the
//     Codex host or a Codex payload (model, turn_id) however full the session
//   - the wiring: hooks.json runs it on the same matcher as post-commit, and
//     codex-hooks.json does not register it
//   - the rule it points at still exists in destination-question.md

const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const { runScriptRaw } = require('./helpers');

const hook = require(path.join(__dirname, '..', 'hooks', 'context-fill.js'));
const { CONTEXT_SHARE, PRE_QUESTION_SCRIPT, assess, currentTokens, message } = hook;

// A compaction point to measure against, and two occupancies over and under
// the line for it, with room to spare either way.
const WINDOW = 200000;
const OVER = Math.round(WINDOW * CONTEXT_SHARE) + 5000;
const UNDER = Math.round(WINDOW * CONTEXT_SHARE) - 5000;

function tmpDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'foreman-context-'));
}

/** Write a .jsonl transcript from record objects and return its path. */
function writeTranscript(records) {
  const file = path.join(tmpDir(), 'transcript.jsonl');
  fs.writeFileSync(file, records.map((r) => (typeof r === 'string' ? r : JSON.stringify(r))).join('\n'), 'utf-8');
  return file;
}

function assistant(usage, extra) {
  return { type: 'assistant', message: { usage }, ...(extra || {}) };
}

/** An env that guarantees no window is configured, whatever the host has set. */
function noWindowEnv() {
  return { CLAUDE_CONFIG_DIR: tmpDir(), CLAUDE_CODE_AUTO_COMPACT_WINDOW: '' };
}

/** The same, with a compaction point configured — the only case that speaks. */
function windowEnv() {
  return { CLAUDE_CONFIG_DIR: tmpDir(), CLAUDE_CODE_AUTO_COMPACT_WINDOW: String(WINDOW) };
}

function payload(command, transcriptPath, tool) {
  return {
    tool_name: tool || 'Bash',
    tool_input: { command },
    transcript_path: transcriptPath,
  };
}

describe('context-fill — the command filter', () => {
  test('matches the scripts a flow runs before the destination question', () => {
    for (const script of ['roadmap.js', 'resolve-symbols.js', 'safe-commit.js']) {
      assert.ok(
        PRE_QUESTION_SCRIPT.test(`node "/plugins/foreman/scripts/${script}" next-candidates --menu`),
        `${script} should match`
      );
    }
  });

  test('matches a Windows backslash plugin path', () => {
    assert.ok(PRE_QUESTION_SCRIPT.test('node "C:\\plugins\\foreman\\scripts\\roadmap.js" list --ids 001'));
  });

  test('does not match craft-handoff.js — that call is past the question', () => {
    assert.equal(PRE_QUESTION_SCRIPT.test('node "/plugins/foreman/scripts/craft-handoff.js"'), false);
  });

  test('does not match an ordinary command', () => {
    assert.equal(PRE_QUESTION_SCRIPT.test('git commit -m "task 1/3: something"'), false);
  });
});

describe('context-fill — reading occupancy', () => {
  test('sums every numeric *_tokens field of the newest assistant record', () => {
    const file = writeTranscript([
      assistant({ input_tokens: 10, output_tokens: 10 }),
      assistant({
        input_tokens: 1000,
        cache_read_input_tokens: 40000,
        cache_creation_input_tokens: 2000,
        output_tokens: 500,
        service_tier: 'standard', // non-numeric, and not a *_tokens key
      }),
    ]);
    assert.equal(currentTokens(file), 43500);
  });

  test('skips a sidechain record — that is a subagent window, not this one', () => {
    const file = writeTranscript([
      assistant({ input_tokens: 5000 }),
      assistant({ input_tokens: 999999 }, { isSidechain: true }),
    ]);
    assert.equal(currentTokens(file), 5000);
  });

  test('skips records that carry no usage at all', () => {
    const file = writeTranscript([
      assistant({ input_tokens: 5000 }),
      { type: 'user', message: { content: 'hello' } },
      { type: 'assistant', message: { content: [] } },
    ]);
    assert.equal(currentTokens(file), 5000);
  });

  test('a torn line is skipped, not fatal', () => {
    const file = writeTranscript([assistant({ input_tokens: 5000 }), '{"type":"assist']);
    assert.equal(currentTokens(file), 5000);
  });

  test('a missing file, an empty one, and a missing path are all null', () => {
    assert.equal(currentTokens(path.join(tmpDir(), 'absent.jsonl')), null);
    assert.equal(currentTokens(writeTranscript([])), null);
    assert.equal(currentTokens(undefined), null);
  });
});

describe('context-fill — the threshold decision', () => {
  test('below the line is silence', () => {
    assert.equal(assess(UNDER, WINDOW), null);
  });

  test('at or above the line returns a reading against the configured window', () => {
    const reading = assess(OVER, WINDOW);
    assert.ok(reading);
    assert.equal(reading.window, WINDOW);
    assert.equal(reading.percent, Math.round((OVER / WINDOW) * 100));
  });

  test('the same occupancy reads differently against a different window', () => {
    // Over the line against 200k, comfortably under it against 1M — which is
    // exactly why an unconfigured window may not be guessed at.
    assert.equal(assess(OVER, 1000000), null);
    const reading = assess(OVER, 100000);
    assert.ok(reading);
    assert.equal(reading.window, 100000);
  });

  test('no configured window is silence, however full the session is', () => {
    for (const window of [null, undefined, 0]) {
      assert.equal(assess(OVER, window), null);
      assert.equal(assess(999999, window), null);
    }
  });

  test('a missing or nonsense occupancy is silence, never a throw', () => {
    for (const value of [null, undefined, 0, -1, NaN, 'lots']) {
      assert.equal(assess(value, WINDOW), null);
    }
  });

  test('the message names the compaction point and never orders the user around', () => {
    const text = message(assess(OVER, WINDOW));
    assert.match(text, /compaction point/);
    assert.doesNotMatch(text, /assumed/);
    assert.match(text, /destination-question\.md/);
  });
});

describe('context-fill — end to end', () => {
  test('emits additionalContext above the line', () => {
    const file = writeTranscript([assistant({ input_tokens: OVER })]);
    const res = runScriptRaw('context-fill.js', payload('node "/p/foreman/scripts/roadmap.js" next-candidates --menu', file), windowEnv());
    assert.equal(res.status, 0);
    const out = JSON.parse(res.stdout);
    assert.equal(out.hookSpecificOutput.hookEventName, 'PostToolUse');
    assert.match(out.hookSpecificOutput.additionalContext, /\[Foreman\] Context reading/);
  });

  test('silent with no configured window, however full the session is', () => {
    const file = writeTranscript([assistant({ input_tokens: OVER })]);
    const res = runScriptRaw('context-fill.js', payload('node "/p/foreman/scripts/roadmap.js" next-candidates --menu', file), noWindowEnv());
    assert.equal(res.status, 0);
    assert.equal(res.stdout.trim(), '');
  });

  test('silent below the line', () => {
    const file = writeTranscript([assistant({ input_tokens: UNDER })]);
    const res = runScriptRaw('context-fill.js', payload('node "/p/foreman/scripts/roadmap.js" next-candidates --menu', file), windowEnv());
    assert.equal(res.stdout.trim(), '');
  });

  test('silent on a command that is not a pre-question script', () => {
    const file = writeTranscript([assistant({ input_tokens: OVER })]);
    const res = runScriptRaw('context-fill.js', payload('git commit -m "x"', file), windowEnv());
    assert.equal(res.stdout.trim(), '');
  });

  test('silent on a tool this hook does not watch', () => {
    const file = writeTranscript([assistant({ input_tokens: OVER })]);
    const res = runScriptRaw('context-fill.js', payload('node "/p/foreman/scripts/roadmap.js" list', file, 'Read'), windowEnv());
    assert.equal(res.stdout.trim(), '');
  });

  test('silent, and still exits clean, with no transcript to read', () => {
    const res = runScriptRaw('context-fill.js', payload('node "/p/foreman/scripts/roadmap.js" list', undefined), windowEnv());
    assert.equal(res.status, 0);
    assert.equal(res.stdout.trim(), '');
  });

  test('empty stdin is silence, not a crash', () => {
    const res = runScriptRaw('context-fill.js', '', windowEnv());
    assert.equal(res.status, 0);
    assert.equal(res.stdout.trim(), '');
  });

  // Codex has no occupancy to read: its transcript is not Claude usage, and a
  // Claude compaction setting says nothing about a Codex window.
  test('silent on the Codex host, however full the session is', () => {
    const file = writeTranscript([assistant({ input_tokens: OVER })]);
    const res = runScriptRaw(
      'context-fill.js',
      payload('node "/p/foreman/scripts/roadmap.js" next-candidates --menu', file),
      { ...windowEnv(), FOREMAN_HOST: 'codex' }
    );
    assert.equal(res.status, 0);
    assert.equal(res.stdout.trim(), '');
  });

  test('silent on a Codex payload, even with Claude settings and usage', () => {
    const file = writeTranscript([assistant({ input_tokens: OVER })]);
    for (const marker of [{ model: 'codex-test' }, { turn_id: 'turn' }]) {
      const res = runScriptRaw(
        'context-fill.js',
        { ...payload('node "/p/foreman/scripts/roadmap.js" next-candidates --menu', file), ...marker },
        windowEnv()
      );
      assert.equal(res.status, 0);
      assert.equal(res.stdout.trim(), '', JSON.stringify(marker));
    }
  });
});

describe('context-fill — wiring', () => {
  test('hooks.json runs it on PostToolUse for Bash and PowerShell', () => {
    const wiring = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'hooks', 'hooks.json'), 'utf-8'));
    const block = wiring.hooks.PostToolUse.find((b) => b.matcher === '^(Bash|PowerShell)$');
    assert.ok(block, 'no Bash/PowerShell PostToolUse block');
    assert.ok(
      block.hooks.some((h) => h.command.includes('context-fill.js') && h.commandWindows.includes('context-fill.js')),
      'context-fill.js is not wired on both platforms'
    );
  });

  // Codex's Windows commands are encoded from `command` and verified against it
  // (tests/windows_launcher.test.js), so the readable command is the one read.
  test('codex-hooks.json does not register it', () => {
    const wiring = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'hooks', 'codex-hooks.json'), 'utf-8'));
    const handlers = Object.values(wiring.hooks).flat().flatMap((group) => group.hooks);
    assert.ok(handlers.length, 'no Codex handlers read');
    assert.equal(
      handlers.some((h) => h.command.includes('context-fill.js')),
      false,
      'a guaranteed silent reader should not run after every Codex shell call'
    );
  });

  test('the destination question still carries the rule this hook points at', () => {
    const shared = fs.readFileSync(
      path.join(__dirname, '..', 'skills', 'roadmap', 'destination-question.md'),
      'utf-8'
    );
    assert.match(shared, /## Which option leads/);
    assert.match(shared, /Exactly one option carries `\(Recommended\)`/);
    assert.match(shared, /Copy prompt to clipboard/);
    // Exactly one option may carry the tag, so the label must not bake it in.
    assert.doesNotMatch(shared, /`Execute here \(Recommended\)`/);
    // Rule 1 is the one this hook's reading feeds. No reading means unknown,
    // never an estimate: the same reason the hook stays silent without a window.
    assert.match(shared, /1\. \*\*A context reading arrived this turn\*\*/);
    assert.match(shared, /unknown context is\s+unknown, so never infer a percentage/);
  });

  test('the destination question probes the tree before asking', () => {
    const shared = fs.readFileSync(
      path.join(__dirname, '..', 'skills', 'roadmap', 'destination-question.md'),
      'utf-8'
    );
    assert.match(shared, /safe-commit\.js"? begin/);
    assert.match(shared, /dirty:false/);
    // Unconditional: rule 2 can fire on a single check, so a probe gated on
    // the split's two-or-more count would be missing exactly when it is needed.
    assert.match(shared, /## Probe the tree before asking/);
    assert.match(shared, /Always, before the question/);
  });

  test('the background agent leads on one rule and is barred outside it', () => {
    const shared = fs.readFileSync(
      path.join(__dirname, '..', 'skills', 'roadmap', 'destination-question.md'),
      'utf-8'
    );
    // The conditions rule 2 needs, each named where the rule is stated. Both
    // bounds must exist, or the slice silently runs to the end of the file.
    const start = shared.indexOf('2. **Other work');
    const end = shared.indexOf('3. **At least two');
    assert.ok(start >= 0 && end > start, 'rule 2 is missing');
    const ruleTwo = shared.slice(start, end);
    for (const condition of ['in_progress', 'collision', 'dirty:false', 'verification', 'runnable check']) {
      assert.match(ruleTwo, new RegExp(condition.replace('.', '\\.')), `rule 2 does not name ${condition}`);
    }
    assert.match(ruleTwo, /Recommend\s+`Execute with a background agent`/);
    assert.match(shared, /Never recommend the background agent outside rule 2\./);
    // Barred from leading, never removed from the list.
    assert.match(shared, /still offered every time/);
  });

  test('every option is always offered — no flow withholds one', () => {
    const shared = fs.readFileSync(
      path.join(__dirname, '..', 'skills', 'roadmap', 'destination-question.md'),
      'utf-8'
    );
    assert.match(shared, /All four options are always offered/);
    // The split's old visibility gate is gone from every copy that had one.
    for (const rel of [
      ['skills', 'roadmap', 'destination-question.md'],
      ['skills', 'roadmap', 'pick.md'],
      ['skills', 'craft-prompt', 'SKILL.md'],
      ['prompt-template.md'],
    ]) {
      const text = fs.readFileSync(path.join(__dirname, '..', ...rel), 'utf-8');
      assert.doesNotMatch(
        text,
        /split option (below simply does not appear|appears only)/,
        `${rel.join('/')} still gates the split option's visibility`
      );
    }
  });

  test('the caution label shares no word with the recommendation', () => {
    const shared = fs.readFileSync(
      path.join(__dirname, '..', 'skills', 'roadmap', 'destination-question.md'),
      'utf-8'
    );
    assert.match(shared, /## Which options carry a caution/);
    assert.match(shared, /`\(Caution\)`/);
    // The whole reason the word is "Caution": a label scanner reads
    // "recommend" and misses the negation in front of it.
    assert.match(shared, /Never write "\(Not recommended\)"/);
    // Only that one mention, as the thing being banned — never as a label.
    const uses = shared.match(/\(Not recommended\)/g) || [];
    assert.equal(uses.length, 1, 'the banned label leaked back in as a label');
    // Beside the tree and the collision, a caution names nothing runnable to
    // check against, or a host that cannot start an agent at all.
    assert.match(shared, /no runnable check was gathered/);
    assert.match(shared, /this host has no callable delegation capability/);
  });

  test('the two labels can never land on the same option', () => {
    const shared = fs.readFileSync(
      path.join(__dirname, '..', 'skills', 'roadmap', 'destination-question.md'),
      'utf-8'
    );
    assert.match(shared, /One `\(Recommended\)`, never on a cautioned option/);
    assert.match(shared, /`Execute here` and `Copy prompt to clipboard` never carry it/);
  });
});
