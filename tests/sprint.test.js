"use strict";

const { test, describe, beforeEach } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");
const { spawnSync } = require("child_process");
const { makeTmpProject, writeRoadmap, initGitRepo, runNodeScript } = require("./helpers");
const {
  parseLimit,
  buildPlan,
  MAX_OVERLAP_PATHS,
  touchesOverlap,
  plannedOverlaps,
  repositorySnapshot,
  attestUnit,
} = require("../scripts/sprint");

let project;

// [Foreman: 130] A plan's overlap check reads the PREDICTED surface, so that
// is what the fixture carries.
function entry(id, title, plannedTouches) {
  return {
    id,
    title,
    why: `${title} matters`,
    what: `Implement ${title}`,
    status: "planned",
    source: "user",
    depends_on: [],
    planned_touches: plannedTouches,
    observed_touches: [],
    commits: [],
    created_at: `2026-01-${id}`,
    updated_at: `2026-01-${id}`,
    notes: "",
  };
}

function cleanGitProject() {
  initGitRepo(project);
  spawnSync("git", ["add", "ROADMAP.jsonl"], { cwd: project });
  spawnSync("git", ["commit", "-q", "-m", "roadmap"], { cwd: project });
}

function git(...args) {
  return spawnSync("git", args, {
    cwd: project,
    encoding: "utf-8",
  });
}

beforeEach(() => {
  project = makeTmpProject();
});

describe("sprint planning mechanics", () => {
  test("defaults to three tasks and caps an explicit count at five", () => {
    assert.equal(parseLimit(undefined), 3);
    assert.equal(parseLimit("9"), 5);
    assert.throws(() => parseLimit("0"), /positive integer/);
    assert.throws(() => parseLimit("2tasks"), /positive integer/);
  });

  test("returns a bounded serial plan for a clean idle repository", () => {
    writeRoadmap(project, [
      entry("001", "API", ["src/api.js"]),
      entry("002", "Docs", ["docs/guide.md"]),
    ]);
    cleanGitProject();

    const plan = buildPlan(project, { limit: 2 });

    assert.equal(plan.mode, "serial");
    assert.equal(plan.runnable, true);
    assert.deepEqual(plan.serial.map((item) => item.id), ["001", "002"]);
    assert.equal(plan.has_overlaps, false);
    assert.deepEqual(plan.overlaps, []);
    assert.deepEqual(plan.reasons, []);
  });

  test("reports exact and prefix path overlap without changing serial order", () => {
    const entries = [
      entry("001", "API area", ["src/api"]),
      entry("002", "API client", ["src\\api\\client.js"]),
      entry("003", "Docs", ["docs/guide.md"]),
    ];
    writeRoadmap(project, entries);
    cleanGitProject();

    const plan = buildPlan(project, { limit: 3 });

    assert.equal(touchesOverlap("src/api", "src/api/client.js"), true);
    assert.equal(touchesOverlap("src/api", "src/apiary/client.js"), false);
    assert.deepEqual(plannedOverlaps(entries), [
      {
        ids: ["001", "002"],
        paths: ["src/api", "src/api/client.js"],
      },
    ]);
    assert.equal(plan.has_overlaps, true);
    assert.deepEqual(plan.overlaps, [
      {
        ids: ["001", "002"],
        paths: ["src/api", "src/api/client.js"],
      },
    ]);
    assert.deepEqual(plan.serial.map((item) => item.id), ["001", "002", "003"]);
  });

  test("bounds overlap evidence so a plan stays compact", () => {
    const shared = Array.from(
      { length: MAX_OVERLAP_PATHS + 2 },
      (_, index) => `src/shared-${index}.js`
    );
    const overlaps = plannedOverlaps([
      entry("001", "First", shared),
      entry("002", "Second", shared),
    ]);

    assert.equal(overlaps[0].paths.length, MAX_OVERLAP_PATHS);
    assert.equal(overlaps[0].more_paths, 2);
  });

  test("dirty trees make the plan non-runnable before any task is created", () => {
    writeRoadmap(project, [entry("001", "API", ["src/api.js"]), entry("002", "Docs", ["docs/guide.md"])]);
    cleanGitProject();
    fs.writeFileSync(path.join(project, "dirty.txt"), "local work", "utf-8");

    const plan = buildPlan(project, { limit: 2 });

    assert.equal(plan.repository_clean, false);
    assert.equal(plan.runnable, false);
    assert.deepEqual(plan.serial.map((item) => item.id), ["001", "002"]);
    assert.ok(plan.reasons.includes("working_tree_has_changes"));
  });

  test("existing in-progress work makes the plan non-runnable", () => {
    writeRoadmap(project, [
      entry("001", "Ready", ["src/ready.js"]),
      { ...entry("002", "Started", ["src/started.js"]), status: "in_progress" },
    ]);
    cleanGitProject();

    const plan = buildPlan(project, { limit: 2 });

    assert.equal(plan.runnable, false);
    assert.deepEqual(plan.in_progress, [{ id: "002", title: "Started" }]);
    assert.ok(plan.reasons.includes("existing_work_in_progress"));
  });

  test("CLI returns a compact plan and honors the hard cap", () => {
    writeRoadmap(
      project,
      Array.from({ length: 7 }, (_, index) =>
        entry(String(index + 1).padStart(3, "0"), `Task ${index + 1}`, [`area/${index + 1}`])
      )
    );
    const result = runNodeScript(
      path.join(__dirname, "..", "scripts", "sprint.js"),
      ["plan", "--limit", "20"],
      null,
      { CLAUDE_PROJECT_DIR: project }
    );
    const json = JSON.parse(result.stdout);

    assert.equal(result.status, 0);
    assert.equal(json.ok, true);
    assert.equal(json.limit, 5);
    assert.equal(json.selected.length, 5);
  });
});

