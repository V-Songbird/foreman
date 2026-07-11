#!/usr/bin/env node
'use strict';
// Generates synthetic backlogs at sizes 10/50/150 into picks/fixtures/<size>/:
//   ROADMAP.jsonl — foreman's schema (see foreman/roadmap-schema.md): all
//     required fields, a dependency graph, a few done/deferred/in_progress
//   TODO.md — the SAME content as a human-style markdown backlog
// Deterministic (seeded PRNG) so regeneration is stable.
//
//   node picks/gen.js

const fs = require('node:fs');
const path = require('node:path');

const SIZES = [10, 50, 150];
const OUT = path.join(__dirname, 'fixtures');

// --- seeded PRNG --------------------------------------------------------------
function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// --- material ------------------------------------------------------------------
const AREAS = [
  { name: 'auth', dir: 'src/auth' },
  { name: 'billing', dir: 'src/billing' },
  { name: 'search', dir: 'src/search' },
  { name: 'notifications', dir: 'src/notifications' },
  { name: 'exports', dir: 'src/exports' },
  { name: 'the admin dashboard', dir: 'src/admin' },
  { name: 'rate limiting', dir: 'src/ratelimit' },
  { name: 'webhooks', dir: 'src/webhooks' },
  { name: 'the session store', dir: 'src/sessions' },
  { name: 'the audit log', dir: 'src/audit' },
  { name: 'uploads', dir: 'src/uploads' },
  { name: 'caching', dir: 'src/cache' },
  { name: 'metrics', dir: 'src/metrics' },
  { name: 'onboarding', dir: 'src/onboarding' },
  { name: 'i18n', dir: 'src/i18n' },
];

const WORK = [
  { t: (a) => `Add retry backoff to ${a.name}`, why: 'Transient upstream failures currently bubble straight to users.', what: (a) => `Wrap outbound calls in ${a.dir}/client.js with exponential backoff — 3 attempts, 200ms base.` },
  { t: (a) => `Fix pagination drift in ${a.name}`, why: 'Page boundaries shift when rows are inserted mid-scroll; duplicates show up.', what: (a) => `Switch ${a.dir}/query.js from offset to keyset pagination on (created_at, id).` },
  { t: (a) => `Instrument ${a.name} with latency histograms`, why: 'We only have averages today; p99 regressions go unnoticed.', what: (a) => `Emit histogram buckets from ${a.dir}/middleware.js into the metrics pipeline.` },
  { t: (a) => `Harden input validation in ${a.name}`, why: 'Malformed payloads reach the handler layer and 500 instead of 400.', what: (a) => `Add schema validation at the boundary in ${a.dir}/routes.js; reject early with field-level errors.` },
  { t: (a) => `Migrate ${a.name} config to the shared loader`, why: 'It still reads env vars ad hoc; every other module uses the typed loader.', what: (a) => `Replace process.env reads in ${a.dir}/config.js with the shared loader and defaults.` },
  { t: (a) => `Document the ${a.name} failure modes`, why: 'On-call keeps rediscovering the same edge cases from scratch.', what: (a) => `Write ${a.dir}/RUNBOOK.md covering the three known failure modes and their signals.` },
  { t: (a) => `Cache hot reads in ${a.name}`, why: 'The same lookups hammer the DB on every request; p50 suffers.', what: (a) => `Add a 30s in-process LRU in front of ${a.dir}/store.js reads; invalidate on write.` },
  { t: (a) => `Fix timezone handling in ${a.name}`, why: 'Dates render off-by-one for users west of UTC.', what: (a) => `Store UTC in ${a.dir}/serialize.js and convert at the render edge only.` },
  { t: (a) => `Add integration tests for ${a.name}`, why: 'Only unit coverage today; the seams between modules are where bugs land.', what: (a) => `Cover the three main flows end to end in tests/${a.dir.split('/')[1]}.integration.test.js against a real store.` },
  { t: (a) => `Debounce duplicate events in ${a.name}`, why: 'Upstream sends bursts; we process the same event several times.', what: (a) => `Key events by idempotency token in ${a.dir}/consumer.js; drop repeats inside a 60s window.` },
  { t: (a) => `Tighten error messages in ${a.name}`, why: 'Current errors leak internals and confuse support tickets.', what: (a) => `Map internal errors to user-facing codes in ${a.dir}/errors.js; log the detail, return the code.` },
  { t: (a) => `Batch writes in ${a.name}`, why: 'Row-at-a-time writes dominate the flamegraph under load.', what: (a) => `Buffer writes in ${a.dir}/writer.js and flush every 100 rows or 50ms, whichever first.` },
];

function fakeSha(rand) {
  const hex = '0123456789abcdef';
  let s = '';
  for (let i = 0; i < 7; i++) s += hex[Math.floor(rand() * 16)];
  return s;
}

