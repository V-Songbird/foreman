---
name: survey
description: Reconcile selected Foreman roadmap entries against current code and propose evidence-backed repairs, including dependency fixes and stale lessons. Use when the user requests a roadmap survey or reconcile-and-pick; a fast pick or old roadmap alone does not trigger it.
---

# Survey the roadmap

Read [the shared runtime](../foreman/runtime.md). This is the advanced code
investigation flow; Fast pick deliberately does not run it. It reads more
code and costs more than ranking stored tasks. Survey only the requested scope,
produce concrete evidence, and apply only authorized repairs.

Use `scripts/roadmap.js` for all roadmap reads and mutations. Missing roadmap:
offer the init flow rather than surveying an invented plan.

## 1. Resolve scope and mechanical facts

If the caller supplies ids, those ids are the scope, including the near-term
set handed over by **Reconcile and pick**. Read them with `list --ids`; report
missing or terminal entries and omit those from repair. Otherwise run
`next-candidates` and survey its top candidates (default limit 3). Say when
additional unblocked work was outside this scope.

Resolve only the distinct `depends_on` ids with a targeted `list --ids`.
Completed dependency rows already carry `commit_evidence`: use its unresolved
SHAs and trailer matches, including submodule-aware evidence. An unresolved
commit means not resolvable here, not fabricated. Zero recorded SHAs plus a
trailer match is recorded work from a staged close.

Check each unique planned path once, relative to the project root, and make a
`path_exists` map. Refuse paths outside the project before reading them.
A missing path may be a file this task will create; absence alone is not stale
scope. `observed_touches` is historical and not a predicted surface to repair.

Regardless of how scope was chosen, gather a compact not-done digest with
`roadmap.js list --status planned,in_progress,awaiting_acceptance,deferred --summary`.
It provides id, title, planned paths, status, and dependencies without loading
the whole backlog's prose. Use it for cross-entry dependency and duplicate
checks; investigation workers do not fetch the roadmap themselves.

## 2. Investigate independently

For each candidate, give a read-only worker its id/title/why/what/planned files/
dependencies, existence map, resolved dependency evidence, and not-done digest.
Use available collaboration subagents for independent candidates while the
coordinator handles other candidates or shared evidence. Limit concurrency to
actual capacity and inherit settings. If delegation is unavailable or there is
only one small candidate, investigate locally. Collect every result before
claiming the survey complete.

Check these questions:

1. **Paths and description**: for a missing path, look for a deletion or rename
   in git history before calling it stale. A planned new file stays valid.
   For existing files, read relevant symbols and history against the task's
   claim. A stale-path finding supplies the whole corrected `planned_touches`
   array, retaining unaffected paths; a stale-description finding supplies a
   finished rewritten `what`.
2. **Dependencies satisfied**: mechanically unresolved evidence already
   warrants attention. For resolved commits, inspect whether the code plausibly
   implements the prerequisite. Keep mechanical resolution and semantic
   implementation as separate conclusions.
3. **Hidden dependencies**: compare imports, calls, and consumers against the
   supplied not-done digest in both directions. Report an overlooked prerequisite
   of this candidate and another entry that depends on this candidate when the
   evidence supports either. Uncertain relations carry `confident:false`.
4. **Done or duplicate**: compare the implemented behavior and other unfinished
   titles/surfaces with this task. Do not treat a similar title alone as proof.

Verdicts are `valid`, `hidden-dependency`, `stale-description`, `stale-touches`,
`already-done`, or `duplicate`. Every non-valid verdict cites file:line or a
commit, or explicitly says `confident:false` and what could not be grounded.

A stale finding needs both evidence (opened files/symbols and observed mismatch)
and a concrete replacement value: a complete `what` string or full
`planned_touches` array. "This looks stale" is not an actionable repair.
Keep evidence even when no replacement can be grounded; mark that uncertain.

## 3. Review and apply

For each proposed change, show id/title, current → proposed value, and evidence.
Show complete planned-file arrays on both sides. A request to inspect remains
read-only for substantive changes. Ask for each needed decision; when the user
already explicitly authorized grounded repairs, apply those within that scope
without asking for the same authorization again. Do not merge unrelated or
uncertain findings into a blanket approval.

Apply through these CLI operations:

- Hidden dependency: `update-deps` with `{"id":"...","add_depends_on":["..."]}`.
  The graph stores the relation so future picks honor it; a note alone does not.
- Already done or duplicate: `update-status` to `done` with the actual commit
  evidence, or `dropped` with the reason, according to the reviewed finding.
  Do not manufacture a completion SHA.
- Stale description/files: re-read immediately with `roadmap.js list --ids <id>`,
  then `roadmap.js correct` with `expected_updated_at`, `expected.<field>` for
  every approved field, and the new values. `planned_touches` is always the
  full replacement array. Never overwrite a declined field.
- If the timestamp or expected value changed, re-read and re-show the proposal
  against current state. Ask when the intervening change affects the authorized
  meaning. Never take values from the rejection merely to force a write.

Uncertain findings are never applied as facts. An evidence-backed uncertain
lead can be recorded using `annotate` with
`{"id":"...","notes":"survey (unconfirmed): <one-line evidence>"}` when recording
survey findings is within the request. Status stays untouched and no field is
rewritten. Explain that such notes inform future prompts but do not reorder
the mechanical ranking. Do not silently record a finding the user declined:
a declined proposal writes nothing, including no refusal breadcrumb.

## 3b. Reconcile lessons from the same evidence

Call `roadmap.js notes --paths <combined candidate paths>` once. Empty results
skip this step; the reader handles a disabled ledger. Offer retirement only
when the just-collected evidence contradicts the lesson. A `stale` label alone
does not prove a lesson wrong, and a `fresh` lesson can still have been wrong
when written.

Show the lesson verbatim, its freshness label, and the contradictory evidence.
A user's decision to retire calls `note-supersede` with
`{"key":"<reported key>","by_entry":"<surveyed id>"}`. Retirement stops recall
without deleting history; new truth belongs to the next completed task's lesson.

Pruning is a distinct, explicit action because it rewrites the lesson store.
Run `note-prune --dry-run`, show the count, and obtain authorization for that
specific removal before running without the flag. Skip the question when
nothing would be removed. Existing authorization to prune that set still counts.

## 4. Report

Report surveyed and omitted counts, verdicts, applied corrections, unconfirmed
leads recorded, and declined proposals. Mention retirement or pruning only when
it occurred. If no writes happened, say the roadmap is unchanged. For
reconcile-and-pick, return these results to the pick flow before it refreshes
its menu; do not quietly continue on the old ranking.

After an actual question, record
`node <plugin-root>/scripts/trial-log.js question_asked '{"flow":"survey"}'`.
This is a no-op unless the project set `trialLog` and never blocks the flow.