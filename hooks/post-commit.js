#!/usr/bin/env node
"use strict";

const fs = require("fs");
const os = require("os");
const path = require("path");
const { readInput, projectDir } = require("./lib");
const crypto = require("crypto");

const { execFileSync } = require("child_process");

const { readEntries, today, trailerIdsIn } = require("../scripts/roadmap");
const { resolveHookScope } = require("../scripts/commit-evidence");
const { readConfigFile } = require("../scripts/foreman-config");

const PLUGIN_ROOT = process.env.CLAUDE_PLUGIN_ROOT
  ? path.resolve(process.env.CLAUDE_PLUGIN_ROOT)
  : path.resolve(__dirname, "..");
const SCRIPT_PATH = path.join(PLUGIN_ROOT, "scripts", "roadmap.js");

const WATCHED_TOOLS = new Set(["Bash", "PowerShell"]);
const SEP = /\s*(?:&&|\|\||[;|\n])\s*/;
const COMMIT_RE = /^\s*git\s+(?:-\S+\s+)*commit\b/i;

function isGitCommit(command) {
  return command.split(SEP).some((part) => COMMIT_RE.test(part));
}

// Confirmed against code.claude.com/docs/en/hooks.md: PostToolUse's Bash
// exit code is a top-level `exit_code` field, not nested under
// tool_response/tool_output (tool_response is stdout text, a string, not an
// object) -- the field this checked before was never real, so this always
// silently failed open. Fail open still, on a genuinely absent field.
//
// An exit-preserving PreToolUse wrapper (hush's preserve-exit-code) forces
// the shell's own exit to 0 and embeds the real code in the output text as
// a marker triplet ([[hush:exit= / N / ]]); PostToolUse hooks across
// plugins run in parallel, so this hook sees that raw marker, never a
// corrected field. When a marker is present it is the truth and the
// top-level 0 is not; absent marker, same field check as before.
const WRAPPED_EXIT_RES = [
  /\[\[hush:exit=\s*(-?\d+)\s*\]\]/, // raw marker triplet (\s* spans the newlines)
  /\[hush: exit (-?\d+)\]/, // compressed form, in case ordering ever changes
];

function wrappedExitCode(data) {
  const r = data?.tool_response;
  const texts =
    typeof r === "string"
      ? [r]
      : r && typeof r === "object"
        ? [r.stdout, r.stderr, r.output].filter((t) => typeof t === "string")
        : [];
  for (const t of texts) {
    for (const re of WRAPPED_EXIT_RES) {
      const m = re.exec(t);
      if (m) return parseInt(m[1], 10);
    }
  }
  return undefined;
}

function commitFailed(data) {
  const wrapped = wrappedExitCode(data);
  if (typeof wrapped === "number") return wrapped !== 0;
  const code = data?.exit_code;
  return typeof code === "number" && code !== 0;
}

// The freshly-done follow-up nudge fires once per entry per day, not on
// every commit of a busy day — a tmpdir state file keyed by project root
// remembers which entries were already mentioned today. Best-effort both
// ways: unreadable state means nudge again (fail open), unwritable state
// means the dedup just doesn't stick.
function freshlyDoneStatePath(root) {
  const safe = crypto.createHash("sha1").update(String(root)).digest("hex").slice(0, 12);
  return path.join(os.tmpdir(), `foreman-freshlydone-${safe}.json`);
}

function filterUnnudged(root, ids, todayStr) {
  const p = freshlyDoneStatePath(root);
  let state = { date: todayStr, ids: [] };
  try {
    const parsed = JSON.parse(fs.readFileSync(p, "utf-8"));
    if (parsed && parsed.date === todayStr && Array.isArray(parsed.ids)) state = parsed;
  } catch {
    // missing or corrupt state — treat as a fresh day
  }
  const unnudged = ids.filter((id) => !state.ids.includes(id));
  if (unnudged.length) {
    try {
      fs.writeFileSync(p, JSON.stringify({ date: todayStr, ids: [...state.ids, ...unnudged] }));
    } catch {
      // best effort
    }
  }
  return new Set(unnudged);
}

