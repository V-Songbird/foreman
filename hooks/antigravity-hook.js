#!/usr/bin/env node
"use strict";

// Antigravity entrypoint: the one file that knows that host's wire. It reads
// the event, rewrites the call into the shape hooks/lib.js already reads —
// tool_name and tool_input with file_path or command, cwd, session_id — and
// runs the same hook scripts Claude Code and Codex run, as child processes
// with FOREMAN_HOST pinned, so none of them learns a third payload. What
// comes back is reshaped for Antigravity: a PreToolUse denial becomes
// {decision: "deny", reason} and an allow is said out loud. Context a hook
// adds after a tool call has no channel here — this host's PostToolUse answer
// is always {} — so it waits in a per-conversation queue under the temp
// directory and rides the next PreInvocation as a transient message, after
// the session notice the first invocation of a conversation carries.
// Antigravity has no task, stop or context-fill event, so those hooks are not
// registered for it.

const fs = require("fs");
const os = require("os");
const path = require("path");
const { spawnSync } = require("child_process");
const { readInput } = require("./lib");
const { configPath, readConfigFile, delegatedOrchestrator } = require("../scripts/foreman-config");

const TOOLS = {
  run_command: (args) => ({ tool_name: "Bash", tool_input: { command: args.CommandLine || "" } }),
  view_file: (args) => ({ tool_name: "Read", tool_input: { file_path: args.AbsolutePath } }),
  write_to_file: (args) => ({ tool_name: "Write", tool_input: { file_path: args.TargetFile } }),
  replace_file_content: (args) => ({ tool_name: "Edit", tool_input: { file_path: args.TargetFile } }),
  multi_replace_file_content: (args) => ({ tool_name: "Edit", tool_input: { file_path: args.TargetFile } }),
};

// Inherited host markers would make lib.js read another session's project or
// answer as another host. The first workspace is the project unless the user
// named one with FOREMAN_PROJECT_DIR.
const INHERITED = new Set(["CLAUDE_PROJECT_DIR", "CODEX_CWD", "CODEX_THREAD_ID", "CODEX_SESSION_ID", "PLUGIN_ROOT", "CLAUDE_PLUGIN_ROOT"]);

function translate(data) {
  const call = data.toolCall && typeof data.toolCall === "object" ? data.toolCall : null;
  const args = call && call.args && typeof call.args === "object" ? call.args : {};
  const absolute = (value) => (typeof value === "string" && path.isAbsolute(value) ? value : null);
  const workspace = Array.isArray(data.workspacePaths) ? absolute(data.workspacePaths[0]) : null;
  const target = absolute(args.TargetFile) || absolute(args.AbsolutePath);
  const translated = call ? (TOOLS[call.name] || ((a) => ({ tool_name: call.name, tool_input: a })))(args) : {};
  return {
    workspace,
    payload: {
      session_id: data.conversationId,
      cwd: absolute(args.Cwd) || workspace || (target ? path.dirname(target) : undefined),
      ...translated,
    },
  };
}

// [Foreman: 470] Each child hook gets 4 s, so a stalled one never holds up
// Antigravity. The test suite raises that budget through
// FOREMAN_HOOK_TIMEOUT_MS, so a loaded machine slows a test instead of
// failing it; the variable can only raise the budget, never lower it.
const HOOK_TIMEOUT_MS = Math.max(4000, Number.parseInt(process.env.FOREMAN_HOOK_TIMEOUT_MS, 10) || 0);

function runHook(script, payload, workspace) {
  const env = {};
  for (const [key, value] of Object.entries(process.env)) if (!INHERITED.has(key)) env[key] = value;
  env.FOREMAN_HOST = "antigravity";
  if (!env.FOREMAN_PROJECT_DIR && workspace) env.FOREMAN_PROJECT_DIR = workspace;
  const result = spawnSync(process.execPath, [path.join(__dirname, script)], {
    input: JSON.stringify(payload),
    encoding: "utf-8",
    env,
    timeout: HOOK_TIMEOUT_MS,
    windowsHide: true,
  });
  return result.status === 0 && typeof result.stdout === "string" ? result.stdout : "";
}

function hookOutput(script, payload, workspace) {
  try {
    return JSON.parse(runHook(script, payload, workspace)).hookSpecificOutput || null;
  } catch {
    return null;
  }
}

// The queue and the session-notice and delegation latches, one file per
// conversation.
function statePath(conversationId) {
  const safe = String(conversationId).replace(/[^a-zA-Z0-9-]/g, "_").slice(0, 80);
  return path.join(os.tmpdir(), `foreman-antigravity-${safe}.json`);
}

function readState(conversationId) {
  try {
    const parsed = JSON.parse(fs.readFileSync(statePath(conversationId), "utf-8"));
    if (parsed && typeof parsed === "object") {
      return {
        started: parsed.started === true,
        pending: Array.isArray(parsed.pending) ? parsed.pending : [],
        ...(typeof parsed.delegated === "string" ? { delegated: parsed.delegated } : {}),
        ...(typeof parsed.configMtime === "number" || parsed.configMtime === null ? { configMtime: parsed.configMtime } : {}),
      };
    }
  } catch {
    // missing or corrupt: a conversation nothing has been said in yet
  }
  return { started: false, pending: [] };
}

