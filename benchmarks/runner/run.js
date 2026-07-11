#!/usr/bin/env node
'use strict';
// foreman handoff benchmark: the SAME task executed under different handoff-
// prompt styles. The four prompt arms differ by PROMPT FILE only — no plugin
// dirs, no settings files, identical CLI flags. The opt-in `trio` arm reuses
// the foreman prompt but plugs the destination session with hush + razor.
// Same chassis as hush/benchmarks/runner/run.js.
//
//   node runner/run.js --dry-run --tag smoke
//   node runner/run.js --tag smoke --tasks api-constraint --reps 1 --model haiku --arms vibe,foreman
//   node runner/run.js --tag full --reps 4 --model haiku
//   node runner/run.js --tag trio --reps 4 --model sonnet --arms foreman,trio
//
// Every arm's prompt is a hand-authored frozen file at
// fixtures/<id>/prompts/<name>.md, piped to claude -p via stdin.

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawn } = require('node:child_process');
const { parseTranscript, findVerifyCommand, mismatchNamed, snapshotDir, scoreRun } = require('./metrics.js');

const ROOT = path.resolve(__dirname, '..');            // foreman/benchmarks
const CONFIG = JSON.parse(fs.readFileSync(path.join(ROOT, 'config.json'), 'utf8'));
const TASKS = JSON.parse(fs.readFileSync(path.join(ROOT, 'tasks.json'), 'utf8'));

// --- CLI args ---------------------------------------------------------------
const argv = process.argv.slice(2);
function flag(name, dflt) {
  const i = argv.indexOf(`--${name}`);
  return i >= 0 ? argv[i + 1] : dflt;
}
const tag = flag('tag', 'dev');
const model = flag('model', CONFIG.model);
const reps = Number(flag('reps', CONFIG.reps));
const concurrency = Number(flag('concurrency', CONFIG.concurrency));
const dryRun = argv.includes('--dry-run');

// --- arms -------------------------------------------------------------------
// An arm is a prompt filename plus (optionally) a plugged destination —
// per-arm pluginDirs/settings, hush-chassis pattern. Fairness rule: every
// arm except `vibe` carries the exact same brief facts; arms differ in
// format, guardrail blocks, and destination plugins, never in information
// access.
//
// The trio arm needs hush and razor on disk. They resolve as SIBLING plugin
// checkouts (../../hush and ../../razor from this benchmarks/ directory —
// i.e. next to the foreman plugin, which is how the monorepo checks out),
// with env overrides for plugins that live elsewhere. The four default arms
// never need them.
const HUSH_DIR = process.env.HUSH_PLUGIN_DIR
  ? path.resolve(process.env.HUSH_PLUGIN_DIR)
  : path.resolve(ROOT, '..', '..', 'hush');
const RAZOR_DIR = process.env.RAZOR_PLUGIN_DIR
  ? path.resolve(process.env.RAZOR_PLUGIN_DIR)
  : path.resolve(ROOT, '..', '..', 'razor');

const ARMS = {
  vibe: { prompt: 'vibe', pluginDirs: [] },
  freeform: { prompt: 'freeform', pluginDirs: [] },
  webtemplate: { prompt: 'webtemplate', pluginDirs: [] },
  foreman: { prompt: 'foreman', pluginDirs: [] },
  // trio: the SAME foreman.md prompt, executed in a destination session with
  // hush + razor active — the full trio vs foreman-alone, same batch. razor
  // injects via SessionStart on its own; hush's force-for-plugin output
  // style does NOT apply under --setting-sources project in -p mode, so
  // settings-trio.json pins it explicitly (same lesson as the hush
  // chassis's settings-hush.json).
  trio: {
    prompt: 'foreman',
    pluginDirs: [HUSH_DIR, RAZOR_DIR],
    settings: path.join(ROOT, 'settings-trio.json'),
  },
};

// Default arms come from config.json (the four prompt-only arms) — `trio`
// is opt-in, it runs only when named via --arms (e.g. --arms foreman,trio).
const armNames = (flag('arms', CONFIG.arms.join(','))).split(',');
for (const a of armNames) {
  if (!ARMS[a]) {
    console.error(`unknown arm "${a}" — valid: ${Object.keys(ARMS).join(', ')}`);
    process.exit(1);
  }
}

