# Call 4-N — optional section details

For each section selected in Call 1 Q2, ask its detail question(s), batched per call (at most 4 questions per `AskUserQuestion` call in Claude Code).

- **Tone** — "Describe the tone for this session."
  Options: `Cautious and defensive (security-focused)`, `Fast and pragmatic (prototype)`, `Pedagogical — explain each step`, `Formal technical report style`
- **Example** — "Provide a before/after snippet or input → output example."
  Options: `I'll type it`, `No example to give`
- **Constraints** (batch both) — "Which files or interfaces must NOT be modified?" Options: `I'll list them`, `Nothing is off limits`; and "Is there a coding style or pattern to follow? Point to an example file." Options: `None`, `I'll describe it`
- **Background context** — "Describe the architectural decisions, patterns, or constraints the agent needs to know to act without prior context."
  Options: `I'll describe it`, `Nothing beyond the files themselves`

A section selected in Q2 whose detail question comes back with the
nothing-to-give answer — `No example to give`, `Nothing is off limits`,
`None`, `Nothing beyond the files themselves` — is dropped from the
assembled prompt, exactly as Call 3 Q4's `Nothing in particular` drops
`<invariants>`. An empty block is worse than an absent one, and changing
their mind about a section is a normal answer rather than a gap to push
back on.

**Workflow stage** (when Call 1 Q4 was `Yes`):
- "What should come back? Describe the fields the schema should capture."
  Options: `I'll describe them`, `Derive them from the done state`

  `Derive them from the done state` does not skip the schema — the stage
  cannot run without one. Author it from Call 2 Q2's done state and Call 1
  Q1's task type instead, then show the fields before delivering.

  `craft-handoff.js` bakes the flavor when the call below carries
  `"workflowStage":true`, but it does NOT author the schema: assemble a
  second artifact yourself, a fenced `json` JSON Schema built from this
  answer. Authoring rules: object root with a `required` array; a
  `description` on every property (descriptions double as instructions to
  the structured-output layer); enums for verdict-like fields; for
  evidence-bearing claims use the cited-pair shape
  `{"cite": "file:line or doc URL", "note": string}`; keep schemas small —
  every validation retry costs a full subagent turn.
  Legality rules, separate from the authoring rules above: in Claude Code,
  `minimum`/`maximum`, `minLength`/`maxLength`, `multipleOf`, recursive or
  external `$ref`, and `minItems` above 1 are unsupported, and
  `additionalProperties` takes no value but `false` — state any such bound
  in the property's `description` instead. An unsupported keyword is
  rejected up front with a 400, not at output-validation time. In Codex,
  verify the runner's supported JSON Schema subset. The schema travels
  with the prompt; see Deliver below.
