"use strict";

// [Foreman: 143] The attention-cost benchmark: the three metrics derivable
// from the roadmap and Foreman's own template, the four trial-gated ones
// (real analysis over a format nothing writes yet), and the --date
// determinism a filed report depends on.

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
  UNPREDICTED_MARKER,
  touchSet,
  scoreEntry,
  notedUnpredicted,
  promptOverhead,
  interruptedRunProxy,
  fileMetrics,
  trialMetrics,
  attentionCost,
} = require("../scripts/health/attention-cost");
const { loadTrialLog } = require("../scripts/health/roadmap-health");

const SCRIPT = path.join(__dirname, "..", "scripts", "health", "attention-cost.js");
const DATE = "2026-07-28";

let project;

function entry(id, overrides = {}) {
  return {
    id,
    title: `Task ${id}`,
    why: `Why ${id}`,
    what: `What ${id}`,
    status: "done",
    source: "user",
    depends_on: [],
    planned_touches: [`src/${id}`],
    observed_touches: [`src/${id}/main.js`],
    commits: ["abc1234"],
    created_at: "2026-07-01",
    updated_at: "2026-07-20",
    notes: "closed",
    ...overrides,
  };
}

beforeEach(() => {
  project = makeTmpProject();
});

describe("attention cost — task-to-commit accuracy", () => {
  test("a prediction that held scores 1/1 and names no offender", () => {
    const metrics = fileMetrics([], [entry("001"), entry("002")]).task_to_commit_accuracy;

    assert.equal(metrics.entries, 2);
    assert.equal(metrics.mean_precision, 1);
    assert.equal(metrics.mean_recall, 1);
    assert.deepEqual(metrics.worst_offenders, []);
    assert.equal(metrics.skipped.count, 0);
  });

  test("an area prediction covers the files beneath it, the CLI's own rule", () => {
    const scored = scoreEntry(
      entry("001", {
        planned_touches: ["src/auth/"],
        observed_touches: ["src\\auth\\middleware.js", "./SRC/auth/session.js"],
      })
    );

    assert.equal(scored.precision, 1);
    assert.equal(scored.recall, 1);
    assert.equal(scored.unpredicted, 0);
  });

  test("a sibling directory is not a child of the predicted one", () => {
    const scored = scoreEntry(
      entry("001", { planned_touches: ["src/auth"], observed_touches: ["src/auth-utils/token.js"] })
    );

    assert.equal(scored.precision, 0);
    assert.equal(scored.recall, 0);
    assert.equal(scored.unpredicted, 1);
  });

  test("a partial prediction reports precision and recall separately", () => {
    const partial = entry("001", {
      planned_touches: ["src/auth", "src/never-touched"],
      observed_touches: ["src/auth/middleware.js", "tests/auth.test.js"],
    });
    const metrics = fileMetrics([], [partial, entry("002")]).task_to_commit_accuracy;

    assert.equal(scoreEntry(partial).precision, 0.5);
    assert.equal(scoreEntry(partial).recall, 0.5);
    // Mean over entries, not over files: one wide entry cannot outvote the rest.
    assert.equal(metrics.mean_precision, 0.75);
    assert.equal(metrics.mean_recall, 0.75);
    assert.deepEqual(metrics.worst_offenders, ["001"]);
  });

  test("an incomplete pair is skipped with its reason, never scored as zero", () => {
    const metrics = fileMetrics(
      [],
      [
        entry("001", { planned_touches: [] }),
        entry("002", { observed_touches: [] }),
        entry("003", { planned_touches: [], observed_touches: [] }),
        entry("004"),
      ]
    ).task_to_commit_accuracy;

    assert.equal(metrics.entries, 1);
    assert.equal(metrics.mean_precision, 1);
    assert.deepEqual(metrics.skipped, {
      count: 3,
      reasons: {
        no_planned_touches: 1,
        no_observed_touches: 1,
        no_planned_or_observed_touches: 1,
      },
    });
  });

  test("only closed entries are scored — open work has not finished predicting", () => {
    const open = entry("001", { status: "in_progress" });
    const metrics = fileMetrics([open], []).task_to_commit_accuracy;

    assert.equal(metrics.entries, 0);
    assert.equal(metrics.mean_precision, null);
    assert.equal(metrics.skipped.count, 0);
  });

  test("an empty roadmap reports no rate rather than a perfect one", () => {
    const metrics = fileMetrics([], []).task_to_commit_accuracy;

    assert.equal(metrics.entries, 0);
    assert.equal(metrics.mean_precision, null);
    assert.equal(metrics.mean_recall, null);
  });
});