// [Foreman: 118] requireVerification defaults ON: a commit that looks like
// it finishes a task is not evidence the task holds up, so the unconfigured
// project gets the safe reading. Opting out is an explicit `false`, and a
// corrupt config falls to the same safe default rather than the loose one.
//
// [Foreman: 127] discoverySuggestions defaults OFF, the opposite polarity:
// discovery spends tokens on every commit of every project that never asked
// for it, so it takes an explicit `true`. Unparseable config is not consent
// either — it falls to off, same as absent.
//
// [Foreman: 136] A THIRD state matters now that init no longer asks about
// discovery: an absent key is off AND unanswered, while an explicit `false`
// is a decline. Only the first earns the one-time invitation below. An
// unreadable config counts as unanswered too — it holds no answer either.
function readConfig(root) {
  // Corrupt config reads as {} — silent here, deliberately: SessionStart/
  // PostToolUse have no user-visible channel for a warning, and {} lands on
  // every safe default above (render-sections.js owns the visible warning).
  const { config } = readConfigFile(root);
  return {
    discoverySuggestions: config.discoverySuggestions === true,
    discoveryUnanswered: !("discoverySuggestions" in config),
    requireVerification: config.requireVerification !== false,
  };
}

// A short tag on each surfaced in_progress task saying whether this commit's
// changed files intersect the task's PREDICTED file surface. This is the
// signal the hook otherwise lacks: under concurrent sessions sharing one
// working tree, a commit from one workstream surfaces every other
// workstream's in_progress task with no way to tell them apart. Never
// suppresses — the tag ranks, it does not filter:
//   - no committed files resolvable (git absent / non-git project) -> no tag
//   - a task with no predicted surface yet -> no tag (nothing to compare)
// [Foreman: 130] `planned_touches`, deliberately. The question is "is this
// commit plausibly THIS task's work", and the entry's prediction is the
// honest answer to it: observed_touches is derived from commits already
// recorded, so matching against it would mostly re-confirm commits the entry
// has already been credited with, and every close would widen the net for the
// next commit. Nothing here relied on the accumulated half — before the split
// this compared against one array that a close folded into, which is exactly
// the drift the tag kept getting vaguer from.
// razor: exact path membership only; an area-level hint ("src/auth/") won't
// match an exact committed path under it. Upgrade to prefix/area matching
// here if area hints prove common enough to matter — the caveat below already
// keeps a no-overlap task from being wrongly skipped meanwhile.
function touchesTag(entry, committedSet) {
  if (!committedSet.size) return "";
  const planned = entry.planned_touches || [];
  if (!planned.length) return "";
  return planned.some((t) => committedSet.has(t))
    ? " [files overlap its planned files]"
    : " [no overlap with its planned files]";
}

// HEAD's commit message, for `Foreman: <id>` trailer detection -- read from
// whichever repo the resolved scope points at (the root, or the submodule
// the commit actually landed in), not always root, so a submodule commit's
// own trailer is seen instead of the parent's last message. Fail-soft like
// every other git read here: no repo / no git -> no trailer ids.
function headTrailerIds(cwd) {
  try {
    const msg = execFileSync("git", ["log", "-1", "--format=%B"], {
      cwd,
      encoding: "utf-8",
      stdio: ["ignore", "pipe", "ignore"],
    });
    return trailerIdsIn(msg);
  } catch {
    return [];
  }
}

// HEAD's changed files, read from the resolved scope's own repo rather than
// always the root. filesTouchedByCommit/filesFromGit walk root-then-
// submodules and return the FIRST scope with files -- correct for a
// concrete sha, wrong for the symbolic ref HEAD, which resolves in every
// scope: that walk always returned the root's HEAD even when the commit
// that fired this hook landed inside a submodule. Prefixed like `touches`
// so a submodule's paths read the way planned_touches does. Fail-soft like
// every other git read here.
function scopeTouchedFiles(scope) {
  try {
    const out = execFileSync(
      "git",
      ["show", "--pretty=format:", "--name-only", "--relative", "HEAD"],
      { cwd: scope.cwd, encoding: "utf-8", stdio: ["ignore", "pipe", "ignore"] }
    );
    const files = out.split("\n").map((line) => line.trim()).filter(Boolean);
    return scope.prefix ? files.map((file) => `${scope.prefix}/${file}`) : files;
  } catch {
    return [];
  }
}

