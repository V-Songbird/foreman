#!/usr/bin/env node
'use strict';
// "What should I do next?" mini-benchmark: cost + stability of picking the
// next task from a backlog.
//
// Two arms:
//   markdown — claude -p in a workdir containing ONLY TODO.md, asked to pick
//              the next task and end with "PICK: <task title>". 5 reps/size.
//              THIS ARM BILLS THE ACCOUNT — it only runs without --dry-run.
//   foreman  — no LLM at all: node foreman/scripts/roadmap.js next-candidates
//              with CLAUDE_PROJECT_DIR pointed at the fixture. Zero tokens,
//              deterministic; safe to run any time (runs even under --dry-run).
//
//   node picks/run.js --tag check --arms foreman            # free, runs now
//   node picks/run.js --tag smoke --dry-run                 # markdown arm planned only
//   node picks/run.js --tag real --reps 5 --model haiku     # bills the account
//
// Chassis notes (spawn flags, env scrubbing, temp workdirs) copied from
// runner/run.js — see the comments there for the rationale on each flag.

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawn, spawnSync } = require('node:child_process');
const { parseTranscript } = require('../runner/metrics.js');

const ROOT = path.join(__dirname);                       // picks/
const HARNESS = path.resolve(__dirname, '..');           // foreman/benchmarks
// The foreman arm shells out to the plugin's own roadmap.js — one level up
// from this benchmarks/ directory. FOREMAN_DIR overrides for a plugin
// checkout that lives elsewhere.
const FOREMAN_ROOT = process.env.FOREMAN_DIR
  ? path.resolve(process.env.FOREMAN_DIR)
  : path.resolve(HARNESS, '..');
const ROADMAP_JS = path.join(FOREMAN_ROOT, 'scripts', 'roadmap.js');

const argv = process.argv.slice(2);
function flag(name, dflt) {
  const i = argv.indexOf(`--${name}`);
  return i >= 0 ? argv[i + 1] : dflt;
}
const tag = flag('tag', 'dev');
const model = flag('model', 'haiku');
const reps = Number(flag('reps', 5));
const sizes = flag('sizes', '10,50,150').split(',').map(Number);
const arms = flag('arms', 'markdown,foreman').split(',');
const dryRun = argv.includes('--dry-run');

const PROMPT = `I keep my whole backlog in TODO.md here at the project root. Have a look and tell me what I should work on next and why. End your reply with exactly one line:
PICK: <task title>
`;

const outDir = path.join(ROOT, 'results', tag);
const workRoot = path.join(os.tmpdir(), 'foreman-bench-picks', tag);

function cleanEnv(extra) {
  const env = {};
  for (const [k, v] of Object.entries(process.env)) {
    if (/^(CLAUDECODE|CLAUDE_CODE_|FOREMAN_|HUSH_)/.test(k)) continue;
    if (k === 'CLAUDE_PROJECT_DIR') continue;
    env[k] = v;
  }
  return Object.assign(env, extra || {});
}

function buildArgs() {
  // Same hard-won flag set as runner/run.js (see comments there).
  return [
    '-p',
    '--output-format', 'stream-json',
    '--verbose',
    '--model', model,
    '--max-turns', '10',
    '--setting-sources', 'project',
    '--strict-mcp-config',
    '--permission-mode', 'acceptEdits',
    '--allowedTools',
    'Read,Edit,Write,Glob,Grep,TodoWrite,Bash,PowerShell',
    '--disallowedTools',
    'Bash(git*),PowerShell(git*),Agent,Task,ScheduleWakeup,CronCreate,RemoteTrigger',
  ];
}

function fixtureDir(size) {
  const d = path.join(ROOT, 'fixtures', String(size));
  if (!fs.existsSync(path.join(d, 'ROADMAP.jsonl'))) {
    throw new Error(`missing fixture for size ${size} — run: node picks/gen.js`);
  }
  return d;
}

function parsePick(finalText) {
  const matches = [...String(finalText).matchAll(/^\s*PICK:\s*(.+?)\s*$/gm)];
  return matches.length ? matches[matches.length - 1][1] : null;
}

