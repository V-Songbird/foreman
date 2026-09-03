#!/usr/bin/env node
"use strict";

// Craft-time assembler: everything mechanical between "a roadmap entry (or
// entry-less judgment)" and "a gate-checked handoff prompt", in one call.
// Sibling to render-sections.js / resolve-symbols.js / check-prompt.js — it
// runs all three in-process (never as a child process) and adds nothing
// those three don't already know: it loads the entry, runs render-sections
// and resolve-symbols, computes the handoff profile from the five mechanical
// signals prompt-template.md defines, assembles the XML from the same
// canonical blocks check-prompt.js validates against, bakes the entry
// paragraph and the checkpoint/split delivery artifacts, and runs
// check-prompt.js's gate in-process as the last step.
//
// Both crafting flows route here now (wave2-design-2026-07-28.md, entries
// 3-4 of 6): skills/roadmap/pick.md calls it with an `entry` id, and
// skills/craft-prompt/SKILL.md calls it entry-less, with the same
// title/why/what/judgment fields given inline on stdin instead.
//
// stdin JSON in, one JSON line out: {ok, prompt, profile, signals, tasks?,
// gate, warnings} — same house style as every sibling script.
// `workflowStage: true` drops <tone>, replaces <output_format> with the
// fixed enforcement sentence, and is passed through to check-prompt.js's
// gate as --workflow-stage would be on the CLI (entry 204).

const fs = require("fs");
const path = require("path");
const { render, projectDir, readConfig } = require("./render-sections.js");
const { resolve: resolveSymbols, candidateIdentifiers } = require("./resolve-symbols.js");
const { readEntries, cmdList, touchesOverlap, today, anchorIdsIn } = require("./roadmap.js");
const { anchorShaFor, changedSince } = require("./commit-evidence.js");
const ledger = require("./ledger");
const { readLedger } = require("./ledger-config");
const noteStaleness = require("./note-staleness.js");
const { recordFirstPick } = require("./trial-log.js");
const {
  checkPrompt,
  readCanonical,
  norm,
  CONCISE_TRUTH_SENTENCE,
  CLOSURE_EVIDENCE_SENTENCE,
  NO_INVENTION_SENTENCE,
  FIX_CEILING_SENTENCE,
  WORKFLOW_STAGE_SENTENCE,
} = require("./check-prompt.js");

const DESTINATIONS = new Set(["task", "agent", "clipboard"]);
const PLUGIN_ROOT = "${CLAUDE_PLUGIN_ROOT}"; // literal, never expanded — [Foreman: 107]
const AUTONOMY_MARKER = "You are operating autonomously.";

// ---- template-derived defaults, read out of prompt-template.md's own XML
// fence at run time (readCanonical's `xml`) so there is still exactly one
// copy of every guardrail/default text. Never hardcode these bodies.

function fullLineContaining(xml, needle) {
  const line = xml.split("\n").find((l) => l.includes(needle));
  if (!line) throw new Error(`prompt-template.md is missing an expected line containing: ${needle}`);
  return line.trim();
}

// Strips `[...]` instructional spans — iterated so a span containing its own
// inner `[...]` (e.g. relevant_files' "files[].symbols" mention) still fully
// clears, innermost pairs first — what's left is the block's literal
// default text.
function stripBracketed(text) {
  let out = String(text);
  let prev;
  do {
    prev = out;
    out = out.replace(/\[[^[\]]*\]/g, "");
  } while (out !== prev);
  return out;
}

// The template's own prose repeatedly *mentions* a tag name in backticks
// before the real tag shows up ("...the `<output_format>` block below..."
// inside the tone instruction) — a
// naive first-`<tag>`-to-next-`</tag>` regex (check-prompt.js's
// extractBlock, built for scanning an *assembled prompt*, never the
// template's own instructional prose) locks onto that inline mention and
// swallows everything up to the real closing tag. Real template tags are
// always alone on their own line, so anchor on that instead.
function extractTemplateBlock(xml, tag) {
  const re = new RegExp(`^<${tag}>\\n([\\s\\S]*?)^<\\/${tag}>$`, "m");
  const m = xml.match(re);
  return m ? m[1] : null;
}

function templateDefaults() {
  const canonical = readCanonical();
  const xml = canonical.xml;
  const toneInner = extractTemplateBlock(xml, "tone") || "";
  const toneQuote = toneInner.match(/"([\s\S]*)"/);
  const defaultTone = toneQuote
    ? norm(toneQuote[1])
    : "Minimal, professional conversation — silent by default, say only what the user actually needs to know.";
  const outputFormatInner = extractTemplateBlock(xml, "output_format") || "";
  const defaultOutputFormat = norm(stripBracketed(outputFormatInner));
  const noInventionLine = fullLineContaining(xml, NO_INVENTION_SENTENCE);
  const fixCeilingLine = fullLineContaining(xml, FIX_CEILING_SENTENCE);
  const autonomyAt = xml.indexOf(AUTONOMY_MARKER);
  const autonomyEnd = autonomyAt === -1 ? -1 : xml.indexOf("]", autonomyAt);
  const autonomyParagraph =
    autonomyAt === -1 || autonomyEnd === -1 ? null : norm(xml.slice(autonomyAt, autonomyEnd));
  return {
    canonical,
    defaultTone,
    defaultOutputFormat,
    noInventionLine,
    fixCeilingLine,
    autonomyParagraph,
  };
}

// ---- local-date helpers — never toISOString() date math

function parseLocalDate(dateStr) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(dateStr || ""));
  return m ? new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3])) : null;
}

function daysSince(dateStr) {
  const then = parseLocalDate(dateStr);
  if (!then) return null;
  const now = parseLocalDate(today());
  return Math.round((now - then) / 86400000);
}

// ---- loading the record: an entry from ROADMAP.jsonl, or the entry-less
// fields given directly on stdin (craft-prompt's future mode).

function loadRecord(root, input) {
  if (input.entry) {
    const { entries } = cmdList(root, { ids: String(input.entry) });
    if (entries.length !== 1) {
      throw new Error(`entry "${input.entry}" not found in ROADMAP.jsonl`);
    }
    return { ...entries[0] };
  }
  return {
    id: null,
    title: input.title || "",
    why: input.why || "",
    what: input.what || "",
    notes: input.notes || "",
    planned_touches: input.planned_touches || input.touches || [],
    depends_on: input.depends_on || [],
    kind: input.kind,
    updated_at: input.updated_at,
    commits: input.commits || [],
    observed_touches: input.observed_touches || [],
    depends_on_docs: input.depends_on_docs || [],
  };
}

