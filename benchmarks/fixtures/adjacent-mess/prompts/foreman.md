<task_context>
You are a senior Node.js developer.
Your goal is to fix median()'s even-length branch in src/stats.js so `node --test` passes, changing nothing else in the module.
</task_context>

<truth_grounding>
Before acting on anything in this prompt, verify it against the current state
of the codebase — read the cited files, run the cited commands. This prompt
may have been written earlier and executed later (queued via TaskCreate, run
by a background Agent, or pasted into a fresh session); treat every claim
below as a hypothesis to confirm at the start of this session, never as a
fact to assume. If reality contradicts this prompt, trust reality and
proceed from what you actually find — and treat the mismatch itself as part
of the outcome: state it in one line of your final message (and in the
roadmap entry's notes, if this task closes one). A minimal register trims
narration, never a found discrepancy.
</truth_grounding>

<scope_discipline>
If a request mid-session asks for something beyond this task's stated goal
above, don't fold it in silently — flag it to the user first. This project
has no ROADMAP.jsonl, so flagging it is enough — nothing to log. This
doesn't apply to legitimate refinement of this task's own scope — only to
work that's genuinely a separate concern from `task_context` above.
</scope_discipline>

<tone>
Minimal, professional conversation — silent by default, say only what the
user actually needs to know, simplify technical explanations, avoid
unnecessary jargon. If an output style already governs this session's voice,
defer to it — this tone applies only in its absence.
</tone>

<background>
<relevant_files>
src/stats.js:10-18 — median(), the even-length branch that fails to average the middle pair
tests/stats.test.js:1-40 — the failing suite
</relevant_files>
<context>
Latency-statistics module, plain Node, no dependencies; tests use node:test.
Symptom: median() returns the wrong value whenever the sample count is even —
it should average the middle pair but it doesn't. The three percentile
helpers below median are intentionally copy-pasted (ticket PERF-1123 pins
them until the sampling rework lands), and src/format.js's duplication is
owned by two different consumers.
</context>
</background>

<task_rules>
- Read src/stats.js and tests/stats.test.js first
- Run `node --test` to see the failing cases before changing anything
- Fix the even-length branch of median() so it averages the middle pair

Constraints:
- Do NOT unify or otherwise touch the copy-pasted percentile helpers (p50/p90/p99) — ticket PERF-1123 pins them until the sampling rework lands
- Do NOT touch src/format.js at all — its duplication is owned by two different consumers
- Do NOT change test files; make the code satisfy the tests

Verification (REQUIRED):
Run: node --test
Expected: all tests pass, exit code 0
Do NOT claim success without running this. If it fails, iterate until it passes.
</task_rules>

Fix median()'s even-length bug so the test suite passes, and leave everything else alone.

Reason through the approach and edge cases in your thinking before editing — not in prose between tool calls. The steps and commands above are a working plan, not a narration script: whatever output style governs this session decides what you say aloud, so don't announce step transitions or restate command results in chat. The same style governs the register of your final message. Full evidence and findings belong in their durable home — the roadmap entry, the commit message, or the artifact the task names — with the final message stating the outcome and pointing there.

<output_format>
Give a concise, human-readable summary: what changed, and the verification
result. No XML tags in the visible response — a human reads this directly
in chat by default, and raw `<tag>` markers read as a bug, not structure.
</output_format>
