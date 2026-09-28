"use strict";

// Codex hook adapters and the explicit task lifecycle. A hook child runs with
// PLUGIN_ROOT set, as Codex starts plugin hooks, which also selects the Codex
// host (scripts/runtime.js detectHost). hooks/codex-task.js runs the way a
// Codex shell command would, pinned with FOREMAN_HOST=codex. Registration
// reads hooks/codex-hooks.json, the file .codex-plugin/plugin.json names.

const { test, beforeEach } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const { spawnSync } = require("node:child_process");
const { makeTmpProject, writeRoadmap, writeConfig, runScriptRaw, runNodeScript, HOOKS_DIR, SPAWN_TIMEOUT_MS, unlessTimedOut } = require("./helpers");
const { patchPaths, projectDir } = require("../hooks/lib");
const { commitFailed } = require("../hooks/post-commit");
const { currentScope } = require("../hooks/codex-task");
const { discoveryInstructions } = require("../scripts/discovery");

const CODEX_HOOKS = path.join(HOOKS_DIR, "codex-hooks.json");

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
  return runNodeScript(path.join(HOOKS_DIR, "codex-task.js"), [action, "--id", id, "--root", root, "--session", session, ...args], null, { FOREMAN_HOST: "codex" });
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

// [Foreman: 828] A checkpoint in a session delegatedAcceptance lists names the
// orchestrator and never tells the session to ask the user; another session
// keeps the shared policy.
test("a listed session's checkpoint defers to the orchestrator; an unlisted one is unchanged", () => {
  writeConfig(root, { delegatedAcceptance: { orchestrator: "orch-1", sessions: [session] } });
  for (const result of [JSON.parse(task("start").stdout), JSON.parse(task("check").stdout)]) {
    assert.equal(result.delegatedTo, "orch-1");
    assert.match(result.discovery, /belongs to the orchestrator orch-1/);
    assert.match(result.discovery, /check-duplicate/);
    assert.match(result.discovery, /"source":"codex-suggested","status":"planned"/);
    assert.doesNotMatch(result.discovery, /(?<!don't )ask the user|Wait for a decision/i);
  }
  const other = JSON.parse(runNodeScript(path.join(HOOKS_DIR, "codex-task.js"), ["check", "--id", "002", "--root", root, "--session", "someone-else"], null, { FOREMAN_HOST: "codex" }).stdout);
  assert.equal(other.delegatedTo, undefined);
  assert.equal(other.discovery, discoveryInstructions());
  const subagent = JSON.parse(task("check", "002", ["--agent", "worker"]).stdout);
  assert.equal(subagent.delegatedTo, undefined);
  assert.match(subagent.discovery, /returns candidates and evidence to its coordinator/);
});

test("background checkpoint returns candidates to the coordinator instead of discarding them", () => {
  const result = JSON.parse(task("check", "002", ["--agent", "worker"]).stdout);
  assert.match(result.discovery, /returns candidates and evidence to its coordinator/);
  assert.match(result.discovery, /must not discard them/);
});

// hooks/lib.js resolves per host: a Codex payload names its session's cwd, and
// an inherited CODEX_CWD or CLAUDE_PROJECT_DIR belongs to some other session;
// Claude Code exports the session root, which outranks a cwd it moved into.
test("hook cwd wins over inherited project environment on Codex, not over the Claude Code session root", () => {
  const inherited = makeTmpProject();
  assert.equal(projectDir({ cwd: root }, { FOREMAN_HOST: "codex", CODEX_CWD: inherited, CLAUDE_PROJECT_DIR: inherited }), root);
  assert.equal(projectDir({ cwd: root }, { FOREMAN_HOST: "claude", CLAUDE_PROJECT_DIR: inherited }), inherited);
});

test("scope derives parent and agent identity without inheriting it over an explicit override", () => {
  assert.deepEqual(currentScope({}, { CODEX_SESSION_ID: "parent", CODEX_THREAD_ID: "worker" }), { session: "parent", agent: "worker" });
  assert.deepEqual(currentScope({ session: "selected" }, { CODEX_SESSION_ID: "parent", CODEX_THREAD_ID: "worker" }), { session: "selected", agent: "" });
  assert.deepEqual(currentScope({}, { CODEX_SESSION_ID: "", CODEX_THREAD_ID: "thread" }), { session: "thread", agent: "" });
  assert.deepEqual(currentScope({ session: "" }, { CODEX_THREAD_ID: "thread" }), { session: "", agent: "" });
});

test("Codex registration carries only supported events and the canonical patch tool", () => {
  assert.equal(path.resolve(__dirname, "..", require("../.codex-plugin/plugin.json").hooks), CODEX_HOOKS);
  const hooks = require(CODEX_HOOKS).hooks;
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

// [Foreman: 771] codex-task.js parses its flags through runtime.parseFlags,
// like the scripts/ CLIs: a bad flag fails before anything is written.
for (const [label, args, error] of [
  ["an unknown flag", ["--bogus", "x"], /unknown flag for codex-task\.js start: --bogus\. Valid flags: --id, --root, --session, --agent/],
  ["a repeated --id", ["--id", "002"], /repeated flag for codex-task\.js start: --id\. Give --id once\.$/],
  ["an empty --agent", ["--agent", ""], /missing value for codex-task\.js start: --agent/],
]) {
  test(`start refuses ${label} and writes nothing`, () => {
    const before = fs.readFileSync(path.join(root, "ROADMAP.jsonl"));
    const result = task("start", "001", args);
    assert.equal(result.status, 1);
    const output = JSON.parse(result.stdout);
    assert.equal(output.ok, false);
    assert.match(output.error, error);
    assert.deepEqual(fs.readFileSync(path.join(root, "ROADMAP.jsonl")), before);
  });
}

// [Foreman: 790] --id takes one value, so a second id is not told to use commas.
test("start refuses a second id after --id without suggesting commas", () => {
  const before = fs.readFileSync(path.join(root, "ROADMAP.jsonl"));
  const result = runNodeScript(path.join(HOOKS_DIR, "codex-task.js"), ["start", "--id", "001", "002", "--root", root, "--session", session], null, { FOREMAN_HOST: "codex" });
  assert.equal(result.status, 1);
  assert.equal(
    JSON.parse(result.stdout).error,
    "unexpected argument for codex-task.js start: 002. --id takes one value: quote one that has spaces. Valid flags: --id, --root, --session, --agent"
  );
  assert.deepEqual(fs.readFileSync(path.join(root, "ROADMAP.jsonl")), before);
});

test("start takes --id=ID", () => {
  const result = runNodeScript(path.join(HOOKS_DIR, "codex-task.js"), ["start", "--id=001", "--root", root, "--session", session], null, { FOREMAN_HOST: "codex" });
  assert.equal(result.status, 0, result.stdout);
  assert.equal(JSON.parse(result.stdout).status, "in_progress");
});

// [Foreman: 760] A duplicated id names neither holder, so the checkpoint
// refuses it the way every roadmap.js write does instead of reading the first.
for (const action of ["start", "check"]) {
  test(`${action} refuses a duplicated id and points to reassign-id`, () => {
    writeRoadmap(root, [{ id: "001", title: "first twin", status: "in_progress" }, { id: "001", title: "second twin", status: "done" }]);
    const result = task(action);
    assert.equal(result.status, 1);
    const output = JSON.parse(result.stdout);
    assert.equal(output.ok, false);
    assert.match(output.error, /held by 2 entries.*reassign-id/);
  });
}

test("Stop blocks an armed check while any holder of a duplicated id is open", () => {
  writeConfig(root, { taskCloseGate: "block" });
  task("check");
  writeRoadmap(root, [{ id: "001", title: "closed twin", status: "done" }, { id: "001", title: "open twin", status: "in_progress" }]);
  assert.equal(hook("stop.js", { hook_event_name: "Stop" }).decision, "block");
});

// [Foreman: 926] Payloads shaped like Codex 0.157.1's (probe 328): the spawn's
// tool_input is {task_name, message}, the message an opaque token; SubagentStop
// names the subagent's rollout, whose first record is session_meta with agent_path.
function spawn(taskName) {
  return hook("codex-spawn.js", { hook_event_name: "PreToolUse", turn_id: "turn", tool_name: "collaborationspawn_agent", tool_input: { task_name: taskName, message: "gAAAAAopaque" } });
}
function subagentStop(agentPath, parent = session, extra = {}) {
  const rollout = path.join(root, `rollout-${crypto.randomUUID()}.jsonl`);
  // The real first record carries the base instructions; keep it past one read chunk.
  const meta = { timestamp: "2026-09-28T00:00:00Z", type: "session_meta", payload: { id: "sub", agent_path: agentPath, parent_thread_id: parent, forked_from_id: parent, thread_source: "subagent", base_instructions: { text: "x".repeat(100 * 1024) } } };
  fs.writeFileSync(rollout, JSON.stringify(meta) + "\n" + JSON.stringify({ type: "response_item" }) + "\n");
  return hook("stop.js", { hook_event_name: "SubagentStop", agent_id: "worker", agent_type: "default", agent_transcript_path: rollout, transcript_path: path.join(root, "parent.jsonl"), last_assistant_message: "done", stop_hook_active: false, ...extra });
}

test("a spawn named foreman or foreman_* must be exactly foreman_<id> for an existing entry", () => {
  for (const name of ["foreman_001_mark", "foreman_999", "foreman", "foreman_1"]) {
    const denied = spawn(name);
    assert.equal(denied.hookSpecificOutput.permissionDecision, "deny", name);
    assert.match(denied.hookSpecificOutput.permissionDecisionReason, /foreman_<id>/);
  }
});

test("a spawn named foreman_<id> for an entry, or outside foreman and foreman_*, passes", () => {
  for (const name of ["foreman_001", "foreman_002", "helper", "foremanship_x", undefined]) assert.equal(spawn(name), null, String(name));
  assert.equal(hook("codex-spawn.js", { hook_event_name: "PreToolUse", tool_name: "Bash", tool_input: { task_name: "foreman_999" } }), null);
  fs.unlinkSync(path.join(root, "ROADMAP.jsonl"));
  assert.equal(spawn("foreman_999"), null);
});

test("a foreman_<id> subagent's finish arms its coordinator's Stop for that entry only, once", () => {
  writeConfig(root, { taskCloseGate: "block" });
  assert.equal(subagentStop("/root/foreman_001"), null);
  const output = hook("stop.js", { hook_event_name: "Stop" });
  assert.equal(output.decision, "block");
  assert.match(output.reason, /001/);
  assert.doesNotMatch(output.reason, /002/);
  assert.equal(hook("stop.js", { hook_event_name: "Stop" }), null);
});

test("a foreman_<id> subagent's continued finish still arms its coordinator", () => {
  writeConfig(root, { taskCloseGate: "block" });
  // Its own check blocked the first SubagentStop, so the second one carries the flag.
  assert.equal(subagentStop("/root/foreman_001", session, { stop_hook_active: true }), null);
  assert.equal(hook("stop.js", { hook_event_name: "Stop" }).decision, "block");
});

test("a nested foreman_<id> subagent arms the subagent that spawned it", () => {
  writeConfig(root, { taskCloseGate: "block" });
  subagentStop("/root/lead/foreman_001", "lead-agent");
  assert.equal(hook("stop.js", { hook_event_name: "Stop" }), null);
  assert.equal(hook("stop.js", { hook_event_name: "SubagentStop", agent_id: "lead-agent" }).decision, "block");
});

test("an unmapped, closed or ungated subagent finish arms nothing", () => {
  subagentStop("/root/foreman_001");
  writeConfig(root, { taskCloseGate: "block" });
  assert.equal(hook("stop.js", { hook_event_name: "Stop" }), null);
  for (const agentPath of ["/root/helper", "/root/foreman_001_mark", ""]) subagentStop(agentPath);
  hook("stop.js", { hook_event_name: "SubagentStop", agent_id: "worker", agent_transcript_path: path.join(root, "missing.jsonl") });
  assert.equal(hook("stop.js", { hook_event_name: "Stop" }), null);
  writeRoadmap(root, [{ id: "001", title: "first", status: "awaiting_acceptance" }]);
  subagentStop("/root/foreman_001");
  assert.equal(hook("stop.js", { hook_event_name: "Stop" }), null);
});

test("Codex registers the spawn guard on the spawn tool only", () => {
  const groups = require(CODEX_HOOKS).hooks.PreToolUse.filter((group) => group.hooks.some((h) => h.command.includes("'codex-spawn.js'")));
  assert.equal(groups.length, 1);
  assert.ok(new RegExp(groups[0].matcher).test("collaborationspawn_agent"));
  for (const tool of ["collaborationwait_agent", "collaborationfollowup_task", "apply_patch", "Bash"]) assert.ok(!new RegExp(groups[0].matcher).test(tool), tool);
});

test("native launcher passes stdin under Windows cmd and PowerShell", { skip: process.platform !== "win32" }, () => {
  const handler = require(CODEX_HOOKS).hooks.PreToolUse[0].hooks[0];
  const input = JSON.stringify({ cwd: root, tool_name: "apply_patch", tool_input: { command: "*** Begin Patch\n*** Delete File: ROADMAP.jsonl\n*** End Patch" } });
  const env = { ...process.env, PLUGIN_ROOT: path.resolve(__dirname, "..") };
  for (const [shell, args] of [["cmd.exe", ["/d", "/s", "/c", `"${handler.commandWindows}"`]], ["powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", handler.commandWindows]]]) {
    // Codex's command_runner uses a raw outer-quoted argument for cmd /C.
    const result = unlessTimedOut(spawnSync(shell, args, { input, env, encoding: "utf-8", timeout: SPAWN_TIMEOUT_MS, windowsHide: true, windowsVerbatimArguments: shell === "cmd.exe" }), `${shell} running the Codex hook`);
    assert.equal(result.status, 0, result.stderr);
    assert.ok(result.stdout.trim(), `${shell}: empty output (${result.stderr})`);
    assert.equal(JSON.parse(result.stdout).hookSpecificOutput.permissionDecision, "deny", shell);
  }
});
