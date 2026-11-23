"use strict";

// context-fill.js — PostToolUse hook on Bash/PowerShell, registered for
// Claude Code only (hooks/hooks.json). Codex has no stable context-fill input
// and its transcript is a different format that must never be read as Claude
// usage, so hooks/codex-hooks.json does not register this file and main()
// stays silent if a Codex payload reaches it anyway.
//
// The destination question ("How do you want to run this?") recommends one
// option, and one of the facts that should move that recommendation is how
// much room this session has left: a nearly-full session is the worst place
// to execute a fresh task in. Nothing in a hook payload carries that number
// — `context_window.used_percentage` exists only in the statusline JSON,
// which a skill cannot invoke — so this hook derives it the one other way
// available: the transcript's own last assistant `usage` block, summed.
//
// It speaks only when the session is at or above CONTEXT_SHARE of the
// window the user configured, or of DEFAULT_WINDOW when they set none, and
// only after one of the scripts a crafting flow runs *before* that question.
// Below the line it writes nothing and costs nothing, which is the common
// case. The number is a fact for the flow to
// apply; the rule that acts on it lives in skills/roadmap/destination-question.md, so the
// wording of the recommendation stays in one place.
//
// Every failure path here is silence. A missing transcript, an unreadable
// one, a format change in the .jsonl (officially unstable) — none of them
// may break a pick, so the whole read is best-effort and the flow simply
// falls back to its default recommendation.

const fs = require("fs");
const os = require("os");
const path = require("path");

const { readInput, hostName } = require("./lib");

const WATCHED_TOOLS = new Set(["Bash", "PowerShell"]);