// ---- the five mechanical signals, prompt-template.md's "Handoff profiles"
// section, verbatim. Never a judgment call — every input here is a fact
// already in hand.

function computeSignals(root, record, input, symbolFiles, hasVerification) {
  const resumed = Boolean(input.resume) || (record.commits || []).length > 0 || (record.observed_touches || []).length > 0;

  // Conflicting — recomputed here, never trusted from the caller: any
  // OTHER in_progress entry's planned_touches, folder-aware, same rule
  // next-candidates uses. [Foreman: 125]
  const entries = readEntries(root);
  const inProgressTouches = [];
  for (const e of entries) {
    if (e.status !== "in_progress") continue;
    if (record.id && e.id === record.id) continue;
    for (const t of e.planned_touches || []) inProgressTouches.push(t);
  }
  const conflicting = (record.planned_touches || []).some((t) =>
    inProgressTouches.some((busy) => touchesOverlap(t, busy))
  );

  const ageDays = record.updated_at ? daysSince(record.updated_at) : null;
  const staleByAge = ageDays !== null && ageDays > 30;
  const staleByDrift = (symbolFiles || []).some(
    (f) => f.lastChanged && record.updated_at && f.lastChanged > record.updated_at
  );
  const stale = staleByAge || staleByDrift;

  const highlyConstrained = (record.depends_on || []).length >= 3 || (record.notes || "").length > 1000;

  const risky = record.kind === "decision" || !hasVerification;

  return { resumed, conflicting, stale, highlyConstrained, risky };
}

// ---- <relevant_files> — resolve-symbols.js's output, cited by symbol
// name, never a line range; missing/outside/unresolved paths ride along as
// stated discrepancies, exactly as skills/roadmap/SKILL.md's step 3 does.

// [Foreman: 259] Every other block this file assembles has a ceiling —
// RECALL_MAX_CHARS, NOTES_KEEP, ANCHOR_KEEP — and the symbol list had none.
// A single-file module resolves to hundreds of top-level names, and the ten
// the task actually touches drown in them. So the names the entry's own prose
// asks for lead, the rest follow in file order, and the tail is cut with its
// count stated rather than silently dropped.
const SYMBOL_KEEP = 12;

// Symbol names the entry's own title/what already names. Two signals, and
// both are needed: candidateIdentifiers covers the call-shaped and
// camelCase/snake_case tokens resolve-symbols.js uses to spot an invented
// API, and backticks cover the rest — a symbol named `grade` or `scan` has
// no shape to it, and prose is where an entry names those. Nothing matches
// on an entry with no prose, which is the honest answer: no signal, so file
// order decides.
const BACKTICKED_NAME = /`([A-Za-z_$][\w$]*)`/g;

function promptedNames(record) {
  if (!record) return new Set();
  const prose = `${record.title || ""} ${record.what || ""}`;
  const names = new Set(candidateIdentifiers(prose));
  BACKTICKED_NAME.lastIndex = 0;
  let match;
  while ((match = BACKTICKED_NAME.exec(prose)) !== null) names.add(match[1]);
  return names;
}

// The symbols worth printing for one file: prompted names first (file order
// among themselves), then the rest, capped. Returns the kept list plus how
// many were left out, so the caller can say so.
function rankSymbols(symbols, prompted) {
  const wanted = symbols.filter((s) => prompted.has(s.name));
  const rest = symbols.filter((s) => !prompted.has(s.name));
  const kept = [...wanted, ...rest].slice(0, SYMBOL_KEEP);
  return { kept, dropped: symbols.length - kept.length };
}

function relevantFilesText(files, references, unresolved, record) {
  const prompted = promptedNames(record);
  const lines = [];
  for (const f of files || []) {
    if (f.missing) {
      lines.push(`${f.path} — MISSING: nothing at this path yet. Either this task creates the file, or the plan is stale and needs fixing.`);
    } else if (f.outside_project) {
      lines.push(`${f.path} — OUTSIDE PROJECT: resolves outside the project root, not read`);
    } else if (f.directory || f.unsupported || f.unreadable) {
      lines.push(f.path);
    } else if (f.symbols && f.symbols.length) {
      const { kept, dropped } = rankSymbols(f.symbols, prompted);
      const named = kept.map((s) => `${s.name} (${s.line})`).join(", ");
      const tail = dropped > 0 ? `, and ${dropped} more top-level definitions — read the file` : "";
      lines.push(`${f.path} — ${named}${tail}`);
    } else {
      lines.push(f.path);
    }
  }
  // [Foreman: 275] One line per reference meant one line per SYMBOL, so a
  // handful of symbols living in one file printed that file over and over —
  // a live prompt carried 11 Pattern lines naming 5 files. The pattern being
  // pointed at is the file, so the file is what dedups.
  const patterned = new Set();
  for (const ref of references || []) {
    if (ref.files && ref.files.length && !patterned.has(ref.files[0])) {
      patterned.add(ref.files[0]);
      lines.push(`Pattern: ${ref.files[0]} — build the new code the same way`);
    }
  }
  if (unresolved && unresolved.length) {
    lines.push(`Unresolved in the entry's own description (not found in any touched file): ${unresolved.join(", ")} — an invented API or an un-caught rename, resolve before trusting it.`);
  }
  return lines.join("\n");
}

// ---- prior-work recall — when a planned path is one only a handful of
// finished entries ever reached, name those entries and what each recorded.
// Deliberately NOT a computeSignals key: that object's every value feeds
// `Object.values(signals).some(Boolean)`, so adding one here would silently
// promote every recalling handoff to the reinforced profile.

// Only closed work counts as prior work, and only work that recorded where
// it actually went. `awaiting_acceptance` is included: it is finished, it
// carries a real diff, and the user's yes is all that separates it.
const RECALL_STATUSES = new Set(["done", "awaiting_acceptance"]);

// A path so common that everything overlaps it teaches nothing, and a path
// nothing has touched has no prior work to recall. Both drop out.
const RECALL_MAX_REACH = 0.2;
const RECALL_KEEP = 3;
const RECALL_EXCERPT = 240;
// The excerpt was capped from the start; the title was not, and a real
// roadmap's titles run past 60 characters often enough to push the whole
// block over the ceiling this feature is held to. Same 60
// buildTaskRows already cuts a task subject at, for the same reason.
const RECALL_TITLE = 60;
// Belt and braces: tag + header + RECALL_KEEP × (id + title + excerpt +
// framing) lands under this for any id length worth having, but the
// ceiling is the contract, so it is enforced rather than argued. It sizes
// to the tagged block: cutting it below the frame would make RECALL_KEEP
// unreachable at full excerpt length and silently drop a third lead.
// Raised once from 1100 when the freshness stamps landed — three leads plus
// three stamps do not fit under the old ceiling, and the third would have
// evicted silently.
const RECALL_MAX_CHARS = 1200;

