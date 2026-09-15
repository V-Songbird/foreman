"use strict";

const { test, describe } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");

const root = path.join(__dirname, "..");
const SKILLS = path.join(root, "skills");
const SKILL_NAMES = ["foreman", "roadmap", "init", "survey", "craft-prompt"];
const read = (name) => fs.readFileSync(path.join(SKILLS, name, "SKILL.md"), "utf-8");
const entrancePath = path.join(SKILLS, "foreman", "SKILL.md");
const manifest = (dir) => JSON.parse(fs.readFileSync(path.join(root, dir, "plugin.json"), "utf-8"));

function markdownFiles(dir) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) return markdownFiles(full);
    return entry.name.endsWith(".md") ? [full] : [];
  });
}

// [Foreman: 137] One natural-language entrance routes to six intents. Its
// whole value is that it owns no flow: every intent is handed to the skill
// that already implements it, so these pin the route targets literally and
// pin the absence of any duplicated flow step.
describe("entrance skill contract", () => {
  test("the entrance file exists", () => {
    assert.ok(fs.existsSync(entrancePath), `missing ${entrancePath}`);
  });

  const skill = fs.readFileSync(entrancePath, "utf-8");

  test("names all six intents", () => {
    for (const intent of [
      "add work",
      "show status",
      "correct work",
      "check the roadmap",
      "pick work",
      "reconcile and pick",
    ]) {
      assert.match(skill, new RegExp(`\\*\\*${intent}\\*\\*`), `intent not named: ${intent}`);
    }
  });

  const routes = {
    "add work": ["Add a task", "add.md"],
    "show status": ["Review status", "status.md"],
    "correct work": ["Correct a task", "correct.md"],
    "check the roadmap": ["Check the roadmap", "doctor.md"],
    "pick work": ["Pick the next task", "pick.md"],
    "reconcile and pick": ["Pick the next task", "pick.md"],
  };
  for (const [intent, [branch, file]] of Object.entries(routes)) {
    test(`routes ${intent} to the branch and the file that own it`, () => {
      const row = skill.split("\n").find((line) => line.includes(`| **${intent}** |`));
      assert.ok(row, `missing intent row: ${intent}`);
      assert.ok(row.includes(`\`foreman:roadmap\` → "Branch: ${branch}"`), `missing branch route: ${intent}`);
      assert.ok(row.includes(`(../roadmap/${file})`), `missing file link: ${intent}`);
      assert.ok(fs.existsSync(path.join(SKILLS, "roadmap", file)));
    });
  }

  // [Foreman: 141] Reconcile and pick is the pick branch's own composition: it
  // takes the near-term set from its menu and hands it to the survey, so the
  // entrance routes to pick and never sequences the survey itself.
  test("reconcile and pick goes to the pick branch, which runs the survey first", () => {
    const row = skill.split("\n").find((line) => line.includes("| **reconcile and pick** |"));
    assert.ok(row.includes("(../survey/SKILL.md)"));
    assert.match(skill, /The pick branch owns that\s+sequence/);
    assert.doesNotMatch(skill, /`foreman:survey` first, then/);
  });

  test("defers instead of duplicating — no flow mechanics live here", () => {
    assert.match(skill, /This skill routes\. It does not add, pick, correct, or survey anything\s+itself/);
    assert.doesNotMatch(skill, /scripts\/roadmap\.js/);
    assert.doesNotMatch(skill, /next-candidates/);
    assert.doesNotMatch(skill, /check-duplicate/);
    assert.doesNotMatch(skill, /expected_updated_at/);
    assert.doesNotMatch(skill, /update-status/);
  });

  test("one clarifying question on ambiguity, out-of-scope names its owner", () => {
    assert.match(skill, /When two intents fit and the distinction changes the work, ask one concise\s+question naming the closest two intents/);
    assert.match(skill, /`AskUserQuestion` in Claude Code, the picker in \[questions\.md\]\(questions\.md\) in\s+Codex/);
    assert.match(skill, /Never a menu of all six/);
    assert.match(skill, /`foreman:init` \(\[init\]\(\.\.\/init\/SKILL\.md\)\)/);
    assert.match(skill, /`foreman:craft-prompt` \(\[craft-prompt\]\(\.\.\/craft-prompt\/SKILL\.md\)\)/);
  });
});

