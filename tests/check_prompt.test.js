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
//   - custom sections must be inlined verbatim
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
  PLACEHOLDER_FRAGMENTS,
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
    background: '<background>\n<relevant_files>\nsrc/auth/middleware.ts:42-80 — token refresh logic\n</relevant_files>\n<context>\nUses JWT tokens in httpOnly cookies. No third-party auth libs.\n</context>\n</background>',
    no_invention: NO_INVENTION_LINE,
    invariants: '',
    task_rules: `<task_rules>\n- Check the refresh path against the failing test.\n- Fix the bug.\n\nConstraints:\n- Do not modify the public API.\n\nVerification (REQUIRED):\nRun: npm test\nExpected: all tests pass\n${FIX_CEILING_LINE}\n</task_rules>`,
    custom_sections: '',
    request: 'Fix the token refresh bug in the auth middleware.',
    autonomy: '',
    closing: canonical.closing,
    plan: `<plan>${canonical.plan}</plan>`,
    output_format: '<output_format>\nGive a concise, human-readable summary: what changed, and the verification result. No XML tags in the visible response.\n</output_format>',
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
    assert.ok(json.errors.some((e) => e.includes('<truth_grounding> differs')));
  });

  test('missing scope_discipline is an error', () => {
    const project = makeTmpProject();
    const { json } = check(project, goodPrompt({ scope_discipline: '' }), ['--destination', 'clipboard']);
    assert.ok(json.errors.some((e) => e.includes('missing <scope_discipline>')));
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
    assert.ok(json.errors.some((e) => e.includes('closing paragraph')));
  });
});

describe('placeholders and required blocks', () => {
  test('leftover template placeholder is an error', () => {
    const project = makeTmpProject();
    const prompt = goodPrompt({
      background: '<background>\n<relevant_files>\n[Exact file paths with line ranges for every file the task touches.]\n</relevant_files>\n<context>\nSome context.\n</context>\n</background>',
    });
    const { json } = check(project, prompt, ['--destination', 'clipboard']);
    assert.ok(json.errors.some((e) => e.includes('placeholder')));
  });

  test('missing verification is an error, unless --research', () => {
    const project = makeTmpProject();
    const noVerify = goodPrompt({
      task_rules: '<task_rules>\n- Read the auth docs.\n- Summarize the findings.\n- Write them to docs/findings.md.\n</task_rules>',
    });
    const failed = check(project, noVerify, ['--destination', 'clipboard']);
    assert.ok(failed.json.errors.some((e) => e.includes('verification')));
    const research = check(project, noVerify, ['--destination', 'clipboard', '--research']);
    assert.equal(research.json.ok, true, JSON.stringify(research.json));
  });

  test('empty relevant_files is an error; a path-less one is a warning', () => {
    const project = makeTmpProject();
    const empty = goodPrompt({
      background: '<background>\n<relevant_files>\n</relevant_files>\n<context>\nctx\n</context>\n</background>',
    });
    assert.ok(check(project, empty, ['--destination', 'clipboard']).json.errors.some((e) => e.includes('relevant_files')));
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
    assert.ok(json.errors.some((e) => e.includes('<output_format>')));
  });
});

describe('omitSections compliance', () => {
  test('an omitted tone must be absent for clipboard/task, present for agent', () => {
    const project = makeTmpProject();
    writeConfig(project, { omitSections: ['tone'] });
    const withTone = goodPrompt();
    const withoutTone = goodPrompt({ tone: '' });
    assert.ok(check(project, withTone, ['--destination', 'clipboard']).json.errors.some((e) => e.includes('<tone> present')));
    assert.equal(check(project, withoutTone, ['--destination', 'clipboard']).json.ok, true);
    assert.ok(check(project, withoutTone, ['--destination', 'agent']).json.errors.some((e) => e.includes('STAYS')));
    assert.equal(check(project, goodPrompt({ autonomy: AUTONOMY }), ['--destination', 'agent']).json.ok, true);
  });

  test('an omitted example/output_format must be absent', () => {
    const project = makeTmpProject();
    writeConfig(project, { omitSections: ['output_format'] });
    const { json } = check(project, goodPrompt(), ['--destination', 'clipboard']);
    assert.ok(json.errors.some((e) => e.includes('<output_format> present')));
    assert.equal(check(project, goodPrompt({ output_format: '' }), ['--destination', 'clipboard']).json.ok, true);
  });

  test('an omitted background must be absent, and relevant_files is not required then', () => {
    const project = makeTmpProject();
    writeConfig(project, { omitSections: ['background'] });
    assert.ok(check(project, goodPrompt(), ['--destination', 'clipboard']).json.errors.some((e) => e.includes('<background> present')));
    assert.equal(check(project, goodPrompt({ background: '' }), ['--destination', 'clipboard']).json.ok, true);
  });
});