// Fail fast — with a pointer at the fix — if a named arm needs plugin dirs
// or a settings file that aren't on disk. Only arms you actually name are
// checked, so the default four never require hush/razor to be present.
for (const a of armNames) {
  for (const d of ARMS[a].pluginDirs) {
    const manifest = path.join(d, '.claude-plugin', 'plugin.json');
    if (!fs.existsSync(manifest)) {
      console.error(
        `arm "${a}" needs a plugin at ${d}, but there is no .claude-plugin/plugin.json there.\n` +
        `The trio arm expects hush and razor as sibling checkouts of the foreman plugin. ` +
        `If yours live elsewhere, point HUSH_PLUGIN_DIR and RAZOR_PLUGIN_DIR at their roots and re-run.`
      );
      process.exit(1);
    }
  }
  if (ARMS[a].settings && !fs.existsSync(ARMS[a].settings)) {
    console.error(`arm "${a}": settings file missing: ${ARMS[a].settings}`);
    process.exit(1);
  }
}

// --- task selection ---------------------------------------------------------
const taskIds = flag('tasks', null);
const tasks = taskIds
  ? TASKS.filter((t) => taskIds.split(',').includes(t.id))
  : TASKS;

const outDir = path.join(ROOT, 'results', tag);

// Workdirs live OUTSIDE the repo, in the OS temp dir. Claude Code injects
// ambient git status / recent commits into the system prompt for any cwd
// inside a git working tree, regardless of tool restrictions — a workdir
// nested under a git repo silently leaks that repo's history into every
// session, and a weak model goes chasing it well past what the task needs.
const workRoot = path.join(os.tmpdir(), 'foreman-bench', tag);
fs.mkdirSync(workRoot, { recursive: true });

// --- environment ------------------------------------------------------------
// Strip nested-session vars so each run starts clean. CLAUDE_PROJECT_DIR is
// scrubbed explicitly — a leaked value would point sessions at this repo.
function cleanEnv() {
  const env = {};
  for (const [k, v] of Object.entries(process.env)) {
    // RAZOR_ included: razor's kill-switch/tuning vars must not leak into a
    // trio destination session from the parent environment.
    if (/^(CLAUDECODE|CLAUDE_CODE_|FOREMAN_|HUSH_|RAZOR_)/.test(k)) continue;
    if (k === 'CLAUDE_PROJECT_DIR') continue;
    env[k] = v;
  }
  return env;
}

// Base flags, identical for every arm (byte-for-byte what the four prompt
// arms have always run with). Per-arm plugin/settings flags are appended by
// buildArgs() below and are empty for those four arms.
function baseArgs() {
  return [
    '-p',
    '--output-format', 'stream-json',
    '--verbose',
    '--model', model,
    '--max-turns', String(CONFIG.maxTurns),
    '--setting-sources', 'project',
    '--strict-mcp-config',
    // No blanket permission bypass: scoped allowlist instead. Anything outside
    // it fails closed in -p mode and the agent has to work within the sandbox.
    '--permission-mode', 'acceptEdits',
    // comma-separated, no spaces: survives the shell:true arg join on Windows
    //
    // Bash/PowerShell are blanket (not prefix-scoped to node*/ls*/etc) as of
    // 2026-07-08: a narrow single-command prefix pattern like `PowerShell(node*)`
    // rejects ANY multi-statement command outright ("contains multiple
    // operations... requires approval") — confirmed live. Real engineering
    // sessions need multi-statement commands anyway (chained builds, piped
    // output) — a narrow prefix allowlist was never realistic for any arm.
    // --disallowedTools below still fails closed on git/Agent/scheduling.
    '--allowedTools',
    'Read,Edit,Write,Glob,Grep,TodoWrite,Bash,PowerShell',
    // --allowedTools alone does not deny what's unlisted in -p mode (verified:
    // a plain `git log` ran fine with only the allowlist above set). Task
    // fixtures never need git/subagents/scheduling; deny them explicitly so a
    // weaker model can't wander into the enclosing repo or spawn busywork.
    '--disallowedTools',
    'Bash(git*),PowerShell(git*),Agent,Task,ScheduleWakeup,CronCreate,RemoteTrigger',
  ];
}

