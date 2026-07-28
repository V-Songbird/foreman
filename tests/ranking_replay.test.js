"use strict";

const { test, describe, beforeEach } = require("node:test");
const assert = require("node:assert/strict");
const {
  makeTmpProject,
  writeRoadmap,
} = require("./helpers");
const {
  criticalDepths,
  candidateComparator,
  replay,
} = require("../benchmarks/picks/ranking-replay");

let project;

function entry(id, depends_on = [], overrides = {}) {
  return {
    id,
    title: `Task ${id}`,
    why: `Why ${id}`,
    what: `What ${id}`,
    status: "planned",
    source: "user",
    depends_on,
    touches: [`src/${id}.js`],
    commits: [],
    created_at: `2026-01-${id}`,
    updated_at: `2026-01-${id}`,
    notes: "",
    ...overrides,
  };
}

beforeEach(() => {
  project = makeTmpProject();
});

describe("critical-depth ranking replay", () => {
  test("computes longest remaining dependent chain without changing production ranking", () => {
    const entries = [
      entry("001"),
      entry("002", ["001"]),
      entry("003", ["002"]),
      entry("004"),
    ];
    const depths = criticalDepths(entries);

    assert.equal(depths.get("001"), 2);
    assert.equal(depths.get("002"), 1);
    assert.equal(depths.get("003"), 0);
    assert.equal(depths.get("004"), 0);
  });

  test("rejects cycles instead of inventing a depth", () => {
    assert.throws(
      () => criticalDepths([entry("001", ["002"]), entry("002", ["001"])]),
      /dependency cycle/
    );
    assert.throws(
      () =>
        criticalDepths([
          entry("001", ["002"], { status: "done" }),
          entry("002", ["001"], { status: "dropped" }),
        ]),
      /dependency cycle/
    );
  });

  test("records when critical depth would choose differently", () => {
    writeRoadmap(project, [
      entry("001"),
      entry("002", ["001"]),
      entry("003", ["001"]),
      entry("004", ["001"]),
      entry("010"),
      entry("011", ["010"]),
      entry("012", ["011"]),
      entry("013", ["012"]),
    ]);

    const result = replay(project);

    assert.equal(result.strategies.current[0], "001");
    assert.equal(result.strategies.depth_first[0], "010");
    assert.deepEqual(result.disagreements, [
      { strategy: "depth_first", current: "001", alternative: "010" },
    ]);
  });

  test("keeps collision avoidance ahead of depth in the late-tiebreaker strategy", () => {
    const candidates = [
      { id: "001", unblocks_total: 4, unblocks: 1, collision: true, critical_depth: 4 },
      { id: "002", unblocks_total: 4, unblocks: 1, collision: false, critical_depth: 1 },
    ];

    candidates.sort(candidateComparator("depth-tiebreaker"));

    assert.equal(candidates[0].id, "002");
  });

  test("is deterministic across repeated replays", () => {
    writeRoadmap(project, [entry("001"), entry("002"), entry("003")]);
    assert.deepEqual(replay(project), replay(project));
  });
});