// Emitted once, only when at least one tag is shown, to keep the recall-first
// contract explicit: a no-overlap tag must never be read as "skip this task",
// because `touches` is an append-only guess and a real completion can add
// files it never listed. Without this, precision labeling could induce the
// one thing the design forbids — a missed real completion (false negative).
const OVERLAP_CAVEAT =
  "(The [...planned files] tags compare this commit's changed files to each " +
  "task's planned_touches — a ranking hint, not proof: that field is a " +
  "prediction, so a task tagged no-overlap can still be the one this commit completes.)";

// Two independent triggers, since a task stops getting any nudge the moment
// it leaves in_progress — real usage showed a follow-up bugfix commit
// (found right after finishing a task, before moving on, or while the task
// still sits awaiting acceptance) silently loses its SHA with no signal at
// all, unlike an in_progress task which still nudges. Passing commit also
// auto-folds that commit's actual changed files into
// observed_touches (roadmap.js runs `git show` itself) — the entry's
// prediction was set once, from whatever investigation happened before the
// task started, and only the close records what the work actually reached.
// add_touches remains for the rare case that needs it (git unavailable, or
// a file touched outside this specific commit) but doesn't need mentioning
// here — passing commit alone already covers the common case.
//
// requireVerification decouples "record the work" from "call it done": data
// (commit/observed files) is never worth gating on a human, only the status label
// is — so under the flag, the in_progress branch still records immediately.
// [Foreman: 131] That recording step now also moves the entry to
// `awaiting_acceptance`, which is what is actually true at that moment:
// committed, checked, waiting on the user. The question mechanics are
// unchanged — confirm still closes to `done`, "not ready" sends it back to
// `in_progress` — only the status the roadmap holds meanwhile is honest.
function statusSyncBlock(inProgress, freshlyDone, requireVerification, committedFiles, trailerIds) {
  const parts = [];
  const trailerSet = new Set(trailerIds || []);
  if (inProgress.length) {
    const committedSet = new Set(committedFiles || []);
    // A trailer naming the entry outranks any touches heuristic — the
    // commit message says which entry it meant, the staged close just
    // didn't happen before the commit.
    const tags = inProgress.map((e) =>
      trailerSet.has(e.id)
        ? " [named in this commit's Foreman: trailer — this is the one]"
        : touchesTag(e, committedSet)
    );
    const list = inProgress.map((e, i) => `${e.id} ("${e.title}")${tags[i]}`).join(", ");
    const caveat = tags.some(Boolean) ? " " + OVERLAP_CAVEAT : "";
    if (requireVerification) {
      parts.push(
        `This commit may complete an in-progress ROADMAP.jsonl task (${list}), ` +
          "but requireVerification is on for this project — record the work now, " +
          "don't close it out yet. Run `git rev-parse --short HEAD` for the SHA, then: " +
          `echo '{"id":"<id>","status":"awaiting_acceptance","commit":"<sha>"}' | node ${SCRIPT_PATH} update-status ` +
          "(keeps commits[]/observed_touches accurate — observed_touches still " +
          "auto-folds from the commit's diff, same as always — and says what is true: finished, " +
          "waiting on the user). Then ask the user (AskUserQuestion) " +
          "whether this is actually verified and working. Only on confirmation, " +
          "close it out: " +
          `echo '{"id":"<id>","status":"done"}' | node ${SCRIPT_PATH} update-status. ` +
          "If they say it's not ready, send it back: " +
          `echo '{"id":"<id>","status":"in_progress","notes":"<what they said>"}' | node ${SCRIPT_PATH} update-status ` +
          "— don't mark done. If this session has no user to ask (a background " +
          "agent), leave it awaiting_acceptance — the user confirms later." +
          caveat
      );
    } else {
      parts.push(
        `This commit may complete an in-progress ROADMAP.jsonl task (${list}). ` +
          "If it does, run `git rev-parse --short HEAD` for the commit SHA, then: " +
          `echo '{"id":"<id>","status":"done","commit":"<sha>"}' | node ${SCRIPT_PATH} update-status. ` +
          "The script computes updated_at, appends the SHA, and auto-folds that " +
          "commit's actual changed files into observed_touches — don't hand-edit the file, " +
          "and no need to list touched files yourself, the script derives them." +
          caveat
      );
    }
  }
  if (freshlyDone.length) {
    // [Foreman: 194] The population mixes two statuses now (done-today and
    // awaiting_acceptance, which can linger days), so a single blanket
    // "status":"done" would wrongly close an awaiting entry just for
    // carrying a follow-up SHA. Each id is tagged with its own current
    // status so the pairing stays unambiguous — that status is what the
    // recording command must keep, not overwrite.
    const list = freshlyDone.map((e) => `${e.id} ("${e.title}", status: ${e.status})`).join(", ");
    parts.push(
      `This commit might also be a follow-up fix for a task that recently ` +
        `finished its work — marked done earlier today, or still waiting on ` +
        `your acceptance (${list}) — a bugfix right after finishing a task is ` +
        "easy to lose track of, since nothing else nudges about a task once it " +
        "leaves in_progress. If this commit actually relates to one of those, " +
        "append its SHA rather than letting it go unrecorded: run " +
        "`git rev-parse --short HEAD`, then, keeping the status shown above " +
        "for that id (an awaiting_acceptance entry must stay " +
        "awaiting_acceptance — recording a follow-up SHA does not close it): " +
        `echo '{"id":"<id>","status":"<its status above>","commit":"<sha>"}' | node ${SCRIPT_PATH} update-status ` +
        "(only adds the SHA, and auto-folds this commit's changed files into " +
        "observed_touches; commits[] and observed_touches both only grow, never " +
        "shrink). Most commits won't relate to an already-finished task — say " +
        "nothing if this one doesn't."
    );
  }
  return "[Foreman] " + parts.join(" ");
}