// Lines the scripts write into `notes` themselves. Each one is bookkeeping
// about the entry, never a finding from the work, so none of them is worth
// carrying into a handoff.
// `lesson recorded:` and `lesson not recorded` are load-bearing here, not
// housekeeping: the second one carries the user's own lesson prose verbatim
// when the store refused it, and quoting that back as a recall excerpt would
// serve an unstored, unstaleness-checked claim through the one channel this
// feature exists to keep honest.
const MACHINE_NOTE_RE =
  /^(scope drift —|correction applied:|id reassigned from |dispatched to background agent|survey \(unconfirmed\):|deferred:|orchestrator:|lesson recorded:|lesson not recorded|unverified:)/;

// The longest line of `notes` that a human (or a closing session) actually
// wrote: date stamp stripped, machine lines dropped, capped.
function recallExcerpt(notes) {
  const lines = String(notes || "")
    .split("\n")
    .map((line) => line.replace(/^\d{4}-\d{2}-\d{2}\s+/, "").trim())
    .filter((line) => line && !MACHINE_NOTE_RE.test(line));
  if (!lines.length) return null;
  const longest = lines.reduce((a, b) => (b.length > a.length ? b : a));
  return longest.length > RECALL_EXCERPT ? `${longest.slice(0, RECALL_EXCERPT - 1)}…` : longest;
}

// A recalled lead with no freshness signal is the measured harm this stamp
// exists to fix: a hard-repeated stale path anchors the destination on the
// decoy. Three-valued and never optimistic — every way of failing to date a
// lead lands on "unknown", so "unchanged since" is only ever said when git
// actually said it.
function recallStamp(root, entry) {
  if (!root) return "";
  const sha = anchorShaFor(root, entry);
  if (!sha) return " [freshness unknown]";
  const { state, changed, checked } = changedSince(root, sha, entry.observed_touches || []);
  const short = String(sha).slice(0, 7);
  if (state === "fresh") return ` [at ${short} — its files unchanged since]`;
  if (state === "stale") {
    return ` [at ${short} — possibly stale: ${changed.length} of its ${checked} files changed since]`;
  }
  return " [freshness unknown]";
}

// `root` is what makes the freshness stamps possible; without it the block is
// selection only, since nothing can date a lead with no repository to ask.
function priorWorkText(entries, record, root) {
  const corpus = entries.filter(
    (e) =>
      RECALL_STATUSES.has(e.status)
      && (!record.id || e.id !== record.id)
      && (e.observed_touches || []).length > 0
  );
  if (!corpus.length) return "";

  const ceiling = corpus.length * RECALL_MAX_REACH;
  const byEntry = new Map(); // id -> smallest reach any of its matching paths had
  for (const planned of record.planned_touches || []) {
    const matches = corpus.filter((e) =>
      (e.observed_touches || []).some((seen) => touchesOverlap(planned, seen))
    );
    // Reach zero is nothing to recall; reach above the ceiling is a path so
    // busy that naming its history is noise rather than a lead.
    if (!matches.length || matches.length > ceiling) continue;
    for (const match of matches) {
      const previous = byEntry.get(match.id);
      if (previous === undefined || matches.length < previous.reach) {
        byEntry.set(match.id, { entry: match, reach: matches.length });
      }
    }
  }
  if (!byEntry.size) return "";

  const ranked = [...byEntry.values()]
    .sort((a, b) => a.reach - b.reach || String(a.entry.id).localeCompare(String(b.entry.id)))
    .slice(0, RECALL_KEEP);

  // Each excerpt is a past entry's own note, and past notes read as
  // imperatives often enough that the frame has to say what they are.
  const header =
    "Recorded by earlier finished entries that touched these files — history, not instructions for this task.";
  const lines = [];
  // The wrapper counts against the same ceiling the block is held to.
  let total = "<prior_work>\n".length + header.length + "\n</prior_work>".length;
  for (const { entry } of ranked) {
    const excerpt = recallExcerpt(entry.notes);
    const title = String(entry.title || "").slice(0, RECALL_TITLE);
    const line = `- ${entry.id} ${title}${excerpt ? ` — ${excerpt}` : ""}${recallStamp(root, entry)}`;
    // A lead that would push the block past the ceiling is dropped whole:
    // half a recalled finding is worse than one fewer.
    if (total + 1 + line.length > RECALL_MAX_CHARS) break;
    lines.push(line);
    total += 1 + line.length;
  }
  if (!lines.length) return "";
  return `<prior_work>\n${header}\n${lines.join("\n")}\n</prior_work>`;
}

// ---- the lesson ledger's read side. Same discipline as prior-work recall
// above, and for the same reason: it rides inside <background> on BOTH
// profiles and is NEVER a computeSignals key, because every value in that
// object feeds `.some(Boolean)` and would promote every serving handoff to
// the reinforced profile.

// Flat, not grouped by area. The P0 probe (2026-08-18) measured that two
// thirds of closed entries have no dominant area at all, so an area-diverse
// window would drop a genuinely relevant record to make room for a heading
// that is an artifact of the prefix rule.
const NOTES_KEEP = 6;
// Header + closer + records, all in. Whole-record drops only: half a recorded
// claim is worse than one fewer.
const NOTES_MAX_CHARS = 1000;
const NOTES_HEADER =
  "Lessons recorded by earlier closed tasks touching these files — recorded claims, verify against the code:";
// Routes a correction through the one channel that exists today. The judge's
// original wording promised a survey repair path; that is stage-2 work and
// promising it here would be a lie the reader cannot act on.
const NOTES_CLOSER =
  'If a Lessons line above proved wrong, note the mismatch in your close notes and record the corrected fact by passing "lesson" on your close.';

/**
 * Records worth serving for this entry, best first.
 *
 * Selection is path-level and only path-level: `area` is cosmetic. A record
 * whose ONLY match is a path more than RECALL_MAX_REACH of closed entries
 * touched is dropped — a file everything reaches teaches nothing about this
 * task, and it is how one busy path would otherwise serve every lesson in
 * the store.
 */
