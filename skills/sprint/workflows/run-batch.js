export const meta = {
  name: "foreman-sprint-run-unit",
  description: "Run one approved Foreman sprint unit with a schema-checked return.",
  phases: [{ title: "Execute", detail: "Implement and verify one approved roadmap entry." }],
};

let input = args;
if (typeof input === "string") input = JSON.parse(input);
if (!input || !Array.isArray(input.units) || input.units.length !== 1) {
  throw new Error("run-batch requires exactly one approved unit");
}

const unit = input.units[0];
// Inlined copy of ID_PATTERN from scripts/roadmap.js -- this file runs
// sandboxed, with no require access to the repo. Keep the two in step.
const ENTRY_ID_RE = /^(?:[1-9]\d{3,}|\d{3})$/;
if (!unit || !ENTRY_ID_RE.test(String(unit.entry_id || ""))) {
  throw new Error("unit.entry_id must be a Foreman id (three or more digits, zero-padded to at least three)");
}
if (typeof unit.prompt !== "string" || !unit.prompt.trim()) {
  throw new Error("unit.prompt must be a non-empty handoff");
}

const MODELS = new Set(["haiku", "sonnet", "opus", "fable"]);
const EFFORTS = new Set(["low", "medium", "high", "xhigh", "max"]);
if (unit.model !== undefined && !MODELS.has(unit.model)) {
  throw new Error("unit.model is not supported");
}
if (unit.effort !== undefined && !EFFORTS.has(unit.effort)) {
  throw new Error("unit.effort is not supported");
}

const RESULT_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["entry_id", "outcome", "commit_sha", "verification", "notes", "changelog_line"],
  properties: {
    entry_id: { type: "string", const: unit.entry_id },
    outcome: {
      type: "string",
      enum: ["done", "blocked", "failed_verification", "conflict"],
    },
    commit_sha: {
      anyOf: [
        { type: "string", pattern: "^[0-9a-fA-F]{7,64}$" },
        { type: "null" },
      ],
    },
    verification: { type: "string" },
    notes: { type: "string" },
    changelog_line: { type: ["string", "null"] },
  },
};

const result = await agent(unit.prompt, {
  label: `foreman-sprint:${unit.entry_id}`,
  phase: "Execute",
  agentType: "general-purpose",
  model: unit.model || "sonnet",
  effort: unit.effort || "high",
  schema: RESULT_SCHEMA,
});

if (!result) {
  return {
    results: [{
      entry_id: unit.entry_id,
      outcome: "failed_verification",
      commit_sha: null,
      verification: "The worker returned no schema-valid result.",
      notes: "Execution stopped before fold-back because the worker produced no result.",
      changelog_line: null,
    }],
  };
}

if (result.outcome === "done" && !result.commit_sha) {
  return {
    results: [{
      ...result,
      outcome: "failed_verification",
      verification: `${result.verification} No commit was returned for the claimed completion.`.trim(),
      changelog_line: null,
    }],
  };
}

return { results: [result] };
