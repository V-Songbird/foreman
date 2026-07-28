"use strict";

// The whole structural contract for ROADMAP.jsonl and .foreman/config.json,
// in one place, with two consumers: `roadmap.js doctor` reports (and, with
// --fix, mechanically repairs) what it finds, and roadmap.js's writeEntries
// refuses any mutation whose resulting file would carry a structural error.
// One definition on purpose -- a doctor that checked more than the write
// path enforced is exactly how a file drifts into a shape the CLI can no
// longer parse, rank, or repair.
//
// Severity rule, applied throughout: **error** when a consumer would break
// or have to guess (unknown status, duplicate id, dangling dependency,
// cycle); **warning** when the value is mechanically recoverable, already
// defaulted by every reader, or merely suspicious (a missing `touches`
// array, an unrecognized `source`, two entries that read alike). Historical
// entries predate later fields and later rules; they must stay writable, so
// anything a real roadmap legitimately contains is a warning at most.
//
// `repairable: true` marks the findings whose fix is mechanical and has
// exactly one possible outcome. Everything else is reported and left for
// the caller (the skill layer asks the user; these scripts never prompt).

const fs = require("fs");
const path = require("path");
const { VALID_GATES, isValidDir } = require("./decision-log-config");
const {
  configPath,
  VALID_TARGET_MODELS,
  OMITTABLE_TAGS,
  RESERVED_TAGS,
  TAG_RE,
} = require("./render-sections");

// roadmap.js requires this module at load time, so requiring it back up here
// would capture a half-built exports object. Node's module cache makes the
// deferred call a map lookup.
function roadmap() {
  return require("./roadmap");
}

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
// Zero-padded, at least three digits -- the width the `Foreman: <id>` commit
// trailer and `[Foreman: <id>]` anchors are written against. Four digits and
// up are accepted here so a roadmap that outgrows 999 fails at the trailer
// grammar (which owns that limit), not at every write.
const ID_RE = /^\d{3,}$/;

// Required and always a plain string with content.
const REQUIRED_TEXT = ["title", "why", "what"];
// Required, and every reader already defaults them -- so a missing one is a
// warning with exactly one sane repair rather than a broken file.
const DEFAULTED_FIELDS = { depends_on: [], touches: [], commits: [], notes: "" };

function isObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function isValidDate(value) {
  return typeof value === "string" && DATE_RE.test(value) && !Number.isNaN(Date.parse(value));
}

function finding(code, severity, ids, message, extra = {}) {
  return { code, severity, ids, message, repairable: false, ...extra };
}

// Same trust boundary validateDoc guards on doc: a `touches` hint that is
// absolute or escapes the project is not a path any collision check should
// be matching against.
function isUnsafePath(value) {
  return (
    path.win32.isAbsolute(value)
    || path.posix.isAbsolute(value)
    || value.split(/[\\/]/).includes("..")
  );
}

