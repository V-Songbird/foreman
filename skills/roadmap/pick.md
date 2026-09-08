# Pick the next task

**Fast pick** is the default. This branch does not investigate the codebase.
Use the roadmap's stored fields and mechanical preflight; do not claim the code
has been audited or the work already verified.

## Select from the compact menu

Run `roadmap.js next-candidates --menu`, adding `--hint` when the user supplied
one. The CLI filters to unblocked planned entries and ranks by hint relevance,
downstream unblocks, direct unblocks, planned-file collisions, then age. Its
`reason` is the explanation for each rank; preserve the returned order. A hint
with `hint_matched:false` gets one line of explanation and the usual candidates.
Do not read the full backlog to recreate this ranking.

Offer finish-first rows before planned candidates: up to two
`awaiting_acceptance` entries, then up to two `in_progress` entries, oldest first.
The first finish-first row is recommended; otherwise the top planned candidate
is. Each option states id, title, a short everyday explanation of `why`, and the
returned ranking `reason` where present. Use only menu fields, with no duplicate
prose recap. Render these as selectable options using
[the shared picker protocol](../foreman/questions.md); paginate when needed
without dropping choices.

- **Accept**: fetch just that entry. If notes contain `unverified:` lines,
  reconcile them with later evidence for the same result using
  [close-increments.md](close-increments.md). For checks still unverified,
  offer "Test it first (Recommended)" first, quote the relevant lines verbatim,
  and leave the entry awaiting while the user checks them. With no recorded
  unverified lines, do not offer that test option; also omit it when all those
  checks have corroborated resolutions. Otherwise ask whether the result holds
  up. Explicit acceptance calls `update-status` with `status:"done"`;
  declining calls it with `status:"in_progress"` and the user's feedback in
  `notes`. An accept choice settles work and crafts no prompt.
- **Resume**: fetch just the selected entry's full notes. Try a stored Codex
  subagent handle only if the available host still knows that session/agent;
  use its follow-up capability and inspect the result. If unavailable,
  re-craft with `resume:true` from the durable record.
  For a run whose explicit review instruction remains active, preserve
  `reviewEachIncrement:true` and follow [resume-increments.md](resume-increments.md).
  The destination executor compares notes with current work; Fast pick does not
  claim to have performed that comparison. Relay full notes and new user context
  to a live worker too. Do not infer review mode or completed work from an
  `accepted:` prefix. The assembler transports the selected notes independently
  of cross-task recall; do not replace them with a summary in judgment.context.
- **Defer**: when the user says "later" or names a prerequisite outside the
  dependency graph, `update-status` to `deferred` with
  `notes:"deferred: <their trigger>"`, then refresh the menu. Do not defer
  a task merely because another one ranks higher.

A single total option skips the selection question. It still goes through
acceptance when awaiting, or the destination question when executable. With
multiple options, call the picker with "Which task next?" unless the user already
selected one, and collect its answer before fetching the selected entry.
A finish-first recommendation does not prevent choosing new work.

Fetch the selected entry using `roadmap.js list --ids <id>` and require exactly
one row. Keep `what`, full notes, `kind`, and `depends_on_docs` out of the menu;
they are now available for assembly. A missing entry requires reselection.

## Build and deliver

Gather verification rows from the entry's actual requirements before asking
where to run it, following [prepare-increments.md](prepare-increments.md).
One row is a meaningful result with commands, human review, or both. Carry an
explicit request for approval after each result as `reviewEachIncrement:true`;
ordinary splits keep their behavior. Fast pick still uses stored evidence and
the user's request, without a codebase investigation. A pure investigation has
a clear question instead. Ask for the one missing piece when evidence is
insufficient; do not invent a command or turn human-reviewed implementation
into a research task.

Craft a task brief that adds the entry's goal, relevant context, real constraints,
and completion evidence to the destination's active Codex instructions. Treat
implementation steps as suggested approach unless the user or a dependency
requires their order. Preserve the recorded task type: investigation and review
produce findings, and a decision produces a choice. None implies a request to
implement a follow-up change.

Read [skills/roadmap/destination-question.md](destination-question.md) and honor
the supplied destination or ask its shared question and wait for the user's
answer as specified there. Once the destination is known, call
`node "<plugin-root>/scripts/craft-handoff.js"` with JSON stdin:

