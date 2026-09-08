"use strict";

const { test, beforeEach } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const { spawnSync } = require("node:child_process");
const { makeTmpProject, writeRoadmap, writeConfig, runScriptRaw, runNodeScript, HOOKS_DIR } = require("./helpers");
const { patchPaths, projectDir } = require("../hooks/lib");
const { commitFailed } = require("../hooks/post-commit");
const { currentScope } = require("../hooks/codex-task");

let root;
let session;
beforeEach(() => {
  root = makeTmpProject();
  session = crypto.randomUUID();
  writeRoadmap(root, [{ id: "001", title: "first", status: "planned", depends_on: [] }, { id: "002", title: "other", status: "in_progress", depends_on: [] }]);
});
function hook(name, data = {}) {
  const result = runScriptRaw(name, { cwd: root, session_id: session, ...data }, { PLUGIN_ROOT: path.resolve(__dirname, "..") });
  assert.equal(result.status, 0, result.stderr);
  return result.stdout ? JSON.parse(result.stdout) : null;
}
function task(action, id = "001", args = []) {
  return runNodeScript(path.join(HOOKS_DIR, "codex-task.js"), [action, "--id", id, "--root", root, "--session", session, "--agent", "", ...args]);
}

test("discovery travels through start and no-commit completion without writing candidates", () => {
  const started = JSON.parse(task("start").stdout);
  assert.match(started.discovery, /optimization opportunities/);
  writeRoadmap(root, [{ id: "001", title: "investigation", status: "awaiting_acceptance", commits: [] }]);
  const before = fs.readFileSync(path.join(root, "ROADMAP.jsonl"), "utf8");
  const checked = task("check");
  assert.equal(checked.status, 0);
  const result = JSON.parse(checked.stdout);
  assert.equal(result.complete, true);
  assert.match(result.discovery, /work without a commit/);
  assert.match(result.discovery, /check-duplicate/);
  assert.match(result.discovery, /Wait for a decision/);
  assert.equal(fs.readFileSync(path.join(root, "ROADMAP.jsonl"), "utf8"), before);
});

test("discovery is disabled at execution time by the project setting", () => {
  writeConfig(root, { discoverySuggestions: false });
  assert.equal(JSON.parse(task("start").stdout).discovery, undefined);
  assert.equal(JSON.parse(task("check").stdout).discovery, undefined);
});

test("background checkpoint returns candidates to the coordinator instead of discarding them", () => {
  const result = JSON.parse(task("check", "002", ["--agent", "worker"]).stdout);
  assert.match(result.discovery, /returns candidates and evidence to its coordinator/);
  assert.match(result.discovery, /must not discard them/);
});

test("hook cwd wins over inherited project environment", () => {
  assert.equal(projectDir({ cwd: root }), root);
});

test("scope derives parent and agent identity without inheriting it over an explicit override", () => {
  assert.deepEqual(currentScope({}, { CODEX_SESSION_ID: "parent", CODEX_THREAD_ID: "worker" }), { session: "parent", agent: "worker" });
  assert.deepEqual(currentScope({ session: "selected" }, { CODEX_SESSION_ID: "parent", CODEX_THREAD_ID: "worker" }), { session: "selected", agent: "" });
  assert.deepEqual(currentScope({}, { CODEX_SESSION_ID: "", CODEX_THREAD_ID: "thread" }), { session: "thread", agent: "" });
  assert.deepEqual(currentScope({ session: "" }, { CODEX_THREAD_ID: "thread" }), { session: "", agent: "" });
});

test("Codex manifest registers supported events and canonical patch tool", () => {
  const hooks = require("../hooks/hooks.json").hooks;
  assert.equal(hooks.TaskCreated, undefined);
  assert.equal(hooks.TaskCompleted, undefined);
  assert.ok(hooks.Stop && hooks.SubagentStop);
  assert.ok(hooks.PreToolUse.some((group) => new RegExp(group.matcher).test("apply_patch")));
});