// Semantic pick identity: raw strings inflate instability — "Fix timezone
// handling in i18n", "Fix timezone handling in i18n (#007)" and
// "**Fix timezone handling in i18n**" are the same answer dressed three
// ways. Strip markdown emphasis, a trailing " (#NNN)" id, surrounding
// quotes/punctuation, collapse whitespace, lowercase. Raw strings stay in
// the record; normalized is the headline distinct count.
function normalizePick(s) {
  if (!s) return '';
  return String(s)
    .replace(/\*\*/g, '')
    .replace(/\s*\(#\d+\)\s*$/, '')
    .replace(/^["'`“”‘’\s]+/, '')
    .replace(/["'`“”‘’.,;:!\s]+$/, '')
    .replace(/\s+/g, ' ')
    .toLowerCase();
}

// --- foreman arm: mechanical, zero-token, runs even under --dry-run ----------
function foremanArm(size) {
  const fixture = fixtureDir(size);
  const picks = [];
  let total = null;
  for (let r = 1; r <= reps; r++) {
    const res = spawnSync(process.execPath, [ROADMAP_JS, 'next-candidates', '--limit', '3'], {
      env: cleanEnv({ CLAUDE_PROJECT_DIR: fixture }),
      encoding: 'utf8',
      timeout: 30000,
    });
    let parsed;
    try { parsed = JSON.parse(res.stdout); } catch { parsed = null; }
    if (!parsed || !parsed.ok) {
      return { size, arm: 'foreman', error: `next-candidates failed: ${res.stdout || res.stderr}` };
    }
    if (!parsed.candidates.length) {
      return { size, arm: 'foreman', error: 'next-candidates returned zero candidates' };
    }
    picks.push(parsed.candidates[0].title);
    total = parsed.total_unblocked;
  }
  const normalized = picks.map(normalizePick);
  return {
    size, arm: 'foreman', reps,
    picks, normalizedPicks: normalized,
    distinct: new Set(normalized).size,
    distinctRaw: new Set(picks).size,
    deterministic: new Set(normalized).size === 1,
    totalUnblocked: total,
    meanOutputTokens: 0, meanCostUsd: 0, // no LLM: zero-token determinism
  };
}

// --- markdown arm: claude -p over TODO.md ------------------------------------
function makeWorkDir(size, rep) {
  const workDir = path.join(workRoot, `md-${size}-r${rep}`);
  fs.rmSync(workDir, { recursive: true, force: true });
  fs.mkdirSync(workDir, { recursive: true });
  fs.copyFileSync(path.join(fixtureDir(size), 'TODO.md'), path.join(workDir, 'TODO.md'));
  return workDir;
}

function markdownRep(size, rep) {
  const workDir = makeWorkDir(size, rep);
  return new Promise((resolve) => {
    const started = Date.now();
    const child = spawn('claude', buildArgs(), {
      cwd: workDir,
      env: cleanEnv(),
      shell: true,
    });
    let stdout = '', stderr = '';
    child.stdout.on('data', (d) => { stdout += d; });
    child.stderr.on('data', (d) => { stderr += d; });
    child.stdin.write(PROMPT);
    child.stdin.end();
    const killer = setTimeout(() => child.kill('SIGKILL'), 240000);
    child.on('close', (code) => {
      clearTimeout(killer);
      fs.mkdirSync(path.join(outDir, 'transcripts'), { recursive: true });
      fs.writeFileSync(path.join(outDir, 'transcripts', `md-${size}-r${rep}.jsonl`), stdout);
      const m = parseTranscript(stdout);
      resolve({
        size, rep, exitCode: code, wallMs: Date.now() - started,
        pick: parsePick(m.finalText),
        costUsd: m.costUsd,
        outputTokens: m.usage?.output_tokens ?? null,
        contextTraffic: m.contextTraffic,
        resultSubtype: m.resultSubtype,
        finalText: m.finalText,
        stderr: stderr.slice(0, 1000),
      });
    });
  });
}

async function markdownArm(size) {
  if (dryRun) {
    const rows = [];
    for (let r = 1; r <= reps; r++) {
      const workDir = makeWorkDir(size, r);
      rows.push(workDir);
      console.log(`plan markdown size=${size} rep=${r} workdir=${workDir} prompt=${PROMPT.length} chars`);
    }
    return { size, arm: 'markdown', dryRun: true, planned: rows.length };
  }
  const repsOut = [];
  for (let r = 1; r <= reps; r++) {
    const rec = await markdownRep(size, r);
    console.log(`markdown size=${size} r=${r}  pick="${rec.pick}"  cost=$${rec.costUsd}  out=${rec.outputTokens}tok`);
    repsOut.push(rec);
  }
  const picks = repsOut.map((r) => r.pick);
  const normalized = picks.map((p) => normalizePick(p) || '(none)');
  const mean = (xs) => {
    const ys = xs.filter(Number.isFinite);
    return ys.length ? ys.reduce((a, b) => a + b, 0) / ys.length : null;
  };
  return {
    size, arm: 'markdown', reps,
    picks, normalizedPicks: normalized,
    distinct: new Set(normalized).size,
    distinctRaw: new Set(picks.map((p) => p || '(none)')).size,
    deterministic: new Set(normalized).size === 1,
    meanOutputTokens: mean(repsOut.map((r) => r.outputTokens)),
    meanCostUsd: mean(repsOut.map((r) => r.costUsd)),
    meanContextTraffic: mean(repsOut.map((r) => r.contextTraffic)),
    repRecords: repsOut,
  };
}

// --- report -------------------------------------------------------------------
function writeReport(records) {
  let md = `# picks mini-benchmark — run \`${tag}\`\n\n`;
  md += `Stability ("distinct picks out of ${reps}") and cost of answering "what should I work on next?" per backlog size.\n\n`;
  md += `Distinct counts are over NORMALIZED picks (markdown emphasis, trailing \` (#NNN)\` ids, surrounding quotes/punctuation, whitespace, and case stripped) — the headline number. Raw distinct is shown for reference; raw strings stay in records.json.\n\n`;
  md += `| Size | Arm | Distinct (normalized) / ${reps} | Distinct (raw) | Deterministic | Mean output tok | Mean cost USD | Top pick |\n|---|---|---|---|---|---|---|---|\n`;
  for (const r of records) {
    if (r.error) { md += `| ${r.size} | ${r.arm} | ERROR: ${r.error} | | | | | |\n`; continue; }
    if (r.dryRun) { md += `| ${r.size} | ${r.arm} | (dry run — ${r.planned} planned) | | | | | |\n`; continue; }
    md += `| ${r.size} | ${r.arm} | ${r.distinct}/${reps} | ${r.distinctRaw}/${reps} | ${r.deterministic ? 'yes' : 'no'} | ${r.meanOutputTokens ?? 0} | ${r.meanCostUsd ?? 0} | ${r.picks[0] ?? '—'} |\n`;
  }
  md += `\nThe foreman arm is \`roadmap.js next-candidates\` — mechanical graph filtering, zero tokens, no LLM in the loop.\n`;
  fs.mkdirSync(outDir, { recursive: true });
  fs.writeFileSync(path.join(outDir, 'records.json'), JSON.stringify(records, null, 2));
  fs.writeFileSync(path.join(outDir, 'report.md'), md);
  console.log(`\nwrote ${path.join(outDir, 'report.md')}`);
}

async function main() {
  console.log(`picks run: tag=${tag} sizes=${sizes.join(',')} arms=${arms.join(',')} reps=${reps}${dryRun ? ' (DRY RUN: markdown arm plans only; foreman arm is free and still runs)' : ''}`);
  if (!fs.existsSync(ROADMAP_JS) && arms.includes('foreman')) {
    console.error(`foreman arm needs ${ROADMAP_JS} — set FOREMAN_DIR if the plugin lives elsewhere`);
    process.exit(1);
  }
  const records = [];
  for (const size of sizes) {
    if (arms.includes('foreman')) {
      const rec = foremanArm(size);
      records.push(rec);
      if (rec.error) console.log(`foreman size=${size} ERROR: ${rec.error}`);
      else console.log(`foreman size=${size}  top="${rec.picks[0]}"  distinct=${rec.distinct}/${reps}  unblocked=${rec.totalUnblocked}  tokens=0`);
    }
    if (arms.includes('markdown')) {
      records.push(await markdownArm(size));
    }
  }
  writeReport(records);
  const bad = records.filter((r) => r.error);
  process.exit(bad.length ? 1 : 0);
}

main();
