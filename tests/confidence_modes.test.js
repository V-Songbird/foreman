"use strict";

const { test, describe } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");

// [Foreman: 141] Two confidence modes, named the way PRODUCT-STRATEGY.md
// names them: Fast pick is the default cheap recommendation, Reconcile and
// pick is the explicit deeper pass that repairs first. The deeper one is
// composition — a scoped survey, then the normal pick — so these pin the
// sequence, the scoping hook, and the never-auto-run rule rather than any
// new mechanism.
const read = (...rel) => fs.readFileSync(path.join(__dirname, "..", ...rel), "utf-8");

const roadmap = read("skills", "roadmap", "pick.md");
const survey = read("skills", "survey", "SKILL.md");
const entrance = read("skills", "foreman", "SKILL.md");
const readme = read("README.md");

describe("two confidence modes", () => {
  test("both modes are named, in the roadmap skill and the README", () => {
    for (const [name, text] of [
      ["roadmap skill", roadmap],
      ["README", readme],
    ]) {
      assert.match(text, /\*\*Fast pick\*\*/, `${name} does not name Fast pick`);
      assert.match(text, /\*\*Reconcile and pick\*\*/, `${name} does not name Reconcile and pick`);
    }
  });

  test("fast pick is stated as the default and left unchanged", () => {
    assert.match(roadmap, /This is \*\*Fast pick\*\*, the default and the whole of this branch/);
    assert.match(roadmap, /nothing\s+below changes because the other mode exists/);
    // The no-investigation rule is what makes it the cheap mode.
    assert.match(roadmap, /\*\*This branch does not investigate the codebase\. At all\.\*\*/);
  });

  test("the deeper mode keeps the investigate → propose → apply → recommend order", () => {
    assert.match(
      roadmap,
      /\*\*investigate → propose → apply →\s+recommend\.\*\*/,
      "the reconcile sequence is not stated in order"
    );
    const steps = ["\\*\\*Investigate\\*\\*", "\\*\\*Propose\\*\\*", "\\*\\*apply\\*\\*", "\\*\\*Recommend\\*\\*"];
    let cursor = -1;
    for (const step of steps) {
      const at = roadmap.slice(cursor + 1).search(new RegExp(step));
      assert.ok(at >= 0, `reconcile step out of order or missing: ${step}`);
      cursor += 1 + at;
    }
    assert.match(roadmap, /It is composition, not a second pick flow/);
  });

  test("the near-term set is defined mechanically from one menu call", () => {
    assert.match(
      roadmap,
      /every `candidates\[\]\.id`, plus every\s+`in_progress\[\]\.id`, plus every `awaiting_acceptance\[\]\.id`/
    );
    assert.match(roadmap, /no second call computes it/);
  });

  test("survey takes a handed-over set of ids as its scope", () => {
    assert.match(survey, /If a caller handed over a set of ids, that set \*\*is\*\* the scope/);
    assert.match(survey, /\*\*Reconcile and pick\*\*'s near-term set/);
    assert.match(survey, /skip\s+the `next-candidates` call below/);
    // Scoping must not fork the finding/approval/apply machinery.
    assert.match(survey, /steps 2–4 run exactly as\s+written/);
  });

  test("the deeper mode is offered in one line and never auto-run", () => {
    assert.match(roadmap, /\*\*Offering it from Fast pick — one line, never a run\.\*\*/);
    assert.match(roadmap, /Never as a blocking question, never started on your own/);
    assert.match(roadmap, /survey \(unconfirmed\):` breadcrumb/);
    assert.match(roadmap, /more\s+than \*\*30 days\*\* before today/);
    // The entrance holds the same rule from its side.
    assert.match(entrance, /the\s+user asks for that or it doesn't happen/);
  });

  test("the entrance names the modes the same way", () => {
    assert.match(entrance, /\*\*pick work\*\* is \*\*Fast pick\*\*, the default confidence mode/);
    assert.match(entrance, /\*\*reconcile and pick\*\* is the other confidence mode, \*\*Reconcile and pick\*\*/);
  });
});