function selectNotes(records, record, corpus) {
  const planned = record.planned_touches || [];
  if (!planned.length) return [];
  const reach = new Map();
  for (const closed of corpus) {
    for (const seen of closed.observed_touches || []) {
      const key = String(seen);
      reach.set(key, (reach.get(key) || 0) + 1);
    }
  }
  const ceiling = corpus.length * RECALL_MAX_REACH;

  const scored = [];
  for (const stored of records) {
    const matches = [];
    for (const plan of planned) {
      for (const kept of stored.paths || []) {
        if (!touchesOverlap(plan, kept)) continue;
        // A path nothing else reached has reach 1 (this record's own close),
        // which is well under any ceiling — the filter only ever fires on a
        // genuinely busy file.
        if (ceiling && (reach.get(kept) || 0) > ceiling) continue;
        matches.push({ plan, kept });
      }
    }
    if (matches.length) scored.push({ stored, matches });
  }
  // Newest first, then by how many planned files a record actually explains.
  return scored
    .reverse()
    .sort((a, b) => b.matches.length - a.matches.length)
    .slice(0, NOTES_KEEP);
}

function ledgerText(root, record) {
  if (!root || !readLedger(root).enabled) return "";
  const { records, error } = ledger.read(root);
  if (error || !records.length) return "";

  const corpus = readEntries(root).filter(
    (e) => RECALL_STATUSES.has(e.status) && (e.observed_touches || []).length > 0
  );
  const selected = selectNotes(records, record, corpus);
  if (!selected.length) return "";

  const budget = noteStaleness.newBudget();
  const lines = [];
  let total = NOTES_HEADER.length + 1 + NOTES_CLOSER.length;
  for (const { stored, matches } of selected) {
    const verdict = noteStaleness.resolve(root, stored, budget);
    // Dead: every file it names is gone, so there is nothing left to check it
    // against. Serving it could only mislead.
    if (verdict.state === "dead") continue;
    // The graded rule: a possibly-stale record whose own prose names one of
    // the files that moved under it is the decoy case, not a hedge case.
    if (verdict.state === "stale" && verdict.changed.some((f) => stored.lesson.includes(f))) continue;
    const { plan, kept } = matches[0];
    const body = verdict.state === "unknown" ? stored.paths.join(", ") : stored.lesson;
    const line = `- ${body} ${verdict.label} (matched: planned ${plan} ↔ recorded ${kept})`;
    if (total + 1 + line.length > NOTES_MAX_CHARS) break;
    lines.push(line);
    total += 1 + line.length;
  }
  if (!lines.length) return "";
  return `${NOTES_HEADER}\n${lines.join("\n")}\n${NOTES_CLOSER}`;
}

// ---- anchors as live references -------------------------------------------
//
// `[Foreman: <id>]` comments mark code an earlier entry already governed. The
// read-back hook has always surfaced them the moment someone opens the file;
// this serves the same fact one step earlier, at dispatch, so the destination
// starts out knowing what governs this code instead of finding out mid-edit.
//
// Deliberately not a second lessons channel: what an earlier task LEARNED
// about these paths already rides in the block above, matched path-level. This
// answers the different question — which entry settled this code, and where
// that settlement is written down.
// Both bounds are on what is SERVED, never on what is collected. An earlier
// cap counted collected ids between files, which bounded nothing a reader
// sees: one file carrying fourteen anchors contributed all fourteen, and a
// file full of stray brackets could spend the budget on lines that are then
// dropped as unresolvable. Measured before the fix, at 2.0.0: a third to a
// half of served blocks were over ANCHOR_KEEP, the worst running to 23 lines
// and 3,342 characters.
const ANCHOR_MAX_FILES = 12;
const ANCHOR_KEEP = 6;
// Header + lines, all in, and whole lines only — the same ceiling and the
// same whole-or-absent rule the lessons block above it already follows.
const ANCHOR_MAX_CHARS = 1000;
const ANCHOR_MAX_BYTES = 512 * 1024;
const ANCHOR_HEADER =
  "Anchored in the files this task plans to touch — earlier entries that already govern this code:";

// Reads at most the first ANCHOR_MAX_BYTES of `filePath`. null on anything
// that isn't a readable regular file, which the caller skips: a planned path
// that does not exist yet is the normal case, not an error.
function readCappedFile(filePath) {
  let fd;
  try {
    fd = fs.openSync(filePath, "r");
  } catch {
    return null;
  }
  try {
    const buf = Buffer.alloc(ANCHOR_MAX_BYTES);
    const bytesRead = fs.readSync(fd, buf, 0, ANCHOR_MAX_BYTES, 0);
    return buf.toString("utf-8", 0, bytesRead);
  } catch {
    return null; // e.g. EISDIR
  } finally {
    try {
      fs.closeSync(fd);
    } catch {
      // ignore
    }
  }
}

/**
 * The anchored entries this task will read past, newest file order first.
 *
 * Costs one capped read per planned file and nothing else. An id with neither
 * a roadmap entry nor a document behind it is stray bracket text and is
 * dropped, the same rule the read-back hook applies.
 */
function anchorsText(root, record, dir) {
  const planned = (record.planned_touches || []).slice(0, ANCHOR_MAX_FILES);
  if (!planned.length) return "";

  const found = new Map(); // anchor id -> the first planned file carrying it
  for (const rel of planned) {
    const content = readCappedFile(path.resolve(root, rel));
    if (content === null) continue;
    for (const id of anchorIdsIn(content)) {
      if (id !== record.id && !found.has(id)) found.set(id, rel);
    }
  }
  if (!found.size) return "";

  const titles = new Map(readEntries(root).map((e) => [e.id, e.title]));
  const lines = [];
  let total = ANCHOR_HEADER.length;
  for (const [id, rel] of found) {
    if (lines.length >= ANCHOR_KEEP) break;
    const docRel = `${String(dir).split(/[\\/]+/).filter(Boolean).join("/")}/${id}.md`;
    const hasDoc = fs.existsSync(path.resolve(root, docRel));
    const title = titles.get(id);
    if (!title && !hasDoc) continue; // stray bracket text, never surfaced
    const named = title ? ` — ${title}` : "";
    const doc = hasDoc ? ` → read ${docRel} first` : "";
    const line = `- ${rel} carries [Foreman: ${id}]${named}${doc}`;
    if (total + 1 + line.length > ANCHOR_MAX_CHARS) break;
    lines.push(line);
    total += 1 + line.length;
  }
  if (!lines.length) return "";
  return `${ANCHOR_HEADER}\n${lines.join("\n")}`;
}

/**
 * True when a closed entry already touched files this one plans to, so the
 * first-relevant-moment question about the ledger is worth putting. Only the
 * fact, never the ask: pick.md owns the question, this owns the trigger.
 */
function notesOverlapExists(root, record) {
  const planned = record.planned_touches || [];
  if (!planned.length) return false;
  return readEntries(root).some(
    (e) =>
      RECALL_STATUSES.has(e.status)
      && e.id !== record.id
      && (e.observed_touches || []).some((seen) => planned.some((plan) => touchesOverlap(plan, seen)))
  );
}

