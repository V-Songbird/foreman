"use strict";

const { test, describe } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");
const read = (...rel) => fs.readFileSync(path.join(__dirname, "..", ...rel), "utf-8");
const pick = read("skills", "roadmap", "pick.md");
const survey = read("skills", "survey", "SKILL.md");
const entrance = read("skills", "foreman", "SKILL.md");
const destination = read("skills", "roadmap", "destination-question.md");

describe("two confidence modes", () => {
  test("both modes remain discoverable in skills and product documentation", () => {
    for (const [name, text] of [["pick", pick], ["entrance", entrance], ["documentation", read("HOW-IT-WORKS.md")]]) {
      assert.match(text, /Fast pick/, `${name} lacks fast mode`);
      assert.match(text, /Reconcile and pick/, `${name} lacks reconcile mode`);
    }
  });
  test("default pick is mechanical rather than a codebase survey", () => {
    assert.match(pick, /\*\*Fast pick\*\* is the default/);
    assert.match(pick, /does not investigate the codebase/);
    assert.match(pick, /Do not read the full backlog/);
  });
  test("reconcile retains investigate, review, authorized repair, then refreshed ranking", () => {
    assert.match(pick, /investigate → propose → apply → recommend/);
    assert.match(pick, /let its evidence, review, and\s+authorized repairs finish, then refresh the menu/);
  });
  test("near-term scope comes from the single compact menu", () => {
    assert.match(pick, /from one `next-candidates --menu` result/);
    for (const key of ["candidates[].id", "in_progress[].id", "awaiting_acceptance[].id"]) assert.ok(pick.includes(key));
    assert.match(survey, /If the caller supplies ids, those ids are the scope/);
  });
  test("stale or uncertain evidence can offer a survey but never auto-run one", () => {
    assert.match(pick, /more than 30 days/);
    assert.match(pick, /survey \(unconfirmed\):/);
    assert.match(pick, /Age alone never starts a survey/);
    assert.match(entrance, /Run it only when\s+the user requests it/);
  });
  test("all four destination choices remain available", () => {
    for (const option of ["Execute here", "Execute here, split by check",
      "Execute with a background agent", "Copy prompt to clipboard"]) assert.ok(destination.includes(option));
    assert.match(destination, /Preserve all four destinations/);
  });
  test("recommendation uses actual context, parallelism, checks, and clean-tree facts", () => {
    assert.match(destination, /Exactly one option gets `\(Recommended\)`/);
    assert.match(destination, /selected candidate's `collision` is explicitly\s+false/);
    assert.match(destination, /at least two increment rows/i);
    assert.match(destination, /Unknown context is unknown/);
    assert.match(destination, /Do not hide a cautioned option/);
  });
});