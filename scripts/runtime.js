"use strict";

const path = require("path");

// Explicit project selection wins. Codex hosts need not provide CODEX_CWD;
// ordinary CLI use runs in cwd. Keep the old variable for existing integrations.
function projectDir(env = process.env, cwd = process.cwd()) {
  return path.resolve(env.FOREMAN_PROJECT_DIR || env.CODEX_CWD || env.CLAUDE_PROJECT_DIR || cwd);
}

module.exports = { projectDir };
