"use strict";

// [Foreman: 144] The record validator: a well-formed record passes, each
// violation class fails on its own, and the records actually published in this
// repository validate clean against the files they were measured against.

const fs = require("fs");
const os = require("os");
const path = require("path");
const { test, describe, beforeEach } = require("node:test");
const assert = require("node:assert/strict");
const { runNodeScript } = require("./helpers");
const {
  RECORDS_DIR,
  sha256,
  validateRecords,
} = require("../benchmarks/records/validate-records");

const SCRIPT = path.join(__dirname, "..", "benchmarks", "records", "validate-records.js");
const TEMPLATE = "prompt-template.md";
const TEMPLATE_ABS = path.join(__dirname, "..", TEMPLATE);

let dir;

function validRecord(overrides = {}) {
  return {
    claim: "The thing this record is allowed to say, and nothing beyond it.",
    fixtures: [{ path: TEMPLATE, sha256: sha256(TEMPLATE_ABS) }],
    prompts: [{ text: "Fix the failing test in src/limiter.js." }],
    model: { id: "claude-haiku", settings: { temperature: 0 } },
    repetitions: 2,
    runs: [{ run: 1, cost_usd: 0.2 }, { run: 2, cost_usd: 0.22 }],
    aggregate: { statistic: "median", values: { cost_usd: 0.21 } },
    date: "2026-07-28",
    environment: { os: "Windows 11", node: "v22.22.2", foreman_commit: "d8d87dd" },
    limitations: ["Three fixtures, one model, four repetitions — a shape, not a powered experiment."],
    ...overrides,
  };
}

function write(id, record) {
  fs.writeFileSync(path.join(dir, `${id}.json`), JSON.stringify(record, null, 2));
}

/** The errors reported for one record id, as one searchable string. */
function errorsFor(result, id) {
  return result.errors.filter((message) => message.startsWith(`${id}: `)).join("\n");
}

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "foreman-records-"));
});

describe("record validator — a valid record", () => {
  test("passes, and reports its id and claim", () => {
    write("R-900-example", validRecord());

    const result = validateRecords(dir);

    assert.equal(result.ok, true);
    assert.deepEqual(result.errors, []);
    assert.equal(result.records.length, 1);
    assert.equal(result.records[0].id, "R-900-example");
    assert.equal(result.records[0].claim, validRecord().claim);
  });

  test("an empty records directory is vacuously ok", () => {
    const result = validateRecords(dir);

    assert.equal(result.ok, true);
    assert.deepEqual(result.records, []);
  });

  test("a static computation records model null with one repetition", () => {
    write("R-901-static", validRecord({
      model: null,
      prompts: [],
      repetitions: 1,
      runs: [{ run: 1, word_ratio: 0.12 }],
      limitations: ["A static computation over files in the repo, not a model trial."],
    }));

    assert.equal(validateRecords(dir).ok, true);
  });

  test("a supersedes pointer to a record that exists resolves", () => {
    write("R-902-old", validRecord());
    write("R-903-new", validRecord({ supersedes: "R-902-old" }));

    assert.equal(validateRecords(dir).ok, true);
  });

  // [Foreman: 185] Superseded records are history: their fixtures have
  // usually moved on (that is why they were superseded), so only the
  // successor answers for today's bytes.
  test("a superseded record is exempt from the byte check; its successor is not", () => {
    write("R-920-old", validRecord({
      fixtures: [{ path: TEMPLATE, sha256: "0".repeat(64) }],
    }));
    write("R-921-new", validRecord({ supersedes: "R-920-old" }));

    const result = validateRecords(dir);

    assert.deepEqual(result.errors, []);
    assert.equal(result.ok, true);
  });

  test("a stale successor still fails even while it supersedes something", () => {
    write("R-922-old", validRecord());
    write("R-923-new", validRecord({
      supersedes: "R-922-old",
      fixtures: [{ path: TEMPLATE, sha256: "0".repeat(64) }],
    }));

    const result = validateRecords(dir);

    assert.equal(result.ok, false);
    assert.match(errorsFor(result, "R-923-new"), /sha256 mismatch/);
  });
});