// [Foreman: 127] The planned titles used to ride along here as a negative
// list, so the block's size grew with the backlog — on every commit, for a
// gain check-duplicate already covers. Dedup is now check-duplicate only:
// one compact call per candidate, paid only when there IS a candidate,
// instead of the whole backlog injected whether or not anything is found.
// [Foreman: 4.3 measurement] The inclusion bar was two qualitative words —
// "CONFIRMED" and "not vague hunches" — on a model that follows exactly that
// instruction and reports less. The concrete criterion already existed two
// clauses later, but it governed how to WRITE an accepted candidate rather than
// what got in. Both gates have to swap together or it is a no-op: the opening
// bar and the closing "Say nothing if nothing is confirmed", which binds hardest
// at the emit point. Set FOREMAN_DISCOVERY_CONCRETE_BAR to 1 or true to swap
// them; the default is today's wording until a measurement says otherwise.
// Nothing in the product writes this variable.
const CONCRETE_BAR = /^(1|true)$/i.test(process.env.FOREMAN_DISCOVERY_CONCRETE_BAR || "");

function discoveryBlock() {
  return (
    "[Foreman] Roadmap discovery is enabled for this project. " +
    (CONCRETE_BAR
      ? "Scan this commit's work for anything worth tracking — a bug, a gap, "
        + "an opportunity. The bar is whether you can name it with an exact "
        + "path, symbol, or behaviour you observed in this session: if you "
        + "can, offer it. "
      : "Scan this "
        + "commit's work for CONFIRMED opportunities, bugs, or ideas — not vague "
        + "hunches. ") +
    "If you add one to the roadmap, write it dense using only " +
    "what's already in this session's context (exact paths, line ranges, " +
    "symbol names, the specific behavior observed) — do NOT run extra " +
    "Read/Grep/Bash calls just to enrich the entry, that spends tokens now " +
    "instead of saving them for whoever picks it up later. Every candidate " +
    "MUST go through the duplicate check before you offer it — the roadmap's " +
    "existing entries are deliberately not in your context, so this call is " +
    "the only thing between a suggestion and a duplicate: " +
    `echo '{"title":"...","why":"..."}' | node ${SCRIPT_PATH} check-duplicate ` +
    "— matches carry each entry's status. A rejected match means the user " +
    "already declined it: skip silently. Any other status (planned/" +
    "in_progress/done/...) means it's already tracked: skip it, or mention " +
    "the existing entry's id if the new observation adds something. Only " +
    "when there's no match, ask the user " +
    "(AskUserQuestion) what to do with it: Add to roadmap / Execute here " +
    "(work it now in this session) / Execute with a " +
    "background Agent (run_in_background: true) / Reject — both Add and " +
    "Reject use the same `add` call, only the status field differs " +
    '("planned" for Add, "rejected" for Reject): ' +
    `echo '{"title":"...","why":"...","what":"...","source":"claude-suggested","status":"planned"}' | node ${SCRIPT_PATH} add. ` +
    "Also scan for the inverse case: work already implemented in this " +
    "commit that goes beyond what any in_progress task's `what` describes — " +
    "scope that grew mid-session (e.g. the user asked for something related " +
    "but separate, and it got built inline), not a future idea. If you find " +
    "one, it's already done, so log and close it in the same breath rather " +
    "than leaving it \"planned\": the same `add` call above, then " +
    `echo '{"id":"<new-id>","status":"done","commit":"<sha>"}' | node ${SCRIPT_PATH} update-status ` +
    "(observed_touches auto-derives from that commit). Ask first (AskUserQuestion: " +
    "Log it / Skip). " +
    "Never call " +
    "mcp__ccd_session__spawn_task — it has a known bug where tasks spawned " +
    "through it don't get MCP tools. Never act without asking. If this " +
    "session has no user to ask (a background agent), skip the suggestions " +
    "entirely. " +
    (CONCRETE_BAR
      ? "If nothing in this commit clears that bar, say nothing."
      : "Say nothing if nothing is confirmed.")
  );
}

