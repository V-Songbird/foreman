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

  test("preserves an existing config untouched", () => {
    assert.match(skill, /leave it exactly as it is/);
    assert.match(skill, /re-init\s+must not throw away/);
  });
});

// [Foreman: 136] Initialization is three strategy questions, not a policy
// interview. Everything optional is a safe default here and gets asked the
// first time it could matter — so these pin both halves: the questions that
// remain, and the ones that must not come back.
describe("init asks three strategy questions", () => {
  test("project, goals, then draft approval — and nothing after", () => {
    assert.match(skill, /## Call 1 — project and goals/);
    assert.match(skill, /"What is this project\?"/);
    assert.match(skill, /"What are the near-term goals for the roadmap\?"/);
    assert.match(skill, /## Call 2 — approval/);
    assert.match(skill, /"Draft roadmap ready above\. Proceed\?"/);
    assert.doesNotMatch(skill, /## Call 2b/);
    assert.doesNotMatch(skill, /## Call 3/);
  });

  test("the policy questions are gone from the interview", () => {
    assert.doesNotMatch(skill, /Should the roadmap accept Claude-suggested entries/);
    assert.doesNotMatch(skill, /Can this project run Fable 5\?/);
    assert.doesNotMatch(skill, /should Foreman keep a short/);
    assert.doesNotMatch(skill, /Should Foreman suggest which model and reasoning effort/);
    assert.doesNotMatch(skill, /what should Foreman do\?/);
    assert.doesNotMatch(skill, /Do other plugins already own the persona/);
  });

  test("the approval covers the config, not only the roadmap", () => {
    assert.match(skill, /approving both files here, not just the roadmap/);
  });
});

describe("init writes safe defaults instead of asking", () => {
  // 1.0: init writes no settings at all. Every default lives in the module
  // that reads it, so restating them in the file only creates a second copy
  // that can drift from the reader — which is exactly what happened before.
  test("the config is written empty, with no key restated", () => {
    assert.match(skill, /`\.foreman\/config\.json` as `\{\}`/);
    for (const key of ['usePersona', 'omitSections', 'requireVerification', 'taskCloseGate', 'fableEnabled']) {
      assert.doesNotMatch(skill, new RegExp(`"${key}": `), `init still writes ${key} into the config`);
    }
  });

  // Absent is not the same as false here: it is also the record that the
  // user was never asked, which is what makes the later first-relevant ask
  // fire exactly once. Writing the key at init would silence it forever.
  test("leaves the first-relevant keys unwritten", () => {
    assert.match(skill, /`discoverySuggestions` and `decisionLog` stay absent/);
    assert.match(skill, /an absent key is the record that the user was never\s+asked/);
    assert.doesNotMatch(skill, /"discoverySuggestions": (true|false)/);
    assert.doesNotMatch(skill, /"decisionLog": \{/);
  });

  test("a re-init must not discard an answer already recorded", () => {
    assert.match(skill, /recorded answer to a first-relevant ask[\s\S]{0,120}re-init\s+must not throw away/);
  });

  // [Foreman: 188] The old generation's ids live on in trailers and anchors;
  // an overwrite must continue past them, never restart at 001.
  test("the overwrite branch continues ids past the old roadmap", () => {
    assert.match(skill, /"ids_after":"<old max>"/);
    assert.match(skill, /must not reuse those ids/);
    assert.doesNotMatch(skill, /ids\s+start at `001` again/);
  });
});
