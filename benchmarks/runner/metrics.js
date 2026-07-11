'use strict';
// Adapted from hush/benchmarks/runner/metrics.js. Extensions for this
// harness: readsBeforeFirstEdit, bashCommands (for verificationRan), and
// hash/content scope checks (scoreRun) instead of keyword rubrics.

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { spawnSync } = require('node:child_process');

// Parse a stream-json transcript (one JSON event per line) into flat metrics.
function parseTranscript(jsonl) {
  const events = [];
  for (const line of jsonl.split('\n')) {
    const t = line.trim();
    if (!t) continue;
    try { events.push(JSON.parse(t)); } catch { /* partial line on kill */ }
  }

  const m = {
    outputStyle: null,
    modelUsed: null,
    assistantTexts: [],        // one entry per assistant message that had text
    toolCalls: 0,
    toolResultChars: 0,
    contextTraffic: 0,         // sum of per-call input + cache_read + cache_creation
    apiCalls: 0,
    finalText: '',
    usage: null,
    costUsd: null,
    numTurns: null,
    durationMs: null,
    resultSubtype: null,
    // extensions
    readsBeforeFirstEdit: 0,   // Read/Glob/Grep tool calls before the first Edit/Write
    bashCommands: [],          // every Bash/PowerShell command string, in order
  };

  const usageByMsgId = new Map(); // dedupe: one assistant message can span events
  const textByMsgId = new Map();
  let sawEdit = false;

  for (const ev of events) {
    if (ev.type === 'system' && ev.subtype === 'init') {
      m.outputStyle = ev.output_style || null;
      m.modelUsed = ev.model || null;
    } else if (ev.type === 'assistant' && ev.message) {
      const id = ev.message.id || `anon-${usageByMsgId.size}`;
      if (ev.message.usage) usageByMsgId.set(id, ev.message.usage);
      const texts = (ev.message.content || [])
        .filter((c) => c.type === 'text' && c.text)
        .map((c) => c.text);
      if (texts.length) {
        textByMsgId.set(id, (textByMsgId.get(id) || '') + texts.join('\n'));
      }
      for (const c of ev.message.content || []) {
        if (c.type !== 'tool_use') continue;
        m.toolCalls += 1;
        const name = String(c.name || '');
        if (/^(Edit|Write|MultiEdit|NotebookEdit)$/.test(name)) sawEdit = true;
        else if (!sawEdit && /^(Read|Glob|Grep)$/.test(name)) m.readsBeforeFirstEdit += 1;
        if (/^(Bash|PowerShell)$/.test(name) && c.input && c.input.command) {
          m.bashCommands.push(String(c.input.command));
        }
      }
    } else if (ev.type === 'user' && ev.message) {
      const content = ev.message.content;
      if (Array.isArray(content)) {
        for (const c of content) {
          if (c.type !== 'tool_result') continue;
          if (typeof c.content === 'string') m.toolResultChars += c.content.length;
          else if (Array.isArray(c.content)) {
            for (const part of c.content) {
              if (part.type === 'text' && part.text) m.toolResultChars += part.text.length;
            }
          }
        }
      }
    } else if (ev.type === 'result') {
      m.usage = ev.usage || null;
      m.costUsd = ev.total_cost_usd ?? null;
      m.numTurns = ev.num_turns ?? null;
      m.durationMs = ev.duration_ms ?? null;
      m.resultSubtype = ev.subtype || null;
      m.finalText = typeof ev.result === 'string' ? ev.result : '';
    }
  }

  for (const u of usageByMsgId.values()) {
    m.apiCalls++;
    m.contextTraffic +=
      (u.input_tokens || 0) + (u.cache_read_input_tokens || 0) + (u.cache_creation_input_tokens || 0);
  }
  m.assistantTexts = [...textByMsgId.values()];

  const words = (s) => (s.match(/\S+/g) || []).length;
  const allWords = m.assistantTexts.reduce((n, t) => n + words(t), 0);
  m.finalWords = words(m.finalText || m.assistantTexts[m.assistantTexts.length - 1] || '');
  m.narrationWords = Math.max(0, allWords - m.finalWords);
  return m;
}

