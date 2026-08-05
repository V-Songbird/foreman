"use strict";

// [Foreman: 142] The roadmap-health benchmark: the six metrics derivable from
// the files, the --date determinism the report depends on, and the trial-log
// rates (which are real analysis over a format nothing writes yet).

const fs = require("fs");
const path = require("path");
const { test, describe, beforeEach } = require("node:test");
const assert = require("node:assert/strict");
const {
  makeTmpProject,
  writeRoadmap,
  writeArchiveFile,
  runNodeScript,
} = require("./helpers");
const {
  STALE_DAYS,
  SURVEY_MARKER,
  CORRECTION_MARKER,
  fileMetrics,
  loadTrialLog,
  trialMetrics,
  health,
} = require("../scripts/health/roadmap-health");

const SCRIPT = path.join(__dirname, "..", "scripts", "health", "roadmap-health.js");
const DATE = "2026-07-28";

let project;

function entry(id, overrides = {}) {
  return {
    id,
    title: `Task ${id}`,
    why: `Why ${id}`,
    what: `What ${id}`,
    status: "planned",
    source: "user",
    depends_on: [],
    touches: [`src/${id}.js`],
    commits: [],
    created_at: "2026-07-01",
    updated_at: "2026-07-27",
    notes: "",
    ...overrides,
  };
}

beforeEach(() => {
  project = makeTmpProject();
});

describe("roadmap health — metrics from the files alone", () => {
  test("counts stale open entries against the run date, not the clock", () => {
    const entries = [
      entry("001", { updated_at: "2026-07-27" }),
      entry("002", { updated_at: "2026-05-01" }),
      // Terminal work is not stale work — it is finished.
      entry("003", { status: "done", updated_at: "2026-01-01", notes: "closed" }),
    ];
    const metrics = fileMetrics(entries, [], DATE);

    assert.equal(metrics.stale_entries.count, 1);
    assert.deepEqual(metrics.stale_entries.ids, ["002"]);
    assert.equal(metrics.stale_entries.threshold_days, 30);
  });

  test("the staleness window is exclusive at the threshold", () => {
    const at = entry("001", { updated_at: "2026-06-28" });
    const past = entry("002", { updated_at: "2026-06-27" });
    assert.equal(new Date(DATE) - new Date(at.updated_at), STALE_DAYS * 86400000);

    assert.deepEqual(fileMetrics([at, past], [], DATE).stale_entries.ids, ["002"]);
  });

  test("counts survey breadcrumbs separately from applied corrections", () => {
    const entries = [
      entry("001", { notes: `2026-07-02 ${SURVEY_MARKER} the named module has no such export` }),
      entry("002", { notes: "2026-07-02 handed off to a background agent" }),
    ];
    const metrics = fileMetrics(entries, [], DATE);

    assert.equal(metrics.corrections.count, 1);
    assert.deepEqual(metrics.corrections.ids, ["001"]);
    assert.deepEqual(metrics.corrections.applied, {
      count: 0,
      ids: [],
      marker: CORRECTION_MARKER,
    });
  });

  // [Foreman: 178] The stamp is one dated line per applied correction, so an
  // entry corrected twice is worth two — the metric is corrections, not
  // corrected entries.
  test("counts one applied correction per stamped line, not per entry", () => {
    const entries = [
      entry("001", {
        notes: `2026-07-02 ${CORRECTION_MARKER}what\n2026-07-05 ${CORRECTION_MARKER}title, planned_touches`,
      }),
      entry("002", { notes: `2026-07-05 ${CORRECTION_MARKER}why` }),
      entry("003", { notes: "2026-07-05 nothing was corrected here" }),
    ];
    const metrics = fileMetrics(entries, [], DATE);

    assert.equal(metrics.corrections.applied.count, 3);
    assert.deepEqual(metrics.corrections.applied.ids, ["001", "002"]);
  });

  test("an archived entry's corrections belong to its own period, not today's plan", () => {
    const active = [entry("001", { notes: `2026-07-05 ${CORRECTION_MARKER}what` })];
    const archived = [
      entry("002", { status: "done", notes: `2026-06-01 ${CORRECTION_MARKER}title` }),
    ];
    const metrics = fileMetrics(active, archived, DATE);

    assert.equal(metrics.corrections.applied.count, 1);
    assert.deepEqual(metrics.corrections.applied.ids, ["001"]);
  });

  test("counts open entries waiting on dropped and missing ids", () => {
    const entries = [
      entry("001", { status: "dropped", notes: "dropped" }),
      entry("002", { depends_on: ["001"] }),
      entry("003", { depends_on: ["099"] }),
      entry("004"),
    ];
    const metrics = fileMetrics(entries, [], DATE);

    assert.equal(metrics.stranded_dependencies.count, 2);
    assert.deepEqual(metrics.stranded_dependencies.ids, ["002", "003"]);
  });

  test("an archived parent is not a stranded dependency", () => {
    const entries = [entry("002", { depends_on: ["001"] })];
    const archived = [entry("001", { status: "done", notes: "done" })];

    assert.equal(fileMetrics(entries, archived, DATE).stranded_dependencies.count, 0);
  });

  test("reports look-alike pairs from the doctor's own duplicate check", () => {
    const entries = [
      entry("001", { title: "add retry to the upload client", why: "uploads fail on flaky links" }),
      entry("002", { title: "add retry to the upload client again", why: "uploads fail on flaky links" }),
      entry("003", { title: "rename the settings tab", why: "the label reads wrong" }),
    ];
    const metrics = fileMetrics(entries, [], DATE);

    assert.equal(metrics.duplicates.count, 1);
    assert.deepEqual(metrics.duplicates.pairs, [{ a: "001", b: "002" }]);
  });

  test("reports archive size next to the active file, bucketed by month", () => {
    const entries = [entry("003"), entry("004")];
    const archived = [
      entry("001", { status: "done", updated_at: "2026-05-14", notes: "done" }),
      entry("002", { status: "done", updated_at: "2026-06-02", notes: "done" }),
      entry("005", { status: "dropped", updated_at: "2026-06-30", notes: "dropped" }),
    ];
    const metrics = fileMetrics(entries, archived, DATE);

    assert.deepEqual(metrics.archive_growth, {
      active: 2,
      archived: 3,
      archived_per_month: { "2026-05": 1, "2026-06": 2 },
    });
  });

  test("counts reassign-id repairs and the duplicate ids still owed one", () => {
    const entries = [
      entry("001"),
      entry("002", {
        notes: "2026-07-10 id reassigned from 001 during duplicate repair; commit trailers Foreman: 001 predate the reassignment",
      }),
      entry("004"),
      entry("004", { title: "Task 004 from the other branch" }),
    ];
    const metrics = fileMetrics(entries, [], DATE);

    assert.equal(metrics.merge_repair.repaired, 1);
    assert.deepEqual(metrics.merge_repair.ids, ["002"]);
    assert.equal(metrics.merge_repair.outstanding, 1);
  });
});

