#!/usr/bin/env node
'use strict';
// Fixture self-validation. Invokes NO claude sessions — only node --test and
// hash comparisons. For every fixture:
//   1. copy app/ to a temp dir, run testCommand -> must FAIL (planted bug)
//   2. lazy path (per tasks.json selfcheckLazy):
//      - overlay type: overlay <dir>/ on a fresh copy -> tests PASS but the
//        scoring pipeline FAILS on a constraint violation (the trap is the
//        easy path, and the checks catch it)
//      - patch type: apply the patch to a fresh copy -> tests STILL FAIL
//        (patching the decoy file goes nowhere)
//   3. overlay solution/ on a fresh copy -> testCommand must PASS
//   4. the full scoring pipeline (scoreRun) must PASS on the solved tree
//   5. all four prompt files exist and are non-empty
//   6. the foreman prompt carries the template's load-bearing blocks and a
//      verification command; its truth_grounding matches the CURRENT
//      foreman/prompt-template.md block verbatim (whitespace-normalized);
//      promptMustContain strings appear in ALL arms
//
//   node selfcheck.js

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { snapshotDir, scoreRun } = require('./runner/metrics.js');

const ROOT = __dirname;
const TASKS = JSON.parse(fs.readFileSync(path.join(ROOT, 'tasks.json'), 'utf8'));
const CONFIG = JSON.parse(fs.readFileSync(path.join(ROOT, 'config.json'), 'utf8'));
const ARMS = CONFIG.arms;

const FOREMAN_REQUIRED = [
  '<truth_grounding>',
  '<scope_discipline>',
  '<task_rules>',
  '<task_context>',
  'Verification (REQUIRED)',
];

// The frozen foreman prompts must carry the template's CURRENT
// truth_grounding text, so template drift fails loudly here instead of
// silently benchmarking a stale prompt. The template lives one level up
// from this benchmarks/ directory (it ships with the foreman plugin);
// FOREMAN_DIR overrides for a checkout that lives elsewhere. Compare
// whitespace-normalized so a reflow/line-wrap never false-fails.
const TEMPLATE_PATH = process.env.FOREMAN_DIR
  ? path.join(path.resolve(process.env.FOREMAN_DIR), 'prompt-template.md')
  : path.resolve(ROOT, '..', 'prompt-template.md');

function normWs(s) {
  return String(s).replace(/\s+/g, ' ').trim();
}

function templateTruthGrounding() {
  const text = fs.readFileSync(TEMPLATE_PATH, 'utf8');
  const m = text.match(/<truth_grounding>([\s\S]*?)<\/truth_grounding>/);
  if (!m) throw new Error(`no <truth_grounding> block found in ${TEMPLATE_PATH}`);
  return normWs(m[1]);
}

function runTests(cmd, cwd) {
  const [c, ...args] = cmd.split(' ');
  return spawnSync(c, args, { cwd, shell: true, encoding: 'utf8', timeout: 120000 });
}

function freshCopy(appDir, name) {
  const work = path.join(os.tmpdir(), 'foreman-bench-selfcheck', name);
  fs.rmSync(work, { recursive: true, force: true });
  fs.mkdirSync(work, { recursive: true });
  fs.cpSync(appDir, work, { recursive: true });
  return work;
}

let truthBlock;
try {
  truthBlock = templateTruthGrounding();
} catch (err) {
  console.log(`FAIL template: ${err.message}`);
  process.exit(1);
}

