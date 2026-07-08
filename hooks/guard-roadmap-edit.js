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

// Basename-only match, deliberately not path-aware — a project having some
// unrelated file literally named ROADMAP.jsonl elsewhere isn't worth
// distinguishing from the real one at this scale.
function targetsRoadmap(filePath) {
  if (!filePath) return false;
  return path.basename(String(filePath)).toLowerCase() === "roadmap.jsonl";
}

function main() {
  const data = readInput();
  if (!WATCHED_TOOLS.has(data.tool_name)) return;
  if (!targetsRoadmap(data.tool_input?.file_path)) return;

  const payload = {
    hookSpecificOutput: {
      hookEventName: "PreToolUse",
      permissionDecision: "deny",
      permissionDecisionReason:
        `Foreman: direct ${data.tool_name} of ROADMAP.jsonl is blocked. Use ` +
        `node ${SCRIPT_PATH} instead (add/update-status/list/` +
        "next-candidates/check-duplicate — run with --help for usage). " +
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