describe("roadmap health — trial log", () => {
  test("computes acceptance, override, and hint success over a log", () => {
    const log = loadTrialLog(writeTrialLog([
      { event: "menu_shown", ts: DATE, session: "aaa", candidates: 3, hint: false },
      { event: "pick_accepted", ts: DATE, session: "aaa", rank: 1 },
      { event: "menu_shown", ts: DATE, session: "aaa", candidates: 3, hint: true },
      { event: "hint_used", ts: DATE, session: "aaa", hit: true },
      { event: "pick_accepted", ts: DATE, session: "aaa", rank: 1 },
      { event: "menu_shown", ts: DATE, session: "bbb", candidates: 3, hint: true },
      { event: "hint_used", ts: DATE, session: "bbb", hit: false },
      { event: "pick_overridden", ts: DATE, session: "bbb", chosen_rank: 3 },
      { event: "pick_overridden", ts: DATE, session: "bbb", chosen_rank: null },
    ]));
    const metrics = trialMetrics(log);

    assert.equal(metrics.recommendation_acceptance.rate, 0.5);
    assert.equal(metrics.recommendation_acceptance.accepted, 2);
    assert.equal(metrics.recommendation_acceptance.decisions, 4);
    assert.equal(metrics.recommendation_acceptance.menus_shown, 3);
    assert.equal(metrics.override_rate.rate, 0.5);
    assert.equal(metrics.override_rate.overridden, 2);
    assert.equal(metrics.hint_success.rate, 0.5);
    assert.equal(metrics.hint_success.hits, 1);
  });

  test("an empty trial is no rate, not a zero rate", () => {
    const metrics = trialMetrics(loadTrialLog(writeTrialLog([
      { event: "menu_shown", ts: DATE, session: "aaa", candidates: 2, hint: false },
    ])));

    assert.deepEqual(metrics.recommendation_acceptance, { rate: null, reason: "no_events", menus_shown: 1 });
    assert.deepEqual(metrics.override_rate, { rate: null, reason: "no_events" });
    assert.deepEqual(metrics.hint_success, { rate: null, reason: "no_events" });
  });

  test("a truncated line is counted and the rest of the log survives", () => {
    const file = writeTrialLog([{ event: "pick_accepted", ts: DATE, session: "aaa", rank: 1 }]);
    fs.appendFileSync(file, '{"event":"pick_over', "utf-8");
    const log = loadTrialLog(file);

    assert.equal(log.malformed, 1);
    assert.equal(log.events.length, 1);
    assert.equal(trialMetrics(log).recommendation_acceptance.rate, 1);
  });

  test("without a log the three rates are null with a reason", () => {
    writeRoadmap(project, [entry("001")]);
    const report = health(project, { date: DATE });

    for (const name of ["recommendation_acceptance", "override_rate", "hint_success"]) {
      assert.deepEqual(report.metrics[name], { rate: null, reason: "no_trial_log" }, name);
    }
  });
});

