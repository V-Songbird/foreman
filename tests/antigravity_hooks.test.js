"use strict";

// Antigravity's contract for Foreman, driven the way that host drives it: one
// process per event, the call nested under toolCall with PascalCase arguments,
// one JSON answer per run. hooks/antigravity-hook.js runs the shared hooks as
// children with FOREMAN_HOST pinned, so these also pin the wording those hooks
// choose for this host, and the registration and manifest it ships under.

const { test, describe, beforeEach } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const { makeTmpProject, writeRoadmap, initGitRepo, commitFile, runNodeScript, HOOKS_DIR } = require("./helpers");
const { HOSTS, detectHost } = require("../scripts/runtime");
const { resolveHost, readCanonical } = require("../scripts/check-prompt");
const { discoveryInstructions } = require("../scripts/discovery");

const ROOT = path.resolve(__dirname, "..");
const ENTRY = path.join(HOOKS_DIR, "antigravity-hook.js");
const read = (file) => JSON.parse(fs.readFileSync(path.join(ROOT, file), "utf-8"));

let project;
let conversation;
beforeEach(() => {
  project = makeTmpProject();
  conversation = crypto.randomUUID();
});

function run(event, payload = {}, env = {}) {
  const result = runNodeScript(ENTRY, [event], { conversationId: conversation, workspacePaths: [project], ...payload }, env);
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stderr, "");
  return result.stdout ? JSON.parse(result.stdout) : "";
}
const call = (name, args, extra = {}) => ({ toolCall: { name, args }, stepIdx: 1, ...extra });
const inProject = (...segments) => path.join(project, ...segments);

describe("the Antigravity manifest and registration", () => {
  test("the root manifest agrees with the other two and selects no portable loader", () => {
    const root = read("plugin.json");
    const claude = read(".claude-plugin/plugin.json");
    assert.equal(root.name, "foreman");
    assert.equal(root.version, claude.version);
    assert.equal(root.description, claude.description);
    assert.equal(root.$schema, undefined, "a root $schema selects a portable loader that drops hooks on Codex");
    assert.deepEqual({ name: root.author.name, email: root.author.email }, { name: claude.author.name, email: claude.author.email });
  });

  test("the root registration carries the three events this host has, each launching the entrypoint", () => {
    const hooks = read("hooks.json");
    assert.deepEqual(Object.keys(hooks), ["foreman"]);
    assert.deepEqual(Object.keys(hooks.foreman).sort(), ["PostToolUse", "PreInvocation", "PreToolUse"]);
    for (const [event, groups] of Object.entries(hooks.foreman)) {
      for (const group of groups) {
        for (const hook of group.hooks) {
          assert.equal(hook.type, "command");
          assert.equal(hook.command, `node ./hooks/antigravity-hook.js ${event}`);
          assert.ok(Number.isInteger(hook.timeout) && hook.timeout > 0, "timeouts are whole seconds");
        }
      }
    }
    const matches = (event, tool) => new RegExp(hooks.foreman[event][0].matcher).test(tool);
    for (const tool of ["write_to_file", "replace_file_content", "multi_replace_file_content"]) {
      assert.ok(matches("PreToolUse", tool) && matches("PostToolUse", tool), tool);
    }
    assert.ok(matches("PostToolUse", "run_command") && matches("PostToolUse", "view_file"));
    assert.ok(!matches("PreToolUse", "run_command"), "the roadmap guard never parses shell writes");
    assert.ok(fs.existsSync(ENTRY));
  });
});

describe("host detection and the prompt form", () => {
  test("Antigravity's markers select it, and Codex's own markers outrank them", () => {
    assert.ok(HOSTS.has("antigravity"));
    assert.equal(detectHost({ ANTIGRAVITY_CONVERSATION_ID: "c" }), "antigravity");
    assert.equal(detectHost({ ANTIGRAVITY_AGENT: "1" }), "antigravity");
    assert.equal(detectHost({ ANTIGRAVITY_AGENT: "1", CODEX_THREAD_ID: "t" }), "codex");
    assert.equal(detectHost({ FOREMAN_HOST: "antigravity", CODEX_THREAD_ID: "t" }), "antigravity");
    assert.equal(detectHost({}), "claude");
  });

  test("a handoff for Antigravity takes the Codex form", () => {
    assert.equal(resolveHost("antigravity"), "codex");
    assert.equal(readCanonical("antigravity").host, "codex");
    assert.throws(() => resolveHost("gemini"), /host must be one of/);
  });
});

describe("PreToolUse guards the roadmap stores", () => {
  beforeEach(() => writeRoadmap(project, []));

  test("a write_to_file of ROADMAP.jsonl is denied in Antigravity's shape", () => {
    const out = run("PreToolUse", call("write_to_file", { TargetFile: inProject("ROADMAP.jsonl"), CodeContent: "{}" }));
    assert.equal(out.decision, "deny");
    assert.match(out.reason, /direct Write of ROADMAP\.jsonl is blocked/);
    assert.match(out.reason, /roadmap\.js/);
  });

  test("replace_file_content and multi_replace_file_content are read as edits", () => {
    const single = run("PreToolUse", call("replace_file_content", { TargetFile: inProject(".foreman", "notes.jsonl"), TargetContent: "a", ReplacementContent: "b" }));
    assert.equal(single.decision, "deny");
    assert.match(single.reason, /notes\.jsonl/);
    const multi = run("PreToolUse", call("multi_replace_file_content", { TargetFile: inProject("ROADMAP.jsonl"), ReplacementChunks: [] }));
    assert.equal(multi.decision, "deny");
  });

  test("any other file, a shell command and a project without a roadmap are allowed out loud", () => {
    assert.deepEqual(run("PreToolUse", call("write_to_file", { TargetFile: inProject("src", "index.js"), CodeContent: "" })), { decision: "allow" });
    assert.deepEqual(run("PreToolUse", call("run_command", { CommandLine: "echo ROADMAP.jsonl", Cwd: project })), { decision: "allow" });
    fs.unlinkSync(inProject("ROADMAP.jsonl"));
    assert.deepEqual(run("PreToolUse", call("write_to_file", { TargetFile: inProject("ROADMAP.jsonl"), CodeContent: "" })), { decision: "allow" });
  });

  test("without a workspace, the file's own directory locates the project", () => {
    const out = run("PreToolUse", { ...call("write_to_file", { TargetFile: inProject("ROADMAP.jsonl") }), workspacePaths: [] });
    assert.equal(out.decision, "deny");
  });

  test("an inherited Claude Code project root never captures an Antigravity call", () => {
    const other = makeTmpProject();
    writeRoadmap(other, []);
    fs.unlinkSync(inProject("ROADMAP.jsonl"));
    const out = run("PreToolUse", call("write_to_file", { TargetFile: inProject("ROADMAP.jsonl") }), { CLAUDE_PROJECT_DIR: other });
    assert.deepEqual(out, { decision: "allow" });
  });
});

