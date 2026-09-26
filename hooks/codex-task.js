#!/usr/bin/env node
"use strict";

// Codex has no TaskCreated/TaskCompleted events. Explicit start/check calls
// preserve those checkpoints without treating update_plan or every Stop as
// a task completion. Stop only considers an attempted check in this scope.
const fs = require("fs");
const os = require("os");
const path = require("path");
const crypto = require("crypto");
const { projectDir, hostName, pluginDir } = require("./lib");
const { readEntries, cmdUpdateStatus, isValidId, soleHolder } = require("../scripts/roadmap");
const { recordResumeRecovered } = require("../scripts/trial-log");
const { discoveryEnabled, discoveryInstructions, delegatedDiscoveryInstructions } = require("../scripts/discovery");
const { readConfigFile, delegatedOrchestrator } = require("../scripts/foreman-config");
const { parseFlags, printHelp } = require("../scripts/runtime");
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
  // [Foreman: 760] A duplicated id is refused, not read from its first holder.
  const holderOf = () => soleHolder(readEntries(root), options.id, "ROADMAP.jsonl");
  let entry = holderOf();
  if (!entry) throw new Error(`no entry with id ${options.id}`);
  let transition;
  if (action === "start" && entry.status === "planned") {
    transition = cmdUpdateStatus(root, { id: entry.id, status: "in_progress", expected_status: "planned", require_ready: true });
    entry = holderOf();
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
  // [Foreman: 828] A session delegatedAcceptance lists hears who accepts for
  // it, and gets discovery wording that reports to that orchestrator instead
  // of asking the user. Antigravity passes no session here unless --session.
  // A background subagent keeps the shared policy: it returns its candidates
  // to its coordinator, which is the listed session.
  const delegatedTo = agent ? null : delegatedOrchestrator(readConfigFile(root).config, session);
  const discovery = !discoveryEnabled(root) ? undefined
    : delegatedTo ? delegatedDiscoveryInstructions(delegatedTo, hostName(), path.join(pluginDir(), "scripts", "roadmap.js"))
    : discoveryInstructions();
  return { id: entry.id, status: entry.status, complete, ...(action === "start" ? { dispatchReady, transition } : {}), stop_gate_scoped: Boolean(scope), ...(delegatedTo ? { delegatedTo } : {}), ...(discovery ? { discovery } : {}) };
}

const USAGE = "usage: codex-task.js start|check --id ID [--root PATH] [--session ID] [--agent ID]";

function main(argv = process.argv.slice(2)) {
  if (printHelp(argv, USAGE)) return;
  const [action, ...args] = argv;
  if (!["start", "check"].includes(action)) throw new Error(USAGE);
  // [Foreman: 771] The same flag parser as the scripts/ CLIs: a repeated
  // --id fails instead of starting the last one given.
  const options = parseFlags(`codex-task.js ${action}`, { id: "value", root: "value", session: "value", agent: "value" }, args);
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