// Per-arm extras, hush-chassis pattern: one --plugin-dir per dir, --settings
// when the arm pins one. Empty for the four prompt-only arms.
function armArgs(arm) {
  const args = [];
  for (const d of ARMS[arm].pluginDirs) args.push('--plugin-dir', d);
  if (ARMS[arm].settings) args.push('--settings', ARMS[arm].settings);
  return args;
}

function buildArgs(arm) {
  return [...baseArgs(), ...armArgs(arm)];
}

// --- prompt + pristine resolution --------------------------------------------
function promptPath(task, arm) {
  return path.join(ROOT, 'fixtures', task.fixture, 'prompts', `${ARMS[arm].prompt}.md`);
}
function readPrompt(task, arm) {
  const p = promptPath(task, arm);
  const text = fs.readFileSync(p, 'utf8');
  if (!text.trim()) throw new Error(`empty prompt file: ${p}`);
  return text;
}

// Snapshot pristine hashes ONCE per task, from the fixture's app/ tree,
// before anything runs — every scope check compares against this.
const pristineByTask = new Map();
function pristineFor(task) {
  if (!pristineByTask.has(task.id)) {
    pristineByTask.set(task.id, snapshotDir(path.join(ROOT, 'fixtures', task.fixture, 'app')));
  }
  return pristineByTask.get(task.id);
}

function makeWorkDir(task, arm, rep) {
  const key = `${task.id}__${arm}__r${rep}`;
  const workDir = path.join(workRoot, key);
  fs.rmSync(workDir, { recursive: true, force: true });
  fs.mkdirSync(workDir, { recursive: true });
  fs.cpSync(path.join(ROOT, 'fixtures', task.fixture, 'app'), workDir, { recursive: true });
  return { key, workDir };
}

// --- single run -------------------------------------------------------------
function oneRun(task, arm, rep) {
  const { key, workDir } = makeWorkDir(task, arm, rep);
  const prompt = readPrompt(task, arm);
  const pristine = pristineFor(task);

  return new Promise((resolve) => {
    const started = Date.now();
    const child = spawn('claude', buildArgs(arm), {
      cwd: workDir,
      env: cleanEnv(),
      // shell:true resolves claude.cmd on Windows. Base args are space-free;
      // per-arm plugin/settings paths resolve inside this repo, which has no
      // spaces in its path — the fail-fast existence check above already ran.
      shell: true,
    });

    let stdout = '', stderr = '';
    child.stdout.on('data', (d) => { stdout += d; });
    child.stderr.on('data', (d) => { stderr += d; });
    child.stdin.write(prompt);
    child.stdin.end();

    const killer = setTimeout(() => child.kill('SIGKILL'), CONFIG.runTimeoutMs);

    child.on('close', (code) => {
      clearTimeout(killer);
      const wallMs = Date.now() - started;
      fs.writeFileSync(path.join(outDir, 'transcripts', `${key}.jsonl`), stdout);
      let record;
      try {
        const m = parseTranscript(stdout);
        const check = scoreRun(task, workDir, pristine);
        const verifyCommand = findVerifyCommand(m.bashCommands, task.testCommand);
        record = {
          key, task: task.id, arm, rep, model,
          exitCode: code, wallMs,
          promptFile: path.relative(ROOT, promptPath(task, arm)).split(path.sep).join('/'),
          promptChars: prompt.length,
          check,
          readsBeforeFirstEdit: m.readsBeforeFirstEdit,
          verificationRan: verifyCommand !== null,
          verifyCommand,
          // info-only content signal (moved-file): did the final name the mismatch
          ...(task.checks && task.checks.mismatchNamed
            ? { mismatchNamed: mismatchNamed(m.finalText) }
            : {}),
          bashCommands: m.bashCommands,
          outputStyle: m.outputStyle,
          costUsd: m.costUsd, numTurns: m.numTurns, durationMs: m.durationMs,
          resultSubtype: m.resultSubtype,
          usage: m.usage, contextTraffic: m.contextTraffic, apiCalls: m.apiCalls,
          toolCalls: m.toolCalls, toolResultChars: m.toolResultChars,
          narrationWords: m.narrationWords, finalWords: m.finalWords,
          finalText: m.finalText,
          stderr: stderr.slice(0, 2000),
        };
      } catch (err) {
        record = { key, task: task.id, arm, rep, exitCode: code, wallMs, error: String(err), stderr: stderr.slice(0, 2000) };
      }
      fs.writeFileSync(path.join(outDir, 'runs', `${key}.json`), JSON.stringify(record, null, 2));
      const ok = record.check ? (record.check.pass ? 'PASS' : 'FAIL') : 'ERR ';
      console.log(`${ok} ${key}  cost=$${record.costUsd ?? '?'}  out=${record.usage?.output_tokens ?? '?'}tok  reads=${record.readsBeforeFirstEdit ?? '?'}  verify=${record.verificationRan ?? '?'}  ${Math.round(wallMs / 1000)}s`);
      resolve(record);
    });
  });
}