function dateStr(d) {
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

// --- generation -----------------------------------------------------------------
function generate(size, rand) {
  const nDone = Math.max(1, Math.round(size * 0.15));
  const nInProgress = Math.max(1, Math.round(size * 0.04));
  const nDeferred = Math.max(1, Math.round(size * 0.05));
  const nDropped = size >= 50 ? Math.round(size * 0.02) : 0;

  const entries = [];
  const start = new Date(2026, 0, 5);
  const spacingDays = Math.max(1, Math.floor(160 / size));

  for (let i = 0; i < size; i++) {
    const id = String(i + 1).padStart(3, '0');
    const area = AREAS[(i * 7 + Math.floor(rand() * 3)) % AREAS.length];
    const work = WORK[(i * 5 + Math.floor(rand() * 2)) % WORK.length];

    // Older entries skew done; a couple in the middle are in_progress.
    let status = 'planned';
    if (i < nDone) status = 'done';
    else if (i < nDone + nInProgress) status = 'in_progress';
    else if (i >= size - nDeferred) status = 'deferred';
    else if (nDropped && i >= size - nDeferred - nDropped) status = 'dropped';

    // Dependency graph: ~35% of non-done entries depend on 1-2 earlier ids.
    // 60% of picked deps point at a done id (unblocked), the rest at whatever
    // came earlier (often blocked).
    const depends_on = [];
    if (i >= 3 && status !== 'done' && rand() < 0.35) {
      const nDeps = rand() < 0.3 ? 2 : 1;
      for (let d = 0; d < nDeps; d++) {
        const preferDone = rand() < 0.6 && nDone > 0;
        const idx = preferDone
          ? Math.floor(rand() * Math.min(nDone, i))
          : Math.floor(rand() * i);
        const dep = String(idx + 1).padStart(3, '0');
        if (dep !== id && !depends_on.includes(dep)) depends_on.push(dep);
      }
    }

    const created = new Date(start.getTime() + i * spacingDays * 86400000);
    const updatedOffset = Math.floor(rand() * 30);
    let updated = new Date(created.getTime() + updatedOffset * 86400000);
    const cap = new Date(2026, 6, 9);
    if (updated > cap) updated = cap;

    const source = rand() < 0.2 ? 'claude-suggested' : 'user';
    const sha = fakeSha(rand);
    const entry = {
      id,
      title: work.t(area),
      why: work.why,
      what: work.what(area),
      status,
      source,
      depends_on,
      touches: [area.dir],
      commits: status === 'done' ? [sha] : [],
      created_at: dateStr(created),
      updated_at: dateStr(updated),
      notes: source === 'claude-suggested'
        ? `surfaced via post-commit discovery scan on commit ${fakeSha(rand)}`
        : '',
    };
    entries.push(entry);
  }

  // Titles must be unique — the PICK parser matches on them.
  const seen = new Map();
  for (const e of entries) {
    const n = (seen.get(e.title) || 0) + 1;
    seen.set(e.title, n);
    if (n > 1) e.title = `${e.title} (phase ${n})`;
  }
  return entries;
}

// --- TODO.md rendering (same content, human-style markdown) ----------------------
function renderTodo(entries) {
  const dep = (e) => (e.depends_on.length ? ` Depends on: ${e.depends_on.map((d) => `#${d}`).join(', ')}.` : '');
  const line = (e) =>
    `**${e.title}** (#${e.id}) — ${e.why} Plan: ${e.what}${dep(e)} Touches: ${e.touches.join(', ')}.${e.notes ? ` _(${e.notes})_` : ''}`;

  let md = `# TODO\n\nProject backlog. \`[x]\` done · \`[~]\` in progress · \`[ ]\` planned · deferred/dropped noted inline.\n`;
  const sections = [
    ['In progress', (e) => e.status === 'in_progress', '[~]'],
    ['Up next (planned)', (e) => e.status === 'planned', '[ ]'],
    ['Deferred (parked, waiting on an external trigger)', (e) => e.status === 'deferred', '[ ]'],
    ['Dropped', (e) => e.status === 'dropped', '[ ]'],
    ['Done', (e) => e.status === 'done', '[x]'],
  ];
  for (const [title, filter, box] of sections) {
    const rows = entries.filter(filter);
    if (!rows.length) continue;
    md += `\n## ${title}\n\n`;
    for (const e of rows) {
      md += `- ${box} ${line(e)}${e.commits.length ? ` Commit: ${e.commits.join(', ')}.` : ''}\n`;
    }
  }
  return md;
}

// --- main -----------------------------------------------------------------------
for (const size of SIZES) {
  const rand = mulberry32(1000 + size);
  const entries = generate(size, rand);
  const dir = path.join(OUT, String(size));
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(
    path.join(dir, 'ROADMAP.jsonl'),
    entries.map((e) => JSON.stringify(e)).join('\n') + '\n'
  );
  fs.writeFileSync(path.join(dir, 'TODO.md'), renderTodo(entries));
  const counts = {};
  for (const e of entries) counts[e.status] = (counts[e.status] || 0) + 1;
  console.log(`wrote picks/fixtures/${size}: ${entries.length} entries  ${JSON.stringify(counts)}`);
}
console.log('gen OK');
