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
    assert.match(skill, /the new path in place of the old one, retaining unaffected paths/);
    assert.match(skill, /a \*\*rewritten\s+`what`\*\*/);
  });

  test("every proposal is shown with current value, proposed value, and evidence", () => {
    assert.match(skill, /before asking or applying it: the entry's \*\*id and title\*\*, the \*\*current value →\s+proposed value\*\*, and the \*\*evidence line\(s\)\*\*/);
    assert.match(skill, /Show\s+`planned_touches` in full on both sides/);
  });

  test("approval is per finding and never one blanket yes", () => {
    assert.match(skill, /\*\*Approval is per finding\.\*\*/);
    assert.match(
      skill,
      /Ask one question per entry: `AskUserQuestion`\s+in Claude Code; in Codex, the picker in \[questions\.md\]\(\.\.\/foreman\/questions\.md\)/
    );
    assert.match(skill, /each field is its own choice; in Claude Code, use `multiSelect`/);
    assert.match(skill, /Batch at most a handful of entries into one question/);
    assert.match(skill, /\*\*Never\s+offer a single blanket "apply everything"\*\*/);
  });

  test("an inspection stays read-only and only an explicit authorization skips the question", () => {
    assert.match(skill, /request to inspect remains read-only for substantive changes/);
    assert.match(
      skill,
      /already explicitly authorized applying grounded repairs, apply those within\s+that scope without asking for the same authorization again/
    );
  });

  test("approved description and planned-file repairs go through correct", () => {
    assert.match(skill, /apply it with `correct`, the one command that can replace\s+`what`\/`planned_touches` on a live entry/);
    assert.match(skill, /roadmap\.js correct/);
    assert.match(skill, /"expected_updated_at":"<the updated_at that read just returned>"/);
    assert.match(skill, /roadmap\.js list --ids <candidate>`\s+— re-read the entry immediately before writing/);
    assert.match(skill, /a field the user declined is simply absent from both/);
    assert.match(skill, /`planned_touches` is sent as the whole\s+replacement array/);
  });

  test("a stale-guard rejection is re-read and re-asked, never forced through", () => {
    assert.match(skill, /If the script refuses with `was last updated … , not …`/);
    assert.match(skill, /`… no longer matches expected\.<field>`/);
    assert.match(skill, /\*\*Re-read\s+\(1\), re-show current → proposed against the newer text, and ask\s+again\*\*/);
    assert.match(skill, /Never re-send with\s+the `updated_at` from the error message to force it through/);
  });

  test("uncertain findings are annotated as unconfirmed, never applied", () => {
    assert.match(skill, /\*\*Uncertain findings are never applied\.\*\*/);
    assert.match(skill, /`confident: false`/);
    assert.match(skill, /"notes":"survey \(unconfirmed\): <one-line evidence>"/);
    assert.match(skill, /status untouched, no field rewritten/);
    assert.match(skill, /Explain that such notes inform future prompts\s+but do not reorder the mechanical ranking/);
  });

  test("a declined proposal writes nothing at all", () => {
    assert.match(skill, /\*\*A declined proposal writes nothing\.\*\*/);
    assert.match(skill, /No note, no refusal breadcrumb,\s+no status change/);
    assert.doesNotMatch(skill, /Claude proposed/);
    assert.match(skill, /Never write on an unconfirmed finding/);
  });

  test("keeps the existing structural and terminal write paths", () => {
    assert.match(skill, /\*\*`hidden-dependency`\*\* → on confirm:[\s\S]*roadmap\.js update-deps/);
    assert.match(skill, /\*\*`already-done` \/ `duplicate`\*\* → on confirm:[\s\S]*roadmap\.js update-status/);
    assert.match(skill, /"status":"dropped","notes":"survey: <one-line evidence>"/);
    assert.match(skill, /Do not manufacture a completion SHA/);
    assert.match(skill, /Use `\$\{CLAUDE_PLUGIN_ROOT\}\/scripts\/roadmap\.js` for all roadmap reads and\s+mutations/);
    assert.match(skill, /never touch `ROADMAP\.jsonl`\s+directly/);
    assert.match(skill, /send it the way \[the shared runtime\]\(\.\.\/foreman\/runtime\.md\)\s+describes rather than inside shell quotes/);
  });

  test("step 1 keeps existence and commit facts mechanical", () => {
    assert.match(skill, /`\/foreman:init` in Claude Code; in\s+Codex, \[the init skill\]\(\.\.\/init\/SKILL\.md\)/);
    assert.match(skill, /Refuse paths outside the project before reading them/);
    assert.match(skill, /so absence alone is not stale scope/);
  });

  test("step 1 collects a not-done digest on both scoping paths", () => {
    assert.match(skill, /gathered once regardless of which path above set\s+the scope/);
    assert.match(
      skill,
      /\*\*not-done digest\*\* — `id`, `title`, `planned_touches` for\s+every entry currently `planned`, `in_progress`, `awaiting_acceptance`, or\s+`deferred`/
    );
    assert.match(
      skill,
      /roadmap\.js list --status\s+planned,in_progress,awaiting_acceptance,deferred --summary/
    );
  });

  test("step 2 gives each candidate one read-only investigator on either host", () => {
    assert.match(skill, /In Claude Code, dispatch one\s+`Agent` \(`subagent_type: Explore`\) per candidate, in parallel/);
    assert.match(skill, /In Codex, use available collaboration\s+subagents for independent candidates, limiting concurrency to actual\s+capacity/);
    assert.match(skill, /If delegation is unavailable or there is only one small candidate,\s+investigate locally/);
    assert.match(skill, /Collect every result before claiming the survey\s+complete/);
  });

  test("step 2 context supplies the not-done digest instead of a self-serve roadmap read", () => {
    assert.match(
      skill,
      /The \*\*not-done digest\*\* from step 1 — `id`\/`title`\/`planned_touches` for\s+every other not-done entry/
    );
    assert.match(skill, /it does\s+not read `ROADMAP\.jsonl` to get it/);
  });

  test("an unresolved dependency commit is flagged without being called fabricated", () => {
    assert.match(skill, /an unresolved commit means not resolvable here, not\s+fabricated/);
  });

  test("checks 3 and 4 reference the supplied digest, not a self-serve roadmap read", () => {
    assert.match(
      skill,
      /something that another entry in the \*\*supplied not-done digest\*\* claims\s+via its own `planned_touches`/
    );
    assert.match(skill, /Check against the digest handed to you, not a fresh\s+`ROADMAP\.jsonl` read/);
    assert.match(skill, /Report every relation you can see in either\s+direction, including one you can see but cannot pin to a line/);
    assert.match(
      skill,
      /does it closely overlap another entry's\s+`title` in the supplied not-done digest/
    );
    assert.match(skill, /Do not treat a similar title\s+alone as proof/);
  });

  test("lesson retirement requires contradiction, and pruning is a distinct authorized removal", () => {
    assert.match(skill, /\*\*A stale label on its own is not a finding\.\*\*/);
    assert.match(skill, /roadmap\.js note-supersede/);
    assert.match(skill, /roadmap\.js note-prune --dry-run/);
    assert.match(skill, /Show the count and ask once, unless the\s+user already explicitly asked to prune that set/);
  });

  test("reconcile and pick gets the results before it refreshes its menu", () => {
    assert.match(skill, /return these results to the pick flow before it\s+refreshes its menu/);
  });

  test("the trial log counts each question interaction the user sees", () => {
    assert.match(
      skill,
      /One event per interaction, never one per question: one `AskUserQuestion` call\s+in Claude Code, however many questions it batches; one picker call or one\s+plain-text question in Codex/
    );
    assert.match(skill, /A skipped question is never logged/);
  });
});