describe('custom sections', () => {
  test('a configured custom section must be inlined verbatim', () => {
    const project = makeTmpProject();
    writeConfig(project, { customSections: [{ tag: 'compliance', content: 'All changes need a ticket reference.' }] });
    const missing = check(project, goodPrompt(), ['--destination', 'clipboard']);
    assert.ok(missing.json.errors.some((e) => e.includes('<compliance>')));
    const present = goodPrompt({
      custom_sections: '<compliance>\nAll changes need a ticket reference.\n</compliance>',
    });
    assert.equal(check(project, present, ['--destination', 'clipboard']).json.ok, true);
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
    assert.ok(json.errors.some((e) => e.includes('ROADMAP.jsonl entry `007`')));
    const withPara = goodPrompt({ entry_paragraph: paragraph });
    assert.equal(check(project, withPara, ['--destination', 'task', '--entry', '007']).json.ok, true);
  });

  test('--resume expects the resume variant', () => {
    const project = makeTmpProject();
    const fresh = goodPrompt({ entry_paragraph: paragraph });
    assert.ok(check(project, fresh, ['--destination', 'task', '--entry', '007', '--resume']).json.errors.some((e) => e.includes('resume')));
    const resumed = goodPrompt({ entry_paragraph: resumeParagraph });
    assert.equal(check(project, resumed, ['--destination', 'task', '--entry', '007', '--resume']).json.ok, true);
  });
});

describe('persona and assumed context', () => {
  test('usePersona:false rejects a "You are a" opener', () => {
    const project = makeTmpProject();
    writeConfig(project, { usePersona: false });
    const { json } = check(project, goodPrompt(), ['--destination', 'clipboard']);
    assert.ok(json.errors.some((e) => e.includes('usePersona:false')));
    const domain = goodPrompt({
      task_context: '<task_context>\nDomain: authentication middleware.\nYour goal is to fix the retry bug so all tests pass.\n</task_context>',
    });
    assert.equal(check(project, domain, ['--destination', 'clipboard']).json.ok, true);
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
    assert.ok(json.warnings.some((w) => w.includes('reasoning_extraction')));
  });

  test('the canonical closing paragraph does not trip the reasoning-echo warning', () => {
    const project = makeTmpProject();
    const { json } = check(project, goodPrompt(), ['--destination', 'clipboard']);
    assert.equal(json.ok, true);
    assert.ok(!json.warnings.some((w) => w.includes('reasoning_extraction')));
  });

  test('agent destination requires the autonomy paragraph; others warn if it appears', () => {
    const project = makeTmpProject();
    const missing = check(project, goodPrompt(), ['--destination', 'agent']);
    assert.ok(missing.json.errors.some((e) => e.includes('operating autonomously')));
    const misplaced = check(project, goodPrompt({ autonomy: AUTONOMY }), ['--destination', 'clipboard']);
    assert.equal(misplaced.json.ok, true);
    assert.ok(misplaced.json.warnings.some((w) => w.includes('user present')));
  });
});

describe('workflow-stage flavor', () => {
  test('requires no tone, no output_format, and the fixed sentence', () => {
    const project = makeTmpProject();
    const wrong = check(project, goodPrompt(), ['--destination', 'clipboard', '--workflow-stage']);
    assert.ok(wrong.json.errors.some((e) => e.includes('<tone> present')));
    assert.ok(wrong.json.errors.some((e) => e.includes('<output_format> present')));
    assert.ok(wrong.json.errors.some((e) => e.includes('enforcement sentence')));
    const right = goodPrompt({ tone: '', output_format: WORKFLOW_STAGE_SENTENCE });
    assert.equal(check(project, right, ['--destination', 'clipboard', '--workflow-stage']).json.ok, true);
  });
});