// [Foreman: 136] The first-relevant ask for discovery. A commit just landed,
// which is the only moment the answer changes anything, so this is where the
// question belongs — not in the init interview, where it was one of several
// policy questions asked before the user had done any work.
//
// razor: rides along with a block already being emitted; it never makes the
// hook speak on a commit it would otherwise stay silent on. Upgrade to a
// standalone block (still behind shouldInviteDiscovery's once-a-day dedup
// below) if projects that never mark work in_progress turn out to need the
// ask too.
const DISCOVERY_INVITE =
  "[Foreman] This project has never answered whether it wants commit-time roadmap " +
  "discovery (no `discoverySuggestions` key in `.foreman/config.json`). Ask the user " +
  "once, now (AskUserQuestion): should Foreman scan each commit for " +
  (CONCRETE_BAR ? "bugs and " : "confirmed bugs and ") +
  "opportunities worth adding to the roadmap? It costs tokens on every commit, which is " +
  "why it is off until asked for. Then write their answer into `.foreman/config.json` — " +
  '`"discoverySuggestions": true` or `false`, either way, preserving every other key — ' +
  "since recording it is what stops this from being raised again. If this session has no " +
  "user to ask (a background agent), skip it silently and leave the config alone.";

// [Foreman: 200] A session with no user to ask (a background agent) skips
// the invite silently and never writes the config key, so without a rate
// limit it re-asks on every single qualifying commit forever. Same tmpdir
// state-file pattern as the freshly-done dedup above, one file per project;
// best-effort both ways: unreadable state means invite again (fail open),
// unwritable state means the dedup just doesn't stick.
function discoveryInviteStatePath(root) {
  const safe = crypto.createHash("sha1").update(String(root)).digest("hex").slice(0, 12);
  return path.join(os.tmpdir(), `foreman-discoveryinvite-${safe}.json`);
}

// razor: fixed ceiling (at most once a day), no config key — add one only
// once a user asks for it.
function shouldInviteDiscovery(root, todayStr) {
  const p = discoveryInviteStatePath(root);
  let lastDate;
  try {
    const parsed = JSON.parse(fs.readFileSync(p, "utf-8"));
    if (parsed && typeof parsed.date === "string") lastDate = parsed.date;
  } catch {
    // missing or corrupt state — fail open, invite again
  }
  if (lastDate === todayStr) return false;
  try {
    fs.writeFileSync(p, JSON.stringify({ date: todayStr }));
  } catch {
    // best effort
  }
  return true;
}

// The emit path shared by every branch that talks — the corrupt-file branch
// below now uses it too, instead of duplicating the JSON envelope.
function emit(additionalContext) {
  const payload = {
    hookSpecificOutput: {
      hookEventName: "PostToolUse",
      additionalContext,
    },
  };
  try {
    process.stdout.write(Buffer.from(JSON.stringify(payload), "utf-8"));
  } catch {
    // ignore
  }
}

// The corrupt-file branch below used to return with no output at all, on the
// reasoning that reporting anything might nudge Claude into writing on top
// of a file it can't safely parse. That rationale only ever covered write
// nudges, and stays valid — but total silence also means the bookkeeping
// this hook does disappears exactly when trust in the file is lowest.
// `doctor` (no --fix) only reports, so pointing at it can't make a bad file
// worse.
const CORRUPT_ROADMAP_MESSAGE =
  "[Foreman] ROADMAP.jsonl could not be parsed, so Foreman's commit " +
  `bookkeeping is paused. Run \`node ${SCRIPT_PATH} doctor\` to see what's ` +
  "wrong — it only reports, it never rewrites.";