test("patch path extraction includes every operation and move destination without reading added text as headers", () => {
  const patch = "*** Begin Patch\n*** Add File: a.txt\n+*** Delete File: ROADMAP.jsonl\n*** Update File: b.txt\n*** Move to: c.txt\n@@\n-before\n+after\n*** Delete File: d.txt\n*** End Patch";
  assert.deepEqual(patchPaths(patch), ["a.txt", "b.txt", "c.txt", "d.txt"]);
  assert.deepEqual(patchPaths("ordinary text *** Update File: ROADMAP.jsonl"), []);
});

for (const operation of ["Add File", "Update File", "Delete File", "Move to"]) {
  for (const file of ["ROADMAP.jsonl", ".foreman/archive.jsonl", ".foreman/notes.jsonl"]) {
    test(`apply_patch guards ${operation} ${file} even after a safe first file`, () => {
      const command = `*** Begin Patch\n*** Update File: safe.txt\n@@\n-a\n+b\n*** ${operation}: ${file}\n*** End Patch`;
      const output = hook("guard-roadmap-edit.js", { tool_name: "apply_patch", tool_input: { command } });
      assert.equal(output.hookSpecificOutput.permissionDecision, "deny");
    });
  }
}

test("patching an unrelated archive and a header-looking added line stays silent", () => {
  assert.equal(hook("guard-roadmap-edit.js", { tool_name: "apply_patch", tool_input: { command: "*** Begin Patch\n*** Add File: vendor/archive.jsonl\n+*** Delete File: ROADMAP.jsonl\n*** End Patch" } }), null);
});

test("ledger recalls all changed patch files and renamed destination", () => {
  fs.mkdirSync(path.join(root, "docs", "foreman"), { recursive: true });
  fs.writeFileSync(path.join(root, "docs", "foreman", "001.md"), "decision");
  fs.writeFileSync(path.join(root, "docs", "foreman", "002.md"), "other decision");
  fs.writeFileSync(path.join(root, "a.js"), "// [Foreman: 001]\n");
  fs.writeFileSync(path.join(root, "new.js"), "// [Foreman: 002]\n");
  const output = hook("ledger-recall.js", { hook_event_name: "PostToolUse", tool_name: "apply_patch", tool_input: { command: "*** Begin Patch\n*** Update File: a.js\n*** Update File: old.js\n*** Move to: new.js\n*** End Patch" } });
  assert.match(output.hookSpecificOutput.additionalContext, /001\.md/);
  assert.match(output.hookSpecificOutput.additionalContext, /002\.md/);
});

test("Codex context reading stays unknown even with Claude settings and usage", () => {
  const transcript = path.join(root, "transcript.jsonl");
  fs.writeFileSync(transcript, JSON.stringify({ type: "assistant", message: { usage: { input_tokens: 999999 } } }));
  const result = runScriptRaw("context-fill.js", { model: "codex-test", turn_id: "turn", tool_name: "Bash", tool_input: { command: "node /plugin/scripts/roadmap.js list" }, transcript_path: transcript }, { CLAUDE_CODE_AUTO_COMPACT_WINDOW: "200000" });
  assert.equal(result.stdout, "");
  assert.equal(result.status, 0);
});

test("post commit accepts explicit exit statuses but never interprets raw output as status", () => {
  assert.equal(commitFailed({ tool_response: { exit_code: 1 } }), true);
  assert.equal(commitFailed({ tool_response: { exit_code: 0 } }), false);
  assert.equal(commitFailed({ tool_response: "Process exited with code 1" }), false);
  assert.equal(commitFailed({ tool_response: "Wall time: 1 second\nProcess exited with code 0\nOutput:\nProcess exited with code 1" }), false);
});

test("explicit start opens a planned entry, and Stop does not reinterpret a normal turn as completing it", () => {
  writeConfig(root, { taskCloseGate: "block" });
  const started = task("start");
  assert.equal(started.status, 0, started.stdout);
  assert.equal(JSON.parse(started.stdout).status, "in_progress");
  assert.equal(JSON.parse(started.stdout).dispatchReady, true);
  assert.equal(hook("stop.js", { hook_event_name: "Stop" }), null);
});