let anyFail = false;
for (const task of TASKS) {
  const problems = [];
  const fixtureDir = path.join(ROOT, 'fixtures', task.fixture);
  const appDir = path.join(fixtureDir, 'app');
  const solutionDir = path.join(fixtureDir, 'solution');
  const pristineSnap = snapshotDir(appDir);

  // 1: pristine fails
  const pristineWork = freshCopy(appDir, `${task.id}-pristine`);
  const pristineRun = runTests(task.testCommand, pristineWork);
  if (pristineRun.status === 0) problems.push('pristine app PASSES tests (bug not planted?)');

  // 2: lazy path behaves as declared
  const lazy = task.selfcheckLazy;
  if (lazy) {
    const lazyWork = freshCopy(appDir, `${task.id}-lazy`);
    if (lazy.type === 'overlay') {
      fs.cpSync(path.join(fixtureDir, lazy.dir), lazyWork, { recursive: true, force: true });
    } else if (lazy.type === 'patch') {
      const target = path.join(lazyWork, lazy.file);
      const before = fs.readFileSync(target, 'utf8');
      if (!before.includes(lazy.find)) {
        problems.push(`lazy patch anchor "${lazy.find}" not found in ${lazy.file}`);
      }
      fs.writeFileSync(target, before.replace(lazy.find, lazy.replace));
    } else {
      problems.push(`unknown selfcheckLazy type "${lazy.type}"`);
    }
    const lazyRun = runTests(task.testCommand, lazyWork);
    if (lazy.expect === 'tests-pass-checks-fail') {
      if (lazyRun.status !== 0) {
        problems.push(`lazy path should PASS tests but exits ${lazyRun.status} (trap is not the easy path)`);
      }
      const lazyScore = scoreRun(task, lazyWork, pristineSnap);
      if (lazyScore.pass) {
        problems.push('lazy path passes ALL checks — the constraint check failed to catch it');
      }
    } else if (lazy.expect === 'tests-fail') {
      if (lazyRun.status === 0) {
        problems.push('lazy patch of the decoy file PASSES tests — the decoy is load-bearing, trap broken');
      }
    } else {
      problems.push(`unknown selfcheckLazy expect "${lazy.expect}"`);
    }
  }

  // 3-4: solution passes tests AND the full scoring pipeline
  const solvedWork = freshCopy(appDir, `${task.id}-solved`);
  fs.cpSync(solutionDir, solvedWork, { recursive: true, force: true });
  const solvedRun = runTests(task.testCommand, solvedWork);
  if (solvedRun.status !== 0) {
    problems.push(`solution still FAILS tests (exit ${solvedRun.status})`);
  }
  const score = scoreRun(task, solvedWork, pristineSnap);
  if (!score.pass) problems.push(`scoreRun on solved tree fails: ${score.violations.join('; ')}`);

  // 5: prompts exist, non-empty
  for (const arm of ARMS) {
    const p = path.join(fixtureDir, 'prompts', `${arm}.md`);
    if (!fs.existsSync(p)) { problems.push(`missing prompt ${arm}.md`); continue; }
    if (!fs.readFileSync(p, 'utf8').trim()) problems.push(`empty prompt ${arm}.md`);
  }

  // 6: foreman prompt structure, current-template truth_grounding, facts
  const foremanPath = path.join(fixtureDir, 'prompts', 'foreman.md');
  if (fs.existsSync(foremanPath)) {
    const fp = fs.readFileSync(foremanPath, 'utf8');
    for (const block of FOREMAN_REQUIRED) {
      if (!fp.includes(block)) problems.push(`foreman.md missing ${block}`);
    }
    if (!fp.includes(task.testCommand)) problems.push(`foreman.md does not cite the test command "${task.testCommand}"`);
    if (!normWs(fp).includes(truthBlock)) {
      problems.push('foreman.md truth_grounding does not match the current prompt-template.md block (template drift — regenerate the frozen prompt)');
    }
  }
  for (const needle of task.promptMustContain || []) {
    for (const arm of ARMS) {
      const p = path.join(fixtureDir, 'prompts', `${arm}.md`);
      if (fs.existsSync(p) && !fs.readFileSync(p, 'utf8').includes(needle)) {
        problems.push(`${arm}.md missing required fact "${needle}"`);
      }
    }
  }

  if (problems.length) {
    anyFail = true;
    console.log(`FAIL ${task.id}`);
    for (const p of problems) console.log(`     - ${p}`);
  } else {
    const lazyNote = lazy
      ? (lazy.expect === 'tests-pass-checks-fail' ? 'lazy passes tests but trips checks -> ' : 'lazy decoy patch still fails -> ')
      : '';
    console.log(`PASS ${task.id}  (pristine fails -> ${lazyNote}solution passes -> checks pass -> ${ARMS.length} prompts ok, truth_grounding current)`);
  }
}

console.log(anyFail ? '\nselfcheck FAILED' : '\nselfcheck OK — no claude session was invoked');
process.exit(anyFail ? 1 : 0);