describe('drift pins', () => {
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

  test('the template still carries the checkpointing protocol literals', () => {
    const raw = fs.readFileSync(TEMPLATE_PATH, 'utf-8');
    assert.ok(raw.includes('## Checkpointing a task-split run'));
    assert.ok(raw.includes('foreman/<slug>'));
    assert.ok(raw.includes('task <n>/<total>:'));
    assert.ok(raw.includes('Squash merge (Recommended)'));
    assert.ok(raw.includes('the `checkpoints`\n  block of `.foreman/config.json`'));
    assert.ok(raw.includes('`onFinish` `"ask"`'));
    assert.ok(raw.includes('With `push` `true` and a remote'));
  });

  test('the template still carries the clipboard checkpoint embed rules', () => {
    const raw = fs.readFileSync(TEMPLATE_PATH, 'utf-8');
    assert.ok(raw.includes('**Clipboard checkpoint embed**'));
    assert.ok(raw.includes('two or more `Run:`/`Expected:` pairs; with one or none, embed nothing'));
    assert.ok(raw.includes('with the resolved values baked in'));
    assert.ok(raw.includes('skip checkpointing and just work the tasks if git is unavailable'));
  });

  test('the template pins background-Agent checkpointing to the crafting session', () => {
    const raw = fs.readFileSync(TEMPLATE_PATH, 'utf-8');
    assert.ok(raw.includes('must not switch branches or\ncommit checkpoints'));
  });

  test('both skills carry the background-Agent orchestration steering line', () => {
    for (const rel of [['skills', 'craft-prompt', 'SKILL.md'], ['skills', 'roadmap', 'SKILL.md']]) {
      const skill = fs.readFileSync(path.join(__dirname, '..', ...rel), 'utf-8');
      assert.ok(
        skill.includes('best for orchestration, where this session owns the commits'),
        `${rel.join('/')} lost the orchestration steering line`
      );
    }
  });

  test('the roadmap skill still uses the entry-paragraph grammar the checker expects', () => {
    const skill = fs.readFileSync(path.join(__dirname, '..', 'skills', 'roadmap', 'SKILL.md'), 'utf-8');
    assert.ok(skill.includes('Mark it `in_progress`'));
    assert.ok(skill.includes('already marked `in_progress`'));
    assert.ok(skill.includes('ROADMAP.jsonl entry `<id>`'));
  });

  test('the template still defines the three optional per-task fields', () => {
    const raw = fs.readFileSync(TEMPLATE_PATH, 'utf-8');
    assert.ok(raw.includes('<invariants>'));
    assert.ok(raw.includes('Expected file surface:'));
    assert.ok(raw.includes('confirm the test goes red'));
  });

  test('both skills still gather the three optional per-task fields', () => {
    for (const rel of [['skills', 'craft-prompt', 'SKILL.md'], ['skills', 'roadmap', 'SKILL.md']]) {
      const skill = fs.readFileSync(path.join(__dirname, '..', ...rel), 'utf-8');
      assert.ok(skill.includes('`invariants`'), `${rel.join('/')} lost the invariants mapping`);
      assert.ok(skill.includes('Expected file surface:'), `${rel.join('/')} lost the file-surface mapping`);
      assert.ok(skill.includes('test-first ordering'), `${rel.join('/')} lost the test-first mapping`);
    }
  });

  test('the template still defines effort fit and its verification-cost rule', () => {
    const raw = fs.readFileSync(TEMPLATE_PATH, 'utf-8');
    assert.ok(raw.includes('**Effort fit**'));
    assert.ok(raw.includes('there is no\n     `targetEffort` key'));
    assert.ok(raw.includes('the `Agent` tool takes no effort argument'));
    for (const level of ['`low` or `medium`', '`high`', '`max`']) {
      assert.ok(raw.includes(level), `the effort-fit note lost its ${level} branch`);
    }
  });

  test('both skills recommend an effort alongside the model', () => {
    for (const rel of [['skills', 'craft-prompt', 'SKILL.md'], ['skills', 'roadmap', 'SKILL.md']]) {
      const skill = fs.readFileSync(path.join(__dirname, '..', ...rel), 'utf-8');
      assert.ok(skill.includes('"Effort fit" note'), `${rel.join('/')} lost the effort-fit reference`);
      assert.ok(
        /takes no\s+effort argument/.test(skill),
        `${rel.join('/')} lost the never-dispatched rule`
      );
    }
  });
});

