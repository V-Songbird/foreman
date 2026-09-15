"use strict";

const { test, describe } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");

const skill = fs.readFileSync(path.join(__dirname, "..", "skills", "init", "SKILL.md"), "utf-8");
const flat = skill.replace(/\s+/g, " ");

describe("init skill contract", () => {
  test("stops before clearing when the snapshot fails", () => {
    assert.match(skill, /If the snapshot fails, stop before clearing anything/);
    assert.match(flat, /Clear the file only after a verified snapshot, a verified backup, or that explicit continue/);
  });

  // "Nothing to commit" is not a lost roadmap, but only checked bytes and a
  // named revision make an unchanged committed roadmap count as its snapshot.
  test("an unchanged committed roadmap counts only after its bytes are verified", () => {
    assert.match(
      flat,
      /counts as snapshotted once you verify its bytes match `HEAD:ROADMAP\.jsonl` and name that revision/
    );
  });

  test("offers exactly the four recovery options", () => {
    assert.match(flat, /with exactly these four options/);
    assert.match(skill, /`Retry the snapshot`/);
    assert.match(skill, /`Save a timestamped backup instead`/);
    assert.match(skill, /`Continue without a snapshot — the old roadmap is lost`/);
    assert.match(skill, /`Cancel` — stop here, change nothing/);
    assert.match(flat, /proceed only when the user picks this option explicitly/);
  });

  test("pins the backup destination and its temporary life", () => {
    assert.ok(skill.includes("ROADMAP.jsonl.backup-YYYYMMDD-HHMMSS"));
    assert.ok(skill.includes(".foreman/config.json.backup-YYYYMMDD-HHMMSS"));
    assert.match(skill, /cp ROADMAP\.jsonl "ROADMAP\.jsonl\.backup-\$\(date \+%Y%m%d-%H%M%S\)"/);
    assert.match(
      skill,
      /cp \.foreman\/config\.json "\.foreman\/config\.json\.backup-\$\(date \+%Y%m%d-%H%M%S\)"/
    );
    assert.match(
      skill,
      /Copy-Item -LiteralPath ROADMAP\.jsonl -Destination "ROADMAP\.jsonl\.backup-\$\(Get-Date -Format yyyyMMdd-HHmmss\)"/
    );
    assert.match(
      skill,
      /Copy-Item -LiteralPath \.foreman\/config\.json -Destination "\.foreman\/config\.json\.backup-\$\(Get-Date -Format yyyyMMdd-HHmmss\)"/
    );
    assert.match(skill, /never invent a folder or another name/);
    assert.match(flat, /verify both copies/);
    assert.match(skill, /backups stay untracked/);
    assert.match(flat, /they are temporary — the user deletes them/);
  });

  // Naming both paths to `git add` still committed whatever else was already
  // staged, and staged a config init never wrote, so both commits take a
  // pathspec and an untouched config stays out of them.
  test("commits only what init wrote, by pathspec", () => {
    assert.match(skill, /git commit -m "chore: snapshot roadmap before foreman re-init" -- ROADMAP\.jsonl/);
    assert.match(
      skill,
      /git add -- ROADMAP\.jsonl \.foreman\/config\.json && git commit -m "chore: init foreman roadmap" -- ROADMAP\.jsonl \.foreman\/config\.json/
    );
    assert.doesNotMatch(skill, /git commit -m "chore: init foreman roadmap"(?! -- )/);
    assert.match(flat, /never stage or commit an existing config this flow did not change/);
    assert.match(flat, /never a broader `git add`/);
    assert.doesNotMatch(skill, /git add -A|git add \.(?:\s|$)/);
    assert.match(flat, /never claim setup was committed or completed when it was not/);
  });

  test("commits respect the user's branch restriction and protected branches", () => {
    assert.match(flat, /Respect any branch restriction the user gave\. Never switch, merge or commit on a protected branch/);
    assert.match(skill, /`codex\/<descriptive-name>` in Codex/);
  });

  test("preserves an existing config untouched", () => {
    assert.match(skill, /leave it exactly as it is/);
    assert.match(flat, /re-init must not throw away/);
    assert.match(flat, /If the file exists but won't parse, say so in the report-back and change nothing/);
  });

  // A goal drafted from the repository is not the user's own: the data keeps
  // stated work and proposed work apart on both hosts.
  test("source separates stated work from proposed work", () => {
    assert.match(skill, /"source":"user"/);
    assert.match(flat, /`source` is `"user"` only for work the user stated/);
    assert.match(flat, /`"claude-suggested"` in Claude Code, `"codex-suggested"` in Codex/);
    assert.doesNotMatch(flat, /`source: "user"` for every entry/);
  });

  test("a failed add keeps the entries already written", () => {
    assert.match(flat, /preserve every successful partial add/);
  });

  test("init_started marks the first question, or the write phase when none is asked", () => {
    assert.match(
      flat,
      /At the \*\*first question actually put to the user\*\* — or as the write phase starts, when no question is asked —/
    );
    assert.match(flat, /A skipped question is never logged/);
  });
});

// [Foreman: 136] Initialization is at most three strategy questions, not a
// policy interview. Everything optional is a safe default here and gets asked
// the first time it could matter — so these pin both halves: the questions
// that remain, and the ones that must not come back. A question the request
// already answers is not asked at all.
describe("init asks at most three strategy questions", () => {
  test("project, goals, then draft approval — and nothing after", () => {
    assert.match(skill, /## Call 1 — project and goals/);
    assert.match(skill, /"What is this project\?"/);
    assert.match(skill, /"What are the near-term goals for the roadmap\?"/);
    assert.match(skill, /## Call 2 — approval/);
    assert.match(skill, /"Draft roadmap ready above\. Proceed\?"/);
    assert.doesNotMatch(skill, /## Call 2b/);
    assert.doesNotMatch(skill, /## Call 3/);
  });

  test("an explicit request answers its own question", () => {
    assert.match(flat, /an explicit user instruction to append or to replace selects that branch\. Otherwise ask/);
    assert.match(flat, /Use a project description or goals the request already gives/);
    assert.match(
      flat,
      /Skip this question only when the user spelled out the tasks themselves — that request authorizes creating them\. Any goal or task you inferred or proposed needs it/
    );
  });

  test("repo-derived proposals are grounded and labeled", () => {
    assert.match(flat, /ground the draft in what is actually there — the README, the manifest, the entry points, `git log` —/);
    assert.match(flat, /which parts came from the repo rather than from the user/);
  });

  test("the policy questions are gone from the interview", () => {
    assert.doesNotMatch(skill, /Should the roadmap accept Claude-suggested entries/);
    assert.doesNotMatch(skill, /Can this project run Fable 5\?/);
    assert.doesNotMatch(skill, /should Foreman keep a short/);
    assert.doesNotMatch(skill, /Should Foreman suggest which model and reasoning effort/);
    assert.doesNotMatch(skill, /what should Foreman do\?/);
    assert.doesNotMatch(skill, /Do other plugins already own the persona/);
    assert.doesNotMatch(skill, /Which model|Fable 5/);
  });

  test("the approval covers the config, not only the roadmap", () => {
    assert.match(flat, /approving both files here, not just the roadmap/);
  });
});

describe("init writes safe defaults instead of asking", () => {
  // 1.0: init writes no settings at all. Every default lives in the module
  // that reads it, so restating them in the file only creates a second copy
  // that can drift from the reader — which is exactly what happened before.
  test("the config is written empty only when missing, with no key restated", () => {
    assert.match(flat, /`\.foreman\/config\.json` as `\{\}` only if missing/);
    for (const key of ['usePersona', 'omitSections', 'requireVerification', 'taskCloseGate']) {
      assert.doesNotMatch(skill, new RegExp(`"${key}":`), `init still writes ${key} into the config`);
    }
  });

  // Absent is not the same as false here: it is also the record that the
  // user was never asked, which is what makes the later first-relevant ask
  // fire exactly once. Writing the key at init would silence it forever.
  test("leaves the first-relevant keys unwritten", () => {
    assert.match(skill, /`ledger` stays absent/);
    assert.match(flat, /an absent key is the record that the user was never asked/);
    assert.match(flat, /Checkpoint policy is asked the same way, at the first split run/);
    assert.doesNotMatch(skill, /"discoverySuggestions": ?(true|false)/);
    assert.doesNotMatch(skill, /"ledger": ?\{/);
  });

  test("a re-init must not discard an answer already recorded", () => {
    assert.match(skill, /recorded answer to a first-relevant ask[\s\S]{0,120}re-init\s+must not throw away/);
  });

  // [Foreman: 188] The old generation's ids live on in trailers and anchors;
  // an overwrite must continue past them, never restart at 001.
  test("the overwrite branch continues ids past the old roadmap", () => {
    assert.match(skill, /"ids_after":"<old max>"/);
    assert.match(flat, /record the old highest id, including archive history/);
    assert.match(skill, /must not reuse those ids/);
    assert.doesNotMatch(skill, /ids\s+start at `001` again/);
  });
});