describe("attention cost — dirty-file capture", () => {
  test("counts observed files no prediction covered, as a rate over all observed", () => {
    const metrics = fileMetrics(
      [],
      [
        entry("001", {
          planned_touches: ["src/auth"],
          observed_touches: ["src/auth/middleware.js", "docs/notes.md", "package.json"],
        }),
        entry("002"),
      ]
    ).dirty_file_capture;

    assert.equal(metrics.observed_files, 4);
    assert.equal(metrics.unpredicted_files, 2);
    assert.equal(metrics.rate, 0.5);
    assert.deepEqual(metrics.entries_with_unpredicted, { count: 1, ids: ["001"] });
  });

  test("corroborates the CLI's own close-time drift note", () => {
    const agreeing = entry("001", {
      planned_touches: ["src/auth"],
      observed_touches: ["src/auth/middleware.js", "docs/notes.md"],
      notes: `2026-07-20 scope drift — ${UNPREDICTED_MARKER} docs/notes.md`,
    });
    const disagreeing = entry("002", {
      planned_touches: ["src/api"],
      observed_touches: ["src/api/routes.js", "docs/api.md"],
      // Written before the entry's prediction was corrected, so the stamped
      // list and the current subtraction no longer match.
      notes: `2026-07-20 scope drift — predicted but untouched: src/old; ${UNPREDICTED_MARKER} docs/api.md, src/api/routes.js`,
    });
    const metrics = fileMetrics([], [agreeing, disagreeing, entry("003")]).dirty_file_capture;

    assert.deepEqual(metrics.drift_notes.stamped, 2);
    assert.deepEqual(metrics.drift_notes.disagreeing_ids, ["002"]);
    assert.equal(notedUnpredicted(agreeing), 1);
    assert.equal(notedUnpredicted(entry("003")), null);
  });

  test("duplicate touches differing only in shape count once", () => {
    assert.deepEqual(touchSet(["src/auth", "SRC\\auth\\", "./src/auth/"]), ["src/auth"]);
  });
});

describe("attention cost — prompt overhead", () => {
  test("both profile floors come out of the template, deterministically", () => {
    const first = promptOverhead();

    assert.deepEqual(first, promptOverhead());
    assert.equal(first.standard.required_blocks, 2);
    assert.equal(first.reinforced.required_blocks, 6);
    assert.deepEqual(first.standard.blocks, ["concise_truth_line", "closure_evidence_line"]);
    assert.ok(first.reinforced.blocks.includes("scope_discipline"));
  });

  test("the short profile is the cheaper one, reported as a ratio", () => {
    const overhead = promptOverhead();

    assert.ok(overhead.standard.fixed_words > 0);
    assert.ok(overhead.reinforced.fixed_words > overhead.standard.fixed_words);
    assert.equal(
      overhead.words_saved,
      overhead.reinforced.fixed_words - overhead.standard.fixed_words
    );
    assert.ok(overhead.word_ratio > 0 && overhead.word_ratio < 1);
  });
});

