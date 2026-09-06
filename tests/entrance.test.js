"use strict";

const { test, describe } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");
const root = path.join(__dirname, "..");
const read = (name) => fs.readFileSync(path.join(root, "skills", name, "SKILL.md"), "utf-8");
const entrance = read("foreman");

// These are product routing contracts. They do not claim to evaluate model
// behavior; CLI invariants and an independent scenario exercise cover that.
describe("entrance skill contract", () => {
  const routes = {
    "add work": "add.md",
    "show status": "status.md",
    "correct work": "correct.md",
    "check the roadmap": "doctor.md",
    "pick work": "pick.md",
    "reconcile and pick": "../survey/SKILL.md",
  };
  for (const [intent, target] of Object.entries(routes)) {
    test(`routes ${intent} to an existing owner`, () => {
      const row = entrance.split("\n").find((line) => line.includes(`**${intent}**`));
      assert.ok(row, `missing intent: ${intent}`);
      assert.ok(row.includes(target), `missing route: ${target}`);
      assert.ok(fs.existsSync(path.resolve(root, "skills", "roadmap", target)));
    });
  }

  test("entrance delegates mechanics and resolves genuine ambiguity", () => {
    assert.doesNotMatch(entrance, /scripts\/roadmap\.js|next-candidates|check-duplicate|expected_updated_at/);
    assert.match(entrance, /two intents[\s\S]*ask one concise/);
    assert.ok(entrance.includes("../init/SKILL.md"));
    assert.ok(entrance.includes("../craft-prompt/SKILL.md"));
  });

  test("specialized surfaces keep their activation boundaries", () => {
    assert.match(read("survey"), /advanced code\s+investigation/);
    assert.match(read("survey"), /fast pick or old roadmap alone does not trigger/i);
    assert.match(read("craft-prompt"), /explicit prompt-crafting request/);
    assert.match(read("craft-prompt"), /ordinary\s+implementation request does not/);
  });

  test("Codex manifest leads with roadmap continuity", () => {
    const manifest = JSON.parse(fs.readFileSync(path.join(root, ".codex-plugin", "plugin.json"), "utf-8"));
    assert.equal(manifest.name, "foreman");
    assert.match(manifest.description, /continuity|roadmap/i);
    assert.doesNotMatch(manifest.description, /^prompt engineering/i);
    assert.ok(fs.existsSync(path.resolve(root, manifest.skills)));
  });
});

describe("Codex skill package", () => {
  const names = ["foreman", "roadmap", "init", "survey", "craft-prompt"];
  for (const name of names) {
    test(`${name} is discoverable and references existing resources`, () => {
      const skillDir = path.join(root, "skills", name);
      const skill = read(name);
      assert.match(skill, new RegExp(`^---\\r?\\nname: ${name}\\r?\\ndescription: .+\\r?\\n---`));
      assert.doesNotMatch(skill, /^(when_to_use|allowed-tools|argument-hint):/m);
      assert.doesNotMatch(skill, /\$\{(?:CLAUDE|CODEX)_PLUGIN_ROOT\}|AskUserQuestion|TaskCreate|TaskUpdate|subagent_type/);
      const yaml = fs.readFileSync(path.join(skillDir, "agents", "openai.yaml"), "utf-8");
      assert.match(yaml, /interface:\s+display_name: ".+"/);
      const blurb = yaml.match(/short_description: "([^"]+)"/);
      assert.ok(blurb && blurb[1].length >= 25 && blurb[1].length <= 64);
      for (const link of skill.matchAll(/\[[^\]]+\]\(([^)]+)\)/g)) {
        if (/^[a-z]+:/i.test(link[1])) continue;
        assert.ok(fs.existsSync(path.resolve(skillDir, link[1].split("#")[0])), `broken link ${link[1]}`);
      }
    });
  }

  test("shared runtime preserves capability, acceptance, and branch boundaries", () => {
    const runtime = fs.readFileSync(path.join(root, "skills", "foreman", "runtime.md"), "utf-8");
    assert.match(runtime, /Create a new\s+sidebar task only when the user explicitly requests one/);
    assert.match(runtime, /exit 0 and `dispatchReady:true`/);
    assert.match(runtime, /requireVerification[\s\S]*awaiting_acceptance/);
    assert.match(runtime, /Never switch,\s+merge, or commit on a protected branch/);
    assert.match(runtime, /model and\s+reasoning settings unless the user chose/);
  });
});