function checkEntry(entry, index, out) {
  if (!isObject(entry)) {
    out.push(finding("invalid_type", "error", [], `line ${index + 1} is not a JSON object`));
    return;
  }
  const { STATUSES, SOURCES, KINDS, MODELS, EFFORTS, validateDoc } = roadmap();
  const id = typeof entry.id === "string" ? entry.id : "";
  const ids = id ? [id] : [];
  const at = id ? `entry ${id}` : `line ${index + 1}`;

  // A later entry owns schema versioning. Until it lands, no version field
  // is the compatible state and any version marker is from a Foreman that
  // knows rules this one does not.
  if (entry.schema_version !== undefined) {
    out.push(finding(
      "unsupported_schema_version",
      "error",
      ids,
      `${at} declares schema_version ${JSON.stringify(entry.schema_version)}; this Foreman only understands unversioned entries`,
      { field: "schema_version" }
    ));
  }

  if (entry.id === undefined || entry.id === null) {
    out.push(finding("missing_field", "error", [], `line ${index + 1} has no id`, { field: "id" }));
  } else if (typeof entry.id !== "string") {
    out.push(finding("invalid_type", "error", [], `line ${index + 1}: id must be a string`, { field: "id" }));
  } else if (!ID_RE.test(entry.id)) {
    out.push(finding("invalid_id", "error", ids, `${at}: id must be zero-padded digits ("001"), not ${JSON.stringify(entry.id)}`, { field: "id" }));
  }

  for (const field of REQUIRED_TEXT) {
    const value = entry[field];
    if (value === undefined || value === null || value === "") {
      out.push(finding("missing_field", "error", ids, `${at} has no ${field}`, { field }));
    } else if (typeof value !== "string") {
      out.push(finding("invalid_type", "error", ids, `${at}: ${field} must be a string`, { field }));
    }
  }

  for (const [field, empty] of Object.entries(DEFAULTED_FIELDS)) {
    const value = entry[field];
    if (value === undefined || value === null) {
      out.push(finding("missing_field", "warning", ids, `${at} has no ${field}`, { field, repairable: Boolean(ids.length) }));
      continue;
    }
    if (Array.isArray(empty)) {
      if (!Array.isArray(value)) {
        out.push(finding("invalid_type", "error", ids, `${at}: ${field} must be an array`, { field }));
      } else if (value.some((item) => typeof item !== "string" || !item)) {
        out.push(finding("invalid_type", "error", ids, `${at}: every ${field} item must be a non-empty string`, { field }));
      }
    } else if (typeof value !== "string") {
      out.push(finding("invalid_type", "error", ids, `${at}: ${field} must be a string`, { field }));
    }
  }

  for (const item of Array.isArray(entry.touches) ? entry.touches : []) {
    if (typeof item === "string" && item && isUnsafePath(item)) {
      out.push(finding("invalid_path", "warning", ids, `${at}: touches "${item}" is absolute or escapes the project`, { field: "touches" }));
    }
  }

  if (entry.status === undefined || entry.status === null) {
    out.push(finding("missing_field", "error", ids, `${at} has no status`, { field: "status" }));
  } else if (!STATUSES.has(entry.status)) {
    out.push(finding("unknown_status", "error", ids, `${at}: status ${JSON.stringify(entry.status)} is not one of ${[...STATUSES].join("|")}`, { field: "status" }));
  }

  if (entry.source === undefined || entry.source === null) {
    out.push(finding("missing_field", "error", ids, `${at} has no source`, { field: "source" }));
  } else if (!SOURCES.has(entry.source)) {
    // Warning, not error: early entries were written before the set closed.
    out.push(finding("unknown_source", "warning", ids, `${at}: source ${JSON.stringify(entry.source)} is not one of ${[...SOURCES].join("|")}`, { field: "source" }));
  }

  for (const field of ["created_at", "updated_at"]) {
    if (entry[field] === undefined || entry[field] === null) {
      out.push(finding("missing_field", "error", ids, `${at} has no ${field}`, { field }));
    } else if (!isValidDate(entry[field])) {
      out.push(finding("invalid_date", "error", ids, `${at}: ${field} ${JSON.stringify(entry[field])} is not a real YYYY-MM-DD date`, { field }));
    }
  }

  if (entry.doc !== undefined) {
    try {
      validateDoc(entry.doc);
    } catch (err) {
      out.push(finding("invalid_doc", "error", ids, `${at}: ${err.message}`, { field: "doc" }));
    }
  }
  if (entry.kind !== undefined && !KINDS.has(entry.kind)) {
    out.push(finding("unknown_kind", "error", ids, `${at}: kind ${JSON.stringify(entry.kind)} is not one of ${[...KINDS].join("|")}`, { field: "kind" }));
  }
  if (entry.model !== undefined && !MODELS.has(entry.model)) {
    out.push(finding("unknown_model", "error", ids, `${at}: model ${JSON.stringify(entry.model)} is not one of ${[...MODELS].join("|")}`, { field: "model" }));
  }
  if (entry.effort !== undefined && !EFFORTS.has(entry.effort)) {
    out.push(finding("unknown_effort", "error", ids, `${at}: effort ${JSON.stringify(entry.effort)} is not one of ${[...EFFORTS].join("|")}`, { field: "effort" }));
  }
}

