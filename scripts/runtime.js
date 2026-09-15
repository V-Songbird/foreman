"use strict";

const path = require("path");

const HOSTS = new Set(["claude", "codex"]);

// Which agent host runs this process. FOREMAN_HOST wins so tests and wrappers
// can pin it. Otherwise each host's own markers decide: Codex sets PLUGIN_ROOT
// for plugin hooks and CODEX_THREAD_ID/CODEX_SESSION_ID for shell commands.
// Claude Code sets neither (its hooks get CLAUDE_PLUGIN_ROOT, which Codex also
// sets for compatibility), so everything else is Claude Code, including plain
// terminal use of these scripts.
function detectHost(env = process.env) {
  const forced = String(env.FOREMAN_HOST || "").trim().toLowerCase();
  if (HOSTS.has(forced)) return forced;
  return env.PLUGIN_ROOT || env.CODEX_THREAD_ID || env.CODEX_SESSION_ID ? "codex" : "claude";
}

// Explicit project selection wins. Codex hosts need not provide CODEX_CWD;
// ordinary CLI use runs in cwd. Keep the old variable for existing integrations.
function projectDir(env = process.env, cwd = process.cwd()) {
  return path.resolve(env.FOREMAN_PROJECT_DIR || env.CODEX_CWD || env.CLAUDE_PROJECT_DIR || cwd);
}

module.exports = { HOSTS, detectHost, projectDir };
