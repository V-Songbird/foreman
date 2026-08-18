#!/usr/bin/env node
"use strict";

const fs = require("fs");
const path = require("path");
const { readInput, projectDir } = require("./lib");

const PLUGIN_ROOT = process.env.CLAUDE_PLUGIN_ROOT
  ? path.resolve(process.env.CLAUDE_PLUGIN_ROOT)
  : path.resolve(__dirname, "..");
const SCRIPT_PATH = path.join(PLUGIN_ROOT, "scripts", "roadmap.js");

const WATCHED_TOOLS = new Set(["Edit", "Write"]);

// ROADMAP.jsonl is a basename-only match, deliberately not path-aware — a
// project having some unrelated file literally named ROADMAP.jsonl elsewhere
// isn't worth distinguishing from the real one at this scale.
// [Foreman: 132] archive.jsonl is the same file in a later life: the archived
// half of the roadmap, written by the same CLI (archive/restore), so a hand
// edit bypasses the same invariants. Unlike the roadmap, though, the name is
// generic — so only this project's own copy counts, and some other tool's
// archive.jsonl is not Foreman's to deny.
const PROJECT_ARCHIVE = ".foreman/archive.jsonl";
// The lesson ledger, guarded for the same reason and on the same terms: the
// CLI owns the append (inside the close's lock, with the format marker and
// the 500-char refusal), and `notes.jsonl` is far too generic a name to match
// on the basename alone.
const PROJECT_NOTES = ".foreman/notes.jsonl";

// Which CLI verbs to name when the deny message fires, per file — a generic
// "use the CLI" leaves the caller to guess which of thirteen verbs applies.
const SCOPED_HINT = {
  [PROJECT_NOTES]:
    'Record a lesson by passing `"lesson"` on that entry\'s `update-status` close, ' +
    "and read the store back with the `notes` verb.",
};

function projectRelative(filePath, root) {
  return path
    .relative(root, path.resolve(root, String(filePath)))
    .replaceAll("\\", "/")
    .toLowerCase();
}

/** The project-relative path this edit targets, or null when it targets none. */
function guardedPath(filePath, root) {
  if (!filePath) return null;
  const base = path.basename(String(filePath)).toLowerCase();
  if (base === "roadmap.jsonl") return "ROADMAP.jsonl";
  if (base !== "archive.jsonl" && base !== "notes.jsonl") return null;
  const rel = projectRelative(filePath, root);
  return rel === PROJECT_ARCHIVE || rel === PROJECT_NOTES ? rel : null;
}

function main() {
  const data = readInput();
  if (!WATCHED_TOOLS.has(data.tool_name)) return;

  const root = projectDir(data);
  // A project that never ran init has no roadmap to guard, and nothing
  // Foreman is entitled to say about it.
  if (!fs.existsSync(path.join(root, "ROADMAP.jsonl"))) return;

  const guarded = guardedPath(data.tool_input?.file_path, root);
  if (guarded === null) return;

  const scoped = SCOPED_HINT[guarded];
  const payload = {
    hookSpecificOutput: {
      hookEventName: "PreToolUse",
      permissionDecision: "deny",
      permissionDecisionReason:
        `Foreman: direct ${data.tool_name} of ` +
        `${path.basename(String(data.tool_input.file_path))} is blocked. Use ` +
        `node ${SCRIPT_PATH} instead (add/update-status/annotate/update-deps/` +
        "correct/reassign-id/archive/restore/list/next-candidates/notes/" +
        "check-duplicate/doctor/migrate — run with --help for usage). " +
        (scoped ? `${scoped} ` : "") +
        "It enforces id computation and parse-before/after-write; a hand " +
        "edit bypasses both. If the file is corrupt and the CLI itself " +
        "can't read it, repair it via Bash instead — that path stays open.",
    },
  };
  try {
    process.stdout.write(Buffer.from(JSON.stringify(payload), "utf-8"));
  } catch {
    // ignore
  }
}

if (require.main === module) {
  try {
    main();
  } catch {
    process.exit(0);
  }
}

module.exports = { main, guardedPath };