function main() {
  const data = readInput();
  if (!WATCHED_TOOLS.has(data.tool_name)) return;

  const command = (data.tool_input?.command || "").trim();
  if (!command || !isGitCommit(command)) return;
  if (commitFailed(data)) return;

  const root = projectDir(data);
  // Which repo this specific commit landed in -- the root project, a
  // declared submodule, or (a commit made in some unrelated repository
  // elsewhere on disk) neither. Only the first two are this hook's
  // business; a commit fired from an unrelated repo must not read or
  // annotate this project's roadmap.
  const scope = resolveHookScope(root, path.resolve(data.cwd || process.cwd()));
  if (!scope) return;

  if (!fs.existsSync(path.join(root, "ROADMAP.jsonl"))) return;

  let entries;
  try {
    entries = readEntries(root);
  } catch {
    // corrupt file — say so read-only, rather than stay silent (see
    // CORRUPT_ROADMAP_MESSAGE above)
    emit(CORRUPT_ROADMAP_MESSAGE);
    return;
  }

  const todayStr = today();
  const inProgress = entries.filter((e) => e.status === "in_progress");
  // A `Foreman: <id>` trailer in the just-landed commit's message is a
  // staged close's link. An entry it names needs no follow-up nudge — this
  // commit IS its closing (or acceptance-recording) commit, and appending
  // the sha would re-dirty the roadmap the staged close just kept clean.
  // Later commits (no trailer for it) still nudge as before.
  //
  // [Foreman: 194] `awaiting_acceptance` sits in neither the in_progress nor
  // the done-today population under the default requireVerification:true
  // config, so a follow-up fix commit landing while an entry waits on
  // acceptance got no nudge at all and its SHA was silently lost — exactly
  // the gap this nudge exists to close. Included regardless of date: unlike
  // done-today, an entry can sit awaiting acceptance for days.
  const doneTodayAll = entries.filter((e) => e.status === "done" && e.updated_at === todayStr);
  const awaitingAll = entries.filter((e) => e.status === "awaiting_acceptance");
  const followUpAll = [...doneTodayAll, ...awaitingAll];
  const trailerIds = inProgress.length || followUpAll.length ? headTrailerIds(scope.cwd) : [];
  const followUpUntagged = followUpAll.filter((e) => !trailerIds.includes(e.id));
  const unnudged = followUpUntagged.length
    ? filterUnnudged(root, followUpUntagged.map((e) => e.id), todayStr)
    : new Set();
  const freshlyDone = followUpUntagged.filter((e) => unnudged.has(e.id));
  const config = readConfig(root);

  // The just-created commit is HEAD (this hook fires after `git commit`).
  // Best-effort — [] when git can't name the files — so the tag degrades to
  // no-tag rather than a misleading "no overlap". Only fetched when it can
  // matter (an in_progress task to tag).
  const committedFiles = inProgress.length ? scopeTouchedFiles(scope) : [];

  const blocks = [];
  if (inProgress.length || freshlyDone.length) {
    blocks.push(statusSyncBlock(inProgress, freshlyDone, config.requireVerification, committedFiles, trailerIds));
  }
  if (config.discoverySuggestions) {
    blocks.push(discoveryBlock());
  } else if (config.discoveryUnanswered && blocks.length && shouldInviteDiscovery(root, todayStr)) {
    blocks.push(DISCOVERY_INVITE);
  }
  if (!blocks.length) return;

  emit(blocks.join("\n\n"));
}

if (require.main === module) {
  try {
    main();
  } catch {
    process.exit(0);
  }
}

module.exports = {
  main,
  isGitCommit,
  commitFailed,
  wrappedExitCode,
  freshlyDoneStatePath,
  filterUnnudged,
  readConfig,
  projectDir,
  statusSyncBlock,
  touchesTag,
  headTrailerIds,
  scopeTouchedFiles,
  discoveryBlock,
  DISCOVERY_INVITE,
  discoveryInviteStatePath,
  shouldInviteDiscovery,
  CORRUPT_ROADMAP_MESSAGE,
  SCRIPT_PATH,
};
