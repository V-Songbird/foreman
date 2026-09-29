"use strict";
const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs"), path = require("node:path"), cp = require("node:child_process");
const { makeTmpProject, writeRoadmap, SPAWN_TIMEOUT_MS, unlessTimedOut } = require("./helpers");
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
  const decoded = Buffer.from(command.match(/-EncodedCommand ([^\s)]+)\) else node /)[1], "base64").toString("utf16le");
  assert.equal(decoded, source.replace(/\r\n/g, "\n").replaceAll("__FOREMAN_HOOK__", "guard-roadmap-edit.js"));
  assert.doesNotMatch(command, /ExecutionPolicy|DevCache/);
  assert.doesNotMatch(decoded, /Set-ExecutionPolicy|ExecutionPolicy\s+Bypass/);
});

// [Foreman: 809] Codex may start commandWindows from a PowerShell parent, and
// Windows PowerShell writes progress records to a redirected stderr as CLIXML.
// A preload logs one line per Node start, which proves every hook ran.
const onPath = exe => (process.env.PATH || "").split(path.delimiter).some(dir => fs.existsSync(path.join(dir, exe)));
for (const parent of ["powershell.exe", "pwsh.exe"]) {
  test(`every Codex hook leaves stderr empty under ${parent}`, { skip: process.platform !== "win32" || !onPath(parent) }, () => {
    const root = makeTmpProject();
    writeRoadmap(root, [{ id: "001", title: "launcher fixture", status: "planned", depends_on: [] }]);
    const log = path.join(root, "starts.log"), preload = path.join(root, "log-start.cjs");
    fs.writeFileSync(preload, `require("fs").appendFileSync(${JSON.stringify(log)}, "start\\n");\n`);
    const env = { ...process.env, PLUGIN_ROOT: path.resolve(__dirname, ".."), FOREMAN_PROJECT_DIR: root,
      NODE_OPTIONS: `--require "${preload.replace(/\\/g, "/")}"` };
    const events = Object.entries(require(CODEX_HOOKS).hooks).flatMap(([event, groups]) => groups.flatMap(group => group.hooks.map(handler => [event, handler])));
    const timeout = Math.max(120000, SPAWN_TIMEOUT_MS);
    for (const [event, handler] of events) {
      const result = unlessTimedOut(cp.spawnSync(parent, ["-NoLogo", "-NoProfile", "-NonInteractive", "-Command", handler.commandWindows], {
        env, input: JSON.stringify({ hook_event_name: event, cwd: root }), encoding: "utf8", windowsHide: true, timeout,
      }), `${event} under ${parent}`, timeout);
      assert.equal(result.status, 0, result.stderr);
      assert.equal(result.stderr, "", `${event} under ${parent}`);
    }
    assert.equal(fs.readFileSync(log, "utf8").split("\n").filter(Boolean).length, events.length);
  });
}

// [Foreman: 957] cmd searches the working directory before PATH unless
// NoDefaultCurrentDirectoryInExePath is set, so a project's node.exe must
// never run in place of Node, nor hide a missing Node from the fnm fallback.
// A copy of whoami.exe stands in for it.
test("a node.exe in the hook's working directory never runs", { skip: process.platform !== "win32" }, () => {
  const root = makeTmpProject();
  writeRoadmap(root, [{ id: "001", title: "launcher fixture", status: "planned", depends_on: [] }]);
  fs.copyFileSync(path.join(process.env.SystemRoot || "C:\\Windows", "System32", "whoami.exe"), path.join(root, "node.exe"));
  const env = { ...process.env, PLUGIN_ROOT: path.resolve(__dirname, ".."), FOREMAN_PROJECT_DIR: root };
  delete env.NoDefaultCurrentDirectoryInExePath;
  const paths = (process.env.PATH || "").split(path.delimiter);
  const envs = { "Node on PATH": env };
  if (paths.some(dir => fs.existsSync(path.join(dir, "fnm.exe")))) {
    envs["no Node on PATH"] = { ...env, PATH: paths.filter(dir => !fs.existsSync(path.join(dir, "node.exe"))).join(path.delimiter) };
    delete envs["no Node on PATH"].FNM_MULTISHELL_PATH;
  }
  const handler = require(CODEX_HOOKS).hooks.PreToolUse[0].hooks[0];
  const input = JSON.stringify({ cwd: root, tool_name: "apply_patch", tool_input: { command: "*** Begin Patch\n*** Delete File: ROADMAP.jsonl\n*** End Patch" } });
  const timeout = Math.max(120000, SPAWN_TIMEOUT_MS);
  for (const [label, runEnv] of Object.entries(envs)) {
    const result = unlessTimedOut(cp.spawnSync("cmd.exe", ["/d", "/s", "/c", `"${handler.commandWindows}"`], {
      cwd: root, env: runEnv, input, encoding: "utf8", windowsHide: true, windowsVerbatimArguments: true, timeout,
    }), `the Codex Windows launcher beside a node.exe, ${label}`, timeout);
    assert.equal(result.status, 0, `${label}: ${result.stderr}`);
    assert.equal(result.stderr, "", label);
    assert.equal(JSON.parse(result.stdout).hookSpecificOutput.permissionDecision, "deny", label);
  }
});