describe('the ordered plan block', () => {
  test('a missing <plan> is an error', () => {
    const project = makeTmpProject();
    const { status, json } = check(project, goodPrompt({ plan: '' }), ['--destination', 'task']);
    assert.equal(status, 1);
    assert.equal(json.ok, false);
    assert.ok(json.errors.some((e) => e.includes('missing <plan>')), JSON.stringify(json.errors));
  });

  test('an altered <plan> is an error — it is carried verbatim', () => {
    const project = makeTmpProject();
    const prompt = goodPrompt({ plan: '<plan>\n1. Do whatever seems best.\n</plan>' });
    const { status, json } = check(project, prompt, ['--destination', 'task']);
    assert.equal(status, 1);
    assert.ok(json.errors.some((e) => e.includes('<plan> differs')), JSON.stringify(json.errors));
  });

  test('the plan states the three universal steps and the entry-paragraph rider', () => {
    assert.match(canonical.plan, /1\. Read every file `relevant_files` cites/);
    assert.match(canonical.plan, /2\. Make the change `task_rules` describes/);
    assert.match(canonical.plan, /3\. Run each `Run:` command/);
    assert.match(canonical.plan, /open step runs before step 1 and its close step after step 3/);
    assert.match(canonical.plan, /last task only, so a row without one starts at step 1/);
  });

  test('the read-first bullet is gone from the template, the skill, and the fragment list', () => {
    const template = fs.readFileSync(TEMPLATE_PATH, 'utf-8');
    assert.ok(!template.includes('[What to read or explore first]'), 'template still carries the read-first bullet');
    assert.ok(!PLACEHOLDER_FRAGMENTS.includes('[What to read'), 'fragment list still registers the removed bullet');
    const skill = fs.readFileSync(path.join(__dirname, '..', 'skills', 'roadmap', 'SKILL.md'), 'utf-8');
    assert.ok(
      /task_rules` carries no read-first bullet/.test(skill),
      'skills/roadmap/SKILL.md still defaults task_rules to an explore-first bullet'
    );
  });
});

describe('durable handoff guardrails', () => {
  test('the precedence rule rides inside the canonical truth_grounding block', () => {
    assert.ok(
      /approach this\s+prompt prescribes is a decision already taken/.test(canonical.truthGrounding),
      'truth_grounding lost the facts-vs-approach precedence rule'
    );
    assert.ok(
      /stop and report it — never silently substitute/.test(canonical.truthGrounding),
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
    assert.ok(json.errors.some((e) => e.includes('no-invention line')), JSON.stringify(json.errors));
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
    assert.ok(dropped.json.errors.some((e) => e.includes('no-invention line')));
  });

  test('the old unbounded "iterate until it passes" fix loop is an error', () => {
    const project = makeTmpProject();
    const rules =
      '<task_rules>\n- Fix the bug.\n\nVerification (REQUIRED):\nRun: npm test\nExpected: all tests pass\n' +
      'Do NOT claim success without running this. If it fails, iterate until it passes.\n</task_rules>';
    const { status, json } = check(project, goodPrompt({ task_rules: rules }), ['--destination', 'task']);
    assert.equal(status, 1);
    assert.equal(json.ok, false);
    assert.ok(json.errors.some((e) => e.includes('fix loop is unbounded')), JSON.stringify(json.errors));
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
    assert.ok(json.errors.some((e) => e.includes('One observable assertion')), JSON.stringify(json.errors));
  });
});
