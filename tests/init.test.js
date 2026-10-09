"use strict";

const { test, describe } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");

// init's SKILL.md routes to sibling step files; each pin reads the file that
// holds its text, and a rule that must be absent is checked against all of them.
const DIR = path.join(__dirname, "..", "skills", "init");
const read = (name) => fs.readFileSync(path.join(DIR, name), "utf-8");
const flatten = (text) => text.replace(/\s+/g, " ");
const skill = read("SKILL.md");
const call1 = read("call-1.md");
const call2 = read("call-2.md");
const write = read("write.md");
const all = fs.readdirSync(DIR).filter((name) => name.endsWith(".md")).sort().map(read).join("\n");
const flat = flatten(skill);
const flatCall1 = flatten(call1);
const flatCall2 = flatten(call2);
const flatWrite = flatten(write);
const flatAll = flatten(all);

describe("init skill contract", () => {
  test("stops before clearing when the snapshot fails", () => {
    assert.match(write, /If the snapshot fails, stop before clearing anything/);
    assert.match(flatWrite, /Clear the file only after a verified snapshot, a verified backup, or that explicit continue/);
  });

  // "Nothing to commit" is not a lost roadmap, but only checked bytes and a
  // named revision make an unchanged committed roadmap count as its snapshot.
  test("an unchanged committed roadmap counts only after its bytes are verified", () => {
    assert.match(
      flatWrite,
      /counts as snapshotted once you verify its bytes match `HEAD:ROADMAP\.jsonl` and name that revision/
    );
  });

  test("offers exactly the four recovery options", () => {
    assert.match(flatWrite, /with exactly these four options/);
    assert.match(write, /`Retry the snapshot`/);
    assert.match(write, /`Save a timestamped backup instead`/);
    assert.match(write, /`Continue without a snapshot — the old roadmap is lost`/);
    assert.match(write, /`Cancel` — stop here, change nothing/);
    assert.match(flatWrite, /proceed only when the user picks this option explicitly/);
  });

  test("pins the backup destination and its temporary life", () => {
    assert.ok(write.includes("ROADMAP.jsonl.backup-YYYYMMDD-HHMMSS"));
    assert.ok(write.includes(".foreman/config.json.backup-YYYYMMDD-HHMMSS"));
    assert.match(write, /cp ROADMAP\.jsonl "ROADMAP\.jsonl\.backup-\$\(date \+%Y%m%d-%H%M%S\)"/);
    assert.match(
      write,
      /cp \.foreman\/config\.json "\.foreman\/config\.json\.backup-\$\(date \+%Y%m%d-%H%M%S\)"/
    );
    assert.match(
      write,
      /Copy-Item -LiteralPath ROADMAP\.jsonl -Destination "ROADMAP\.jsonl\.backup-\$\(Get-Date -Format yyyyMMdd-HHmmss\)"/
    );
    assert.match(
      write,
      /Copy-Item -LiteralPath \.foreman\/config\.json -Destination "\.foreman\/config\.json\.backup-\$\(Get-Date -Format yyyyMMdd-HHmmss\)"/
    );
    assert.match(write, /never invent a folder or another name/);
    assert.match(flatWrite, /verify both copies/);
    assert.match(write, /backups stay untracked/);
    assert.match(flatWrite, /they are temporary — the user deletes them/);
  });

  // Naming both paths to `git add` still committed whatever else was already
  // staged, and staged a config init never wrote, so both commits take a
  // pathspec and an untouched config stays out of them.
  test("commits only what init wrote, by pathspec", () => {
    assert.match(write, /git commit -m "chore: snapshot roadmap before foreman re-init" -- ROADMAP\.jsonl/);
    assert.match(
      write,
      /git add -- ROADMAP\.jsonl \.foreman\/config\.json && git commit -m "chore: init foreman roadmap" -- ROADMAP\.jsonl \.foreman\/config\.json/
    );
    assert.doesNotMatch(all, /git commit -m "chore: init foreman roadmap"(?! -- )/);
    assert.match(flatWrite, /never stage or commit an existing config this flow did not change/);
    assert.match(flatWrite, /never a broader `git add`/);
    assert.doesNotMatch(all, /git add -A|git add \.(?:\s|$)/);
    assert.match(flatWrite, /never claim setup was committed or completed when it was not/);
  });

  test("commits respect the user's branch restriction and protected branches", () => {
    assert.match(flatWrite, /Respect any branch restriction the user gave\. Never switch, merge or commit on a protected branch/);
    assert.match(write, /`codex\/<descriptive-name>` in Codex/);
  });

  test("preserves an existing config untouched", () => {
    assert.match(write, /leave it exactly as it is/);
    assert.match(flatWrite, /re-init must not throw away/);
    assert.match(flatWrite, /If the file exists but won't parse, say so in the report-back and change nothing/);
  });

  // A goal drafted from the repository is not the user's own: the data keeps
  // stated work and proposed work apart on both hosts.
  test("source separates stated work from proposed work", () => {
    assert.match(write, /"source":"user"/);
    assert.match(flatWrite, /`source` is `"user"` only for work the user stated/);
    assert.match(flatWrite, /`"claude-suggested"` in Claude Code, `"codex-suggested"` in Codex/);
    assert.doesNotMatch(flatAll, /`source: "user"` for every entry/);
  });

  test("a failed add keeps the entries already written", () => {
    assert.match(flatWrite, /preserve every successful partial add/);
  });

  test("init_started marks the first question, or the write phase when none is asked", () => {
    assert.match(
      flat,
      /At the \*\*first question actually put to the user\*\* — or as the write phase starts, when no question is asked —/
    );
    assert.match(flat, /A skipped question is never logged/);
  });

  test("SKILL.md sends each step to the file that holds it, in order", () => {
    let cursor = -1;
    for (const [heading, file] of [
      ["## Call 1 — project and goals", "call-1.md"],
      ["## Draft phase (no question)", "draft.md"],
      ["## Call 2 — approval", "call-2.md"],
      ["## Write phase", "write.md"],
    ]) {
      const at = skill.indexOf(heading);
      assert.ok(at > cursor, `${heading} missing or out of order`);
      const next = skill.indexOf("\n## ", at + 1);
      const section = skill.slice(at, next < 0 ? undefined : next);
      assert.ok(section.includes(`(${file})`), `${heading} does not read ${file}`);
      cursor = at;
    }
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
    assert.match(call1, /"What is this project\?"/);
    assert.match(call1, /"What are the near-term goals for the roadmap\?"/);
    assert.match(skill, /## Call 2 — approval/);
    assert.match(call2, /"Draft roadmap ready above\. Proceed\?"/);
    assert.doesNotMatch(all, /## Call 2b/);
    assert.doesNotMatch(all, /## Call 3/);
  });

  test("an explicit request answers its own question", () => {
    assert.match(flat, /an explicit user instruction to append or to replace selects that branch\. Otherwise ask/);
    assert.match(flatCall1, /Use a project description or goals the request already gives/);
    assert.match(
      flatCall2,
      /Skip this question only when the user spelled out the tasks themselves — that request authorizes creating them\. Any goal or task you inferred or proposed needs it/
    );
  });

  test("repo-derived proposals are grounded and labeled", () => {
    assert.match(flatCall1, /ground the draft in what is actually there — the README, the manifest, the entry points, `git log` —/);
    assert.match(flatCall1, /which parts came from the repo rather than from the user/);
  });

  test("the policy questions are gone from the interview", () => {
    assert.doesNotMatch(all, /Should the roadmap accept Claude-suggested entries/);
    assert.doesNotMatch(all, /Can this project run Fable 5\?/);
    assert.doesNotMatch(all, /should Foreman keep a short/);
    assert.doesNotMatch(all, /Should Foreman suggest which model and reasoning effort/);
    assert.doesNotMatch(all, /what should Foreman do\?/);
    assert.doesNotMatch(all, /Do other plugins already own the persona/);
    assert.doesNotMatch(all, /Which model|Fable 5/);
  });

  test("the approval covers the config, not only the roadmap", () => {
    assert.match(flatCall2, /approving both files here, not just the roadmap/);
  });
});

describe("init writes safe defaults instead of asking", () => {
  // 1.0: init writes no settings at all. Every default lives in the module
  // that reads it, so restating them in the file only creates a second copy
  // that can drift from the reader — which is exactly what happened before.
  test("the config is written empty only when missing, with no key restated", () => {
    assert.match(flatWrite, /`\.foreman\/config\.json` as `\{\}` only if missing/);
    for (const key of ['usePersona', 'omitSections', 'requireVerification', 'taskCloseGate']) {
      assert.doesNotMatch(all, new RegExp(`"${key}":`), `init still writes ${key} into the config`);
    }
  });

  // Absent is not the same as false here: it is also the record that the
  // user was never asked, which is what makes the later first-relevant ask
  // fire exactly once. Writing the key at init would silence it forever.
  test("leaves the first-relevant keys unwritten", () => {
    assert.match(skill, /`ledger` stays absent/);
    assert.match(flat, /an absent key is the record that the user was never asked/);
    assert.match(flat, /Checkpoint policy is asked the same way, at the first split run/);
    assert.doesNotMatch(all, /"discoverySuggestions": ?(true|false)/);
    assert.doesNotMatch(all, /"ledger": ?\{/);
  });

  test("a re-init must not discard an answer already recorded", () => {
    assert.match(write, /recorded answer to a first-relevant ask[\s\S]{0,120}re-init\s+must not throw away/);
  });

  // [Foreman: 188] The old generation's ids live on in trailers and anchors;
  // an overwrite must continue past them, never restart at 001.
  test("the overwrite branch continues ids past the old roadmap", () => {
    assert.match(write, /"ids_after":"<old max>"/);
    assert.match(flatWrite, /record the old highest id, including archive history/);
    assert.match(write, /must not reuse those ids/);
    assert.doesNotMatch(all, /ids\s+start at `001` again/);
  });
});
