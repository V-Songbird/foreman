#!/usr/bin/env node
'use strict';
// Aggregate run records into report.md: per-task x per-arm tables plus
// per-rep rows so the spread stays visible.   node runner/report.js --tag full

const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');
const argv = process.argv.slice(2);
const tag = argv[argv.indexOf('--tag') + 1] || 'dev';
const dir = path.join(ROOT, 'results', tag);
const CONFIG = JSON.parse(fs.readFileSync(path.join(ROOT, 'config.json'), 'utf8'));

const runs = fs.readdirSync(path.join(dir, 'runs'))
  .filter((f) => f.endsWith('.json'))
  .map((f) => JSON.parse(fs.readFileSync(path.join(dir, 'runs', f), 'utf8')))
  .filter((r) => !r.error);

// Arm order follows config.json (vibe -> freeform -> webtemplate -> foreman),
// which is also the "least structure -> most structure" reading order.
// Opt-in arms found only in the records (e.g. trio) append after those.
const ARMS = CONFIG.arms
  .filter((a) => runs.some((r) => r.arm === a))
  .concat([...new Set(runs.map((r) => r.arm))].filter((a) => !CONFIG.arms.includes(a)));
const TASKS = [...new Set(runs.map((r) => r.task))];

const mean = (xs) => {
  const ys = xs.filter(Number.isFinite);
  return ys.length ? ys.reduce((a, b) => a + b, 0) / ys.length : NaN;
};
const fmt = (x, d = 0) => (Number.isFinite(x) ? x.toFixed(d) : '—');
const pct = (x) => (Number.isFinite(x) ? `${(x * 100).toFixed(0)}%` : '—');
// per-rep-consistency signal: "mean (min–max)" over a cell's reps
const range = (xs, d = 0) => {
  const ys = xs.filter(Number.isFinite);
  if (!ys.length) return '—';
  const lo = Math.min(...ys), hi = Math.max(...ys);
  return `${fmt(mean(ys), d)} (${fmt(lo, d)}–${fmt(hi, d)})`;
};

function agg(rs) {
  return {
    n: rs.length,
    correct: mean(rs.map((r) => (r.check?.pass ? 1 : 0))),
    testsPass: mean(rs.map((r) => (r.check?.testsPass ? 1 : 0))),
    cost: mean(rs.map((r) => r.costUsd ?? NaN)),
    outTok: mean(rs.map((r) => r.usage?.output_tokens ?? NaN)),
    traffic: mean(rs.map((r) => r.contextTraffic ?? NaN)),
    narration: mean(rs.map((r) => r.narrationWords ?? NaN)),
    apiCalls: mean(rs.map((r) => r.apiCalls ?? NaN)),
    reads: range(rs.map((r) => r.readsBeforeFirstEdit ?? NaN), 0),
    verify: mean(rs.map((r) => (r.verificationRan ? 1 : 0))),
    violations: mean(rs.map((r) => r.check?.violations?.length ?? NaN)),
    turns: range(rs.map((r) => r.numTurns ?? NaN), 0),
    wallS: mean(rs.map((r) => r.wallMs / 1000)),
  };
}

const byTaskArm = {};
for (const t of TASKS) {
  byTaskArm[t] = {};
  for (const a of ARMS) byTaskArm[t][a] = agg(runs.filter((r) => r.task === t && r.arm === a));
}
const byArm = {};
for (const a of ARMS) byArm[a] = agg(runs.filter((r) => r.arm === a));

const armHeader = '| Arm | n | Correct (all checks) | Tests pass | Cost USD | Output tok | Traffic tok | Narration w | API calls | Reads before 1st edit (min–max) | Turns (min–max) | Verification ran | Violations/run | Wall s |\n|---|---|---|---|---|---|---|---|---|---|---|---|---|---|\n';
const armRow = (label, g) =>
  `| ${label} | ${g.n} | ${pct(g.correct)} | ${pct(g.testsPass)} | ${fmt(g.cost, 4)} | ${fmt(g.outTok)} | ${fmt(g.traffic)} | ${fmt(g.narration)} | ${fmt(g.apiCalls, 1)} | ${g.reads} | ${g.turns} | ${pct(g.verify)} | ${fmt(g.violations, 1)} | ${fmt(g.wallS)} |\n`;

let md = `# foreman handoff benchmark — run \`${tag}\`\n\n`;
md += `${runs.length} runs · model \`${runs[0]?.model}\` · generated from \`results/${tag}/runs/\`\n\n`;
md += `Arms differ by prompt file only; every arm except \`vibe\` carries the same brief facts. Judge on per-rep spread, not the mean alone.\n\n`;
md += `## Overall (mean per run, all tasks pooled)\n\n${armHeader}`;
for (const a of ARMS) md += armRow(`**${a}**`, byArm[a]);

for (const t of TASKS) {
  md += `\n## ${t}\n\n${armHeader}`;
  for (const a of ARMS) md += armRow(a, byTaskArm[t][a]);

  md += `\n### Per-rep rows — ${t}\n\n`;
  md += `| Arm | Rep | Pass | Tests | Violations | Cost USD | Output tok | Narration w | Reads | Verify command | Mismatch named | Final words | Result |\n|---|---|---|---|---|---|---|---|---|---|---|---|---|\n`;
  for (const a of ARMS) {
    for (const r of runs.filter((x) => x.task === t && x.arm === a).sort((x, y) => x.rep - y.rep)) {
      const viols = r.check?.violations?.length
        ? r.check.violations.map((v) => v.replace(/\|/g, '\\|')).join('; ')
        : '—';
      const verify = r.verificationRan
        ? `\`${String(r.verifyCommand ?? '').replace(/\|/g, '\\|').replace(/\n/g, ' ').slice(0, 60)}\``
        : 'NO';
      const mismatch = r.mismatchNamed === undefined ? '—' : (r.mismatchNamed ? 'yes' : 'no');
      md += `| ${a} | ${r.rep} | ${r.check?.pass ? 'PASS' : 'FAIL'} | ${r.check?.testsPass ? 'ok' : 'fail'} | ${viols} | ${fmt(r.costUsd, 4)} | ${r.usage?.output_tokens ?? '—'} | ${r.narrationWords ?? '—'} | ${r.readsBeforeFirstEdit ?? '—'} | ${verify} | ${mismatch} | ${r.finalWords ?? '—'} | ${r.resultSubtype ?? '—'} |\n`;
    }
  }
}

md += `\n---\n\nHonesty checklist before quoting any number: same-batch arms only; check each rep's \`finalText\` for truncation-fabricated runs (\`resultSubtype\` != \`success\` is a red flag); n>=4 per cell before claiming anything.\n`;

fs.writeFileSync(path.join(dir, 'report.md'), md);
console.log(`wrote ${path.join(dir, 'report.md')} (${runs.length} runs)`);
