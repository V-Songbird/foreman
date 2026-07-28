#!/usr/bin/env node
"use strict";

// [Foreman: 144] The gate on Foreman's public performance claims.
//
// PRODUCT-STRATEGY.md ("Reproducibility") says a published benchmark claim
// must ship with its fixtures and prompts, model configuration, repetition
// count, aggregate and per-repetition results, date, environment, and
// claim-specific limitations. This validates that a record actually carries
// all of it — and, for every fixture and prompt it names, that the file is
// still on disk with the bytes the record was measured against.
//
// The point is that a claim cannot drift away from its evidence quietly. A
// record whose fixture has since been edited fails here rather than going on
// supporting a sentence in the README.
//
// Conventions are health/'s: plain script, one JSON object on stdout, exports
// for the tests. `--records` defaults to this directory because that is the
// published set — unlike the health tools, no default here can point at
// anyone's live data.

const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const RECORDS_DIR = __dirname;
// Fixture and prompt paths are repo-relative, so they read the same in a
// record as in the README sentence the record supports.
const REPO_ROOT = path.resolve(__dirname, "..", "..");

// A record's id is its filename stem. One less field to keep in sync, and a
// published record is immutable — correcting one means a NEW file with a new
// id and a `supersedes` pointer, never an edit in place.
const RECORD_EXT = ".json";

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

const REQUIRED = [
  "claim",
  "fixtures",
  "prompts",
  "model",
  "repetitions",
  "runs",
  "aggregate",
  "date",
  "environment",
  "limitations",
];

const ENVIRONMENT_FIELDS = ["os", "node", "foreman_commit"];

function sha256(file) {
  return crypto.createHash("sha256").update(fs.readFileSync(file)).digest("hex");
}

