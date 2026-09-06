'use strict';

// Tests for scripts/check-prompt.js — the mechanical gate for assembled
// handoff prompts.
//
// Covers:
//   - a well-formed prompt passes for each destination
//   - guardrail blocks (truth_grounding, scope_discipline, the fixed
//     closing paragraph) must be present and verbatim
//   - leftover template placeholders are errors
//   - verification (Run:/Expected:) required unless --research
//   - omitSections compliance, incl. the background-Agent tone carve-out
//   - --entry requires the embedded entry paragraph (and --resume its variant)
//   - usePersona:false rejects a "You are a" opener
//   - assumed-context phrasing is a warning, not an error
//   - Workflow-stage flavor: no tone, no output_format, fixed sentence
//   - the no-invention line and the bounded fix loop are both required
//   - <plan> is required and carried verbatim, and states the order once
//   - drift pin: every bracketed placeholder line in prompt-template.md's
//     xml fence is covered by the checker's fragment list
//   - grammar pin: the skill prose still uses the phrases the checker expects

const { describe, test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

const { makeTmpProject, writeConfig, runNodeScript, SCRIPTS_DIR } = require('./helpers.js');
const {
  readCanonical,
  detectProfile,
  PLACEHOLDER_FRAGMENTS,
  PROFILES,
  CONCISE_TRUTH_SENTENCE,
  CLOSURE_EVIDENCE_SENTENCE,
  WORKFLOW_STAGE_SENTENCE,
  NO_INVENTION_SENTENCE,
  FIX_CEILING_SENTENCE,
  TEMPLATE_PATH,
} = require(path.join(SCRIPTS_DIR, 'check-prompt.js'));

const CHECK = path.join(SCRIPTS_DIR, 'check-prompt.js');
const canonical = readCanonical();
const AUTONOMY = 'You are operating autonomously. The user is not watching in real time and cannot answer questions mid-task. End your turn only when the task is complete or you are blocked on input only the user can provide.';
const PLUGIN_ROOT = '/plugins/foreman';
const scopeText = canonical.scopeDiscipline.split('${CLAUDE_PLUGIN_ROOT}').join(PLUGIN_ROOT);
const NO_INVENTION_LINE = `If a file, symbol, or fallback path this prompt names does not exist as described, ${NO_INVENTION_SENTENCE}`;
const FIX_CEILING_LINE = `Do NOT claim success without running this. If it fails, fix and re-run — but ${FIX_CEILING_SENTENCE}`;

function goodPrompt(overrides = {}) {
  const parts = {
    task_context: '<task_context>\nYou are a senior engineer.\nYour goal is to fix the retry bug so all tests pass.\n</task_context>',
    truth_grounding: `<truth_grounding>${canonical.truthGrounding}</truth_grounding>`,
    scope_discipline: `<scope_discipline>${scopeText}</scope_discipline>`,
    entry_paragraph: '',
    tone: '<tone>\nMinimal, professional conversation — silent by default. If an output style already governs this session\'s voice, defer to it.\n</tone>',
    background: '<background>\n<relevant_files>\nsrc/auth/middleware.ts — refreshToken (42), verifySession (77)\n</relevant_files>\n<context>\nUses JWT tokens in httpOnly cookies. No third-party auth libs.\n</context>\n</background>',
    no_invention: NO_INVENTION_LINE,
    invariants: '',
    task_rules: `<task_rules>\n- Check the refresh path against the failing test.\n- Fix the bug.\n\nConstraints:\n- Do not modify the public API.\n\nVerification (REQUIRED):\nRun: npm test\nExpected: all tests pass\n${FIX_CEILING_LINE}\n</task_rules>`,
    request: 'Fix the token refresh bug in the auth middleware.',
    autonomy: '',
    closing: canonical.closing,
    plan: `<plan>${canonical.plan}</plan>`,
    output_format: '<output_format>\nGive a concise, human-readable summary: what changed, and the verification result. No XML tags in the visible response.\n</output_format>',
    ...overrides,
  };
  return Object.values(parts).filter(Boolean).join('\n\n') + '\n';
}

// [Foreman: 138, 231] The short profile: identity + goal, the concise truth
// line, touches, how to verify — the Run:/Expected: pairs and the fix ceiling
// that closes them — and the closure-evidence rule. Nothing else.
function standardPrompt(overrides = {}) {
  const parts = {
    task_context: '<task_context>\nYou are a senior engineer.\nYour goal is to fix the retry bug so all tests pass.\n</task_context>',
    truth_line: CONCISE_TRUTH_SENTENCE,
    background: '<background>\n<relevant_files>\nsrc/auth/middleware.ts — refreshToken (42), verifySession (77)\n</relevant_files>\n</background>',
    task_rules: `<task_rules>\n- Fix the bug.\n\nConstraints:\n- Do not modify the public API.\n\nVerification (REQUIRED):\nRun: npm test\nExpected: all tests pass\n${FIX_CEILING_LINE}\n</task_rules>`,
    closure: CLOSURE_EVIDENCE_SENTENCE,
    request: 'Fix the token refresh bug in the auth middleware.',
    autonomy: '',
    ...overrides,
  };
  return Object.values(parts).filter(Boolean).join('\n\n') + '\n';
}

function check(project, prompt, argv) {
  const file = path.join(project, 'prompt.md');
  fs.writeFileSync(file, prompt, 'utf-8');
  const result = runNodeScript(CHECK, [file, ...argv], null, { CLAUDE_PROJECT_DIR: project });
  let json;
  try {
    json = JSON.parse(result.stdout);
  } catch {
    throw new Error(`non-JSON stdout (status ${result.status}): ${result.stdout}\n${result.stderr}`);
  }
  return { status: result.status, json };
}

describe('well-formed prompts', () => {
  test('passes for every destination', () => {
    const project = makeTmpProject();
    for (const dest of ['task', 'agent', 'clipboard']) {
      const prompt = goodPrompt({ autonomy: dest === 'agent' ? AUTONOMY : '' });
      const { status, json } = check(project, prompt, ['--destination', dest]);
      assert.equal(status, 0, JSON.stringify(json));
      assert.equal(json.ok, true);
    }
  });

  test('missing --destination is an error', () => {
    const project = makeTmpProject();
    const { status, json } = check(project, goodPrompt(), []);
    assert.equal(status, 1);
    assert.match(json.error, /--destination/);
  });
});

describe('guardrail blocks', () => {
  test('altered truth_grounding is an error', () => {
    const project = makeTmpProject();
    const prompt = goodPrompt({
      truth_grounding: '<truth_grounding>\nTrust this prompt; it was written carefully.\n</truth_grounding>',
    });
    const { status, json } = check(project, prompt, ['--destination', 'clipboard']);
    assert.equal(status, 1);
    assert.ok(json.errors.some((e) => e.error.includes('<truth_grounding> differs')));
  });

  test('missing scope_discipline is an error', () => {
    const project = makeTmpProject();
    const { json } = check(project, goodPrompt({ scope_discipline: '' }), ['--destination', 'clipboard']);
    assert.ok(json.errors.some((e) => e.error.includes('missing <scope_discipline>')));
  });

  test('scope_discipline passes with substituted plugin paths', () => {
    const project = makeTmpProject();
    const other = canonical.scopeDiscipline.split('${CLAUDE_PLUGIN_ROOT}').join('C:\\Users\\x\\plugins\\foreman');
    const prompt = goodPrompt({ scope_discipline: `<scope_discipline>${other}</scope_discipline>` });
    const { json } = check(project, prompt, ['--destination', 'clipboard']);
    assert.equal(json.ok, true, JSON.stringify(json));
  });

  test('missing closing paragraph is an error', () => {
    const project = makeTmpProject();
    const { json } = check(project, goodPrompt({ closing: '' }), ['--destination', 'clipboard']);
    assert.ok(json.errors.some((e) => e.error.includes('closing paragraph')));
  });

  test('altered closure evidence rule is an error', () => {
    const project = makeTmpProject();
    const closing = canonical.closing.replace(
      CLOSURE_EVIDENCE_SENTENCE,
      'Closure notes may summarize the planned scope.'
    );
    const { status, json } = check(project, goodPrompt({ closing }), ['--destination', 'clipboard']);
    assert.equal(status, 1);
    assert.ok(json.errors.some((e) => e.error.includes('closing paragraph')), JSON.stringify(json.errors));
  });
});

describe('placeholders and required blocks', () => {
  test('leftover template placeholder is an error', () => {
    const project = makeTmpProject();
    const prompt = goodPrompt({
      background: '<background>\n<relevant_files>\n[Exact file paths for every file the task touches, each with the symbols that matter.]\n</relevant_files>\n<context>\nSome context.\n</context>\n</background>',
    });
    const { json } = check(project, prompt, ['--destination', 'clipboard']);
    assert.ok(json.errors.some((e) => e.error.includes('placeholder')));
  });

  test('missing verification is an error, unless --research', () => {
    const project = makeTmpProject();
    const noVerify = goodPrompt({
      task_rules: '<task_rules>\n- Read the auth docs.\n- Summarize the findings.\n- Write them to docs/findings.md.\n</task_rules>',
    });
    const failed = check(project, noVerify, ['--destination', 'clipboard']);
    assert.ok(failed.json.errors.some((e) => e.error.includes('verification')));
    const research = check(project, noVerify, ['--destination', 'clipboard', '--research']);
    assert.equal(research.json.ok, true, JSON.stringify(research.json));
  });

  test('empty relevant_files is an error; a path-less one is a warning', () => {
    const project = makeTmpProject();
    const empty = goodPrompt({
      background: '<background>\n<relevant_files>\n</relevant_files>\n<context>\nctx\n</context>\n</background>',
    });
    assert.ok(check(project, empty, ['--destination', 'clipboard']).json.errors.some((e) => e.error.includes('relevant_files')));
    const vague = goodPrompt({
      background: '<background>\n<relevant_files>\nthe auth module\n</relevant_files>\n<context>\nctx\n</context>\n</background>',
    });
    const { json } = check(project, vague, ['--destination', 'clipboard']);
    assert.equal(json.ok, true);
    assert.ok(json.warnings.some((w) => w.includes('path-like')));
  });

  test('missing output_format is an error when the project does not omit it', () => {
    const project = makeTmpProject();
    const { json } = check(project, goodPrompt({ output_format: '' }), ['--destination', 'clipboard']);
    assert.ok(json.errors.some((e) => e.error.includes('<output_format>')));
  });
});

describe('omitSections compliance', () => {
  test('an omitted tone must be absent for clipboard/task, present for agent', () => {
    const project = makeTmpProject();
    writeConfig(project, { omitSections: ['tone'] });
    const withTone = goodPrompt();
    const withoutTone = goodPrompt({ tone: '' });
    assert.ok(check(project, withTone, ['--destination', 'clipboard']).json.errors.some((e) => e.error.includes('<tone> present')));
    assert.equal(check(project, withoutTone, ['--destination', 'clipboard']).json.ok, true);
    assert.ok(check(project, withoutTone, ['--destination', 'agent']).json.errors.some((e) => e.error.includes('STAYS')));
    assert.equal(check(project, goodPrompt({ autonomy: AUTONOMY }), ['--destination', 'agent']).json.ok, true);
  });

  test('an omitted example/output_format must be absent', () => {
    const project = makeTmpProject();
    writeConfig(project, { omitSections: ['output_format'] });
    const { json } = check(project, goodPrompt(), ['--destination', 'clipboard']);
    assert.ok(json.errors.some((e) => e.error.includes('<output_format> present')));
    assert.equal(check(project, goodPrompt({ output_format: '' }), ['--destination', 'clipboard']).json.ok, true);
  });

  test('an omitted background must be absent, and relevant_files is not required then', () => {
    const project = makeTmpProject();
    writeConfig(project, { omitSections: ['background'] });
    assert.ok(check(project, goodPrompt(), ['--destination', 'clipboard']).json.errors.some((e) => e.error.includes('<background> present')));
    assert.equal(check(project, goodPrompt({ background: '' }), ['--destination', 'clipboard']).json.ok, true);
  });
});

describe('roadmap entry paragraph', () => {
  const paragraph =
    'This task is ROADMAP.jsonl entry `007`. Mark it `in_progress` before doing anything else — Foreman\'s picking flow deliberately leaves it `planned` until you do:\n' +
    `echo '{"id":"007","status":"in_progress"}' | node ${PLUGIN_ROOT}/scripts/roadmap.js update-status\n` +
    'When the work concludes, close the entry the same way.';
  const resumeParagraph =
    'This task is ROADMAP.jsonl entry `007`, already marked `in_progress` by an earlier session — don\'t re-mark it.\n' +
    `Close it via node ${PLUGIN_ROOT}/scripts/roadmap.js update-status when done.`;

  test('--entry requires the embedded paragraph', () => {
    const project = makeTmpProject();
    const { json } = check(project, goodPrompt(), ['--destination', 'task', '--entry', '007']);
    assert.ok(json.errors.some((e) => e.error.includes('ROADMAP.jsonl entry `007`')));
    const withPara = goodPrompt({ entry_paragraph: paragraph });
    assert.equal(check(project, withPara, ['--destination', 'task', '--entry', '007']).json.ok, true);
  });

  test('--resume expects the resume variant', () => {
    const project = makeTmpProject();
    const fresh = goodPrompt({ entry_paragraph: paragraph });
    assert.ok(check(project, fresh, ['--destination', 'task', '--entry', '007', '--resume']).json.errors.some((e) => e.error.includes('resume')));
    const resumed = goodPrompt({ entry_paragraph: resumeParagraph });
    assert.equal(check(project, resumed, ['--destination', 'task', '--entry', '007', '--resume']).json.ok, true);
  });
});

describe('persona and assumed context', () => {
  test('usePersona:false rejects a "You are a" opener', () => {
    const project = makeTmpProject();
    writeConfig(project, { usePersona: false });
    const { json } = check(project, goodPrompt(), ['--destination', 'clipboard']);
    assert.ok(json.errors.some((e) => e.error.includes('usePersona:false')));
    const domain = goodPrompt({
      task_context: '<task_context>\nDomain: authentication middleware.\nYour goal is to fix the retry bug so all tests pass.\n</task_context>',
    });
    assert.equal(check(project, domain, ['--destination', 'clipboard']).json.ok, true);
  });

  // [Foreman: 291] The why line under the goal is the entry's own prose, and a
  // quoted "you are" inside it is not a persona. Only the opener is judged.
  test('usePersona:false judges the opener only, never the why line under the goal', () => {
    const project = makeTmpProject();
    writeConfig(project, { usePersona: false });
    const prompt = goodPrompt({
      task_context:
        '<task_context>\nDomain: authentication middleware.\nYour goal is to fix the retry bug so all tests pass.\n' +
        'Why this task exists: Support tickets keep saying "you are a slow app" whenever a token expires mid-request.\n</task_context>',
    });
    const { json } = check(project, prompt, ['--destination', 'clipboard']);
    assert.equal(json.ok, true, JSON.stringify(json.errors));
  });

  test('usePersona:true looks for the persona in the opener, so a why line cannot stand in for it', () => {
    const project = makeTmpProject();
    const prompt = goodPrompt({
      task_context:
        '<task_context>\nDomain: authentication middleware.\nYour goal is to fix the retry bug so all tests pass.\n' +
        'Why this task exists: users say you are logging them out.\n</task_context>',
    });
    const { json } = check(project, prompt, ['--destination', 'clipboard']);
    assert.ok(json.warnings.some((w) => w.includes('no "You are [role]" sentence')), JSON.stringify(json.warnings));
  });

  test('assumed-context phrasing is a warning, not an error', () => {
    const project = makeTmpProject();
    const prompt = goodPrompt({ request: 'Fix the token refresh bug as we discussed.' });
    const { json } = check(project, prompt, ['--destination', 'clipboard']);
    assert.equal(json.ok, true);
    assert.ok(json.warnings.some((w) => w.includes('as we discussed')));
  });

  test('reasoning-echo phrasing is a warning, not an error', () => {
    const project = makeTmpProject();
    const prompt = goodPrompt({ request: 'Fix the bug and show your reasoning in the final message.' });
    const { json } = check(project, prompt, ['--destination', 'clipboard']);
    assert.equal(json.ok, true);
    assert.ok(json.warnings.some((w) => w.includes('echo its reasoning')));
  });

  test('the canonical closing paragraph does not trip the reasoning-echo warning', () => {
    const project = makeTmpProject();
    const { json } = check(project, goodPrompt(), ['--destination', 'clipboard']);
    assert.equal(json.ok, true);
    assert.ok(!json.warnings.some((w) => w.includes('echo its reasoning')));
  });

  test('agent destination requires the autonomy paragraph; others warn if it appears', () => {
    const project = makeTmpProject();
    const missing = check(project, goodPrompt(), ['--destination', 'agent']);
    assert.ok(missing.json.errors.some((e) => e.error.includes('operating autonomously')));
    const misplaced = check(project, goodPrompt({ autonomy: AUTONOMY }), ['--destination', 'clipboard']);
    assert.equal(misplaced.json.ok, true);
    assert.ok(misplaced.json.warnings.some((w) => w.includes('user present')));
  });
});

describe('workflow-stage flavor', () => {
  test('requires no tone, no output_format, and the fixed sentence', () => {
    const project = makeTmpProject();
    const wrong = check(project, goodPrompt(), ['--destination', 'clipboard', '--workflow-stage']);
    assert.ok(wrong.json.errors.some((e) => e.error.includes('<tone> present')));
    assert.ok(wrong.json.errors.some((e) => e.error.includes('<output_format> present')));
    assert.ok(wrong.json.errors.some((e) => e.error.includes('enforcement sentence')));
    const right = goodPrompt({ tone: '', output_format: WORKFLOW_STAGE_SENTENCE });
    assert.equal(check(project, right, ['--destination', 'clipboard', '--workflow-stage']).json.ok, true);
  });
});

describe('drift pins', () => {
  test('checkpoint finish choices remain local and preserve the saved preference contract', () => {
    const raw = fs.readFileSync(TEMPLATE_PATH, 'utf8');
    const section = raw.slice(raw.indexOf('## Checkpointing a task-split run'));
    assert.match(section, /onFinish can be ask, squash, merge, pr, or keep/);
    assert.match(section, /update only checkpoints\.onFinish while preserving other config/);
    assert.match(section, /Do not use git add -A or publish checkpoint commits/);
    assert.match(section, /There is no checkpoints\.push key/);
    assert.match(section, /setting never overrides an explicit ban on modifying a target branch/);
  });

  test('every bracketed placeholder line in the template fence is covered by the fragment list', () => {
    const raw = fs.readFileSync(TEMPLATE_PATH, 'utf-8');
    const fence = raw.match(/```xml\n([\s\S]*?)```/)[1];
    const bracketLines = fence.split('\n').filter((line) => /^\s*(?:- )?\[/.test(line));
    assert.ok(bracketLines.length >= 10, `expected the template to have bracketed placeholder lines, found ${bracketLines.length}`);
    for (const line of bracketLines) {
      assert.ok(
        PLACEHOLDER_FRAGMENTS.some((frag) => line.includes(frag)),
        `template placeholder line not covered by check-prompt.js's PLACEHOLDER_FRAGMENTS: ${line.trim()}`
      );
    }
  });


  // [Foreman: 119] checkpoints.push was removed, not renamed: pushing a
  // checkpoint publishes history the default squash ending rewrites, and
  // with `branch` false it pushed WIP straight to the session's own branch.



  // entry 223: the destination question (and its orchestration steering
  // line) moved into the one shared branch file both flows read at that
  // step — so the line is pinned there, and each flow is pinned to still
  // point at the shared file.

  // entry 203: the embedded entry paragraph moved into
  // craft-handoff.js's entryParagraphText (it bakes the exact grammar
  // check-prompt.js requires) — pick.md no longer writes the paragraph
  // itself, it only calls the script. craft-handoff.test.js's "entry mode"
  // and "resumed: also fires on the caller's explicit resume flag" tests
  // already pin this grammar transitively: either phrase being wrong would
  // make checkPrompt() reject the assembled prompt and fail `gate.ok`.

  test('the template still defines the three optional per-task fields', () => {
    const raw = fs.readFileSync(TEMPLATE_PATH, 'utf-8');
    assert.ok(raw.includes('<invariants>'));
    assert.ok(raw.includes('Expected file surface:'));
    assert.ok(raw.includes('confirm the test goes red'));
  });


});

describe('symbols-first relevant_files', () => {
  test('a symbol-only citation passes clean — no line numbers required', () => {
    const project = makeTmpProject();
    const prompt = goodPrompt({
      background: '<background>\n<relevant_files>\nsrc/auth/middleware.ts — refreshToken, verifySession\n</relevant_files>\n<context>\nSome context.\n</context>\n</background>',
    });
    const { status, json } = check(project, prompt, ['--destination', 'task']);
    assert.equal(status, 0, JSON.stringify(json));
    assert.deepEqual(json.warnings, []);
  });

  test('a bare directory still passes clean — the roadmap touches pass-through depends on it', () => {
    const project = makeTmpProject();
    const prompt = goodPrompt({
      background: '<background>\n<relevant_files>\nforeman/skills/\n</relevant_files>\n<context>\nSome context.\n</context>\n</background>',
    });
    const { status, json } = check(project, prompt, ['--destination', 'task']);
    assert.equal(status, 0, JSON.stringify(json));
    assert.deepEqual(json.warnings, [], 'a symbol-less citation must not warn — see the [Foreman: 105] note in check-prompt.js');
  });

  // [Foreman: 259] The template's checklist already said to fix or drop a
  // stale path before delivering. Nothing enforced it, and a real handoff
  // shipped two.
  // [Foreman: 271] But refusing it was too blunt: planned_touches is a plan,
  // so a task that adds a file names it before it exists, and every one of
  // those handoffs was refused. The marker still prints and still warns.
  test('a MISSING: path warns and still passes — the task may be the one creating it', () => {
    const project = makeTmpProject();
    const prompt = goodPrompt({
      background: '<background>\n<relevant_files>\nsrc/api/retry.js — MISSING: nothing at this path yet. Either this task creates the file, or the plan is stale and needs fixing.\n</relevant_files>\n<context>\nSome context.\n</context>\n</background>',
    });
    const { status, json } = check(project, prompt, ['--destination', 'task']);
    assert.equal(status, 0, JSON.stringify(json));
    assert.ok(json.warnings.some((w) => w.includes('MISSING:')), JSON.stringify(json.warnings));
  });

  test('an OUTSIDE PROJECT: path is still refused — it was never read, and no task writes outside the root', () => {
    const project = makeTmpProject();
    const prompt = goodPrompt({
      background: '<background>\n<relevant_files>\n../elsewhere/a.ts — OUTSIDE PROJECT: resolves outside the project root, not read\n</relevant_files>\n<context>\nSome context.\n</context>\n</background>',
    });
    const { status, json } = check(project, prompt, ['--destination', 'task']);
    assert.notEqual(status, 0, JSON.stringify(json));
    assert.ok(json.errors.some((e) => e.error.includes('OUTSIDE PROJECT:')), JSON.stringify(json.errors));
  });

  test('an omitted background cannot trip the stale-path gate', () => {
    const project = makeTmpProject();
    writeConfig(project, { omitSections: ['background'] });
    const prompt = goodPrompt({ background: '' });
    const { status, json } = check(project, prompt, ['--destination', 'task']);
    assert.equal(status, 0, JSON.stringify(json));
  });


  test('a citation with no path at all still warns', () => {
    const project = makeTmpProject();
    const prompt = goodPrompt({
      background: '<background>\n<relevant_files>\nthe auth module\n</relevant_files>\n<context>\nSome context.\n</context>\n</background>',
    });
    const { json } = check(project, prompt, ['--destination', 'task']);
    assert.ok(json.warnings.some((w) => w.includes('no path-like reference')), JSON.stringify(json.warnings));
  });

});

describe('Codex plugin paths', () => {
  test('rejects unresolved legacy and invented Codex root placeholders', () => {
    for (const variable of ['CLAUDE_PLUGIN_ROOT', 'CODEX_PLUGIN_ROOT']) {
      const prompt = goodPrompt({request: 'Run node $' + '{' + variable + '}/scripts/roadmap.js list'});
      const {status, json} = check(makeTmpProject(), prompt, ['--destination', 'task']);
      assert.equal(status, 1);
      assert.ok(json.errors.some((error) => error.error.includes('unresolved plugin root')));
    }
  });
  test('accepts installed versioned paths so a Codex handoff can run', () => {
    const {status, json} = check(makeTmpProject(), goodPrompt({request: 'Use C:/Users/x/.codex/plugins/cache/foreman/1.0.0/scripts/roadmap.js'}), ['--destination', 'task']);
    assert.equal(status, 0, JSON.stringify(json));
  });
});

describe('the ordered plan block', () => {
  test('a missing <plan> is an error', () => {
    const project = makeTmpProject();
    const { status, json } = check(project, goodPrompt({ plan: '' }), ['--destination', 'task']);
    assert.equal(status, 1);
    assert.equal(json.ok, false);
    assert.ok(json.errors.some((e) => e.error.includes('missing <plan>')), JSON.stringify(json.errors));
  });

  test('an altered <plan> is an error — it is carried verbatim', () => {
    const project = makeTmpProject();
    const prompt = goodPrompt({ plan: '<plan>\n1. Do whatever seems best.\n</plan>' });
    const { status, json } = check(project, prompt, ['--destination', 'task']);
    assert.equal(status, 1);
    assert.ok(json.errors.some((e) => e.error.includes('<plan> differs')), JSON.stringify(json.errors));
  });

  test('the plan states the three universal steps and the entry-paragraph rider', () => {
    assert.match(canonical.plan, /1\. Read every file `relevant_files` cites/);
    assert.match(canonical.plan, /2\. Make the change `task_rules` describes/);
    assert.match(canonical.plan, /3\. Run each `Run:` command/);
    assert.match(canonical.plan, /open step runs before step 1 and its close step after step 3/);
    assert.match(canonical.plan, /last task only, so a row without one starts at step 1/);
  });

});

describe('durable handoff guardrails', () => {
  test('the canonical closure rule pins observed evidence in the template and craft-prompt flow', () => {
    assert.ok(
      canonical.closing.includes(CLOSURE_EVIDENCE_SENTENCE),
      'the canonical closing paragraph lost the closure-evidence rule'
    );
  });

  test('the precedence rule rides inside the canonical truth_grounding block', () => {
    assert.ok(
      /Preserve explicit user constraints and decisions/.test(canonical.truthGrounding),
      'truth_grounding lost the facts-vs-approach precedence rule'
    );
    assert.ok(
      /report why before substituting another approach/.test(canonical.truthGrounding),
      'truth_grounding lost the stop-and-report instruction'
    );
    // No separate check needed: the verbatim block comparison already covers it.
    const project = makeTmpProject();
    const { status, json } = check(project, goodPrompt(), ['--destination', 'task']);
    assert.equal(status, 0, JSON.stringify(json));
    assert.equal(json.ok, true);
  });

  test('a prompt without the no-invention line is an error', () => {
    const project = makeTmpProject();
    const { status, json } = check(project, goodPrompt({ no_invention: '' }), ['--destination', 'task']);
    assert.equal(status, 1);
    assert.equal(json.ok, false);
    assert.ok(json.errors.some((e) => e.error.includes('no-invention line')), JSON.stringify(json.errors));
  });

  test('the no-invention line sits outside <background>, so an omitted background keeps it', () => {
    const project = makeTmpProject();
    writeConfig(project, { omitSections: ['background'] });
    const { status, json } = check(project, goodPrompt({ background: '' }), ['--destination', 'task']);
    assert.equal(status, 0, JSON.stringify(json));
    assert.equal(json.ok, true);
    // ...and it is still the checker's business when dropped.
    const dropped = check(project, goodPrompt({ background: '', no_invention: '' }), ['--destination', 'task']);
    assert.equal(dropped.status, 1);
    assert.ok(dropped.json.errors.some((e) => e.error.includes('no-invention line')));
  });

  test('the old unbounded "iterate until it passes" fix loop is an error', () => {
    const project = makeTmpProject();
    const rules =
      '<task_rules>\n- Fix the bug.\n\nVerification (REQUIRED):\nRun: npm test\nExpected: all tests pass\n' +
      'Do NOT claim success without running this. If it fails, iterate until it passes.\n</task_rules>';
    const { status, json } = check(project, goodPrompt({ task_rules: rules }), ['--destination', 'task']);
    assert.equal(status, 1);
    assert.equal(json.ok, false);
    assert.ok(json.errors.some((e) => e.error.includes('fix loop is unbounded')), JSON.stringify(json.errors));
  });

  test('a --research prompt needs no fix ceiling — it has no verification block', () => {
    const project = makeTmpProject();
    const rules = '<task_rules>\nQuestion: does the retry path double-count?\nRun `npm test -- retry` to reproduce.\n</task_rules>';
    const { status, json } = check(project, goodPrompt({ task_rules: rules }), ['--destination', 'task', '--research']);
    assert.equal(status, 0, JSON.stringify(json));
    assert.equal(json.ok, true);
  });

  test('the template still carries all three rules', () => {
    const template = fs.readFileSync(TEMPLATE_PATH, 'utf-8');
    assert.ok(template.includes(NO_INVENTION_SENTENCE), 'template lost the no-invention line');
    assert.ok(template.includes(FIX_CEILING_SENTENCE), 'template lost the fix ceiling');
    assert.ok(
      !/If it fails, iterate until it passes\./.test(template),
      'template still carries the old unbounded fix loop'
    );
  });
});

describe('optional per-task fields', () => {
  const INVARIANTS = '<invariants>\nRebuilding twice yields the same ids.\nAn unknown flag exits non-zero.\n</invariants>';
  const RULES_WITH_FIELDS =
    '<task_rules>\n- Check the refresh path against the failing test.\n- Fix the bug.\n\n' +
    'Constraints:\n- Do not modify the public API.\n- Expected file surface: src/auth/middleware.ts. Anything beyond this list gets flagged to the user before it is written, not after.\n\n' +
    'Verification (REQUIRED):\nWrite the invariant test first, confirm it passes against the unmodified code, deliberately break the invariant and confirm the test goes red, then implement.\n' +
    `Run: npm test\nExpected: all tests pass\n${FIX_CEILING_LINE}\n</task_rules>`;

  test('a prompt carrying all three passes clean', () => {
    const project = makeTmpProject();
    const prompt = goodPrompt({ invariants: INVARIANTS, task_rules: RULES_WITH_FIELDS });
    const { status, json } = check(project, prompt, ['--destination', 'task']);
    assert.equal(status, 0, JSON.stringify(json));
    assert.equal(json.ok, true);
    assert.deepEqual(json.warnings, []);
  });

  test('a prompt carrying none of them passes clean too — all three are optional', () => {
    const project = makeTmpProject();
    const { status, json } = check(project, goodPrompt(), ['--destination', 'task']);
    assert.equal(status, 0, JSON.stringify(json));
    assert.equal(json.ok, true);
    assert.deepEqual(json.warnings, []);
  });

  test('an unfilled invariants placeholder is an error', () => {
    const project = makeTmpProject();
    const prompt = goodPrompt({ invariants: '<invariants>\n[One observable assertion per line.]\n</invariants>' });
    const { json } = check(project, prompt, ['--destination', 'task']);
    assert.equal(json.ok, false);
    assert.ok(json.errors.some((e) => e.error.includes('One observable assertion')), JSON.stringify(json.errors));
  });
});

// [Foreman: 138]
describe('handoff profiles', () => {
  const SIGNALS = ['resumed', 'conflicting', 'stale', 'highly constrained', 'risky'];

  test('the profile names are exactly standard and reinforced', () => {
    assert.deepEqual([...PROFILES].sort(), ['reinforced', 'standard']);
  });

  test('a valid standard prompt passes for every destination', () => {
    const project = makeTmpProject();
    for (const dest of ['task', 'agent', 'clipboard']) {
      const prompt = standardPrompt({ autonomy: dest === 'agent' ? AUTONOMY : '' });
      const { status, json } = check(project, prompt, ['--destination', dest, '--profile', 'standard']);
      assert.equal(status, 0, JSON.stringify(json));
      assert.equal(json.ok, true);
      assert.equal(json.profile, 'standard');
    }
  });

  test('a valid reinforced prompt still passes, flag or no flag', () => {
    const project = makeTmpProject();
    const explicit = check(project, goodPrompt(), ['--destination', 'task', '--profile', 'reinforced']);
    assert.equal(explicit.status, 0, JSON.stringify(explicit.json));
    assert.equal(explicit.json.profile, 'reinforced');
    // Backward compatibility: a prompt written before profiles existed carries
    // no flag and must validate exactly as it did.
    const implicit = check(project, goodPrompt(), ['--destination', 'task']);
    assert.equal(implicit.status, 0, JSON.stringify(implicit.json));
    assert.equal(implicit.json.profile, 'reinforced');
  });

  test('the profile is auto-detected from the guardrail blocks', () => {
    assert.equal(detectProfile(goodPrompt()), 'reinforced');
    assert.equal(detectProfile(standardPrompt()), 'standard');
    const project = makeTmpProject();
    assert.equal(check(project, standardPrompt(), ['--destination', 'task']).json.profile, 'standard');
  });

  test('an unknown --profile is refused', () => {
    const project = makeTmpProject();
    const { status, json } = check(project, goodPrompt(), ['--destination', 'task', '--profile', 'light']);
    assert.equal(status, 1);
    assert.match(json.error, /--profile must be one of/);
  });

  test('the short shape is rejected when the profile says reinforced', () => {
    const project = makeTmpProject();
    const { status, json } = check(project, standardPrompt(), ['--destination', 'task', '--profile', 'reinforced']);
    assert.equal(status, 1);
    for (const missing of ['<truth_grounding>', '<scope_discipline>', '<plan>', 'closing paragraph', 'no-invention line']) {
      assert.ok(json.errors.some((e) => e.error.includes(missing)), `${missing} not required at --profile reinforced: ${JSON.stringify(json.errors)}`);
    }
  });

  test('the closure-evidence rule is required in BOTH profiles', () => {
    const project = makeTmpProject();
    const shortNoClosure = check(project, standardPrompt({ closure: '' }), ['--destination', 'task', '--profile', 'standard']);
    assert.equal(shortNoClosure.status, 1);
    assert.ok(shortNoClosure.json.errors.some((e) => e.error.includes('closure-evidence rule')), JSON.stringify(shortNoClosure.json.errors));
    const strippedClosing = canonical.closing.replace(CLOSURE_EVIDENCE_SENTENCE, '');
    const longNoClosure = check(project, goodPrompt({ closing: strippedClosing }), ['--destination', 'task', '--profile', 'reinforced']);
    assert.equal(longNoClosure.status, 1);
    assert.ok(longNoClosure.json.errors.some((e) => e.error.includes('closure-evidence rule')), JSON.stringify(longNoClosure.json.errors));
  });

  // [Foreman: 231]
  test('the fix ceiling is required in BOTH profiles — it belongs to the verification block', () => {
    const project = makeTmpProject();
    const noCeiling = '<task_rules>\n- Fix the bug.\n\nVerification (REQUIRED):\nRun: npm test\nExpected: all tests pass\n</task_rules>';
    const short = check(project, standardPrompt({ task_rules: noCeiling }), ['--destination', 'task', '--profile', 'standard']);
    assert.equal(short.status, 1);
    assert.ok(short.json.errors.some((e) => e.error.includes('fix loop is unbounded')), JSON.stringify(short.json.errors));
    const long = check(project, goodPrompt({ task_rules: noCeiling }), ['--destination', 'task', '--profile', 'reinforced']);
    assert.equal(long.status, 1);
    assert.ok(long.json.errors.some((e) => e.error.includes('fix loop is unbounded')), JSON.stringify(long.json.errors));
  });

  test('standard still needs its truth line and a runnable verification', () => {
    const project = makeTmpProject();
    const noTruth = check(project, standardPrompt({ truth_line: '' }), ['--destination', 'task', '--profile', 'standard']);
    assert.ok(noTruth.json.errors.some((e) => e.error.includes('concise truth-grounding line')), JSON.stringify(noTruth.json.errors));
    const noVerify = check(project, standardPrompt({ task_rules: '<task_rules>\n- Fix the bug.\n</task_rules>' }), ['--destination', 'task', '--profile', 'standard']);
    assert.ok(noVerify.json.errors.some((e) => e.error.includes('verification')), JSON.stringify(noVerify.json.errors));
    const noFiles = check(project, standardPrompt({ background: '<background>\n<relevant_files>\n</relevant_files>\n</background>' }), ['--destination', 'task', '--profile', 'standard']);
    assert.ok(noFiles.json.errors.some((e) => e.error.includes('relevant_files')), JSON.stringify(noFiles.json.errors));
  });

  test('standard is a smaller floor, not a licence to reword what it keeps', () => {
    const project = makeTmpProject();
    const prompt = standardPrompt({ closure: `${CLOSURE_EVIDENCE_SENTENCE}\n\n<plan>\n1. Do whatever seems best.\n</plan>` });
    const { status, json } = check(project, prompt, ['--destination', 'task', '--profile', 'standard']);
    assert.equal(status, 1);
    assert.ok(json.errors.some((e) => e.error.includes('<plan> differs')), JSON.stringify(json.errors));
  });

  test('the template maps every mechanical signal to reinforced, with thresholds', () => {
    const raw = fs.readFileSync(TEMPLATE_PATH, 'utf-8');
    const flat = raw.replace(/\s+/g, ' ');
    assert.ok(flat.includes('## Handoff profiles'), 'the template lost the Handoff profiles section');
    for (const signal of SIGNALS) {
      assert.ok(flat.includes(`**${signal}**`), `the signal set lost "${signal}"`);
    }
    assert.ok(
      flat.includes('Any one of them true → `reinforced`. None true → `standard`.'),
      'the template lost the any-signal/no-signal mapping'
    );
    // Each signal's threshold is documented, not left to judgment.
    assert.ok(flat.includes('more than **30 days** before today'), 'the stale threshold is gone');
    assert.ok(flat.includes('**3 or more** ids'), 'the dependency-count threshold is gone');
    assert.ok(flat.includes('longer than **1000 characters**'), 'the notes-length threshold is gone');
    assert.ok(flat.includes('`collision` is `true`'), 'the conflicting signal lost its mechanical source');
    assert.ok(
      flat.includes('There is no roadmap risk field and none should be added'),
      'the template lost the no-new-risk-field rule'
    );
    assert.ok(
      /computed from the roadmap\/git facts already in hand at craft time. Never a judgment call/.test(flat),
      'the template lost the mechanical-only rule'
    );
  });

  test('the template carries both profiles fixed sentences verbatim', () => {
    const raw = fs.readFileSync(TEMPLATE_PATH, 'utf-8');
    assert.ok(raw.includes(CONCISE_TRUTH_SENTENCE), 'the template lost the concise truth line');
    assert.ok(raw.includes(CLOSURE_EVIDENCE_SENTENCE), 'the template lost the closure-evidence sentence');
    assert.ok(
      canonical.closing.includes(CLOSURE_EVIDENCE_SENTENCE),
      'the closing paragraph and the standalone closure rule have drifted apart'
    );
  });

  // The profile is craft-handoff.js's to compute and nobody's to say out
  // loud: 1.0 stopped reciting it in the delivery message, so the pin is
  // that the skill calls the assembler and keeps the score to itself.

});

// [Foreman: 075] The gate's errors are a repair instruction, not a complaint.
// Every one carries the message, the single action that clears it, and the
// shape to copy when a literal beats a sentence. The whole failing JSON is
// meant to go back to the crafting session verbatim, so the schema is pinned
// here rather than left to whichever branch happened to fire.
describe('every gate error is a repair instruction', () => {
  // One prompt that trips as many branches at once as a single input can.
  function tripEverything(project) {
    return check(project, 'this is not a handoff prompt at all\n', [
      '--destination', 'agent', '--profile', 'reinforced', '--entry', '007',
    ]).json;
  }

  test('each error carries error, fix and example, and every field is well formed', () => {
    const json = tripEverything(makeTmpProject());
    assert.equal(json.ok, false);
    assert.ok(json.errors.length >= 8, `too few branches fired to be a real pin: ${json.errors.length}`);

    for (const e of json.errors) {
      assert.equal(typeof e, 'object', `an error is still a bare string: ${JSON.stringify(e)}`);
      assert.ok(typeof e.error === 'string' && e.error.trim(), `empty error message: ${JSON.stringify(e)}`);
      assert.ok(typeof e.fix === 'string' && e.fix.trim(), `no fix on "${e.error}"`);
      assert.ok('example' in e, `example key missing on "${e.error}" — it is null, never absent`);
      assert.ok(
        e.example === null || (typeof e.example === 'string' && e.example.trim()),
        `example must be a non-empty string or null, got ${JSON.stringify(e.example)}`
      );
      assert.notEqual(e.fix, e.error, `fix just repeats the message on "${e.error}"`);
    }
  });

  test('a fix names an action rather than restating the complaint', () => {
    const json = tripEverything(makeTmpProject());
    // Every fix opens with an imperative verb — the thing to DO, first word.
    const verbs = /^(Add|Copy|Restore|Delete|Replace|Fill|List|Close|Append|Open|Include|Tell|Use)\b/;
    for (const e of json.errors) {
      assert.match(e.fix, verbs, `fix does not open with an action: "${e.fix}"`);
    }
  });

  test('warnings stay bare strings, because nothing has to be repaired to deliver', () => {
    const project = makeTmpProject();
    const { json } = check(project, goodPrompt({
      background: '<background>\n<relevant_files>\nsrc/a.ts — go (1)\n</relevant_files>\n<context>\nAs we discussed above, keep it small.\n</context>\n</background>',
    }), ['--destination', 'clipboard']);
    assert.ok(json.warnings.length > 0);
    for (const w of json.warnings) assert.equal(typeof w, 'string');
  });

});