function checkGraph(rows, out) {
  const { reaches, TERMINAL_STATUSES } = roadmap();
  const byId = new Map();
  const counts = new Map();
  for (const entry of rows) {
    if (typeof entry.id !== "string" || !entry.id) continue;
    counts.set(entry.id, (counts.get(entry.id) || 0) + 1);
    if (!byId.has(entry.id)) byId.set(entry.id, entry);
  }
  for (const [id, count] of counts) {
    if (count > 1) {
      out.push(finding("duplicate_id", "error", [id], `id ${id} appears on ${count} lines`, { field: "id" }));
    }
  }

  for (const entry of rows) {
    const id = entry.id;
    if (typeof id !== "string" || !Array.isArray(entry.depends_on)) continue;
    const seen = new Set();
    for (const dep of entry.depends_on) {
      if (typeof dep !== "string" || !dep) continue;
      if (dep === id) {
        out.push(finding("self_dependency", "error", [id], `entry ${id} depends on itself`, { field: "depends_on", repairable: true }));
        continue;
      }
      if (seen.has(dep)) {
        out.push(finding("duplicate_dependency", "warning", [id], `entry ${id} lists dependency ${dep} more than once`, { field: "depends_on", repairable: true }));
        continue;
      }
      seen.add(dep);
      const parent = byId.get(dep);
      if (!parent) {
        out.push(finding("missing_dependency", "error", [id], `entry ${id} depends on ${dep}, which does not exist`, { field: "depends_on" }));
        continue;
      }
      // Same predicate update-deps refuses an edge with, applied to edges
      // that are already in the file.
      if (reaches(rows, dep, id)) {
        out.push(finding("dependency_cycle", "error", [id, dep], `entry ${id} depends on ${dep}, which depends back on ${id}`, { field: "depends_on" }));
        continue;
      }
      if (TERMINAL_STATUSES.has(parent.status) && parent.status !== "done" && !TERMINAL_STATUSES.has(entry.status)) {
        out.push(finding("stranded_dependency", "warning", [id], `entry ${id} waits on ${dep}, which is ${parent.status} — it can never become ready without an edge change`, { field: "depends_on" }));
      }
    }
  }

  for (const entry of rows) {
    if (entry.status !== "done" || typeof entry.id !== "string") continue;
    const commits = Array.isArray(entry.commits) ? entry.commits : [];
    if (!commits.length && !String(entry.notes || "").trim()) {
      out.push(finding("terminal_without_evidence", "warning", [entry.id], `entry ${entry.id} is done with no commits and no notes — nothing records what happened`));
    }
  }
}

// The same word-overlap score check-duplicate offers callers before they add
// a task, run over the pairs already on the roadmap. Capped like
// check-duplicate's own match list: this is a heuristic, and an unbounded
// pair list on a large roadmap would cost more context than it saves.
function checkSimilarity(rows, out) {
  const { normalizeWords, jaccard, DUPLICATE_THRESHOLD, MAX_MATCHES } = roadmap();
  const texts = rows
    .filter((entry) => typeof entry.id === "string" && entry.id)
    .map((entry) => ({ id: entry.id, words: normalizeWords(`${entry.title || ""} ${entry.why || ""}`) }));
  const pairs = [];
  for (let i = 0; i < texts.length; i += 1) {
    for (let j = i + 1; j < texts.length; j += 1) {
      const score = jaccard(texts[i].words, texts[j].words);
      if (score >= DUPLICATE_THRESHOLD) pairs.push({ a: texts[i].id, b: texts[j].id, score });
    }
  }
  pairs
    .sort((left, right) => right.score - left.score)
    .slice(0, MAX_MATCHES)
    .forEach((pair) => {
      out.push(finding(
        "similar_titles",
        "warning",
        [pair.a, pair.b],
        `entries ${pair.a} and ${pair.b} overlap ${pair.score.toFixed(2)} on title/why — possible duplicates`
      ));
    });
}

/**
 * Every structural finding for a set of parsed entries.
 * `similarity: false` drops the pairwise duplicate heuristic — the one
 * quadratic pass, and warning-only, so the write gate (which acts on errors
 * alone) skips it rather than paying for it on every mutation.
 */
function validateEntries(entries, options = {}) {
  const out = [];
  entries.forEach((entry, index) => checkEntry(entry, index, out));
  const rows = entries.filter(isObject);
  checkGraph(rows, out);
  if (options.similarity !== false) checkSimilarity(rows, out);
  return out;
}

const BOOL = { ok: (value) => typeof value === "boolean", expected: "true or false" };
const STRING = { ok: (value) => typeof value === "string" && value !== "", expected: "a non-empty string" };
const ON_FINISH = new Set(["ask", "squash", "merge", "pr", "keep"]);

function oneOf(values) {
  return { ok: (value) => values.has(value), expected: [...values].join(" | ") };
}