function isObject(value) {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function nonEmptyString(value) {
  return typeof value === "string" && value.trim() !== "";
}

/**
 * A referenced file must exist and still hash to what the record measured.
 * Paths stay inside the repo: a record is only reproducible if everything it
 * names travels with the checkout.
 */
function checkHashedRef(ref, label, errors) {
  if (!isObject(ref)) {
    errors.push(`${label}: must be an object with path + sha256`);
    return;
  }
  if (!nonEmptyString(ref.path)) {
    errors.push(`${label}: missing path`);
    return;
  }
  if (!/^[0-9a-f]{64}$/.test(ref.sha256 || "")) {
    errors.push(`${label}: sha256 must be 64 lowercase hex characters`);
    return;
  }
  const absolute = path.resolve(REPO_ROOT, ref.path);
  if (!absolute.startsWith(REPO_ROOT + path.sep)) {
    errors.push(`${label}: path escapes the repository: ${ref.path}`);
    return;
  }
  if (!fs.existsSync(absolute)) {
    errors.push(`${label}: file not found: ${ref.path}`);
    return;
  }
  const actual = sha256(absolute);
  if (actual !== ref.sha256) {
    errors.push(`${label}: sha256 mismatch for ${ref.path} (recorded ${ref.sha256}, actual ${actual})`);
  }
}

function checkDate(value, errors) {
  if (!ISO_DATE.test(value || "")) {
    errors.push(`date: must be an ISO YYYY-MM-DD date, got ${JSON.stringify(value)}`);
    return;
  }
  const parsed = new Date(`${value}T00:00:00Z`);
  if (Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== value) {
    errors.push(`date: not a real calendar date: ${value}`);
  }
}

/**
 * `model: null` is legal and means "no model ran" — a deterministic
 * computation over files in the repo. It is not a hole in the record; the
 * record's limitations are required to say so, and repetitions is 1 because
 * rerunning a deterministic computation produces the same number.
 */
function checkModel(model, errors) {
  if (model === null) return;
  if (!isObject(model)) {
    errors.push("model: must be an object with an id, or null for a static computation");
    return;
  }
  if (!nonEmptyString(model.id)) errors.push("model: missing id");
  if (model.settings !== undefined && !isObject(model.settings)) {
    errors.push("model.settings: must be an object when present");
  }
}

/**
 * The aggregate has to name the statistic it is. "0.16" means nothing until
 * the record says whether it is a median or a mean over how many runs.
 */
function checkAggregate(aggregate, runs, errors) {
  if (!isObject(aggregate)) {
    errors.push("aggregate: must be an object");
    return;
  }
  if (!nonEmptyString(aggregate.statistic)) {
    errors.push("aggregate.statistic: must name the statistic (median, mean, rate, ...)");
  }
  if (aggregate.values === undefined) errors.push("aggregate.values: missing");
}

function validateRecord(id, record, ids) {
  const errors = [];
  if (!isObject(record)) return { id, ok: false, errors: ["record: must be a JSON object"] };

  for (const field of REQUIRED) {
    if (record[field] === undefined) errors.push(`${field}: missing`);
  }
  if (record.claim !== undefined && !nonEmptyString(record.claim)) {
    errors.push("claim: must be the sentence the record supports");
  }

  for (const [key, label] of [["fixtures", "fixtures"], ["prompts", "prompts"]]) {
    if (record[key] === undefined) continue;
    if (!Array.isArray(record[key])) {
      errors.push(`${label}: must be an array`);
      continue;
    }
    record[key].forEach((ref, index) => {
      // A prompt may be carried verbatim instead of by path — exact text is
      // just as reproducible as a hashed file, and shorter prompts read
      // better inline.
      if (key === "prompts" && isObject(ref) && ref.text !== undefined) {
        if (!nonEmptyString(ref.text)) errors.push(`prompts[${index}]: text is empty`);
        return;
      }
      checkHashedRef(ref, `${label}[${index}]`, errors);
    });
  }

  if (record.model !== undefined) checkModel(record.model, errors);

  if (record.repetitions !== undefined
    && (!Number.isInteger(record.repetitions) || record.repetitions < 1)) {
    errors.push("repetitions: must be a positive integer");
  }
  if (record.runs !== undefined && !Array.isArray(record.runs)) {
    errors.push("runs: must be an array of per-run results");
  } else if (Array.isArray(record.runs) && Number.isInteger(record.repetitions)
    && record.runs.length !== record.repetitions) {
    // The check that matters most: an aggregate over fewer runs than the
    // record claims is the exact shape of an inflated result.
    errors.push(`runs: ${record.runs.length} run(s) recorded but repetitions says ${record.repetitions}`);
  }

  if (record.aggregate !== undefined) checkAggregate(record.aggregate, record.runs, errors);
  if (record.date !== undefined) checkDate(record.date, errors);

  if (record.environment !== undefined) {
    if (!isObject(record.environment)) {
      errors.push("environment: must be an object");
    } else {
      for (const field of ENVIRONMENT_FIELDS) {
        if (!nonEmptyString(record.environment[field])) {
          errors.push(`environment.${field}: missing`);
        }
      }
    }
  }

  // Non-empty limitations are the whole honesty contract: every measurement
  // has a claim boundary, and a record that names none has not looked for it.
  if (record.limitations !== undefined) {
    if (!Array.isArray(record.limitations) || record.limitations.length === 0) {
      errors.push("limitations: must be a non-empty array of honest caveats");
    } else if (!record.limitations.every(nonEmptyString)) {
      errors.push("limitations: every entry must be a non-empty string");
    }
  }

  if (record.supersedes !== undefined) {
    if (!nonEmptyString(record.supersedes)) {
      errors.push("supersedes: must be the id of the record this replaces");
    } else if (record.supersedes === id) {
      errors.push("supersedes: a record cannot supersede itself");
    } else if (!ids.has(record.supersedes)) {
      errors.push(`supersedes: no such record: ${record.supersedes}`);
    }
  }

  return { id, ok: errors.length === 0, claim: record.claim, errors };
}

function readRecords(dir) {
  if (!fs.existsSync(dir)) throw new Error(`records directory not found: ${dir}`);
  const files = fs
    .readdirSync(dir)
    .filter((name) => name.endsWith(RECORD_EXT))
    .sort();
  return files.map((name) => {
    const id = name.slice(0, -RECORD_EXT.length);
    try {
      return { id, record: JSON.parse(fs.readFileSync(path.join(dir, name), "utf8")) };
    } catch (error) {
      return { id, parseError: error.message };
    }
  });
}

function validateRecords(dir = RECORDS_DIR) {
  const loaded = readRecords(dir);
  const ids = new Set(loaded.map((entry) => entry.id));
  const records = loaded.map((entry) =>
    entry.parseError
      ? { id: entry.id, ok: false, errors: [`record: invalid JSON — ${entry.parseError}`] }
      : validateRecord(entry.id, entry.record, ids)
  );
  const errors = records
    .filter((result) => !result.ok)
    .flatMap((result) => result.errors.map((message) => `${result.id}: ${message}`));
  return { ok: errors.length === 0, records, errors };
}

function flag(argv, name) {
  const index = argv.indexOf(`--${name}`);
  return index >= 0 ? argv[index + 1] : undefined;
}

function main() {
  const argv = process.argv.slice(2);
  const dir = flag(argv, "records");
  const resolved = dir ? path.resolve(dir) : RECORDS_DIR;
  const result = validateRecords(resolved);
  process.stdout.write(JSON.stringify({ records_dir: resolved, ...result }, null, 2));
  if (!result.ok) process.exit(1);
}

if (require.main === module) {
  try {
    main();
  } catch (error) {
    process.stdout.write(JSON.stringify({ ok: false, error: error.message }));
    process.exit(1);
  }
}

module.exports = {
  RECORDS_DIR,
  REPO_ROOT,
  REQUIRED,
  sha256,
  validateRecord,
  validateRecords,
};