function contextText(judgmentContext, dependsOnDocs) {
  let text = judgmentContext || "";
  if (dependsOnDocs && dependsOnDocs.length) {
    text += `${text ? "\n" : ""}Decision docs to read first, so a settled question isn't re-decided: ${dependsOnDocs.join(", ")}`;
  }
  return text;
}

// ---- <task_context>

function taskContextText(usePersona, judgment) {
  const role = judgment.role || "a senior engineer";
  const opener = usePersona ? `You are ${role}.` : `Domain: ${role}.`;
  let goal = String(judgment.goal || "complete the task").trim();
  if (!/[.!?]$/.test(goal)) goal += ".";
  const purpose = judgment.purpose ? `\n${judgment.purpose}` : "";
  return `<task_context>\n${opener}\nYour goal is ${goal}${purpose}\n</task_context>`;
}

// ---- <task_rules> — steps/constraints/verification are judgment; the
// decision-entry bullet, the fix-ceiling line, and the checkpoint embed are
// mechanical additions this script bakes on top.

function taskRulesText(record, judgment, hasVerification, fixCeilingLine, checkpointEmbed) {
  const lines = [];
  if (record.kind === "decision") {
    lines.push(
      "This is a decision, not a build: resolve the open question — state the choice and the reason it wins over the alternatives — and do not write implementation code for it. The deliverable is the decision."
    );
  }
  for (const step of judgment.steps || []) lines.push(`- ${step}`);
  let body = lines.join("\n");

  const constraintLines = (judgment.constraints || []).map((c) => `- ${c}`);
  if (judgment.expectedFileSurface) {
    constraintLines.push(
      `Expected file surface: ${judgment.expectedFileSurface}. Anything beyond this list gets flagged to the user before it is written, not after.`
    );
  }
  if (constraintLines.length) {
    body += `${body ? "\n\n" : ""}Constraints:\n${constraintLines.join("\n")}`;
  }

  if (hasVerification) {
    let verifyBlock = "Verification (REQUIRED):\n";
    if (judgment.testFirst) {
      verifyBlock +=
        "Write the invariant test first, confirm it passes against the unmodified code, deliberately break the invariant and confirm the test goes red, then implement.\n";
      // [Foreman: 4.1 measurement] The testFirst branch is the one place a
      // session authors the very check it is graded on, which is where a test
      // can quietly become the specification instead of verifying one. The
      // clause names that shortcut, and naming a failure has primed it here
      // before, so the switch exists before the default does: set
      // FOREMAN_TEST_GAMING_CLAUSE to 1 or true to emit it. Either way it
      // costs zero words on an ordinary handoff, because nothing outside this
      // branch ever sees it. Nothing in the product writes this variable.
      if (/^(1|true)$/i.test(process.env.FOREMAN_TEST_GAMING_CLAUSE || "")) {
        verifyBlock +=
          "The test verifies the rule; it does not define it. Write it to hold for every input the rule covers, not only the one named here.\n";
      }
    }
    for (const pair of judgment.verification) {
      verifyBlock += `Run: ${pair.run}\nExpected: ${pair.expected}\n`;
    }
    // [Foreman: 231] On both profiles — the ceiling bounds the retry loop these
    // pairs open, so it travels with them rather than with the profile.
    verifyBlock += fixCeilingLine;
    body += `${body ? "\n\n" : ""}${verifyBlock}`;
  } else if (judgment.question) {
    body += `${body ? "\n\n" : ""}Question: ${judgment.question}`;
  }

  if (checkpointEmbed) {
    body += `\n\n${checkpointEmbed}`;
  }

  return `<task_rules>\n${body}\n</task_rules>`;
}

// ---- checkpoints config (.foreman/config.json's `checkpoints` group) —
// same three keys, same defaults, as prompt-template.md's "Checkpointing a
// task-split run" section: branch true, onFinish "ask", baseBranch unset.
// No `push` key, and none should be added. [Foreman: 119]
const ON_FINISH_VALUES = new Set(["ask", "squash", "merge", "pr", "keep"]);

function checkpointsConfig(root) {
  const { config } = readConfig(root);
  const c = (config && config.checkpoints) || {};
  return {
    baseBranch: typeof c.baseBranch === "string" && c.baseBranch ? c.baseBranch : null,
    branch: c.branch !== false,
    onFinish: ON_FINISH_VALUES.has(c.onFinish) ? c.onFinish : "ask",
  };
}

// The clipboard checkpoint embed — resolved config values baked into a
// compact block appended to task_rules, per prompt-template.md's "Clipboard
// checkpoint embed" section. Only when the destination is clipboard and the
// prompt carries two or more Run:/Expected: pairs.
function checkpointEmbedText(cfg, checkCount, entryId) {
  const branchLine = cfg.baseBranch
    ? `the base branch is \`${cfg.baseBranch}\``
    : "detect the base branch with `git symbolic-ref --short refs/remotes/origin/HEAD` (name after `origin/`, fallback `main`)";
  const branchAction = cfg.branch
    ? "with branch creation on, create `foreman/<slug>` only when starting on the base branch, otherwise checkpoint in place"
    : "checkpoint in place (branch creation is off)";
  const onFinishLine =
    cfg.onFinish === "ask"
      ? "ask the user squash/merge/PR/keep the branch"
      : `apply \`${cfg.onFinish}\` directly, no question`;
  return [
    "Checkpoint protocol for this multi-task run (the pasted session cannot read prompt-template.md, so this rides in the prompt itself):",
    `- create one tracked task per Run:/Expected: pair (${checkCount} total) with \`TaskCreate\`, then chain every task from the second onward with one \`TaskUpdate\` \`addBlockedBy: ["<the previous task's id>"]\``,
    `- settle the branch first: ${branchLine}; ${branchAction}`,
    "- before task 1, stop if `git status --porcelain` is non-empty: say so once and make no checkpoint commits at all for this run",
    "- after each task's check passes, stage only the files that task changed (`git add -- <those paths>`, never `git add -A`) and commit `task <n>/<total>: <task subject>`; leave it local, never push",
    ...(entryId
      ? [
          "- the last task carries the roadmap close instead of a `task <n>/<total>` commit: stage with `safe-commit.js finish --no-commit`, close the entry with `staged:true`, then make that one commit with `Foreman: " + entryId + "` as its final line",
        ]
      : []),
    `- after the last task (only if this run created the branch): ${onFinishLine}`,
    "- skip checkpointing and just work the tasks if git is unavailable",
  ].join("\n");
}