describe("sprint skill contract", () => {
  test("keeps one writer, one final acceptance, and schema-checked returns", () => {
    const skill = fs.readFileSync(path.join(__dirname, "..", "skills", "sprint", "SKILL.md"), "utf-8");
    const workflow = fs.readFileSync(
      path.join(__dirname, "..", "skills", "sprint", "workflows", "run-batch.js"),
      "utf-8"
    );

    assert.match(skill, /only roadmap and changelog writer/);
    assert.match(skill, /final acceptance is mandatory/);
    assert.match(skill, /never exceed 5/);
    assert.match(skill, /never edit `ROADMAP\.jsonl` or `CHANGELOG\.md`/);
    assert.match(skill, /"expected_status":"planned"/);
    assert.match(skill, /"require_ready":true/);
    assert.match(skill, /list --ids <id>/);
    assert.match(skill, /Do not fetch all full entries\s+or compose all handoffs up front/);
    assert.match(skill, /latest post-commit tree/);
    assert.match(skill, /`has_overlaps`/);
    assert.match(skill, /scripts\/sprint\.js snapshot/);
    assert.match(skill, /scripts\/sprint\.js attest/);
    assert.match(skill, /execution is strictly serial/);
    assert.match(skill, /For every boundary-valid result that returned a commit/);
    assert.match(skill, /reclassify the result as\s+`failed_verification`/);
    // [Foreman: 131] The fold-back records the state it earned: a
    // re-verified result waits on acceptance, a failed one is still in flight.
    assert.match(skill, /"status":"awaiting_acceptance","commit":"<sha>"/);
    assert.match(skill, /"status":"in_progress","commit":"<sha>"/);
    assert.match(workflow, /RESULT_SCHEMA/);
    assert.match(workflow, /schema: RESULT_SCHEMA/);
    assert.match(workflow, /\^\[0-9a-fA-F\]\{7,64\}\$/);
    assert.doesNotMatch(workflow, /parallel\(/);
    assert.match(workflow, /input\.units\.length !== 1/);
    assert.match(workflow, /additionalProperties: false/);
  });
});

describe("sprint unit attestation", () => {
  function baselineProject() {
    writeRoadmap(project, [entry("001", "Safe unit", ["src/unit.js"])]);
    cleanGitProject();
    return repositorySnapshot(project);
  }

  function commitUnit(files = [["src/unit.js", "module.exports = true;\n"]], trailer = "001") {
    for (const [relative, content] of files) {
      const fullPath = path.join(project, relative);
      fs.mkdirSync(path.dirname(fullPath), { recursive: true });
      fs.writeFileSync(fullPath, content, "utf8");
      git("add", "--", relative);
    }
    const committed = git("commit", "-q", "-m", "Implement unit", "-m", `Foreman: ${trailer}`);
    assert.equal(committed.status, 0, committed.stderr);
    return git("rev-parse", "HEAD").stdout.trim();
  }

  test("proves one direct worker commit, its trailer, files, and clean boundary", () => {
    const snapshot = baselineProject();
    const commit = commitUnit();

    const result = attestUnit(project, {
      entryId: "001",
      baseline: snapshot.head,
      stateHash: snapshot.state_hash,
      commit,
    });

    assert.equal(result.ok, true);
    assert.equal(result.commit_count, 1);
    assert.deepEqual(result.changed_files, ["src/unit.js"]);
    assert.deepEqual(result.trailer_ids, ["001"]);
  });

  test("rejects a returned SHA that is not the new HEAD", () => {
    const snapshot = baselineProject();
    commitUnit();

    const result = attestUnit(project, {
      entryId: "001",
      baseline: snapshot.head,
      stateHash: snapshot.state_hash,
      commit: snapshot.head,
    });

    assert.equal(result.ok, false);
    assert.ok(result.reasons.includes("reported_commit_is_not_head"));
  });

  test("rejects multiple worker commits and a missing matching trailer", () => {
    const snapshot = baselineProject();
    commitUnit([["src/one.js", "one\n"]], "999");
    const commit = commitUnit([["src/two.js", "two\n"]], "999");

    const result = attestUnit(project, {
      entryId: "001",
      baseline: snapshot.head,
      stateHash: snapshot.state_hash,
      commit,
    });

    assert.equal(result.ok, false);
    assert.ok(result.reasons.includes("unit_did_not_create_exactly_one_commit"));
    assert.ok(result.reasons.includes("unit_commit_is_not_directly_on_baseline"));
    assert.ok(result.reasons.includes("exact_foreman_trailer_missing"));
  });

  test("rejects a worker commit that captures a shared ledger", () => {
    const snapshot = baselineProject();
    const commit = commitUnit([["ROADMAP.jsonl", `${fs.readFileSync(path.join(project, "ROADMAP.jsonl"), "utf8")} `]]);

    const result = attestUnit(project, {
      entryId: "001",
      baseline: snapshot.head,
      stateHash: snapshot.state_hash,
      commit,
    });

    assert.equal(result.ok, false);
    assert.deepEqual(result.forbidden_files, ["ROADMAP.jsonl"]);
    assert.ok(result.reasons.includes("shared_ledger_committed_by_worker"));
  });

  test("rejects a worker commit that renames ROADMAP.jsonl", () => {
    const snapshot = baselineProject();
    const moved = git("mv", "ROADMAP.jsonl", "ledger-renamed.jsonl");
    assert.equal(moved.status, 0, moved.stderr);
    const committed = git("commit", "-q", "-m", "Move ledger", "-m", "Foreman: 001");
    assert.equal(committed.status, 0, committed.stderr);
    const commit = git("rev-parse", "HEAD").stdout.trim();

    const result = attestUnit(project, {
      entryId: "001",
      baseline: snapshot.head,
      stateHash: snapshot.state_hash,
      commit,
    });

    assert.equal(result.ok, false);
    assert.ok(result.changed_files.includes("ROADMAP.jsonl"));
    assert.ok(result.reasons.includes("shared_ledger_committed_by_worker"));
  });

  test("rejects a worker commit that renames CHANGELOG.md", () => {
    baselineProject();
    fs.writeFileSync(path.join(project, "CHANGELOG.md"), "# Changes\n", "utf8");
    git("add", "CHANGELOG.md");
    git("commit", "-q", "-m", "Add changelog");
    const snapshot = repositorySnapshot(project);
    const moved = git("mv", "CHANGELOG.md", "history.md");
    assert.equal(moved.status, 0, moved.stderr);
    const committed = git("commit", "-q", "-m", "Move changelog", "-m", "Foreman: 001");
    assert.equal(committed.status, 0, committed.stderr);
    const commit = git("rev-parse", "HEAD").stdout.trim();

    const result = attestUnit(project, {
      entryId: "001",
      baseline: snapshot.head,
      stateHash: snapshot.state_hash,
      commit,
    });

    assert.equal(result.ok, false);
    assert.ok(result.changed_files.includes("CHANGELOG.md"));
    assert.ok(result.reasons.includes("shared_ledger_committed_by_worker"));
  });

  test("rejects non-canonical or extra Foreman trailer lines", () => {
    const snapshot = baselineProject();
    const commit = commitUnit([["src/unit.js", "unit\n"]], "001, 999");

    const result = attestUnit(project, {
      entryId: "001",
      baseline: snapshot.head,
      stateHash: snapshot.state_hash,
      commit,
    });

    assert.equal(result.ok, false);
    assert.ok(result.reasons.includes("exact_foreman_trailer_missing"));
  });

  test("rejects uncommitted or staged leftovers before verification", () => {
    const snapshot = baselineProject();
    const commit = commitUnit();
    fs.writeFileSync(path.join(project, "leftover.txt"), "partial\n", "utf8");

    const result = attestUnit(project, {
      entryId: "001",
      baseline: snapshot.head,
      stateHash: snapshot.state_hash,
      commit,
    });

    assert.equal(result.ok, false);
    assert.equal(result.repository_state_unchanged, false);
    assert.ok(result.reasons.includes("working_tree_or_index_changed"));
  });

  test("detects edits inside an already-dirty coordinator ledger", () => {
    baselineProject();
    fs.appendFileSync(path.join(project, "ROADMAP.jsonl"), "coordinator baseline\n");
    const snapshot = repositorySnapshot(project);
    const commit = commitUnit();
    fs.appendFileSync(path.join(project, "ROADMAP.jsonl"), "worker tampering\n");

    const result = attestUnit(project, {
      entryId: "001",
      baseline: snapshot.head,
      stateHash: snapshot.state_hash,
      commit,
    });

    assert.equal(result.ok, false);
    assert.equal(result.repository_state_unchanged, false);
    assert.ok(result.reasons.includes("working_tree_or_index_changed"));
  });

  test("accepts a clean no-commit boundary for a blocked worker", () => {
    const snapshot = baselineProject();

    const result = attestUnit(project, {
      entryId: "001",
      baseline: snapshot.head,
      stateHash: snapshot.state_hash,
    });

    assert.equal(result.ok, true);
    assert.equal(result.reported_commit, null);
    assert.deepEqual(result.changed_files, []);
  });
});