describe("attention cost — trial log", () => {
  test("computes setup time, questions, interruptions, and recovery over a log", () => {
    const log = loadTrialLog(writeTrialLog([
      { event: "session_start", ts: DATE, session: "aaa" },
      { event: "init_started", ts: DATE, session: "aaa" },
      { event: "init_completed", ts: DATE, session: "aaa", tasks: 5 },
      { event: "question_asked", ts: DATE, session: "aaa", flow: "init" },
      { event: "first_pick", ts: DATE, session: "aaa", seconds_since_init: 120, sessions_since_init: 0 },
      { event: "pick_accepted", ts: DATE, session: "aaa", rank: 1 },
      { event: "question_asked", ts: DATE, session: "aaa", flow: "pick" },
      { event: "commit_interrupted", ts: DATE, session: "aaa", hook: "safe-commit", reason_class: "dirty_tree" },
      { event: "recovery_attempted", ts: DATE, session: "aaa", kind: "resume-in-progress", success: true },
      { event: "session_start", ts: DATE, session: "bbb" },
      { event: "first_pick", ts: DATE, session: "bbb", seconds_since_init: null, sessions_since_init: 4 },
      { event: "pick_overridden", ts: DATE, session: "bbb", chosen_rank: 3 },
      { event: "question_asked", ts: DATE, session: "bbb", flow: "pick" },
      { event: "commit_interrupted", ts: DATE, session: "bbb", hook: "safe-commit", reason_class: "unexpected_files" },
      { event: "recovery_attempted", ts: DATE, session: "bbb", kind: "failed-verification-retry", success: false },
    ]));
    const metrics = trialMetrics(log);

    assert.equal(metrics.setup_to_first_task.seconds_median, 120);
    assert.equal(metrics.setup_to_first_task.seconds_samples, 1);
    assert.equal(metrics.setup_to_first_task.sessions_median, 2);
    assert.equal(metrics.setup_to_first_task.initializations, 1);

    assert.equal(metrics.questions_per_task.per_task, 1.5);
    assert.equal(metrics.questions_per_task.decisions, 2);
    assert.deepEqual(metrics.questions_per_task.by_flow, { init: 1, pick: 2 });

    assert.equal(metrics.commit_interruptions.per_task, 1);
    assert.deepEqual(metrics.commit_interruptions.by_reason, { dirty_tree: 1, unexpected_files: 1 });
    assert.deepEqual(metrics.commit_interruptions.by_hook, { "safe-commit": 2 });

    assert.equal(metrics.recovery_success.rate, 0.5);
    assert.deepEqual(metrics.recovery_success.by_kind, {
      "resume-in-progress": { attempts: 1, succeeded: 1 },
      "failed-verification-retry": { attempts: 1, succeeded: 0 },
    });
  });

  test("an empty trial is no rate, not a zero rate", () => {
    const metrics = trialMetrics(loadTrialLog(writeTrialLog([
      { event: "session_start", ts: DATE, session: "aaa" },
    ])));

    assert.equal(metrics.setup_to_first_task.seconds_median, null);
    assert.equal(metrics.setup_to_first_task.reason, "no_events");
    assert.equal(metrics.questions_per_task.per_task, null);
    assert.equal(metrics.questions_per_task.reason, "no_events");
    assert.equal(metrics.commit_interruptions.per_task, null);
    assert.deepEqual(metrics.recovery_success, { rate: null, reason: "no_events" });
  });

  test("events with no task taken report no denominator rather than dividing by zero", () => {
    const metrics = trialMetrics(loadTrialLog(writeTrialLog([
      { event: "question_asked", ts: DATE, session: "aaa", flow: "add" },
    ])));

    assert.equal(metrics.questions_per_task.per_task, null);
    assert.equal(metrics.questions_per_task.reason, "no_decisions");
    assert.equal(metrics.questions_per_task.questions, 1);
  });

  test("without a log the four metrics are null with a reason", () => {
    writeRoadmap(project, [entry("001", { status: "planned" })]);
    const report = attentionCost(project, { date: DATE });

    assert.deepEqual(report.metrics.setup_to_first_task, { seconds_median: null, reason: "no_trial_log" });
    assert.deepEqual(report.metrics.questions_per_task, { per_task: null, reason: "no_trial_log" });
    assert.deepEqual(report.metrics.commit_interruptions, { per_task: null, reason: "no_trial_log" });
    assert.equal(report.metrics.recovery_success.rate, null);
    assert.equal(report.metrics.recovery_success.reason, "no_trial_log");
  });
});

