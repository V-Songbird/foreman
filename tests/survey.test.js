"use strict";

const { test, describe } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");

const skill = fs.readFileSync(path.join(__dirname, "..", "skills", "survey", "SKILL.md"), "utf-8");

describe("survey skill contract", () => {
  test("stale findings must carry evidence and a concrete replacement value", () => {
    assert.match(skill, /`stale-description` \| `stale-touches`/);
    assert.match(skill, /the \*\*evidence\*\* — the file paths and\s+symbols it actually opened, and what it found there instead/);
    assert.match(
      skill,
      /\*\*concrete proposed replacement value\*\*, a finished `what` string or a\s+complete `planned_touches` array, ready to be written as-is/
    );
    assert.match(skill, /A vague "this looks\s+stale" is not a finding of this kind/);
    assert.match(skill, /\*\*whole corrected `planned_touches` array\*\*/);
    assert.match(skill, /a \*\*rewritten\s+`what`\*\*/);
  });

  test("every proposal is shown with current value, proposed value, and evidence", () => {
    assert.match(skill, /the entry's \*\*id and title\*\*, the \*\*current value →\s+proposed value\*\*, and the \*\*evidence line\(s\)\*\*/);
    assert.match(skill, /Show\s+`planned_touches` in full on both sides/);
  });

  test("approval is per finding and never one blanket yes", () => {
    assert.match(skill, /\*\*Approval is per finding\.\*\*/);
    assert.match(skill, /One `AskUserQuestion` per entry, using\s+`multiSelect`/);
    assert.match(skill, /Batch at most a handful of entries into one question/);
    assert.match(skill, /\*\*Never\s+offer a single blanket "apply everything"\*\*/);
  });

  test("approved description and planned-file repairs go through correct", () => {
    assert.match(skill, /apply it with `correct`, the one command that can replace\s+`what`\/`planned_touches` on a live entry/);
    assert.match(skill, /roadmap\.js correct/);
    assert.match(skill, /"expected_updated_at":"<the updated_at that read just returned>"/);
    assert.match(skill, /roadmap\.js list --ids <candidate>`\s+— re-read the entry immediately before writing/);
    assert.match(skill, /`planned_touches` is sent as the whole\s+replacement array/);
  });

  test("a stale-guard rejection is re-read and re-asked, never forced through", () => {
    assert.match(skill, /If the script refuses with `was last updated … , not …`/);
    assert.match(skill, /\*\*Re-read\s+\(1\), re-show current → proposed against the newer text, and ask\s+again\*\*/);
    assert.match(skill, /Never re-send with\s+the `updated_at` from the error message to force it through/);
  });

  test("uncertain findings are annotated as unconfirmed, never applied", () => {
    assert.match(skill, /\*\*Uncertain findings are never applied\.\*\*/);
    assert.match(skill, /`confident: false`/);
    assert.match(skill, /"notes":"survey \(unconfirmed\): <one-line evidence>"/);
    assert.match(skill, /status untouched, no field rewritten/);
  });

  test("a declined proposal writes nothing at all", () => {
    assert.match(skill, /\*\*A declined proposal writes nothing\.\*\*/);
    assert.match(skill, /No note, no "Claude proposed\s+this and the user said no" breadcrumb, no status change/);
    assert.match(skill, /Never write on an unconfirmed finding/);
  });

  test("keeps the existing structural and terminal write paths", () => {
    assert.match(skill, /\*\*`hidden-dependency`\*\* → on confirm:[\s\S]*roadmap\.js update-deps/);
    assert.match(skill, /\*\*`already-done` \/ `duplicate`\*\* → on confirm:[\s\S]*roadmap\.js update-status/);
    assert.match(skill, /never touch `ROADMAP\.jsonl`\s+directly/);
  });
});
