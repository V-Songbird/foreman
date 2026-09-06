#!/usr/bin/env node
"use strict";

// Codex has no TaskCreated/TaskCompleted events. Explicit start/check calls
// preserve those checkpoints without treating update_plan or every Stop as
// a task completion. Stop only considers an attempted check in this scope.
const fs = require("fs");
const os = require("os");
const path = require("path");
const crypto = require("crypto");
const { projectDir } = require("./lib");
const { readEntries, cmdUpdateStatus, isValidId } = require("../scripts/roadmap");
const { recordResumeRecovered } = require("../scripts/trial-log");
const OPEN = new Set(["planned", "in_progress"]);

function scopePath(root, session, agent = "") {
  if (!session) return null;
  const hash = crypto.createHash("sha256").update(JSON.stringify([path.resolve(root), session, agent])).digest("hex");
  return path.join(os.tmpdir(), "foreman-codex-checkpoints", hash);
}

function currentScope(options = {}, env = process.env) {
  const session = options.session ?? (env.CODEX_SESSION_ID || env.CODEX_THREAD_ID || "");
  const thread = env.CODEX_THREAD_ID || "";
  const agent = options.agent ?? (options.session === undefined && env.CODEX_SESSION_ID && thread !== session ? thread : "");
  return { session, agent };
}

function checkpoint(action, options) {
  const root = path.resolve(options.root || projectDir({}));
  if (!isValidId(options.id)) throw new Error("--id must be a roadmap entry id");
  let entry = readEntries(root).find((e) => e.id === options.id);
  if (!entry) throw new Error(`no entry with id ${options.id}`);
  let transition;
  if (action === "start" && entry.status === "planned") {
    transition = cmdUpdateStatus(root, { id: entry.id, status: "in_progress", expected_status: "planned", require_ready: true });
    entry = readEntries(root).find((e) => e.id === options.id);
  }
  const dispatchReady = action === "start" && entry.status === "in_progress";
  if (action === "start" && !dispatchReady) {
    return { id: entry.id, status: entry.status, complete: !OPEN.has(entry.status), dispatchReady: false, skipped: true, reason: transition?.reason || `entry is ${entry.status}, not in_progress`, transition, stop_gate_scoped: false };
  }
  const complete = !OPEN.has(entry.status);
  const { session, agent } = currentScope(options);
  const scope = scopePath(root, session, agent);
  // A filename per entry keeps concurrent checkpoints from losing each other.
  // Only explicit check attempts arm Stop; asking the user a question after
  // start must never become an implicit demand to finish the task.
  if (scope) {
    const file = path.join(scope, `${entry.id}.json`);
    if (action === "check" && !complete) {
      fs.mkdirSync(scope, { recursive: true });
      fs.writeFileSync(file, JSON.stringify({ id: entry.id }), "utf-8");
    } else {
      try { fs.unlinkSync(file); } catch (err) { if (err.code !== "ENOENT") throw err; }
    }
  }
  if (action === "check" && complete && ((entry.commits || []).length || (entry.observed_touches || []).length)) {
    recordResumeRecovered({ root });
  }
  return { id: entry.id, status: entry.status, complete, ...(action === "start" ? { dispatchReady, transition } : {}), stop_gate_scoped: Boolean(scope) };
}

function main(argv = process.argv.slice(2)) {
  const [action, ...args] = argv;
  if (!["start", "check"].includes(action)) throw new Error("usage: codex-task.js start|check --id ID [--root PATH] [--session ID] [--agent ID]");
  const options = {};
  for (let i = 0; i < args.length; i += 2) {
    const key = args[i].replace(/^--/, "");
    if (!args[i].startsWith("--") || !["id", "root", "session", "agent"].includes(key) || args[i + 1] === undefined) throw new Error(`invalid option ${args[i]}`);
    options[key] = args[i + 1];
  }
  const result = checkpoint(action, options);
  process.stdout.write(JSON.stringify(result));
  if ((action === "check" && !result.complete) || (action === "start" && !result.dispatchReady)) process.exitCode = 1;
}

if (require.main === module) {
  try { main(); } catch (error) {
    process.stdout.write(JSON.stringify({ ok: false, error: error.message }));
    process.exitCode = 1;
  }
}
module.exports = { main, checkpoint, scopePath, currentScope, OPEN };