describe("roadmap health — the script", () => {
  test("reports every metric over a roadmap and its autodetected archive", () => {
    writeRoadmap(project, [
      entry("002", { depends_on: ["001"] }),
      entry("003", { updated_at: "2026-01-05" }),
      entry("004", { notes: `2026-07-02 ${SURVEY_MARKER} the helper it names moved` }),
    ]);
    writeArchiveFile(project, [
      entry("001", { status: "done", updated_at: "2026-05-14", notes: "done" }),
    ]);

    const json = runScript(["--roadmap", path.join(project, "ROADMAP.jsonl"), "--date", DATE]);

    assert.equal(json.ok, true);
    assert.equal(json.generated_for_date, DATE);
    assert.equal(json.archive, path.join(project, ".foreman", "archive.jsonl"));
    assert.deepEqual(json.metrics.stale_entries.ids, ["003"]);
    assert.deepEqual(json.metrics.corrections.ids, ["004"]);
    assert.equal(json.metrics.stranded_dependencies.count, 0);
    assert.deepEqual(json.metrics.archive_growth, {
      active: 3,
      archived: 1,
      archived_per_month: { "2026-05": 1 },
    });
    assert.ok(Array.isArray(json.notes) && json.notes.length);
  });

  test("--date makes the whole report reproducible", () => {
    writeRoadmap(project, [entry("001", { updated_at: "2026-06-01" }), entry("002")]);
    const argv = ["--roadmap", path.join(project, "ROADMAP.jsonl"), "--date", DATE];

    assert.deepEqual(runScript(argv), runScript(argv));
    // A different run date moves the answer, and only the run date does.
    assert.deepEqual(
      runScript(["--roadmap", path.join(project, "ROADMAP.jsonl"), "--date", "2026-06-15"])
        .metrics.stale_entries.ids,
      []
    );
  });

  test("reads an explicitly named archive and trial log", () => {
    writeRoadmap(project, [entry("001")]);
    // Moved out of the autodetected location, so a count of 1 can only have
    // come from the flag.
    const archive = path.join(project, "elsewhere.jsonl");
    fs.renameSync(writeArchiveTo(project), archive);
    const trial = writeTrialLog([{ event: "pick_accepted", ts: DATE, session: "aaa", rank: 1 }]);

    const json = runScript([
      "--roadmap", path.join(project, "ROADMAP.jsonl"),
      "--archive", archive,
      "--trial-log", trial,
      "--date", DATE,
    ]);

    assert.equal(json.archive, archive);
    assert.equal(json.metrics.archive_growth.archived, 1);
    assert.equal(json.metrics.recommendation_acceptance.rate, 1);
  });

  test("refuses to run without a roadmap and refuses a malformed date", () => {
    const noRoadmap = runScript([], 1);
    assert.match(noRoadmap.error, /--roadmap/);

    writeRoadmap(project, [entry("001")]);
    const badDate = runScript(
      ["--roadmap", path.join(project, "ROADMAP.jsonl"), "--date", "July 2026"],
      1
    );
    assert.match(badDate.error, /YYYY-MM-DD/);

    const missing = runScript(["--roadmap", path.join(project, "nope.jsonl")], 1);
    assert.match(missing.error, /roadmap not found/);
  });
});

function runScript(argv, expectedStatus = 0) {
  const result = runNodeScript(SCRIPT, argv);
  assert.equal(result.status, expectedStatus, result.stderr || result.stdout);
  return JSON.parse(result.stdout);
}

function writeTrialLog(events) {
  const file = path.join(project, "trial-log.jsonl");
  fs.writeFileSync(file, events.map((e) => JSON.stringify(e)).join("\n") + "\n", "utf-8");
  return file;
}

function writeArchiveTo(dir) {
  writeArchiveFile(dir, [entry("009", { status: "done", updated_at: "2026-05-14", notes: "done" })]);
  return path.join(dir, ".foreman", "archive.jsonl");
}
