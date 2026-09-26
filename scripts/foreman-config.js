"use strict";

// The one reader for .foreman/config.json. Five sites used to parse the
// file themselves with subtly different failure semantics — a confirmed
// divergence risk. This module owns the read once; every caller keeps its
// own presentation channel (the hooks swallow `error` because their events
// have nowhere to surface one, render-sections turns it into its
// user-visible warning).

const fs = require("fs");
const path = require("path");

function configPath(root) {
  return path.join(root, ".foreman", "config.json");
}

// One failure contract: `config` is always a plain object — {} when the
// file is missing, corrupt, or parses to a non-object — and `error` is the
// fs/parse error when a file was present but unusable, null otherwise
// (a missing file is the uninitialized case, not an error).
function readConfigFile(root) {
  try {
    const parsed = JSON.parse(fs.readFileSync(configPath(root), "utf-8"));
    return {
      config: parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : {},
      error: null,
    };
  } catch (err) {
    return { config: {}, error: err && err.code === "ENOENT" ? null : err };
  }
}

// [Foreman: 825, 828] delegatedAcceptance scopes by session, not by project
// or entry: `{"orchestrator": "<name>", "sessions": ["<session_id>", ...]}`
// names the orchestrator that accepts for the listed sessions (the hook
// input's session_id, which is the transcript file's name in Claude Code).
// Every session it does not list, the owner's own included, keeps today's
// prompts. Anything malformed reads as off (null), which is today's behavior.
function delegatedOrchestrator(config, sessionId) {
  const delegated = config.delegatedAcceptance;
  const orchestrator = delegated?.orchestrator;
  return typeof orchestrator === "string" && orchestrator && sessionId &&
    Array.isArray(delegated.sessions) && delegated.sessions.includes(sessionId)
    ? orchestrator
    : null;
}

module.exports = { configPath, readConfigFile, delegatedOrchestrator };