```json
{
  "entry": "<selected id>",
  "destination": "task",
  "resume": false,
  "split": false,
  "request": "<specific request preserving the selected task type>",
  "judgment": {
    "role": "<project specialization>",
    "goal": "<observable done state>",
    "context": "<entry what and attributed prior notes>",
    "steps": ["<specific work>"],
    "constraints": ["<actual limits>"],
    "verification": [{"run": "<real command>", "expected": "<pass signal>"}]
  }
}
```

`task`, `agent`, and `clipboard` are the builder's destination values. `split:true`
is for ordered local rows, including a requested local run by increments.
For explicitly requested review, add top-level `reviewEachIncrement:true` and
`review:{action,expected}` to every verification row, preserving `goal` and the
known `files`. Automatic-only rows remain valid in ordinary runs; human-only
rows omit `run`/`expected`. Do not infer review mode from a split alone. The entry's own `why` is carried verbatim as its purpose;
do not replace it with a guessed motivation. The builder resolves
`planned_touches`, dependency docs, decision-task rules, prior work, symbols,
lessons, and anchors. It derives the expected file surface unless a deliberate
narrowing or widening was requested. This is a forecast; record an explicit
restriction on file changes in `judgment.constraints` when the user supplied
one. Context may carry attributed prior notes,
but prior claims remain evidence to check.

Include `judgment.invariants` only for observable assertions. Set
`judgment.testFirst:true` only when this task could silently violate an invariant
while the existing checks pass; a failing test that already catches the bug
needs no artificial mutation exercise. Investigation passes `judgment.question`
instead of invented implementation steps or verification; its `request` asks
for the investigation's findings. Carry an explicitly read-only scope in
`judgment.constraints`.

The builder returns `{ok,prompt,profile,signals,tasks?,ledger_ask?,gate,warnings}`.
Profiles are internal standard/reinforced choices based on stale, resumed,
conflicting, constrained, and decision/research signals. Do not expose the
scoring. Evaluate warnings; fix errors using their concrete `fix`/`example`
and re-run. Never deliver `ok:false`, invent symbols to satisfy a prompt, or
claim mechanical preflight established semantic correctness.

If `ledger_ask:true`, a finished entry already touched these files and the
user has never chosen a ledger policy. Ask once:

> **[Beta]** A finished task already touched these files. Should a close be
> able to record one durable sentence about a code area, quoted back to later
> tasks that plan to touch the same files? This one is new and may
> still have rough edges. Turning it off later changes nothing you have
> already recorded.
> Options: `Yes, record and quote lessons`, `No, keep handoffs as they are`

The `[Beta]` marker is part of the question, not decoration: the decision
should explain the feature's maturity and reversible setting. Save
`ledger:{enabled:true|false}` while preserving every other config key.
Do not rebuild this prompt solely for the answer; it affects subsequent picks.

Crafting and copying leave the entry planned. The destination opens it when
work actually begins. Read [delivery.md](delivery.md) and deliver the returned
artifacts unchanged; that reference owns split/checkpoint and acceptance rules.

## Reconcile first, only when requested

**Reconcile and pick** is **investigate → propose → apply → recommend**.
Derive its near-term set from one `next-candidates --menu` result: every
`candidates[].id`, `in_progress[].id`, and `awaiting_acceptance[].id`.
Hand those ids to [survey](../survey/SKILL.md), let its evidence, review, and
authorized repairs finish, then refresh the menu and run Fast pick above.

A stale open row (more than 30 days) or a selected entry's
`survey (unconfirmed):` breadcrumb can justify mentioning this option once.
Age alone never starts a survey; continue the user's requested fast flow.

## Trial events

These are a no-op unless the project set `trialLog` and never block the flow.
Invoke only after the event actually happens, substituting real scalar values.

`next-candidates --menu` already records `menu_shown` and, when a hint is
supplied, `hint_used`. These events are emitted by the CLI; do not record them
again. Only the model-side interactions below need explicit calls:

- Asked a question:
  `node <plugin-root>/scripts/trial-log.js question_asked '{"flow":"pick"}'`
- Chose the recommended planned row:
  `node <plugin-root>/scripts/trial-log.js pick_accepted '{"rank":<one-based position>}'`
- Chose a different planned row or described off-menu work:
  `node <plugin-root>/scripts/trial-log.js pick_overridden '{"chosen_rank":<position or null>}'`

Accept, resume, and defer choices record neither acceptance nor override.
A refreshed menu is a new menu event. A skipped question is never logged.