describe("record validator — violations", () => {
  test("a missing required field is named", () => {
    const record = validRecord();
    delete record.environment;
    write("R-904-nofield", record);

    const result = validateRecords(dir);

    assert.equal(result.ok, false);
    assert.match(errorsFor(result, "R-904-nofield"), /environment: missing/);
  });

  test("an incomplete environment is named field by field", () => {
    write("R-905-noenv", validRecord({ environment: { os: "Windows 11" } }));

    const result = validateRecords(dir);

    assert.equal(result.ok, false);
    assert.match(errorsFor(result, "R-905-noenv"), /environment\.node: missing/);
    assert.match(errorsFor(result, "R-905-noenv"), /environment\.foreman_commit: missing/);
  });

  test("empty limitations fail — every measurement has a boundary", () => {
    write("R-906-nolimits", validRecord({ limitations: [] }));

    const result = validateRecords(dir);

    assert.equal(result.ok, false);
    assert.match(errorsFor(result, "R-906-nolimits"), /limitations: must be a non-empty array/);
  });

  test("a fixture whose bytes have changed since the run fails loudly", () => {
    write("R-907-stalehash", validRecord({
      fixtures: [{ path: TEMPLATE, sha256: "0".repeat(64) }],
    }));

    const result = validateRecords(dir);

    assert.equal(result.ok, false);
    assert.match(errorsFor(result, "R-907-stalehash"), /sha256 mismatch for prompt-template\.md/);
  });

  test("a fixture that no longer exists fails", () => {
    write("R-908-gone", validRecord({
      fixtures: [{ path: "fixtures/deleted-fixture.md", sha256: "a".repeat(64) }],
    }));

    const result = validateRecords(dir);

    assert.equal(result.ok, false);
    assert.match(errorsFor(result, "R-908-gone"), /file not found/);
  });

  test("supersedes pointing at nothing fails", () => {
    write("R-909-orphan", validRecord({ supersedes: "R-000-never-published" }));

    const result = validateRecords(dir);

    assert.equal(result.ok, false);
    assert.match(errorsFor(result, "R-909-orphan"), /supersedes: no such record: R-000-never-published/);
  });

  test("a record cannot supersede itself", () => {
    write("R-910-self", validRecord({ supersedes: "R-910-self" }));

    const result = validateRecords(dir);

    assert.equal(result.ok, false);
    assert.match(errorsFor(result, "R-910-self"), /cannot supersede itself/);
  });

  test("a date that is not a real ISO calendar date fails", () => {
    write("R-911-baddate", validRecord({ date: "July 28, 2026" }));
    write("R-912-notaday", validRecord({ date: "2026-02-30" }));

    const result = validateRecords(dir);

    assert.equal(result.ok, false);
    assert.match(errorsFor(result, "R-911-baddate"), /must be an ISO YYYY-MM-DD date/);
    assert.match(errorsFor(result, "R-912-notaday"), /not a real calendar date/);
  });

  test("an unnamed aggregate statistic fails — a bare number is not a result", () => {
    write("R-913-nostat", validRecord({ aggregate: { values: { cost_usd: 0.21 } } }));

    const result = validateRecords(dir);

    assert.equal(result.ok, false);
    assert.match(errorsFor(result, "R-913-nostat"), /aggregate\.statistic: must name the statistic/);
  });

  test("fewer runs than repetitions claims fails", () => {
    write("R-914-shortruns", validRecord({ repetitions: 4 }));

    const result = validateRecords(dir);

    assert.equal(result.ok, false);
    assert.match(errorsFor(result, "R-914-shortruns"), /2 run\(s\) recorded but repetitions says 4/);
  });

  test("a model with no id fails", () => {
    write("R-915-nomodel", validRecord({ model: { settings: { temperature: 0 } } }));

    const result = validateRecords(dir);

    assert.equal(result.ok, false);
    assert.match(errorsFor(result, "R-915-nomodel"), /model: missing id/);
  });

  test("a fixture path escaping the repository fails", () => {
    write("R-916-escape", validRecord({
      fixtures: [{ path: "../../../etc/passwd", sha256: "b".repeat(64) }],
    }));

    const result = validateRecords(dir);

    assert.equal(result.ok, false);
    assert.match(errorsFor(result, "R-916-escape"), /escapes the repository/);
  });

  test("an unparseable record file is reported, not thrown", () => {
    fs.writeFileSync(path.join(dir, "R-917-broken.json"), "{ not json");

    const result = validateRecords(dir);

    assert.equal(result.ok, false);
    assert.match(errorsFor(result, "R-917-broken"), /invalid JSON/);
  });
});

describe("record validator — CLI", () => {
  test("exits 0 with JSON on a clean directory", () => {
    write("R-918-clean", validRecord());

    const run = runNodeScript(SCRIPT, ["--records", dir]);

    assert.equal(run.status, 0);
    const output = JSON.parse(run.stdout);
    assert.equal(output.ok, true);
    assert.equal(output.records_dir, path.resolve(dir));
  });

  test("exits non-zero when a record is invalid", () => {
    write("R-919-bad", validRecord({ limitations: [] }));

    const run = runNodeScript(SCRIPT, ["--records", dir]);

    assert.notEqual(run.status, 0);
    assert.equal(JSON.parse(run.stdout).ok, false);
  });

  test("a missing directory is one clean error, not a stack trace", () => {
    const run = runNodeScript(SCRIPT, ["--records", path.join(dir, "nope")]);

    assert.notEqual(run.status, 0);
    const output = JSON.parse(run.stdout);
    assert.equal(output.ok, false);
    assert.match(output.error, /records directory not found/);
  });
});

describe("the records published in this repository", () => {
  test("validate clean against the files they were measured against", () => {
    const result = validateRecords();

    assert.deepEqual(result.errors, []);
    assert.equal(result.ok, true);
  });

  test("default to this repository's own records directory", () => {
    const run = runNodeScript(SCRIPT, []);

    assert.equal(run.status, 0);
    assert.equal(JSON.parse(run.stdout).records_dir, RECORDS_DIR);
  });

  test("every published record names at least one limitation", () => {
    for (const name of fs.readdirSync(RECORDS_DIR).filter((f) => f.endsWith(".json"))) {
      const record = JSON.parse(fs.readFileSync(path.join(RECORDS_DIR, name), "utf8"));
      assert.ok(record.limitations.length > 0, `${name} names no limitation`);
    }
  });
});
