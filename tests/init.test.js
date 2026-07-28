"use strict";

const { test, describe } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");

const skill = fs.readFileSync(path.join(__dirname, "..", "skills", "init", "SKILL.md"), "utf-8");

describe("init skill contract", () => {
  test("stops before clearing when the snapshot fails", () => {
    assert.match(skill, /If the snapshot fails, stop before clearing anything/);
    assert.match(
      skill,
      /Clear the file only after a snapshot that exited 0, a backup that\s+copied, or that explicit continue/
    );
  });

  test("offers exactly the four recovery options", () => {
    assert.match(skill, /with exactly these four\s+options/);
    assert.match(skill, /`Retry the snapshot`/);
    assert.match(skill, /`Save a timestamped backup instead`/);
    assert.match(skill, /`Continue without a snapshot — the old roadmap is lost`/);
    assert.match(skill, /`Cancel` — stop here, change nothing/);
    assert.match(skill, /proceed\s+only when the user picks this option explicitly/);
  });

  test("pins the backup destination and its temporary life", () => {
    assert.match(skill, /cp ROADMAP\.jsonl "ROADMAP\.jsonl\.backup-\$\(date \+%Y%m%d-%H%M%S\)"/);
    assert.match(
      skill,
      /cp \.foreman\/config\.json "\.foreman\/config\.json\.backup-\$\(date \+%Y%m%d-%H%M%S\)"/
    );
    assert.match(skill, /never invent a folder or another name/);
    assert.match(skill, /backups stay untracked/);
    assert.match(skill, /they are temporary — the user\s+deletes them/);
  });

  test("stages only the two files init owns", () => {
    assert.match(skill, /git add ROADMAP\.jsonl \.foreman\/config\.json && git commit/);
    assert.match(skill, /never a broader `git add`/);
    assert.match(skill, /never `git add` \+ commit/);
    assert.doesNotMatch(skill, /git add -A/);
    assert.doesNotMatch(skill, /git add \./);
  });

  test("preserves configuration keys it does not recognize", () => {
    assert.match(skill, /any other key present must survive untouched/);
    assert.match(skill, /the rule is "everything else\s+survives", not a list/);
  });
});