describe("specialized skills present as advanced surfaces", () => {
  test("survey is advanced, reached through the entrance, and never fired by age", () => {
    const survey = read("survey");
    assert.match(survey, /Advanced surface, normally reached through the `foreman` entrance/);
    assert.match(survey, /advanced code\s+investigation/);
    assert.match(survey, /fast pick or old roadmap alone does not trigger/i);
  });

  // [Foreman: 139] Generic prompt construction is an advanced surface, not
  // part of the normal path: the skill must fire only on an explicit ask,
  // and the manifests must lead with the roadmap job instead of prompting.
  test("craft-prompt is framed as advanced and fires only on an explicit ask", () => {
    const skill = read("craft-prompt");
    assert.match(skill, /description: "Advanced surface, separate from Foreman's core roadmap job/);
    assert.match(skill, /Trigger only on an explicit request to build or refine a standalone prompt/);
    assert.match(skill, /explicit prompt-crafting request/);
    assert.match(skill, /ordinary\s+implementation request does not/);
    assert.doesNotMatch(skill, /when_to_use:.*wants to create a task/);
  });
});

describe("one package for Claude Code and Codex", () => {
  test("both manifests lead with roadmap continuity, not prompt engineering", () => {
    const claude = manifest(".claude-plugin");
    const codex = manifest(".codex-plugin");
    for (const m of [claude, codex]) {
      assert.equal(m.name, "foreman");
      assert.match(m.description, /^Project continuity.*roadmap/);
      assert.doesNotMatch(m.description, /[Pp]rompt[- ]engineering/);
    }
    assert.equal(claude.keywords[0], "roadmap");
    assert.ok(!claude.keywords.includes("prompt-engineering"));
  });

  test("both manifests carry the same release version", () => {
    const claude = manifest(".claude-plugin");
    const codex = manifest(".codex-plugin");
    assert.match(codex.version, /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/, "the version is strict semver");
    assert.equal(claude.version, codex.version, "Claude Code and Codex install the same version");
  });

  test("the Codex manifest points at the shared skills and its own hook registration", () => {
    const codex = manifest(".codex-plugin");
    assert.equal(codex.skills, "./skills/");
    assert.equal(codex.hooks, "./hooks/codex-hooks.json");
    assert.ok(fs.existsSync(path.resolve(root, codex.skills)));
    assert.ok(fs.existsSync(path.resolve(root, codex.hooks)));
    assert.ok(fs.existsSync(path.join(root, "hooks", "hooks.json")), "Claude Code's registration is missing");
  });

  for (const name of SKILL_NAMES) {
    test(`${name} has frontmatter both hosts parse and the shared host note`, () => {
      const skill = read(name);
      const block = skill.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n/);
      assert.ok(block, "missing frontmatter");
      const fields = {};
      for (const line of block[1].split(/\r?\n/)) {
        const m = line.match(/^([a-z_-]+): (.*)$/);
        assert.ok(m, `not a single-line key: ${line}`);
        fields[m[1]] = m[2];
      }
      assert.deepEqual(
        Object.keys(fields).filter((key) => !["name", "description", "when_to_use", "argument-hint", "allowed-tools"].includes(key)),
        [],
        "unknown frontmatter key"
      );
      assert.equal(fields.name, name);
      // Codex parses the frontmatter as YAML; an unquoted value holding ": " is invalid there.
      const quoted = /^"(?:[^"\\]|\\["\\/bfnrt]|\\u[0-9a-fA-F]{4})*"$/;
      for (const key of ["description", "when_to_use", "argument-hint"]) {
        if (fields[key] !== undefined) assert.match(fields[key], quoted, `${key} must be one double-quoted string`);
      }
      if (fields["allowed-tools"] !== undefined) assert.match(fields["allowed-tools"], /^[A-Za-z]+(, [A-Za-z]+)*$/);
      const description = JSON.parse(fields.description);
      assert.ok(description.length <= 1024, "description too long for Codex");
      assert.doesNotMatch(description, /[<>]/, "Codex rejects angle brackets in a description");
      assert.match(skill, /Foreman runs in Claude Code and in Codex\. Every step applies to both unless it names a host\./);
      assert.match(skill, /\[the shared runtime\]\((?:\.\.\/foreman\/)?runtime\.md\)/);
    });

    test(`${name} keeps its Codex interface metadata`, () => {
      const yaml = fs.readFileSync(path.join(SKILLS, name, "agents", "openai.yaml"), "utf-8");
      assert.match(yaml, /interface:\s+display_name: ".+"/);
      const blurb = yaml.match(/short_description: "([^"]+)"/);
      assert.ok(blurb && blurb[1].length >= 25 && blurb[1].length <= 64);
    });
  }

  test("every relative link in the skills resolves, and no invented root variable appears", () => {
    for (const file of markdownFiles(SKILLS)) {
      const text = fs.readFileSync(file, "utf-8");
      assert.doesNotMatch(text, /\$\{CODEX_PLUGIN_ROOT\}/, `${file} names a variable no host defines`);
      for (const link of text.matchAll(/\[[^\]]+\]\(([^)\s]+)\)/g)) {
        if (/^[a-z]+:/i.test(link[1]) || link[1].startsWith("#")) continue;
        const target = path.resolve(path.dirname(file), link[1].split("#")[0]);
        assert.ok(fs.existsSync(target), `broken link ${link[1]} in ${path.relative(root, file)}`);
      }
    }
  });

  test("the shared runtime states each host's capability, acceptance, and branch boundaries", () => {
    const runtime = fs.readFileSync(path.join(SKILLS, "foreman", "runtime.md"), "utf-8");
    assert.match(runtime, /`\$\{CLAUDE_PLUGIN_ROOT\}` in a command means Foreman's plugin root/);
    assert.match(runtime, /In Codex, resolve it from the loaded skill's actual location/);
    assert.match(runtime, /`FOREMAN_PROJECT_DIR`, then\s+`CODEX_CWD`, then `CLAUDE_PROJECT_DIR`, then the shell working directory/);
    assert.match(runtime, /Never interpolate\s+user-written text into a shell command/);
    assert.match(runtime, /Create a new\s+sidebar task only when the user explicitly requests one/);
    assert.match(runtime, /exit 0 and `dispatchReady:true`/);
    assert.match(runtime, /requireVerification[\s\S]*awaiting_acceptance/);
    assert.match(runtime, /Never switch,\s+merge, or commit on a protected branch/);
    assert.match(runtime, /model and\s+reasoning settings unless the user chose/);
    assert.match(runtime, /Never call `mcp__ccd_session__spawn_task`/);
  });
});
