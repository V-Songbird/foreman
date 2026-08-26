'use strict';

// [Foreman: 062] The scripts/ layer is foreman's harness-free core: plain Node
// CLIs whose only harness touch is an OPTIONAL CLAUDE_PROJECT_DIR that falls
// back to cwd. skills/ and hooks/ are Claude Code only by design and are not
// covered here.
//
// Every child below is spawned with EVERY CLAUDE_* variable deleted from its
// environment and cwd set to a temp fixture project, so a future change that
// quietly re-couples one of these three scripts to the harness fails here
// instead of shipping.
//
// Covers:
//   - roadmap.js: add -> list -> next-candidates -> update-status round-trip,
//     writing to the CWD project because no CLAUDE_PROJECT_DIR is set
//   - render-sections.js: renders against a temp .foreman/config.json, and a
//     non-boolean requireVerification warns and falls back rather than
//     crashing (it is a boolean gate, not an enum)
//   - check-prompt.js: passes a good prompt and fails an unfilled placeholder,
//     resolving prompt-template.md from its own tree rather than from cwd
//
// If any of these fails without CLAUDE_* env, that failure IS the finding:
// fix the coupling, never relax the test.

const { describe, test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const { makeTmpProject, SCRIPTS_DIR } = require('./helpers.js');
const {
  readCanonical,
  PLACEHOLDER_FRAGMENTS,
  CONCISE_TRUTH_SENTENCE,
  CLOSURE_EVIDENCE_SENTENCE,
  FIX_CEILING_SENTENCE,
} = require(path.join(SCRIPTS_DIR, 'check-prompt.js'));

const ROADMAP = path.join(SCRIPTS_DIR, 'roadmap.js');
const RENDER = path.join(SCRIPTS_DIR, 'render-sections.js');
const CHECK = path.join(SCRIPTS_DIR, 'check-prompt.js');

/** process.env with every CLAUDE_* variable removed. */
function harnessFreeEnv() {
  const env = { ...process.env };
  for (const key of Object.keys(env)) {
    if (key.startsWith('CLAUDE_')) delete env[key];
  }
  return env;
}

/**
 * Spawn one of the three CLIs as a child with no harness environment at all,
 * rooted at `cwd`. Deliberately does NOT use helpers.runNodeScript, which
 * forwards process.env — the whole point here is to control the env exactly.
 */
function runStandalone(script, argv, stdinData, cwd) {
  return spawnSync('node', [script, ...(argv || [])], {
    input: stdinData === null || stdinData === undefined ? undefined : String(stdinData),
    encoding: 'utf-8',
    timeout: 30000,
    cwd,
    env: harnessFreeEnv(),
  });
}

function json(result) {
  try {
    return JSON.parse(result.stdout);
  } catch {
    throw new Error(`non-JSON stdout (status ${result.status}): ${result.stdout}\n${result.stderr}`);
  }
}

const FIX_CEILING_LINE = `Do NOT claim success without running this. If it fails, fix and re-run — but ${FIX_CEILING_SENTENCE}`;

/** The short profile, built here so this file does not depend on another test. */
function standardPrompt(extra = '') {
  return [
    '<task_context>\nYou are a senior engineer.\nYour goal is to fix the retry bug so all tests pass.\n</task_context>',
    CONCISE_TRUTH_SENTENCE,
    '<background>\n<relevant_files>\nsrc/auth/middleware.ts — refreshToken (42), verifySession (77)\n</relevant_files>\n</background>',
    `<task_rules>\n- Fix the bug.\n\nConstraints:\n- Do not modify the public API.\n\nVerification (REQUIRED):\nRun: npm test\nExpected: all tests pass\n${FIX_CEILING_LINE}\n</task_rules>`,
    CLOSURE_EVIDENCE_SENTENCE,
    'Fix the token refresh bug in the auth middleware.',
    extra,
  ].filter(Boolean).join('\n\n') + '\n';
}

describe('the scripts layer runs with no harness environment', () => {
  test('the fixture env really is stripped', () => {
    const env = harnessFreeEnv();
    assert.deepEqual(
      Object.keys(env).filter((k) => k.startsWith('CLAUDE_')),
      [],
      'a CLAUDE_* variable survived the strip, so every test below would be vacuous'
    );
  });

  test('roadmap.js round-trips add, list, next-candidates and update-status from cwd alone', () => {
    const project = makeTmpProject();

    const added = json(runStandalone(ROADMAP, ['add'], JSON.stringify({
      title: 'Standalone contract probe',
      why: 'The scripts layer must work with no harness variables present.',
      what: 'Nothing is executed here; the entry exists so the CLI has something to round-trip.',
      source: 'user',
      status: 'planned',
    }), project));
    assert.equal(added.ok, true, JSON.stringify(added));
    const id = added.entry.id;

    // cwd fallback, proven on disk: nothing told the CLI where the project was.
    assert.ok(
      fs.existsSync(path.join(project, 'ROADMAP.jsonl')),
      'the roadmap landed somewhere other than the cwd project'
    );

    const listed = json(runStandalone(ROADMAP, ['list', '--ids', id], null, project));
    assert.equal(listed.ok, true);
    assert.equal(listed.entries.length, 1);
    assert.equal(listed.entries[0].title, 'Standalone contract probe');

    const candidates = json(runStandalone(ROADMAP, ['next-candidates'], null, project));
    assert.equal(candidates.ok, true);
    assert.ok(Array.isArray(candidates.candidates), 'next-candidates must answer with a list');

    const closed = json(runStandalone(ROADMAP, ['update-status'], JSON.stringify({
      id,
      status: 'dropped',
      notes: 'Dropped by the standalone contract test.',
    }), project));
    assert.equal(closed.ok, true, JSON.stringify(closed));
    assert.equal(closed.entry.status, 'dropped');
  });

  test('render-sections.js renders against a cwd .foreman/config.json', () => {
    const project = makeTmpProject();
    fs.mkdirSync(path.join(project, '.foreman'), { recursive: true });
    fs.writeFileSync(
      path.join(project, '.foreman', 'config.json'),
      JSON.stringify({ usePersona: false, requireVerification: false }),
      'utf-8'
    );

    const out = json(runStandalone(RENDER, [], null, project));
    assert.equal(out.ok, true, JSON.stringify(out));
    assert.equal(out.usePersona, false, 'the cwd config was not the one that was read');
    assert.equal(out.requireVerification, false);
  });

  test('a non-boolean requireVerification warns and falls back rather than crashing', () => {
    const project = makeTmpProject();
    fs.mkdirSync(path.join(project, '.foreman'), { recursive: true });
    fs.writeFileSync(
      path.join(project, '.foreman', 'config.json'),
      JSON.stringify({ requireVerification: 'yes' }),
      'utf-8'
    );

    const result = runStandalone(RENDER, [], null, project);
    assert.equal(result.status, 0, `render-sections crashed: ${result.stderr}`);
    const out = json(result);
    assert.equal(out.ok, true);
    assert.equal(out.requireVerification, true, 'a boolean gate must fall back to its default, not carry a string through');
    assert.ok(
      out.warnings.some((w) => /requireVerification/.test(w)),
      `the bad value was swallowed silently: ${JSON.stringify(out.warnings)}`
    );
  });

  test('check-prompt.js passes a good prompt with its template resolved from its own tree', () => {
    const project = makeTmpProject();
    const file = path.join(project, 'prompt.md');
    fs.writeFileSync(file, standardPrompt(), 'utf-8');

    // Nothing named the template and cwd holds no copy of it, so a pass here
    // is proof the __dirname resolution held.
    assert.ok(!fs.existsSync(path.join(project, 'prompt-template.md')));

    const out = json(runStandalone(
      CHECK,
      [file, '--destination', 'clipboard', '--profile', 'standard'],
      null,
      project
    ));
    assert.equal(out.ok, true, JSON.stringify(out));
    assert.equal(out.profile, 'standard');
  });

  test('check-prompt.js still fails an unfilled placeholder with no harness environment', () => {
    const project = makeTmpProject();
    const file = path.join(project, 'prompt.md');
    const placeholder = PLACEHOLDER_FRAGMENTS[0];
    fs.writeFileSync(file, standardPrompt(`${placeholder} left unfilled]`), 'utf-8');

    const result = runStandalone(
      CHECK,
      [file, '--destination', 'clipboard', '--profile', 'standard'],
      null,
      project
    );
    const out = json(result);
    assert.equal(out.ok, false, 'an unfilled placeholder passed the gate');
    assert.ok(out.errors.length > 0);
  });

  test('the canonical blocks load without a project at all', () => {
    // readCanonical() is what every prompt check leans on; it must resolve
    // from the script's own tree, not from whatever directory it was run in.
    const canonical = readCanonical();
    assert.ok(canonical.closing.length > 0);
    assert.ok(canonical.truthGrounding.length > 0);
  });
});
