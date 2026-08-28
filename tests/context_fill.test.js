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
//   - the threshold decision, and the assumed window when none is configured
//   - a configured compaction point wins over the assumption
//   - end to end: emits above the line, silent below it
//   - the wiring: hooks.json runs it on the same matcher as post-commit
//   - the rule it points at still exists in destination-question.md

const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const { runScriptRaw } = require('./helpers');

const hook = require(path.join(__dirname, '..', 'hooks', 'context-fill.js'));
const { CONTEXT_SHARE, ASSUMED_WINDOW, PRE_QUESTION_SCRIPT, assess, currentTokens, message } = hook;

// Over the line against the assumed window, with room to spare either way.
const OVER = Math.round(ASSUMED_WINDOW * CONTEXT_SHARE) + 5000;
const UNDER = Math.round(ASSUMED_WINDOW * CONTEXT_SHARE) - 5000;

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
    assert.equal(assess(UNDER, null), null);
  });

  test('at or above the line returns a reading against the assumed window', () => {
    const reading = assess(OVER, null);
    assert.ok(reading);
    assert.equal(reading.window, ASSUMED_WINDOW);
    assert.equal(reading.assumed, true);
    assert.equal(reading.percent, Math.round((OVER / ASSUMED_WINDOW) * 100));
  });

  test('a configured compaction point wins over the assumption', () => {
    // The same occupancy is over the line against 200k and under it against 1M.
    assert.equal(assess(OVER, 1000000), null);
    const reading = assess(OVER, 100000);
    assert.ok(reading);
    assert.equal(reading.window, 100000);
    assert.equal(reading.assumed, false);
  });

  test('a missing or nonsense occupancy is silence, never a throw', () => {
    for (const value of [null, undefined, 0, -1, NaN, 'lots']) {
      assert.equal(assess(value, null), null);
    }
  });

  test('the message names the assumption when there is one, and never orders the user around', () => {
    assert.match(message(assess(OVER, null)), /assumed/);
    assert.doesNotMatch(message(assess(OVER, 100000)), /assumed/);
    assert.match(message(assess(OVER, null)), /destination-question\.md/);
  });
});

describe('context-fill — end to end', () => {
  test('emits additionalContext above the line', () => {
    const file = writeTranscript([assistant({ input_tokens: OVER })]);
    const res = runScriptRaw('context-fill.js', payload('node "/p/foreman/scripts/roadmap.js" next-candidates --menu', file), noWindowEnv());
    assert.equal(res.status, 0);
    const out = JSON.parse(res.stdout);
    assert.equal(out.hookSpecificOutput.hookEventName, 'PostToolUse');
    assert.match(out.hookSpecificOutput.additionalContext, /\[Foreman\] Context reading/);
  });

  test('silent below the line', () => {
    const file = writeTranscript([assistant({ input_tokens: UNDER })]);
    const res = runScriptRaw('context-fill.js', payload('node "/p/foreman/scripts/roadmap.js" next-candidates --menu', file), noWindowEnv());
    assert.equal(res.stdout.trim(), '');
  });

  test('silent on a command that is not a pre-question script', () => {
    const file = writeTranscript([assistant({ input_tokens: OVER })]);
    const res = runScriptRaw('context-fill.js', payload('git commit -m "x"', file), noWindowEnv());
    assert.equal(res.stdout.trim(), '');
  });

  test('silent on a tool this hook does not watch', () => {
    const file = writeTranscript([assistant({ input_tokens: OVER })]);
    const res = runScriptRaw('context-fill.js', payload('node "/p/foreman/scripts/roadmap.js" list', file, 'Read'), noWindowEnv());
    assert.equal(res.stdout.trim(), '');
  });

  test('silent, and still exits clean, with no transcript to read', () => {
    const res = runScriptRaw('context-fill.js', payload('node "/p/foreman/scripts/roadmap.js" list', undefined), noWindowEnv());
    assert.equal(res.status, 0);
    assert.equal(res.stdout.trim(), '');
  });

  test('empty stdin is silence, not a crash', () => {
    const res = runScriptRaw('context-fill.js', '', noWindowEnv());
    assert.equal(res.status, 0);
    assert.equal(res.stdout.trim(), '');
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

  test('the destination question still carries the rule this hook points at', () => {
    const shared = fs.readFileSync(
      path.join(__dirname, '..', 'skills', 'roadmap', 'destination-question.md'),
      'utf-8'
    );
    assert.match(shared, /## Which option leads/);
    assert.match(shared, /Copy prompt to clipboard/);
    // Exactly one option may carry the tag, so the label must not bake it in.
    assert.doesNotMatch(shared, /`Execute here \(Recommended\)`/);
  });

  test('the destination question probes the tree before asking', () => {
    const shared = fs.readFileSync(
      path.join(__dirname, '..', 'skills', 'roadmap', 'destination-question.md'),
      'utf-8'
    );
    assert.match(shared, /safe-commit\.js begin/);
    assert.match(shared, /dirty:false/);
    // Unconditional: rule 2 can fire on a single check, so a probe gated on
    // the split's two-or-more count would be missing exactly when it is needed.
    assert.match(shared, /## Probe the tree before asking/);
    assert.match(shared, /Always, before the question/);
  });

  test('the background Agent leads on one rule and is barred outside it', () => {
    const shared = fs.readFileSync(
      path.join(__dirname, '..', 'skills', 'roadmap', 'destination-question.md'),
      'utf-8'
    );
    // The four conditions rule 2 needs, each named where the rule is stated.
    const ruleTwo = shared.slice(shared.indexOf('2. **Other work'), shared.indexOf('3. **Two or more'));
    assert.ok(ruleTwo, 'rule 2 is missing');
    for (const condition of ['in_progress', 'collision', 'dirty:false', 'verification']) {
      assert.match(ruleTwo, new RegExp(condition.replace('.', '\\.')), `rule 2 does not name ${condition}`);
    }
    assert.match(shared, /Never recommend the background Agent outside rule 2/);
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