// ---- the entry paragraph — id substitution, requireVerification
// acceptance hold, decision-doc close field,
// ${CLAUDE_PLUGIN_ROOT} as the literal string. This is the canonical copy
// now (skills/roadmap/pick.md calls this script instead of assembling the
// paragraph itself), collapsed to the one concrete variant that applies for
// this handoff rather than a human-facing skill's illustrative examples.

function entryParagraphText({ id, resume, requireVerification, askLesson, destination }) {
  const opening = resume
    ? `This task is ROADMAP.jsonl entry \`${id}\`, already marked \`in_progress\` by an earlier session — don't re-mark it; earlier findings may sit in its \`notes\` (included above), read them before re-deriving anything.`
    : `This task is ROADMAP.jsonl entry \`${id}\`. Mark it \`in_progress\` before doing anything else — Foreman's picking flow deliberately leaves it \`planned\` until you do:\n\`echo '{"id":"${id}","status":"in_progress"}' | node ${PLUGIN_ROOT}/scripts/roadmap.js update-status\``;

  const beginStep = `Then take the commit boundary before touching any file:\n\`node ${PLUGIN_ROOT}/scripts/safe-commit.js begin\`\nKeep its \`baseline.head\`. A \`dirty:true\` result means the tree already carries someone else's changes: tell the user in one line, then do the work and make NO commit at all — leave everything in the tree for them. Never stage around it.`;

  // [Foreman] A background agent has no one to ask, so it keeps the prose
  // hand-back; every other destination lands in a session with a user in it,
  // and that session puts the accept/review choice in front of them rather
  // than leaving it for the next pick to raise days later.
  const acceptCall = `\`echo '{"id":"${id}","status":"done"}' | node ${PLUGIN_ROOT}/scripts/roadmap.js update-status\``;
  const askSentence =
    destination === "agent"
      ? ` Say so in your final message too — name the entry and say it now needs the user's accept or decline before you start anything new.`
      : ` Then put the choice to them in the same turn, with AskUserQuestion. Wrote at least one \`unverified:\` line? The first option is Test — you read those lines back to them and stop, the entry still awaiting. With none, offer accept-the-entry and review-it-first only. Accepting closes it — ${acceptCall}. Review leaves it awaiting and you walk them through what changed. Start nothing new until they answer.`;
  // [Foreman] What makes the Test option mechanical rather than a mood: it
  // can only appear where a `unverified:` line was actually recorded, and a
  // check with a runnable command is never one — the session runs those
  // itself instead of handing the user its own homework. One `annotate` per
  // check, because one append is exactly one line (roadmap.js appendNote
  // folds embedded newlines).
  //
  // [Foreman] Two bars on top of "has no command", both from live misfires:
  // a check blocked on unbuilt work fired Test on an entry nobody could
  // test, and an Electron project sent its owner to the window session after
  // session until one of them wrote a skill that drives the app instead. A
  // note is for what the session cannot reach, not for what it did not try.
  const splitStep =
    requireVerification && destination !== "agent"
      ? `Before you close, split your checks in two. Anything with a command, you run — never hand a command to the user to run for you. Anything that can only be settled by a human's eyes or hands — how it renders, how it feels to use, whether the motion looks right — has no command, so record it on the entry, one call per check:\n\`echo '{"id":"${id}","notes":"unverified: <the check, and what to look for>"}' | node ${PLUGIN_ROOT}/scripts/roadmap.js annotate\`\nTwo bars before you write one of those lines. It has to be answerable today: a check that waits on work nobody has built yet goes in your findings, not here. And it has to be genuinely past your reach: where a skill, script or harness in this project already drives the thing, use it and answer the check yourself, and where none exists but one could, say that in your findings instead of sending the user to look by hand again.\nWrite none at all when every check ran — an empty list is the normal outcome and is what tells the user there is nothing to look at.`
      : "";

  const holdSentence = requireVerification
    ? ` When that earned status is \`done\`, write \`awaiting_acceptance\` instead — this project holds finished work for the user's acceptance, and their confirmation makes it \`done\`; \`dropped\` and \`rejected\` close as themselves.${askSentence}`
    : "";
  const closeIntro = `When the work concludes, close the entry the same way — the status it actually earned (\`done\`, \`dropped\`, \`rejected\`) and your full findings in \`notes\`.${holdSentence}`;

  const stageStep = `Stage the task's own files with the safe-commit primitive — never \`git add -A\`:\n\`echo '{"id":"${id}","expected":["<the files this task owns>"]}' | node ${PLUGIN_ROOT}/scripts/safe-commit.js finish --baseline <baseline.head> --no-commit\`\nThen close with \`staged:true\` (the script folds the staged files into \`observed_touches\` and stages ROADMAP.jsonl alongside), then commit once with \`Foreman: ${id}\` as the final line of the message.`;

  const fields = ['"status":"<status>"', '"staged":true', '"notes":"<findings>"'];
  const closeCall = `\`echo '{"id":"${id}",${fields.join(",")}}' | node ${PLUGIN_ROOT}/scripts/roadmap.js update-status\``;

  // [Foreman: 260] roadmap-schema.md:112-113 — model/effort are self-reported
  // at close, never guessed, and now always: Foreman stopped asking which model
  // should run a task, so nothing upstream knows the answer to bake in.
  const modelEffortNote = "Also add `model` and `effort` to that close call — what actually ran this task. Omit either one you genuinely don't know rather than guessing — an absent field reads as unrecorded, a wrong one silently poisons the corpus.";

  // Two sentences, single-purpose, emitted only where the ledger is on. A
  // skipped ask is silence, which is the designed outcome: forcing a lesson
  // manufactures platitudes, and the counter measures the real rate instead.
  const lessonAsk = askLesson
    ? 'If this task taught you one durable fact about this code area that a future task would need, add `"lesson":"one sentence, naming the file or symbol it concerns"` to that close call. If nothing generalizes beyond this task, omit it — that is a valid outcome.'
    : "";

  return [opening, beginStep, splitStep, closeIntro, stageStep, closeCall, modelEffortNote, lessonAsk]
    .filter(Boolean)
    .join("\n");
}

function slugify(text, maxLen = 40) {
  const slug = String(text || "task")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, maxLen);
  return slug || "task";
}

// ---- the task split — one row per Run:/Expected: pair, the full prompt on
// row 1, the entry paragraph on the last row only. [load-bearing placement]

