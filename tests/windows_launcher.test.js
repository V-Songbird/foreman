"use strict";
const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs"), path = require("node:path"), cp = require("node:child_process");
const { makeTmpProject, writeRoadmap } = require("./helpers");
const { build, main } = require("../scripts/build-windows-launchers");

// Only Codex registrations are encoded launchers. hooks/hooks.json registers
// Claude Code's hooks in exec form, `node` plus one script argument, which
// needs no per-platform string.
const CODEX_HOOKS = path.join(__dirname, "../hooks/codex-hooks.json");

// [Foreman: 345]
test("Claude Code hooks run in exec form with no commandWindows", () => {
  const wiring = JSON.parse(fs.readFileSync(path.join(__dirname, "../hooks/hooks.json"), "utf8"));
  const handlers = Object.values(wiring.hooks).flat().flatMap((group) => group.hooks);
  assert.ok(handlers.length);
  for (const handler of handlers) {
    assert.equal(handler.command, "node", JSON.stringify(handler));
    assert.equal(handler.args.length, 1, JSON.stringify(handler));
    assert.match(handler.args[0], /^\$\{CLAUDE_PLUGIN_ROOT\}\/hooks\/[\w-]+\.js$/);
    assert.ok(fs.existsSync(path.join(__dirname, "../hooks", path.basename(handler.args[0]))), handler.args[0]);
    assert.equal(handler.commandWindows, undefined, JSON.stringify(handler));
  }
});

test("Windows commands match their readable source without changing policy", () => {
  main();
  const source = fs.readFileSync(path.join(__dirname, "../hooks/windows-launcher.ps1"), "utf8");
  const command = build(source, "guard-roadmap-edit.js");
  const decoded = Buffer.from(command.split(" ").at(-1), "base64").toString("utf16le");
  assert.equal(decoded, source.replace(/\r\n/g, "\n").replaceAll("__FOREMAN_HOOK__", "guard-roadmap-edit.js"));
  assert.doesNotMatch(command, /ExecutionPolicy|DevCache/);
  assert.doesNotMatch(decoded, /Set-ExecutionPolicy|ExecutionPolicy\s+Bypass/);
});

test("fnm fallback works without a Node PATH entry", { skip: process.platform !== "win32" }, t => {
  const paths = (process.env.PATH || "").split(path.delimiter);
  const fnmDir = paths.find(dir => fs.existsSync(path.join(dir, "fnm.exe")));
  if (!fnmDir) return t.skip("fnm is not installed on this runner");
  const root = makeTmpProject();
  writeRoadmap(root, [{ id: "001", title: "launcher fixture", status: "planned", depends_on: [] }]);
  const env = { ...process.env, PLUGIN_ROOT: path.resolve(__dirname, ".."), FOREMAN_PROJECT_DIR: root };
  env.PATH = paths.filter(dir => !fs.existsSync(path.join(dir, "node.exe"))).join(path.delimiter);
  delete env.FNM_MULTISHELL_PATH;
  const handler = require(CODEX_HOOKS).hooks.PreToolUse[0].hooks[0];
  const input = JSON.stringify({ cwd: root, tool_name: "apply_patch", tool_input: { command: "*** Begin Patch\n*** Delete File: ROADMAP.jsonl\n*** End Patch" } });
  // [Foreman: 470] cmd.exe, PowerShell and fnm take seconds to start on a
  // loaded machine, so the bound only catches a hang; the assertions are the test.
  const result = cp.spawnSync("cmd.exe", ["/d", "/s", "/c", `"${handler.commandWindows}"`], {
    env, input, encoding: "utf8", windowsVerbatimArguments: true, windowsHide: true, timeout: 120000,
  });
  assert.equal(result.status, 0, result.stderr);
  assert.equal(JSON.parse(result.stdout).hookSpecificOutput.permissionDecision, "deny");
});