function writeState(conversationId, state) {
  try {
    fs.writeFileSync(statePath(conversationId), JSON.stringify(state));
  } catch {
    // best effort: a lost queue costs one notice, never the tool call
  }
}

const DAY_MS = 24 * 60 * 60 * 1000;

// Queues outlive their conversations. A conversation that is new, or back
// after a day of silence, deletes every queue idle for more than a day. The
// scan reads the whole temp directory, so a live conversation, which rewrites
// its own file on every call, skips it. Its own file is never deleted: it
// latches the notice. A file that will not go waits for the next sweep.
function pruneQueues(conversationId) {
  const own = statePath(conversationId);
  const dir = path.dirname(own);
  const idle = (file) => Date.now() - fs.statSync(file).mtimeMs > DAY_MS;
  try {
    if (fs.existsSync(own) && !idle(own)) return;
    for (const name of fs.readdirSync(dir)) {
      if (!/^foreman-antigravity-[\w-]+\.json$/.test(name) || name === path.basename(own)) continue;
      const file = path.join(dir, name);
      try {
        if (idle(file)) fs.unlinkSync(file);
      } catch {
        // gone mid-scan, or not ours to delete
      }
    }
  } catch {
    // an unreadable temp directory never blocks the invocation
  }
}

function answer(value) {
  process.stdout.write(JSON.stringify(value));
}

// [Foreman: 838] A command the model runs is no child of this hook, so the
// checkpoint in hooks/codex-task.js cannot learn the conversation id from
// it. The first call after delegatedAcceptance lists the conversation says
// which --session to pass. Unlisted conversations hear nothing new.
// [Foreman: 850] The latch is the orchestrator's name, so a new orchestrator
// is announced too. The config is read again only when its mtime moves, so an
// unlisted conversation costs one stat per invocation, not a read.
function delegationLine(conversationId, root, state) {
  let mtime = null;
  try {
    mtime = root ? fs.statSync(configPath(root)).mtimeMs : null;
  } catch {
    // no config: nothing is delegated
  }
  if (mtime === state.configMtime) return "";
  state.configMtime = mtime;
  const orchestrator = mtime === null ? null : delegatedOrchestrator(readConfigFile(root).config, conversationId);
  const said = state.delegated;
  if (orchestrator) state.delegated = orchestrator;
  else delete state.delegated;
  if (!orchestrator || orchestrator === said) return "";
  const script = path.join(__dirname, "codex-task.js").replace(/\\/g, "/");
  return `[Foreman] delegatedAcceptance lists this conversation: acceptance belongs to the orchestrator ${orchestrator}. ` +
    `Pass --session ${conversationId} to every checkpoint, as in node "${script}" start --id <id> --session ${conversationId}, and the same for check.`;
}

function preInvocation(data, { payload, workspace }) {
  pruneQueues(data.conversationId);
  const state = readState(data.conversationId);
  const messages = state.pending.splice(0);
  const delegation = delegationLine(data.conversationId, process.env.FOREMAN_PROJECT_DIR || workspace || payload.cwd, state);
  if (delegation) messages.unshift(delegation);
  if (!state.started) {
    state.started = true;
    const notice = runHook("session-start.js", { ...payload, source: "startup" }, workspace).trim();
    if (notice) messages.unshift(notice);
  }
  writeState(data.conversationId, state);
  answer(messages.length ? { injectSteps: messages.map((text) => ({ ephemeralMessage: text })) } : {});
}

function preToolUse(data, { payload, workspace }) {
  const output = hookOutput("guard-roadmap-edit.js", { ...payload, hook_event_name: "PreToolUse" }, workspace);
  answer(
    output && output.permissionDecision === "deny"
      ? { decision: "deny", reason: output.permissionDecisionReason }
      : { decision: "allow" }
  );
}

function postToolUse(data, { payload, workspace }) {
  // A failed tool call bookkeeps nothing; a successful one runs the hooks
  // that watch its tool and queues whatever they had to say.
  if (!data.error && payload.tool_name) {
    const state = readState(data.conversationId);
    let queued = false;
    for (const script of payload.tool_name === "Bash" ? ["post-commit.js"] : ["ledger-recall.js"]) {
      const output = hookOutput(script, { ...payload, hook_event_name: "PostToolUse" }, workspace);
      if (output && typeof output.additionalContext === "string" && output.additionalContext) {
        state.pending.push(output.additionalContext);
        queued = true;
      }
    }
    if (queued) writeState(data.conversationId, state);
  }
  answer({});
}

const EVENTS = { PreInvocation: preInvocation, PreToolUse: preToolUse, PostToolUse: postToolUse };

function main() {
  const event = process.argv[2];
  if (!Object.hasOwn(EVENTS, event)) return;
  const input = readInput();
  const data = input && typeof input === "object" && !Array.isArray(input) ? input : {};
  // No conversation means nothing to remember: allow the call, inject nothing.
  if (typeof data.conversationId !== "string" || !data.conversationId) {
    answer(event === "PreToolUse" ? { decision: "allow" } : {});
    return;
  }
  EVENTS[event](data, translate(data));
}

if (require.main === module) {
  try {
    main();
  } catch {
    answer(process.argv[2] === "PreToolUse" ? { decision: "allow" } : {});
  }
}

module.exports = { main, translate, EVENTS, HOOK_TIMEOUT_MS };
