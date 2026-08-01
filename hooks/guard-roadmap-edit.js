#!/usr/bin/env node
"use strict";

const fs = require("fs");
const path = require("path");

const PLUGIN_ROOT = process.env.CLAUDE_PLUGIN_ROOT
  ? path.resolve(process.env.CLAUDE_PLUGIN_ROOT)
  : path.resolve(__dirname, "..");
const SCRIPT_PATH = path.join(PLUGIN_ROOT, "scripts", "roadmap.js");

const WATCHED_TOOLS = new Set(["Edit", "Write"]);

function readInput() {
  let raw;
  try {
    raw = fs.readFileSync(0, "utf-8");
  } catch {
    return {};
  }
  try {
    return JSON.parse(raw || "{}");
  } catch {
    return {};
  }
}

function projectDir(data) {
  return path.resolve(process.env.CLAUDE_PROJECT_DIR || data.cwd || process.cwd());
}

// ROADMAP.jsonl is a basename-only match, deliberately not path-aware — a
// project having some unrelated file literally named ROADMAP.jsonl elsewhere
// isn't worth distinguishing from the real one at this scale.
// [Foreman: 132] archive.jsonl is the same file in a later life: the archived
// half of the roadmap, written by the same CLI (archive/restore), so a hand
// edit bypasses the same invariants. Unlike the roadmap, though, the name is
// generic — so only this project's own copy counts, and some other tool's
// archive.jsonl is not Foreman's to deny.
const PROJECT_ARCHIVE = ".foreman/archive.jsonl";

function targetsRoadmap(filePath, root) {
  if (!filePath) return false;
  const base = path.basename(String(filePath)).toLowerCase();
  if (base === "roadmap.jsonl") return true;
  if (base !== "archive.jsonl") return false;
  const rel = path.relative(root, path.resolve(root, String(filePath)));
  return rel.replaceAll("\\", "/").toLowerCase() === PROJECT_ARCHIVE;
}

function main() {
  const data = readInput();
  if (!WATCHED_TOOLS.has(data.tool_name)) return;

  const root = projectDir(data);
  // A project that never ran init has no roadmap to guard, and nothing
  // Foreman is entitled to say about it.
  if (!fs.existsSync(path.join(root, "ROADMAP.jsonl"))) return;

  if (!targetsRoadmap(data.tool_input?.file_path, root)) return;

  const payload = {
    hookSpecificOutput: {
      hookEventName: "PreToolUse",
      permissionDecision: "deny",
      permissionDecisionReason:
        `Foreman: direct ${data.tool_name} of ` +
        `${path.basename(String(data.tool_input.file_path))} is blocked. Use ` +
        `node ${SCRIPT_PATH} instead (add/update-status/annotate/update-deps/` +
        "correct/reassign-id/archive/restore/list/next-candidates/" +
        "check-duplicate/doctor/migrate — run with --help for usage). " +
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

module.exports = { main, targetsRoadmap };