describe("PreInvocation carries the session notice once, in this host's words", () => {
  test("open entries are announced on the first model call of a conversation only", () => {
    writeRoadmap(project, [{ id: "001", title: "Ship the thing", status: "in_progress" }]);
    const first = run("PreInvocation", { invocationNum: 0 });
    assert.equal(first.injectSteps.length, 1);
    const notice = first.injectSteps[0].ephemeralMessage;
    assert.match(notice, /\[Foreman\] Roadmap entries still open: 001/);
    assert.match(notice, /ask Foreman to resume, accept, or review\./);
    assert.doesNotMatch(notice, /foreman:roadmap/);
    assert.deepEqual(run("PreInvocation", { invocationNum: 1 }), {});
  });

  test("a project with nothing open, or no roadmap, injects nothing", () => {
    assert.deepEqual(run("PreInvocation", { invocationNum: 0 }), {});
    writeRoadmap(project, [{ id: "001", title: "a", status: "planned" }]);
    conversation = crypto.randomUUID();
    assert.deepEqual(run("PreInvocation", { invocationNum: 0 }), {});
  });
});

describe("PostToolUse answers nothing and queues context for the next model call", () => {
  beforeEach(() => {
    initGitRepo(project);
    writeRoadmap(project, [{ id: "001", title: "Ship the thing", status: "in_progress", planned_touches: ["src/a.js"] }]);
    run("PreInvocation", { invocationNum: 0 }); // consume the session notice
  });

  test("a commit queues the status block and the shared discovery policy", () => {
    commitFile(project, "src/a.js", "one\n");
    const command = call("run_command", { CommandLine: "git commit -m 'ship'", Cwd: project }, { modelName: "gemini" });
    assert.deepEqual(run("PostToolUse", command), {});
    const next = run("PreInvocation", { invocationNum: 3 });
    assert.equal(next.injectSteps.length, 1);
    const text = next.injectSteps[0].ephemeralMessage;
    assert.match(text, /^\[Foreman\] A git commit command was invoked\. This hook cannot reliably observe this host's exit status/);
    assert.match(text, /This commit may complete an in-progress ROADMAP\.jsonl task \(001/);
    assert.doesNotMatch(text, /AskUserQuestion/);
    assert.ok(text.includes(discoveryInstructions()), "Antigravity reads the discovery policy Codex reads");
    assert.deepEqual(run("PreInvocation", { invocationNum: 4 }), {}, "the queue drains once");
  });

  test("a failed command and a command that is not a commit queue nothing", () => {
    commitFile(project, "src/a.js", "one\n");
    assert.deepEqual(run("PostToolUse", call("run_command", { CommandLine: "git commit -m x", Cwd: project }, { error: "exit 1" })), {});
    assert.deepEqual(run("PostToolUse", call("run_command", { CommandLine: "git status", Cwd: project })), {});
    assert.deepEqual(run("PreInvocation", { invocationNum: 1 }), {});
  });

  test("viewing a file with a decision anchor queues its documents", () => {
    fs.mkdirSync(inProject("docs", "foreman"), { recursive: true });
    fs.writeFileSync(inProject("docs", "foreman", "001.md"), "decision");
    fs.mkdirSync(inProject("src"), { recursive: true });
    fs.writeFileSync(inProject("src", "a.js"), "// [Foreman: 001]\n");
    assert.deepEqual(run("PostToolUse", call("view_file", { AbsolutePath: inProject("src", "a.js") })), {});
    const next = run("PreInvocation", { invocationNum: 2 });
    assert.match(next.injectSteps[0].ephemeralMessage, /decision docs \(docs\/foreman\/001\.md\)/);
  });
});

describe("malformed input and unknown events", () => {
  test("no conversation means allow, nothing to inject and nothing to bookkeep", () => {
    for (const raw of ["", "{", "null", "[]", "42", "{}", '{"workspacePaths":["x"]}']) {
      for (const [event, expected] of [["PreToolUse", { decision: "allow" }], ["PreInvocation", {}], ["PostToolUse", {}]]) {
        const result = runNodeScript(ENTRY, [event], raw, {});
        assert.equal(result.status, 0, result.stderr);
        assert.deepEqual(JSON.parse(result.stdout), expected, `${event} on ${JSON.stringify(raw)}`);
      }
    }
    const unknown = runNodeScript(ENTRY, ["Stop"], { conversationId: conversation }, {});
    assert.equal(unknown.status, 0);
    assert.equal(unknown.stdout, "");
  });
});
