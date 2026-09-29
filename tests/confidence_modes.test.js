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
const reconcile = read("skills", "roadmap", "reconcile.md");
const survey = read("skills", "survey", "SKILL.md");
const entrance = read("skills", "foreman", "SKILL.md");
const destination = read("skills", "roadmap", "destination-question.md");
const howItWorks = read("HOW-IT-WORKS.md");

describe("two confidence modes", () => {
  // The README is the plain-language front page; the two pick modes are a
  // mechanism, so they live in HOW-IT-WORKS.md. Both must still name them.
  test("both modes are named, in the roadmap skill and HOW-IT-WORKS.md", () => {
    for (const [name, text] of [
      ["roadmap skill", roadmap],
      ["HOW-IT-WORKS.md", howItWorks],
    ]) {
      assert.match(text, /\*\*Fast pick\*\*/, `${name} does not name Fast pick`);
      assert.match(text, /\*\*Reconcile and pick\*\*/, `${name} does not name Reconcile and pick`);
    }
  });

  test("fast pick is stated as the default, left unchanged, and never rebuilds the ranking", () => {
    assert.match(roadmap, /This is \*\*Fast pick\*\*, the default and the whole of this branch/);
    assert.match(roadmap, /nothing\s+below changes because the other mode exists/);
    // The no-investigation rule is what makes it the cheap mode.
    assert.match(roadmap, /\*\*This branch does not investigate the codebase\. At all\.\*\*/);
    assert.match(roadmap, /Do not read the full\s+backlog/);
  });

  // [Foreman: 353] The deeper mode's steps load only when the user asks for it.
  test("the deeper mode keeps the investigate → propose → apply → recommend order", () => {
    assert.match(roadmap, /When the user asks for it, read \[reconcile\.md\]\(reconcile\.md\)/);
    assert.match(
      reconcile,
      /\*\*investigate → propose → apply → recommend\.\*\*/,
      "the reconcile sequence is not stated in order"
    );
    const steps = ["\\*\\*Investigate\\*\\*", "\\*\\*Propose\\*\\*", "\\*\\*apply\\*\\*", "\\*\\*Recommend\\*\\*"];
    let cursor = -1;
    for (const step of steps) {
      const at = reconcile.slice(cursor + 1).search(new RegExp(step));
      assert.ok(at >= 0, `reconcile step out of order or missing: ${step}`);
      cursor += 1 + at;
    }
    assert.match(reconcile, /It is composition, not a second pick flow/);
    assert.match(reconcile, /let its evidence, review, and\s+authorized repairs finish/);
    assert.match(reconcile, /continue through pick\.md's Fast pick steps\s+exactly as written/);
  });

  test("the near-term set is defined mechanically from one menu call", () => {
    assert.match(
      reconcile,
      /every `candidates\[\]\.id`, plus every\s+`in_progress\[\]\.id`, plus every `awaiting_acceptance\[\]\.id`/
    );
    assert.match(reconcile, /no second call computes it/);
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
    assert.match(roadmap, /age alone never starts a survey/);
    assert.match(roadmap, /survey \(unconfirmed\):` breadcrumb/);
    assert.match(roadmap, /more\s+than \*\*30 days\*\* before today/);
    assert.match(roadmap, /If the user says yes,\s+read \[reconcile\.md\]\(reconcile\.md\) and start at its step 1/);
    // The entrance holds the same rule from its side.
    assert.match(entrance, /the\s+user asks for that or it doesn't happen/);
  });

  test("the entrance names the modes the same way", () => {
    assert.match(entrance, /\*\*pick work\*\* is \*\*Fast pick\*\*, the default confidence mode/);
    assert.match(entrance, /\*\*reconcile and pick\*\* is the other confidence mode, \*\*Reconcile and pick\*\*/);
  });
});

describe("the shared destination question", () => {
  // [Foreman: 353] A pick reads the question only when it asks it, and each
  // destination's steps only when that destination was picked.
  test("a pick reads the question only when it asks it", () => {
    assert.match(roadmap, /When the user already named a\s+destination, use it and skip the question\. Otherwise read\s+\[destination-question\.md\]/);
    const delivery = read("skills", "roadmap", "delivery.md");
    for (const file of ["delivery-split.md", "delivery-agent.md", "delivery-clipboard.md"]) {
      assert.ok(delivery.includes(`](${file})`), `delivery.md does not send its destination to ${file}`);
    }
    assert.match(read("skills", "roadmap", "delivery-split.md"), /A fixed number of tasks the user asked for/);
  });

  // [Foreman: 968] The clipboard step's prompt file must not dirty the tree.
  test("the clipboard prompt file lives in the project's tmp/ and goes after a successful copy", () => {
    const clipboard = read("skills", "roadmap", "delivery-clipboard.md").replace(/\s+/g, " ");
    assert.match(clipboard, /in the project's `tmp\/` directory under a unique name, never in the project root/);
    assert.match(clipboard, /Create `tmp\/` when it is missing/);
    assert.match(clipboard, /delete the file once the copy succeeded/);
    assert.match(clipboard, /put the schema artifact in the same file, after the prompt/);
  });

  test("all four destination choices remain available, in order", () => {
    let cursor = -1;
    for (const option of [
      "- `Execute here` —",
      "- `Execute here, split by check` —",
      "- `Execute with a background agent` —",
      "- `Copy prompt to clipboard` —",
    ]) {
      const at = destination.indexOf(option, cursor + 1);
      assert.ok(at > cursor, `option missing or out of order: ${option}`);
      cursor = at;
    }
    assert.match(destination, /\*\*All four options are always offered, in this order\.\*\*/);
    assert.match(destination, /When the user already named a destination, use it and skip\s+the question/);
  });

  test("the recommendation reads actual context, parallelism, checks, and tree facts", () => {
    assert.match(destination, /Exactly one option carries `\(Recommended\)`/);
    assert.match(destination, /the selected row's `collision` is explicitly `false`/);
    assert.match(destination, /an actual `run` command, not merely a non-empty\s+array/);
    assert.match(destination, /At least two verification rows, each row after the first carrying\s+its\s+own slice of the work/);
    assert.match(destination, /unknown context is\s+unknown/);
    assert.match(destination, /Every option stays selectable/);
  });
});
