"use strict";

const { test, describe } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");
const skill = fs.readFileSync(path.join(__dirname, "..", "skills", "survey", "SKILL.md"), "utf-8");
const flat = skill.replace(/\s+/g, " ");

describe("survey operational contract", () => {
  test("stale findings require evidence and a finished replacement", () => {
    assert.match(flat, /both evidence .* and a concrete replacement value/);
    assert.match(flat, /complete `what` string or full `planned_touches` array/);
    assert.match(flat, /retaining unaffected paths/);
    assert.match(flat, /not an actionable repair/);
  });
  test("review shows identity, both values, and supporting evidence", () => {
    assert.match(flat, /show id\/title, current → proposed value, and evidence/);
    assert.match(flat, /complete planned-file arrays on both sides/);
  });
  test("only authorized repairs proceed and unrelated findings remain separate", () => {
    assert.match(flat, /request to inspect remains read-only for substantive changes/);
    assert.match(flat, /already explicitly authorized grounded repairs/);
    assert.match(flat, /Do not merge unrelated or uncertain findings into a blanket approval/);
  });
  test("stale-file corrections preserve compare-and-set guards", () => {
    assert.match(flat, /re-read immediately with `roadmap\.js list --ids <id>`/);
    assert.match(flat, /`roadmap\.js correct` with `expected_updated_at`, `expected\.<field>`/);
    assert.match(flat, /`planned_touches` is always the full replacement array/);
    assert.match(flat, /Never overwrite a declined field/);
  });
  test("a changed guard cannot be bypassed to force a write", () => {
    assert.match(flat, /timestamp or expected value changed, re-read and re-show/);
    assert.match(flat, /Never take values from the rejection merely to force a write/);
  });
  test("uncertain findings stay labeled leads without a status rewrite", () => {
    assert.match(flat, /Uncertain findings are never applied as facts/);
    assert.match(flat, /confident:false/);
    assert.match(flat, /survey \(unconfirmed\): <one-line evidence>/);
    assert.match(flat, /Status stays untouched and no field is rewritten/);
    assert.match(flat, /do not reorder the mechanical ranking/);
  });
  test("a declined proposal leaves no persistent refusal breadcrumb", () => {
    assert.match(flat, /a declined proposal writes nothing, including no refusal breadcrumb/);
  });
  test("structural and terminal changes use the existing CLI verbs", () => {
    assert.match(flat, /Hidden dependency: `update-deps`/);
    assert.match(flat, /Already done or duplicate: `update-status`/);
    assert.match(flat, /Do not manufacture a completion SHA/);
    assert.match(flat, /Use `scripts\/roadmap\.js` for all roadmap reads and mutations/);
  });
  test("supplied scopes retain a shared not-done digest", () => {
    assert.match(flat, /Regardless of how scope was chosen/);
    assert.match(flat, /list --status planned,in_progress,awaiting_acceptance,deferred --summary/);
    assert.match(flat, /investigation workers do not fetch the roadmap themselves/);
  });
  test("hidden dependency checks run both directions and missing files can be future work", () => {
    assert.match(flat, /against the supplied not-done digest in both directions/);
    assert.match(flat, /absence alone is not stale scope/);
    assert.match(flat, /unresolved commit means not resolvable here, not fabricated/);
  });
  test("lesson retirement requires contradiction, and pruning is a distinct authorized removal", () => {
    assert.match(flat, /A `stale` label alone does not prove a lesson wrong/);
    assert.match(flat, /`note-supersede`/);
    assert.match(flat, /`note-prune --dry-run`/);
    assert.match(flat, /authorization for that specific removal/);
  });
});