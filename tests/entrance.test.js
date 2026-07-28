"use strict";

const { test, describe } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");

const entrancePath = path.join(__dirname, "..", "skills", "foreman", "SKILL.md");

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
    assert.match(skill, /never a menu of all six/);
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
});