// Documented in settings.md; the accepted values come from the modules that
// actually read them, so this table can never drift from the readers.
const CONFIG_SPEC = {
  discoverySuggestions: BOOL,
  usePersona: BOOL,
  requireVerification: BOOL,
  modelSuggestions: BOOL,
  fableEnabled: BOOL,
  taskCloseGate: oneOf(VALID_GATES),
  targetModel: oneOf(VALID_TARGET_MODELS),
  omitSections: {
    ok: (value) => Array.isArray(value) && value.every((tag) => OMITTABLE_TAGS.has(tag)),
    expected: `an array of ${[...OMITTABLE_TAGS].join(" | ")}`,
  },
  customSections: {
    ok: (value) =>
      Array.isArray(value)
      && value.every(
        (section) =>
          isObject(section)
          && typeof section.tag === "string"
          && TAG_RE.test(section.tag)
          && !RESERVED_TAGS.has(section.tag)
          && typeof section.content === "string"
          && section.content.trim() !== ""
      ),
    expected: "an array of {tag, content} sections with unreserved lowercase tags",
  },
  decisionLog: {
    spec: {
      enabled: BOOL,
      dir: { ok: isValidDir, expected: 'a relative path with no ".." segments' },
      gate: oneOf(VALID_GATES),
    },
  },
  checkpoints: {
    spec: { baseBranch: STRING, branch: BOOL, onFinish: oneOf(ON_FINISH) },
  },
};

function checkGroup(prefix, group, spec, out) {
  for (const [key, value] of Object.entries(group)) {
    const field = `${prefix}${key}`;
    const rule = spec[key];
    if (!rule) {
      // Forward compatibility: a newer Foreman's key is not corruption.
      out.push(finding("unknown_config_key", "warning", [], `.foreman/config.json: ${field} is not a setting this Foreman knows`, { field }));
      continue;
    }
    if (rule.spec) {
      if (!isObject(value)) {
        out.push(finding("invalid_config_value", "error", [], `.foreman/config.json: ${field} must be an object`, { field }));
        continue;
      }
      checkGroup(`${field}.`, value, rule.spec, out);
      continue;
    }
    if (!rule.ok(value)) {
      out.push(finding("invalid_config_value", "error", [], `.foreman/config.json: ${field} must be ${rule.expected}, got ${JSON.stringify(value)}`, { field }));
    }
  }
}

/** Findings for .foreman/config.json. A missing file is the uninitialized case. */
function validateConfig(root) {
  const out = [];
  let raw;
  try {
    raw = fs.readFileSync(configPath(root), "utf-8");
  } catch (err) {
    if (err && err.code === "ENOENT") return out;
    out.push(finding("unreadable_config", "error", [], `.foreman/config.json could not be read: ${err.message}`));
    return out;
  }
  let config;
  try {
    config = JSON.parse(raw);
  } catch (err) {
    // Every reader fails soft to defaults on this, silently in the hooks --
    // which is exactly why it has to be loud somewhere.
    out.push(finding("unreadable_config", "error", [], `.foreman/config.json is not valid JSON: ${err.message}`));
    return out;
  }
  if (!isObject(config)) {
    out.push(finding("unreadable_config", "error", [], ".foreman/config.json must contain a JSON object"));
    return out;
  }
  checkGroup("", config, CONFIG_SPEC, out);
  return out;
}

/**
 * Apply the repairs whose outcome is not a judgment call, in place.
 * `updated_at` deliberately stays untouched: normalizing a container field
 * is not a change to the task, and bumping the date would make a long-closed
 * entry look freshly done to post-commit.js.
 */
function applyRepairs(entries, findings) {
  const byId = new Map();
  for (const entry of entries) {
    if (isObject(entry) && typeof entry.id === "string" && !byId.has(entry.id)) byId.set(entry.id, entry);
  }
  const applied = [];
  for (const item of findings) {
    if (!item.repairable) continue;
    const entry = byId.get(item.ids[0]);
    if (!entry) continue;
    if (item.code === "missing_field" && item.field in DEFAULTED_FIELDS) {
      const empty = DEFAULTED_FIELDS[item.field];
      entry[item.field] = Array.isArray(empty) ? [] : empty;
    } else if (item.code === "self_dependency") {
      entry.depends_on = entry.depends_on.filter((dep) => dep !== entry.id);
    } else if (item.code === "duplicate_dependency") {
      entry.depends_on = [...new Set(entry.depends_on)];
    } else {
      continue;
    }
    applied.push(item);
  }
  return applied;
}

function summarize(findings) {
  return {
    ok: !findings.some((item) => item.severity === "error"),
    findings,
    summary: {
      errors: findings.filter((item) => item.severity === "error").length,
      warnings: findings.filter((item) => item.severity === "warning").length,
    },
  };
}

module.exports = {
  validateEntries,
  validateConfig,
  applyRepairs,
  summarize,
  CONFIG_SPEC,
  DEFAULTED_FIELDS,
};
