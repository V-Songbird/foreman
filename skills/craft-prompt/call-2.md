# Call 2 — required fields (batch all 4)

**Q1** — "What role should the spawned agent play?"
Options: `Senior engineer`, `Security engineer`, `Code reviewer`, `Technical writer`

**Q2** — "What does 'done' look like? One sentence. A performance or
coverage goal names the metric and threshold (e.g. 'p95 under 500ms')."
Options: `Bug is fixed and all tests pass`, `Feature is implemented and tested`, `Findings are written to a file in the repo, cited`, `Refactor complete — no behavior change`

**Q3** — "List the relevant files, naming the functions or classes that
matter in each. If an analogous implementation exists, name it too as a
pattern to imitate."
Options: `<candidate 1>`, `<candidate 2>`, `<candidate 3>`, `I'll list them` (each candidate is one line the grounding pass proposed, already shaped `src/auth/middleware.ts — refreshToken, verifySession`. Fill the slots you have and drop the rest; with no candidates at all the options are `I'll list them` and `I can only name the area`. Whichever way the user answers, they may add a `Pattern: src/webhooks/github.ts — build the new code the same way` line, and the pass's similar-file answer is what to suggest for it. A line number only when the spot has no name — `resolve-symbols.js` fills the rest in below.)

The candidates are offered one per option so the user can take one and
correct it rather than retyping the whole list. Let the user pick several
when the pass returned more than one plausible file (`multiSelect` in
Claude Code): the picked lines concatenate into `touches` in the order
shown.

**Q4** — In Claude Code: "Describe the two steps: analyze/check, then implement/produce."
In Codex, ask for approach notes and keep requirements separate from
suggested implementation steps: prescribe an order only when a dependency,
an explicit user instruction, or the verification method requires it.
Antigravity asks the Codex question, since its handoff takes the Codex form
and labels these steps a suggested approach too.
Options: `I'll describe them`, `Implement only, no analysis`
`Implement only, no analysis` yields one `judgment.steps` bullet rather
than two — the analyze half is dropped, never invented. For
`Investigate / research`, this answer is the question under investigation
instead.