describe("attention cost — the recovery proxy", () => {
  test("counts open entries with work already behind them, labeled as a proxy", () => {
    const proxy = interruptedRunProxy([
      entry("001", { status: "in_progress", commits: ["abc1234"] }),
      entry("002", { status: "in_progress", commits: [], observed_touches: ["src/002/main.js"] }),
      entry("003", { status: "in_progress", commits: [], observed_touches: [] }),
      entry("004", { status: "planned", commits: [] }),
      entry("005"),
    ]);

    assert.equal(proxy.label, "proxy");
    assert.equal(proxy.interrupted_runs_open, 2);
    assert.deepEqual(proxy.ids, ["001", "002"]);
  });

  test("the proxy rides inside recovery_success without becoming its rate", () => {
    writeRoadmap(project, [entry("001", { status: "in_progress" })]);
    const recovery = attentionCost(project, { date: DATE }).metrics.recovery_success;

    assert.equal(recovery.rate, null);
    assert.equal(recovery.proxy.interrupted_runs_open, 1);
  });
});

describe("attention cost — the script", () => {
  test("reports every metric over a roadmap and its autodetected archive", () => {
    writeRoadmap(project, [entry("003", { status: "in_progress" })]);
    writeArchiveFile(project, [
      entry("001"),
      entry("002", {
        planned_touches: ["src/api"],
        observed_touches: ["src/api/routes.js", "docs/api.md"],
        notes: `2026-07-20 scope drift — ${UNPREDICTED_MARKER} docs/api.md`,
      }),
    ]);

    const json = runScript(["--roadmap", path.join(project, "ROADMAP.jsonl"), "--date", DATE]);

    assert.equal(json.ok, true);
    assert.equal(json.generated_for_date, DATE);
    assert.equal(json.archive, path.join(project, ".foreman", "archive.jsonl"));
    assert.equal(json.metrics.task_to_commit_accuracy.entries, 2);
    assert.equal(json.metrics.dirty_file_capture.unpredicted_files, 1);
    assert.deepEqual(json.metrics.dirty_file_capture.drift_notes.disagreeing_ids, []);
    assert.equal(json.metrics.prompt_overhead.reinforced.required_blocks, 6);
    assert.equal(json.metrics.recovery_success.proxy.interrupted_runs_open, 1);
    assert.ok(Array.isArray(json.notes) && json.notes.length);
  });

  test("--date is echoed and moves nothing else in the report", () => {
    writeRoadmap(project, [entry("001")]);
    const argv = ["--roadmap", path.join(project, "ROADMAP.jsonl"), "--date", DATE];
    const other = runScript(["--roadmap", path.join(project, "ROADMAP.jsonl"), "--date", "2026-01-05"]);

    assert.deepEqual(runScript(argv), runScript(argv));
    assert.equal(other.generated_for_date, "2026-01-05");
    assert.deepEqual(other.metrics, runScript(argv).metrics);
  });

  test("reads an explicitly named archive and trial log", () => {
    writeRoadmap(project, [entry("001", { status: "planned" })]);
    const archive = path.join(project, "elsewhere.jsonl");
    writeArchiveFile(project, [entry("009")]);
    fs.renameSync(path.join(project, ".foreman", "archive.jsonl"), archive);
    const trial = writeTrialLog([
      { event: "pick_accepted", ts: DATE, session: "aaa", rank: 1 },
      { event: "question_asked", ts: DATE, session: "aaa", flow: "pick" },
    ]);

    const json = runScript([
      "--roadmap", path.join(project, "ROADMAP.jsonl"),
      "--archive", archive,
      "--trial-log", trial,
      "--date", DATE,
    ]);

    assert.equal(json.archive, archive);
    assert.equal(json.metrics.task_to_commit_accuracy.entries, 1);
    assert.equal(json.metrics.questions_per_task.per_task, 1);
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