// The calls a crafting flow makes before it asks the destination question:
// `roadmap.js step pick` (pick's steps, which report the selected entry
// before Q2), `resolve-symbols.js` (craft-prompt's pre-question read), and
// `safe-commit.js begin` (the tree probe the destination question itself takes
// before offering the split). Only those subcommands: `roadmap.js annotate`,
// `update-status`, `add`, `check-duplicate`, `list` and the rest run outside
// any pick, where a repeated reading only reads as a warning. Anything else —
// including `craft-handoff.js`, which runs *after* the answer — is past the
// moment this number could change and is not worth a line.
const PRE_QUESTION_SCRIPT =
  /scripts[\\/](?:resolve-symbols\.js|safe-commit\.js["']?\s+begin\b|roadmap\.js["']?\s+step\s+pick\b)/;

// The share of the window at which executing in this session stops being the
// obvious default. Deliberately not configurable: the window size underneath
// it is already an assumption, so a second knob would only add precision this
// number does not have.
const CONTEXT_SHARE = 0.25;

// The range `/autocompact` accepts, and so the only values worth believing.
const WINDOW_MIN = 100000;
const WINDOW_MAX = 1000000;

// The window measured against when the user set none or set an invalid value.
const DEFAULT_WINDOW = 1000000;

// Read far enough back to clear the largest single tool result a turn can
// hold, so the newest assistant record is inside the slice.
const TAIL_BYTES = 1024 * 1024;

function windowValue(raw) {
  const n = Number(raw);
  return Number.isFinite(n) && n >= WINDOW_MIN && n <= WINDOW_MAX ? n : null;
}

// How full the window may get before the host compacts on its own. The env
// var wins over the setting `/autocompact` saves, matching the host's own
// precedence. DEFAULT_WINDOW when neither holds a valid value — no hook input
// carries the real window size, so there is nothing else to read.
function autoCompactWindow() {
  const fromEnv = windowValue(process.env.CLAUDE_CODE_AUTO_COMPACT_WINDOW);
  if (fromEnv) return fromEnv;
  const dir = process.env.CLAUDE_CONFIG_DIR || path.join(os.homedir(), ".claude");
  try {
    const settings = JSON.parse(fs.readFileSync(path.join(dir, "settings.json"), "utf-8"));
    return windowValue(settings.autoCompactWindow) || DEFAULT_WINDOW;
  } catch {
    return DEFAULT_WINDOW; // absent, unreadable, or not JSON — treat as unset
  }
}

// Context occupancy ≈ the most recent main-thread request: the last
// non-sidechain assistant `usage`, summed across every numeric `*_tokens`
// field (uncached input + cache read + cache write + output). A sidechain
// record belongs to a subagent's own window, not this one. Null when the
// transcript holds no usable record.
function currentTokens(transcriptPath) {
  if (!transcriptPath || typeof transcriptPath !== "string") return null;

  let lines;
  try {
    const fd = fs.openSync(transcriptPath, "r");
    try {
      const size = fs.fstatSync(fd).size;
      const start = Math.max(0, size - TAIL_BYTES);
      const buf = Buffer.alloc(size - start);
      fs.readSync(fd, buf, 0, buf.length, start);
      lines = buf.toString("utf-8").split("\n");
      if (start > 0) lines = lines.slice(1); // drop the partial first line
    } finally {
      fs.closeSync(fd);
    }
  } catch {
    return null;
  }

  for (let i = lines.length - 1; i >= 0; i--) {
    const line = lines[i];
    if (!line) continue;
    let entry;
    try {
      entry = JSON.parse(line);
    } catch {
      continue; // torn or partial line
    }
    if (!entry || entry.type !== "assistant" || entry.isSidechain) continue;
    const usage = entry.message && entry.message.usage;
    if (!usage || typeof usage !== "object") continue;
    let sum = 0;
    for (const key of Object.keys(usage)) {
      if (/_tokens$/.test(key) && typeof usage[key] === "number") sum += usage[key];
    }
    return sum;
  }
  return null;
}

// The one decision: is this session full enough that the destination question
// should hear about it? Returns null for silence, or the numbers the message
// is built from. autoCompactWindow always supplies a window; a missing one
// here is still silence.
function assess(tokens, configuredWindow) {
  if (!Number.isFinite(tokens) || tokens <= 0) return null;
  if (!configuredWindow) return null;
  const share = tokens / configuredWindow;
  if (share < CONTEXT_SHARE) return null;
  return { tokens, window: configuredWindow, percent: Math.round(share * 100) };
}

function message(reading) {
  return (
    `[Foreman] Context reading for the destination question: this session is about ` +
    `${reading.percent}% full (${reading.tokens.toLocaleString("en-US")} tokens against ` +
    `a ${reading.window.toLocaleString("en-US")}-token compaction point), ` +
    `at or above Foreman's ${Math.round(CONTEXT_SHARE * 100)}% line. ` +
    `If you reach "How do you want to run this?" this turn, apply the high-context ` +
    `rule in skills/roadmap/destination-question.md; in a roadmap pick, pass ` +
    `--context-high to roadmap.js step pick. This is a reading, not an ` +
    `instruction to the user — never quote the number at them unless they ask. ` +
    `Outside that question it is no reason to stop, warn about context or ` +
    `hand the work to a new session.`
  );
}

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

function main(data = readInput()) {
  if (!WATCHED_TOOLS.has(data.tool_name)) return;

  // Codex has no stable context-occupancy hook field, and its payloads carry
  // model/turn_id where Claude Code's PostToolUse carries neither: never read a
  // Codex transcript as Claude usage or apply a Claude compaction setting.
  if (hostName() !== "claude" || data.model || data.turn_id) return;

  const command = data.tool_input?.command || "";
  if (!PRE_QUESTION_SCRIPT.test(command)) return;

  const reading = assess(currentTokens(data.transcript_path), autoCompactWindow());
  if (!reading) return;

  emit(message(reading));
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
  CONTEXT_SHARE,
  DEFAULT_WINDOW,
  PRE_QUESTION_SCRIPT,
  autoCompactWindow,
  currentTokens,
  assess,
  message,
};
