"use strict";

// The two helpers every Foreman hook shares. Hook stdin is the harness's
// one delivery channel and a hook must never die on bad input, so both
// read failures collapse to {}; projectDir resolves the same way in every
// hook so all of them agree on which project a payload belongs to. The
// tmpdir latches deliberately stay local to each hook — their key
// semantics differ per hook, so there is nothing shared to extract there.

const fs = require("fs");
const path = require("path");
const { detectHost } = require("../scripts/runtime");

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

function hostName(env = process.env) {
  return detectHost(env);
}

function projectDir(data, env = process.env) {
  // An explicit Foreman target wins. Claude Code exports the session's project
  // root to every hook, while the payload cwd can be a subdirectory the session
  // moved into, so that root comes first there. Codex has no such variable:
  // its payload identifies the session, and a CLAUDE_PROJECT_DIR it inherited
  // belongs to some other session, so it is only the last resort.
  const ordered = hostName(env) === "codex"
    ? [env.FOREMAN_PROJECT_DIR, data?.cwd, env.CODEX_CWD, env.CLAUDE_PROJECT_DIR]
    : [env.FOREMAN_PROJECT_DIR, env.CLAUDE_PROJECT_DIR, data?.cwd];
  return path.resolve(ordered.find(Boolean) || process.cwd());
}

function pluginDir() {
  return path.resolve(process.env.PLUGIN_ROOT || process.env.CLAUDE_PLUGIN_ROOT || path.join(__dirname, ".."));
}

// Codex reports apply_patch as one call containing an entire patch, including
// rename destinations. Only structural headers count; added/context text may
// itself contain strings that resemble paths or patch headers.
function patchPaths(command) {
  if (typeof command !== "string") return [];
  const lines = command.trim().split(/\r?\n/);
  if (lines[0] !== "*** Begin Patch" || lines.at(-1) !== "*** End Patch") return [];
  const paths = [];
  for (const line of lines.slice(1, -1)) {
    const m = /^\*\*\* (?:Add File|Update File|Delete File|Move to): (.+)$/.exec(line);
    if (m) paths.push(m[1]);
  }
  return [...new Set(paths)];
}

function touchedPaths(data) {
  if (data?.tool_name === "apply_patch") return patchPaths(data.tool_input?.command);
  if (["Read", "Edit", "Write"].includes(data?.tool_name) && typeof data.tool_input?.file_path === "string") {
    return [data.tool_input.file_path];
  }
  return [];
}

module.exports = { readInput, hostName, projectDir, pluginDir, patchPaths, touchedPaths };