test("start refuses unfinished dependencies without inviting dispatch", () => {
  writeRoadmap(root, [{ id: "001", title: "blocked", status: "planned", depends_on: ["002"] }, { id: "002", title: "dependency", status: "in_progress" }]);
  const result = task("start");
  assert.equal(result.status, 1);
  const output = JSON.parse(result.stdout);
  assert.equal(output.dispatchReady, false);
  assert.equal(output.status, "planned");
  assert.equal(output.reason, "dependencies_not_done");
  assert.equal(output.transition.blocking_dependencies[0].id, "002");
});

for (const status of ["deferred", "done", "dropped", "rejected", "awaiting_acceptance"]) {
  test(`start does not dispatch a ${status} entry`, () => {
    writeRoadmap(root, [{ id: "001", title: "first", status }]);
    const result = task("start");
    assert.equal(result.status, 1);
    assert.equal(JSON.parse(result.stdout).dispatchReady, false);
    assert.equal(JSON.parse(result.stdout).status, status);
  });
}

test("explicit check arms opt-in Stop only for that entry and consumes the continuation once", () => {
  writeConfig(root, { taskCloseGate: "block" });
  const checked = task("check");
  assert.equal(checked.status, 1);
  assert.equal(JSON.parse(checked.stdout).complete, false);
  const output = hook("stop.js", { hook_event_name: "Stop" });
  assert.equal(output.decision, "block");
  assert.match(output.reason, /001/);
  assert.doesNotMatch(output.reason, /002/);
  assert.equal(hook("stop.js", { hook_event_name: "Stop" }), null);
});

test("Stop respects the default off and the host continuation flag", () => {
  task("check");
  assert.equal(hook("stop.js", { hook_event_name: "Stop" }), null);
  writeConfig(root, { taskCloseGate: "block" });
  assert.equal(hook("stop.js", { hook_event_name: "Stop", stop_hook_active: true }), null);
});

test("awaiting acceptance satisfies the checkpoint without closing the entry", () => {
  writeRoadmap(root, [{ id: "001", title: "first", status: "awaiting_acceptance" }]);
  writeConfig(root, { taskCloseGate: "block" });
  const checked = task("check");
  assert.equal(checked.status, 0, checked.stdout);
  assert.equal(JSON.parse(checked.stdout).status, "awaiting_acceptance");
  assert.equal(hook("stop.js", { hook_event_name: "Stop" }), null);
});

test("a different session or agent cannot inherit a checkpoint", () => {
  writeConfig(root, { taskCloseGate: "block" });
  task("check");
  assert.equal(hook("stop.js", { hook_event_name: "Stop", session_id: "different" }), null);
  assert.equal(hook("stop.js", { hook_event_name: "SubagentStop", agent_id: "different" }), null);
  assert.equal(hook("stop.js", { hook_event_name: "Stop" }).decision, "block");
});

test("subagent checkpoint uses explicit parent session and agent identity", () => {
  writeConfig(root, { taskCloseGate: "block" });
  task("check", "001", ["--agent", "worker"]);
  assert.equal(hook("stop.js", { hook_event_name: "Stop" }), null);
  assert.equal(hook("stop.js", { hook_event_name: "SubagentStop", agent_id: "worker" }).decision, "block");
});

test("native launcher passes stdin under Windows cmd and PowerShell", { skip: process.platform !== "win32" }, () => {
  const handler = require("../hooks/hooks.json").hooks.PreToolUse[0].hooks[0];
  const input = JSON.stringify({ cwd: root, tool_name: "apply_patch", tool_input: { command: "*** Begin Patch\n*** Delete File: ROADMAP.jsonl\n*** End Patch" } });
  const env = { ...process.env, PLUGIN_ROOT: path.resolve(__dirname, "..") };
  for (const [shell, args] of [["cmd.exe", ["/d", "/s", "/c", `"${handler.commandWindows}"`]], ["powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", handler.commandWindows]]]) {
    // Codex's command_runner uses a raw outer-quoted argument for cmd /C.
    const result = spawnSync(shell, args, { input, env, encoding: "utf-8", windowsHide: true, windowsVerbatimArguments: shell === "cmd.exe" });
    assert.equal(result.status, 0, result.stderr);
    assert.ok(result.stdout.trim(), `${shell}: empty output (${result.stderr})`);
    assert.equal(JSON.parse(result.stdout).hookSpecificOutput.permissionDecision, "deny", shell);
  }
});