// [Foreman: 959] A hook that exits nonzero must still hand Codex its code.
// [Foreman: 963] Its stderr must reach Codex too. A stand-in hook writes to
// stderr and exits 3.
test("a Codex hook's nonzero exit code and stderr survive its Windows command", { skip: process.platform !== "win32" }, () => {
  const root = makeTmpProject();
  fs.mkdirSync(path.join(root, "hooks"));
  const handler = require(CODEX_HOOKS).hooks.PreToolUse[0].hooks[0];
  fs.writeFileSync(path.join(root, "hooks", handler.command.match(/'hooks','([a-z-]+\.js)'/)[1]), "exports.main = () => { process.stderr.write('hook failed'); process.exit(3); };\n");
  const timeout = Math.max(120000, SPAWN_TIMEOUT_MS);
  const result = unlessTimedOut(cp.spawnSync("cmd.exe", ["/d", "/s", "/c", `"${handler.commandWindows}"`], {
    cwd: root, env: { ...process.env, PLUGIN_ROOT: root }, input: "{}", encoding: "utf8", windowsHide: true, windowsVerbatimArguments: true, timeout,
  }), "a hook exiting 3 under cmd.exe", timeout);
  assert.equal(result.status, 3, result.stderr);
  assert.equal(result.stderr, "hook failed");
});

// [Foreman: 814] The PowerShell-parent tests above find Node on PATH, which
// never writes progress records; only the fnm fallback does, so it runs under
// both parents.
const launchers = {
  "cmd.exe": command => [["/d", "/s", "/c", `"${command}"`], { windowsVerbatimArguments: true }],
  "powershell.exe": command => [["-NoLogo", "-NoProfile", "-NonInteractive", "-Command", command], {}],
};
for (const [parent, launch] of Object.entries(launchers)) {
  test(`fnm fallback works without a Node PATH entry under ${parent}`, { skip: process.platform !== "win32" || !onPath(parent) }, t => {
    const paths = (process.env.PATH || "").split(path.delimiter);
    const fnmDir = paths.find(dir => fs.existsSync(path.join(dir, "fnm.exe")));
    if (!fnmDir) return t.skip("fnm is not installed on this runner");
    const root = makeTmpProject();
    writeRoadmap(root, [{ id: "001", title: "launcher fixture", status: "planned", depends_on: [] }]);
    const env = { ...process.env, PLUGIN_ROOT: path.resolve(__dirname, ".."), FOREMAN_PROJECT_DIR: root };
    env.PATH = paths.filter(dir => !fs.existsSync(path.join(dir, "node.exe"))).join(path.delimiter);
    delete env.FNM_MULTISHELL_PATH;
    // [Foreman: 809] A cold module analysis cache makes the fnm fallback write
    // "Preparing modules for first use" progress records unless they are silenced.
    env.PSModuleAnalysisCachePath = path.join(root, "module-analysis-cache");
    const handler = require(CODEX_HOOKS).hooks.PreToolUse[0].hooks[0];
    const input = JSON.stringify({ cwd: root, tool_name: "apply_patch", tool_input: { command: "*** Begin Patch\n*** Delete File: ROADMAP.jsonl\n*** End Patch" } });
    // [Foreman: 470] cmd.exe, PowerShell and fnm take seconds to start on a
    // loaded machine, so the bound only catches a hang; the assertions are the test.
    const timeout = Math.max(120000, SPAWN_TIMEOUT_MS);
    const [args, options] = launch(handler.commandWindows);
    const result = unlessTimedOut(cp.spawnSync(parent, args, {
      ...options, env, input, encoding: "utf8", windowsHide: true, timeout,
    }), `the Codex Windows launcher under ${parent}`, timeout);
    assert.equal(result.status, 0, result.stderr);
    assert.equal(result.stderr, "");
    assert.equal(JSON.parse(result.stdout).hookSpecificOutput.permissionDecision, "deny");
  });
}