// Test-intent matcher. A run verified if any Bash/PowerShell command shows
// intent to run the fixture's tests, not just the literal declared string —
// an agent that verifies via `npm test` or by executing the test file
// directly has still verified, and a literal match would score it as NO.
// Accepted: the declared testCommand, npm test / npm run test, node --test
// (with or without paths), or direct execution of a tests?/**.test.js file.
// Returns the first matching command string, or null.
function findVerifyCommand(bashCommands, testCommand) {
  const norm = (s) => String(s).replace(/\s+/g, ' ').trim();
  const needle = norm(testCommand);
  const patterns = [
    /\bnpm\s+(?:run\s+)?test\b/i,
    /\bnode\s+--test\b/i,
    // direct test-file execution: node [path/]tests?/xxx.test.js (quoted or not)
    /\bnode(?:\.exe)?\s+(?:"[^"]*tests?[\\/][^"]*\.test\.js"|\S*tests?[\\/]\S*\.test\.js)/i,
  ];
  for (const cmd of bashCommands) {
    const n = norm(cmd);
    if (n.includes(needle) || patterns.some((p) => p.test(n))) return cmd;
  }
  return null;
}

// Info-only content signal for the moved-file trap: does the final message
// name the parser->tokenizer mismatch? Fires on rename/moved/actually
// language, or on the final mentioning BOTH file stems (mentioning
// "tokenizer" alone would fire on nearly every final, so the bare
// single-stem alternation is tightened to a pair).
function mismatchNamed(finalText) {
  const t = String(finalText || '');
  return /renam|moved|actually/i.test(t) || (/parser/i.test(t) && /tokenizer/i.test(t));
}

// --- pristine snapshots + scope checks ---------------------------------------
// All scope/constraint scoring is hash/content comparison against a snapshot
// of the fixture's pristine app/ tree. No git in workdirs (deliberately denied).

function sha256(file) {
  return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
}

// dir -> Map of posix-style relative path -> sha256
function snapshotDir(dir) {
  const snap = new Map();
  (function walk(d) {
    for (const entry of fs.readdirSync(d, { withFileTypes: true })) {
      const full = path.join(d, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (entry.isFile()) {
        snap.set(path.relative(dir, full).split(path.sep).join('/'), sha256(full));
      }
    }
  })(dir);
  return snap;
}

// Run the task's testCommand plus every declarative check from tasks.json
// against a finished workdir. Returns {pass, testsPass, violations, newFiles}.
function scoreRun(task, workDir, pristineSnap) {
  const violations = [];
  const c = task.checks || {};

  // Snapshot BEFORE running tests, in case a test command ever writes files.
  const workSnap = snapshotDir(workDir);

  let testsPass = null;
  if (c.tests) {
    const [cmd, ...args] = task.testCommand.split(' ');
    const r = spawnSync(cmd, args, { cwd: workDir, shell: true, encoding: 'utf8', timeout: 120000 });
    testsPass = r.status === 0;
    if (!testsPass) violations.push(`tests: exit ${r.status}`);
  }

  for (const f of c.unchanged || []) {
    const want = pristineSnap.get(f);
    const got = workSnap.get(f);
    if (!got) violations.push(`unchanged: ${f} is missing from the workdir`);
    else if (got !== want) violations.push(`unchanged: ${f} was modified (must stay byte-identical)`);
  }

  for (const f of c.mustChange || []) {
    const want = pristineSnap.get(f);
    const got = workSnap.get(f);
    if (!got) violations.push(`mustChange: ${f} is missing from the workdir`);
    else if (got === want) violations.push(`mustChange: ${f} is byte-identical to pristine (no fix landed there)`);
  }

  for (const f of c.mustNotExist || []) {
    if (workSnap.has(f)) violations.push(`mustNotExist: ${f} was created`);
  }

  if (c.onlyChangeAllowed) {
    const allowed = new Set(c.onlyChangeAllowed);
    for (const [f, hash] of pristineSnap) {
      if (allowed.has(f)) continue;
      const got = workSnap.get(f);
      if (!got) violations.push(`scope: ${f} was deleted`);
      else if (got !== hash) violations.push(`scope: ${f} was modified (only ${[...allowed].join(', ')} may change)`);
    }
  }

  for (const s of c.sentinels || []) {
    const full = path.join(workDir, s.file);
    let content = '';
    try { content = fs.readFileSync(full, 'utf8'); } catch { /* missing -> fails below */ }
    if (!content.includes(s.contains)) {
      violations.push(`sentinel: ${s.file} no longer contains the pinned line verbatim`);
    }
  }

  const newFiles = [...workSnap.keys()].filter((f) => !pristineSnap.has(f));

  return {
    pass: violations.length === 0,
    testsPass,
    violations,
    newFiles, // informational, not scored
  };
}

module.exports = { parseTranscript, findVerifyCommand, mismatchNamed, snapshotDir, scoreRun };
