"use strict";

const { test, describe } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");

const entrancePath = path.join(__dirname, "..", "skills", "foreman", "SKILL.md");

// [Foreman: 137] One natural-language entrance routes to seven intents. Its
// whole value is that it owns no flow: every intent is handed to the skill
// that already implements it, so these pin the route targets literally and
// pin the absence of any duplicated flow step.
describe("entrance skill contract", () => {
  test("the entrance file exists", () => {
    assert.ok(fs.existsSync(entrancePath), `missing ${entrancePath}`);
  });

  const skill = fs.readFileSync(entrancePath, "utf-8");

  test("names all seven intents", () => {
    for (const intent of [
      "add work",
      "show status",
      "correct work",
      "check the roadmap",
      "pick work",
      "reconcile and pick",
      "run a short batch",
    ]) {
      assert.match(skill, new RegExp(`\\*\\*${intent}\\*\\*`), `intent not named: ${intent}`);
    }
  });

  test("routes each intent at the flow that already owns it", () => {
    assert.match(skill, /`foreman:roadmap` → "Branch: Add a task"/);
    assert.match(skill, /`foreman:roadmap` → "Branch: Review status"/);
    assert.match(skill, /`foreman:roadmap` → "Branch: Correct a task"/);
    assert.match(skill, /`foreman:roadmap` → "Branch: Check the roadmap"/);
    assert.match(skill, /`foreman:roadmap` → "Branch: Pick the next task"/);
    assert.match(
      skill,
      /`foreman:survey` first, then `foreman:roadmap` → "Branch: Pick the next task"/
    );
    assert.match(skill, /`foreman:sprint` \(experimental\)/);
  });

  test("defers instead of duplicating — no flow mechanics live here", () => {
    assert.match(skill, /This skill routes\. It does not add, pick, correct, survey, or batch\s+anything itself/);
    assert.doesNotMatch(skill, /scripts\/roadmap\.js/);
    assert.doesNotMatch(skill, /scripts\/sprint\.js/);
    assert.doesNotMatch(skill, /next-candidates/);
    assert.doesNotMatch(skill, /check-duplicate/);
    assert.doesNotMatch(skill, /expected_updated_at/);
    assert.doesNotMatch(skill, /update-status/);
  });

  test("one clarifying question on ambiguity, out-of-scope names its owner", () => {
    assert.match(skill, /Ask \*\*one\*\* `AskUserQuestion` naming the closest two intents/);
    assert.match(skill, /never a menu of all seven/);
    assert.match(skill, /`foreman:init`/);
    assert.match(skill, /`foreman:craft-prompt`/);
  });
});

describe("specialized skills present as advanced surfaces", () => {
  const read = (name) =>
    fs.readFileSync(path.join(__dirname, "..", "skills", name, "SKILL.md"), "utf-8");

  test("survey is advanced and reached through the entrance", () => {
    assert.match(read("survey"), /Advanced surface, normally reached through the `foreman` entrance/);
  });

  test("sprint keeps its experimental label as an advanced surface", () => {
    assert.match(
      read("sprint"),
      /Experimental advanced surface, normally reached through the `foreman` entrance/
    );
  });

  // [Foreman: 139] Generic prompt construction is an advanced surface, not
  // part of the normal path: the skill must fire only on an explicit ask,
  // and the manifest must lead with the roadmap job instead of prompting.
  test("craft-prompt is framed as advanced and fires only on an explicit ask", () => {
    const skill = read("craft-prompt");
    assert.match(skill, /description: Advanced surface, separate from Foreman's core roadmap job/);
    assert.match(skill, /Trigger only on an explicit request to build or refine a standalone prompt/);
    assert.doesNotMatch(skill, /when_to_use:.*wants to create a task/);
  });

  test("the manifest no longer leads with prompt engineering", () => {
    const manifest = JSON.parse(
      fs.readFileSync(path.join(__dirname, "..", ".claude-plugin", "plugin.json"), "utf-8")
    );
    assert.match(manifest.description, /^Project continuity and roadmap trust/);
    assert.doesNotMatch(manifest.description, /[Pp]rompt-engineering/);
    assert.equal(manifest.keywords[0], "roadmap");
    assert.ok(!manifest.keywords.includes("prompt-engineering"));
  });
});