// --- dry run ----------------------------------------------------------------
// Assembles workdirs, resolves prompts, prints the planned run matrix.
// Invokes NOTHING — no claude, no tests.
function dryRunAll(queue) {
  console.log(`DRY RUN — ${queue.length} planned runs (${tasks.length} tasks x ${armNames.length} arms x ${reps} reps), model=${model}, tag=${tag}`);
  console.log(`arms: ${armNames.join(', ')}`);
  console.log(`claude args (base, every arm): claude ${baseArgs().join(' ')}`);
  for (const a of armNames) {
    const extra = armArgs(a);
    console.log(`arm args (${a}): ${extra.length ? extra.join(' ') : '(none)'}`);
  }
  console.log(`workdirs under: ${workRoot}\n`);
  let failures = 0;
  for (const [task, arm, rep] of queue) {
    try {
      const { key, workDir } = makeWorkDir(task, arm, rep);
      const prompt = readPrompt(task, arm);
      const pristine = pristineFor(task);
      const extra = armArgs(arm);
      console.log(`plan ${key}  prompt=${path.relative(ROOT, promptPath(task, arm)).split(path.sep).join('/')} (${prompt.length} chars)  fixtureFiles=${pristine.size}  workdir=${workDir}${extra.length ? `  args+=${extra.join(' ')}` : ''}`);
    } catch (err) {
      failures++;
      console.log(`FAIL ${task.id}__${arm}__r${rep}  ${err.message}`);
    }
  }
  console.log(`\ndry run ${failures ? `FAILED (${failures} problems)` : 'OK'} — nothing was invoked`);
  process.exit(failures ? 1 : 0);
}

// --- pool -------------------------------------------------------------------
async function main() {
  const queue = [];
  for (const task of tasks) for (const arm of armNames) for (let r = 1; r <= reps; r++) queue.push([task, arm, r]);

  if (dryRun) return dryRunAll(queue);

  for (const d of ['runs', 'transcripts']) fs.mkdirSync(path.join(outDir, d), { recursive: true });
  console.log(`${queue.length} runs (${tasks.length} tasks x ${armNames.length} arms x ${reps} reps), model=${model}, tag=${tag}`);
  console.log(`arms: ${armNames.join(', ')}`);

  const results = [];
  let idx = 0;
  async function worker() {
    while (idx < queue.length) {
      const [task, arm, r] = queue[idx++];
      results.push(await oneRun(task, arm, r));
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, queue.length) }, worker));

  const failures = results.filter((r) => !r.check || !r.check.pass);
  console.log(`\ndone: ${results.length - failures.length}/${results.length} passed all checks`);
  if (failures.length) console.log('non-passing:', failures.map((f) => f.key).join(', '));
  console.log(`\nnext: node runner/report.js --tag ${tag}`);
}

main();