function buildTaskRows(verification, basePrompt, entryParagraph, titleBase) {
  return verification.map((pair, i) => {
    const isFirst = i === 0;
    const isLast = i === verification.length - 1;
    const subject = (pair.subject || `${titleBase} — check ${i + 1}/${verification.length}`).slice(0, 60);
    let description;
    if (isFirst) {
      description = basePrompt;
    } else {
      const filesLine = pair.files && pair.files.length ? `Files: ${pair.files.join(", ")}\n` : "";
      description = `${pair.goal || subject}\n${filesLine}Run: ${pair.run}\nExpected: ${pair.expected}`;
    }
    if (isLast && entryParagraph) description += `\n\n${entryParagraph}`;
    return { subject, description };
  });
}

// ---- judgment shape — a trust boundary: the caller is a model, and a
// malformed verification pair or example must fail loudly here rather than
// ride through as "Run: undefined" / "Expected: undefined" /
// "undefined → undefined" in a prompt the gate then waves through (the gate
// checks structure, never field content).

function validateJudgment(judgment) {
  if (judgment.verification !== undefined) {
    if (!Array.isArray(judgment.verification)) {
      throw new Error("judgment.verification must be an array of {run, expected}");
    }
    judgment.verification.forEach((pair, i) => {
      if (
        !pair ||
        typeof pair !== "object" ||
        typeof pair.run !== "string" ||
        !pair.run.trim() ||
        typeof pair.expected !== "string" ||
        !pair.expected.trim()
      ) {
        throw new Error(`judgment.verification[${i}] must be {run, expected} with non-empty strings`);
      }
    });
  }
  if (judgment.example !== undefined) {
    const ex = judgment.example;
    if (
      !ex ||
      typeof ex !== "object" ||
      Array.isArray(ex) ||
      typeof ex.before !== "string" ||
      !ex.before.trim() ||
      typeof ex.after !== "string" ||
      !ex.after.trim()
    ) {
      throw new Error("judgment.example must be an object with non-empty before/after strings");
    }
  }
}

// ---- assembly

