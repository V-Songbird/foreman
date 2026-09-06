"use strict";

const { test, describe } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");
const skill = fs.readFileSync(path.join(__dirname, "..", "skills", "init", "SKILL.md"), "utf-8");
const flat = skill.replace(/\s+/g, " ");

// Keep the existing setup/recovery contracts through the host port. These
// inspect documented obligations, not a particular question-tool grammar.
describe("init recovery and ownership", () => {
  test("replacement cannot clear history after a failed snapshot", () => {
    assert.match(flat, /If the snapshot fails, stop before clearing anything/);
    assert.match(flat, /Clear only after a verified snapshot, verified backup, or explicit acceptance of data loss/);
  });
  test("retains retry, backup, explicit data-loss, and cancel alternatives", () => {
    for (const choice of ["Retry the snapshot", "Save a timestamped backup instead",
      "Continue without a snapshot — the old roadmap is lost", "Cancel"]) {
      assert.ok(skill.includes(choice), `missing recovery: ${choice}`);
    }
    assert.match(flat, /proceed only on the user's explicit choice/);
  });
  test("backups preserve both exact artifact destinations and stay temporary", () => {
    assert.ok(skill.includes("ROADMAP.jsonl.backup-YYYYMMDD-HHMMSS"));
    assert.ok(skill.includes(".foreman/config.json.backup-YYYYMMDD-HHMMSS"));
    assert.match(flat, /verify both copies/);
    assert.match(flat, /backups stay untracked and temporary/);
  });
  test("snapshot and final commit cannot sweep unrelated staged files", () => {
    assert.match(skill, /git commit -m "[^"]+" -- ROADMAP\.jsonl/);
    assert.match(flat, /pathspec commit of those files avoids capturing unrelated staged work/);
    assert.doesNotMatch(skill, /git add -A|git add \.(?:\s|$)/);
  });
  test("existing configuration, including prior first-relevant answers, survives", () => {
    assert.match(flat, /leave it exactly as it is/);
    assert.match(flat, /Re-init must not throw away ledger or checkpoint choices/);
    assert.match(flat, /malformed existing config is reported and preserved/);
  });
  test("new ids cannot reuse replaced or archived history", () => {
    assert.match(flat, /old highest id first, including archive history/);
    assert.match(flat, /must not reuse those ids/);
    assert.ok(skill.includes('"ids_after":"<old max>"'));
  });
});

describe("init interview and defaults", () => {
  test("gathers project, near-term goals, and a concrete draft", () => {
    assert.match(flat, /project description and goals/);
    assert.match(flat, /Ground proposals in README, manifests, entrypoints, and recent git history/);
    assert.match(flat, /show the concrete draft and ask/);
    assert.match(flat, /already specified tasks authorizes their creation/);
  });
  test("review covers both artifacts and keeps optional policy questions deferred", () => {
    assert.match(flat, /reviewing both artifacts/);
    assert.match(flat, /ledger and checkpoint-policy choices wait until they matter/);
    assert.doesNotMatch(skill, /Which model|Fable 5|Should Foreman suggest which model/);
  });
  test("new config is empty and never resets the ledger's unanswered state", () => {
    assert.match(skill, /`\.foreman\/config\.json` as `\{\}` only if missing/);
    assert.match(flat, /`ledger` stays absent initially/);
    for (const key of ["usePersona", "omitSections", "requireVerification", "taskCloseGate"]) {
      assert.ok(!skill.includes(`"${key}":`), `init writes a duplicate default for ${key}`);
    }
  });
  test("failure reports partial success rather than inventing completion", () => {
    assert.match(flat, /preserve every successful partial add/);
    assert.match(flat, /never claim setup was committed or completed when it was not/);
  });
});