function assemble(root, input) {
  if (!input || typeof input !== "object") throw new Error("stdin must be a JSON object");
  const destination = input.destination;
  if (!destination || !DESTINATIONS.has(destination)) {
    throw new Error(`destination is required and must be one of ${[...DESTINATIONS].join("|")}`);
  }
  const judgment = input.judgment || {};
  validateJudgment(judgment);
  const record = loadRecord(root, input);
  const isEntry = Boolean(record.id);
  // [Foreman: 204] Workflow-stage flavor: no <tone>, <output_format> replaced
  // by the fixed enforcement sentence, wired through to check-prompt.js's own
  // --workflow-stage-equivalent gate option below so a mismatch is caught
  // rather than silently assembled wrong.
  const workflowStage = Boolean(input.workflowStage);

  const hasVerification = Array.isArray(judgment.verification) && judgment.verification.length > 0;
  // [Foreman: 236] Every check the handoff names is preflighted, not just the
  // first — a command in position 2..N runs in the handed-off session exactly
  // as the first one does. resolve-symbols.js dedupes and names each one.
  const verifyCmds = hasVerification ? judgment.verification.map((pair) => pair.run) : input.verify;
  const symbolResult = resolveSymbols(root, record.planned_touches, record.what, verifyCmds);

  const config = render(root);
  const signals = computeSignals(root, record, input, symbolResult.files, hasVerification);
  const reinforced = Object.values(signals).some(Boolean);
  const profile = reinforced ? "reinforced" : "standard";

  const { canonical, defaultTone, defaultOutputFormat, noInventionLine, fixCeilingLine, autonomyParagraph } =
    templateDefaults();

  const omit = new Set(config.omit);
  const isDecision = record.kind === "decision";

  const entryId = record.id;

  const checkCount = hasVerification ? judgment.verification.length : 0;
  const wantsClipboardEmbed = destination === "clipboard" && checkCount >= 2;
  const checkpointEmbed = wantsClipboardEmbed
    ? checkpointEmbedText(checkpointsConfig(root), checkCount, isEntry ? entryId : null)
    : null;

  const entryParagraph = isEntry
    ? entryParagraphText({
        id: entryId,
        // The resume *variant* is about the delivery path (this pick came
        // from the finish-first in_progress array), never the `resumed`
        // mechanical signal — that also fires on plain non-empty
        // commits/observed_touches, which is not the same claim.
        resume: Boolean(input.resume),
        requireVerification: config.requireVerification,
        destination,
        askLesson: isEntry && readLedger(root).enabled,
      })
    : "";

  const taskContextBlock = taskContextText(config.usePersona, judgment);
  const backgroundInner = relevantFilesText(symbolResult.files, symbolResult.references, symbolResult.unresolved, record);
  const priorWork = priorWorkText(readEntries(root), record, root);
  const lessons = ledgerText(root, record);
  const anchors = anchorsText(root, record, config.ledger.dir);
  const ctxText = contextText(judgment.context, record.depends_on_docs);
  const includeTone = !workflowStage && reinforced && (destination === "agent" || !omit.has("tone"));
  const includeBackground = !omit.has("background");
  // [Foreman: 4.2 measurement] The standard profile ends on the closure-evidence
  // sentence and says nothing about the final message — the one part of a
  // handoff a human actually reads. Giving it the canonical <output_format>
  // costs words on the profile whose whole purpose is the length it saves, so
  // the switch exists before the default does: set FOREMAN_STANDARD_OUTPUT_SHAPE
  // to 1 or true and standard carries the block too, inheriting both existing
  // opt-outs unchanged. Default is today's behaviour until a measurement says
  // otherwise. Nothing in the product writes this variable.
  const shapeStandard = /^(1|true)$/i.test(process.env.FOREMAN_STANDARD_OUTPUT_SHAPE || "");
  const includeOutputFormat =
    !workflowStage && (reinforced || shapeStandard) && !omit.has("output_format");
  const rulesBlock = taskRulesText(record, judgment, hasVerification, fixCeilingLine, checkpointEmbed);
  // A decision entry's task_rules already say "do not write implementation
  // code" — synthesizing `Implement: <title>.` as the request sentence puts
  // the contradiction in the one line that carries the actual ask.
  const requestSubject = record.title || judgment.goal || "the task described above";
  const requestSentence =
    input.request ||
    (isDecision ? `Decide: ${requestSubject}, and state why the chosen option wins.` : `Implement: ${requestSubject}.`);
  const invariantsText =
    reinforced && judgment.invariants && judgment.invariants.length
      ? `<invariants>\n${judgment.invariants.join("\n")}\n</invariants>`
      : "";
  const exampleText =
    reinforced && !omit.has("example") && judgment.example
      ? `<example>\n${judgment.example.before} → ${judgment.example.after}\n</example>`
      : "";

  function buildParts(includeEntry) {
    const parts = [];
    parts.push(taskContextBlock);
    if (reinforced) {
      parts.push(`<truth_grounding>\n${canonical.truthGrounding}\n</truth_grounding>`);
      parts.push(`<scope_discipline>\n${canonical.scopeDiscipline}\n</scope_discipline>`);
    } else {
      parts.push(CONCISE_TRUTH_SENTENCE);
    }
    if (includeEntry && entryParagraph) parts.push(entryParagraph);
    if (includeTone) {
      parts.push(`<tone>\n${input.customTone || defaultTone}\n</tone>`);
    }
    if (includeBackground) {
      const ctxBlock = reinforced && ctxText ? `<context>\n${ctxText}\n</context>\n` : "";
      // Prior work rides in the background block itself, never in <context>:
      // that block is emitted only on a reinforced profile, so anything put
      // there is dropped from every standard handoff.
      const recallBlock = priorWork ? `${priorWork}\n` : "";
      // Untagged, unlike <prior_work>: these are one-sentence claims, not a
      // block of past-entry prose that needs a frame to stop it reading as
      // instructions. Same both-profiles rule.
      const lessonsBlock = lessons ? `${lessons}\n` : "";
      // Same untagged treatment, same both-profiles rule: an anchor is a
      // pointer at code the destination is about to read, and it is only worth
      // anything before the reading starts.
      const anchorsBlock = anchors ? `${anchors}\n` : "";
      parts.push(`<background>\n<relevant_files>\n${backgroundInner}\n</relevant_files>\n${recallBlock}${lessonsBlock}${anchorsBlock}${ctxBlock}</background>`);
    }
    if (reinforced) parts.push(noInventionLine);
    if (invariantsText) parts.push(invariantsText);
    parts.push(rulesBlock);
    if (exampleText) parts.push(exampleText);
    parts.push(requestSentence);
    if (destination === "agent" && autonomyParagraph) parts.push(autonomyParagraph);
    if (reinforced) parts.push(canonical.closing);
    else parts.push(CLOSURE_EVIDENCE_SENTENCE);
    if (reinforced) parts.push(`<plan>\n${canonical.plan}\n</plan>`);
    if (workflowStage) parts.push(WORKFLOW_STAGE_SENTENCE);
    else if (includeOutputFormat) parts.push(`<output_format>\n${defaultOutputFormat}\n</output_format>`);
    return parts.filter(Boolean).join("\n\n") + "\n";
  }

  const basePrompt = buildParts(false);
  const prompt = buildParts(true);

  const gateOpts = {
    root,
    profile,
    destination,
    research: !hasVerification,
    ...(workflowStage ? { workflowStage: true } : {}),
    ...(isEntry ? { entry: entryId, resume: Boolean(input.resume) } : {}),
  };
  const gateResult = checkPrompt(prompt, gateOpts);
  const gate = { ok: gateResult.errors.length === 0, profile: gateResult.profile, errors: gateResult.errors, warnings: gateResult.warnings };

  let tasks;
  if (destination === "task" && input.split && checkCount >= 1) {
    const titleBase = record.title || input.title || "Task";
    tasks = buildTaskRows(judgment.verification, basePrompt, entryParagraph, titleBase);
  }

  const warnings = [...config.warnings, ...symbolResult.warnings, ...gateResult.warnings];

  // [Foreman] `<context>` renders on the reinforced profile only, so a fact
  // the crafting session put in `judgment.context` is absent from every
  // standard handoff. That is deliberate — but it was silent, and a session
  // that supplied one had no way to learn the fact never shipped. Found by
  // rendering a benchmark arm and diffing it against the facts it was built
  // from: the arm's `fix location:` line had vanished.
  if (judgment.context && gateResult.profile !== "reinforced") {
    warnings.push(
      "judgment.context was dropped: <context> renders on the reinforced profile only, and this handoff assembled at standard. "
        + "Put anything the session must actually receive in judgment.constraints, task_rules or the description instead."
    );
  }

  // [Foreman: 208] The first delivered handoff of this project's life. This
  // is the moment TRIALS.md names — a prompt that never passed the gate is
  // not a first useful task — and it costs no skill instruction, because
  // every crafting flow already ends here. Silent no-op unless the project
  // opted in, no-op again on every later handoff, and never throws.
  if (gate.ok) recordFirstPick({ root });

  // The first moment the ledger could actually pay: a finished entry already
  // touched files this one plans to, and nobody has been asked yet. An absent
  // key is the record that the question was never put — a written `false` is
  // what stops it being asked again, and either key `ledger` replaced counts
  // as an answer already given. Just the fact; pick.md owns the question.
  const ledgerConfig = readConfig(root).config;
  const ledgerAsk =
    isEntry
    && ledgerConfig.ledger === undefined
    && ledgerConfig.areaNotes === undefined
    && ledgerConfig.decisionLog === undefined
    && process.env.FOREMAN_LEDGER === undefined
    && process.env.FOREMAN_AREA_NOTES === undefined
    && notesOverlapExists(root, record);

  return {
    ok: gate.ok,
    prompt,
    profile,
    signals,
    ...(tasks ? { tasks } : {}),
    ...(ledgerAsk ? { ledger_ask: true } : {}),
    gate,
    warnings,
  };
}

function readStdin() {
  const raw = fs.readFileSync(0, "utf-8").trim();
  return raw ? JSON.parse(raw) : {};
}

function main() {
  const input = readStdin();
  const result = assemble(projectDir(), input);
  process.stdout.write(JSON.stringify(result));
  if (!result.ok) process.exitCode = 1;
}

if (require.main === module) {
  try {
    main();
  } catch (err) {
    process.stdout.write(JSON.stringify({ ok: false, error: err.message }));
    process.exit(1);
  }
}

module.exports = {
  assemble,
  loadRecord,
  computeSignals,
  relevantFilesText,
  rankSymbols,
  SYMBOL_KEEP,
  priorWorkText,
  recallExcerpt,
  ledgerText,
  anchorsText,
  ANCHOR_KEEP,
  ANCHOR_MAX_CHARS,
  notesOverlapExists,
  // Read by benchmarks/foreman/lessons/gen.js, so a reworded header or closer
  // fails the arm-invariant test instead of silently benchmarking prose the
  // product no longer ships.
  NOTES_HEADER,
  NOTES_CLOSER,
  taskContextText,
  taskRulesText,
  entryParagraphText,
  checkpointsConfig,
  checkpointEmbedText,
  buildTaskRows,
  slugify,
  templateDefaults,
  daysSince,
  parseLocalDate,
};
