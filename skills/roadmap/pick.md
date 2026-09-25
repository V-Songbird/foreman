# Branch: Pick the next task

<!-- [Foreman: 141] -->
This is **Fast pick**, the default and the whole of this branch — nothing
below changes because the other mode exists. **Reconcile and pick** is the
deeper mode for when the roadmap itself has gone stale: it repairs the
near-term entries first, then runs this same flow on the repaired data.

**This branch does not investigate the codebase. At all.** No file reads, no
searches, no exploring files to confirm or expand what an entry says. The
selected entry's own fields are the only input to the prompt. Verifying
those claims against reality is the handed-off session's job, at the start
of *its* work — that's exactly what the `<truth_grounding>` block in
`prompt-template.md` exists for. Picking a task should be fast: one compact
mechanical menu, one question, then one detailed read of the selected entry
only.

Say it that way whenever the flow explains itself, and never more than it
does: the entry's paths and symbols get checked mechanically by
`resolve-symbols.js` while the prompt is built, and the handoff checks the
rest of its claims once the work starts. Never tell the user a pick was
checked against the code, and never say the work has been confirmed —
nothing here has read the code, and nothing here has run.

<!-- [Foreman: 141] -->
### Reconcile and pick — the deeper mode, only when the user asks

When the user asks for it, read [reconcile.md](reconcile.md)
(`${CLAUDE_PLUGIN_ROOT}/skills/roadmap/reconcile.md`) and follow it: it scopes
a survey pass to the near-term entries, then runs this flow's steps on the
repaired data.

**Offering it from Fast pick — one line, never a run.** Fast pick may mention
this mode once, in a single line, when its own data already shows staleness.
Never as a blocking question, never started on your own, and never because the
roadmap merely looks old — age alone never starts a survey. Two mechanical
signals, both already in hand:
- a menu `in_progress` or `awaiting_acceptance` row whose `updated_at` is more
  than **30 days** before today (the same stale signal step 3's profile check
  reads);
- the selected entry's `notes` carrying a `survey (unconfirmed):` breadcrumb —
  a lead an earlier survey could not ground, visible after the selected-entry
  load.

Menu candidate rows carry neither `updated_at` nor `notes`, so there is no
staleness to read there — don't fetch any to find some. If the user says yes,
read [reconcile.md](reconcile.md) and start at its step 1; if they don't
answer or say no, Fast pick continues unchanged.

1. `node ${CLAUDE_PLUGIN_ROOT}/scripts/roadmap.js next-candidates --menu` —
   already filtered (unblocked: `planned` with every `depends_on` done),
   ranked (hint relevance when a hint was given, then most open work waiting
   behind it — `unblocks_total` counts the whole dependency chain, then direct
   `unblocks` — then collision-free before colliding, then oldest), limited to
   3 by default, with a `collision` flag per candidate (its `planned_touches`
   overlaps a currently-`in_progress` task's `planned_touches` — predicted
   surfaces only, never where either has already been — folder-aware, so a
   planned `src/auth/` collides with an in-progress `src/auth/middleware.ts`
   and vice versa) and a `reason` per candidate — the ranking key that
   actually placed that row. This is Foreman's **recommended** ordering, the
   default one, not a claim to have found the objectively best task: the sort
   knows dependencies, hint words, collisions, and age, and nothing about
   product value, urgency, or effort. Do not read the full backlog to
   re-derive this by calling `list` and reasoning over the whole file yourself
   — that's exactly the cost `next-candidates` exists to cut. `--menu` returns
   only choice-time fields; do not fetch or reconstruct the unselected
   entries' details.

   **If args carried a pick hint**, read [hint.md](hint.md)
   (`${CLAUDE_PLUGIN_ROOT}/skills/roadmap/hint.md`) before running the command.

   **Never paste or print this JSON output into your chat response.** It's
   input to the next step, not something to show. It deliberately contains
   only the short `why`, collision state, and ranking signals needed for
   the choice.
2. Go straight to Q1 below — no narrative recap of the candidates in prose
   first, the question *is* the presentation.

<!-- [Foreman: 209] -->
**Trial log.** Which row the user chose exists only in this turn — no script
and no hook can see it, so these lines are the only reason the recommendation
numbers exist at all. A valid call records nothing unless the project set
`trialLog`, so it needs no check first; a malformed one fails in every
project. Either way it never blocks the flow.

`next-candidates --menu` has already recorded `menu_shown` and, on a menu
built with `--hint`, `hint_used` —
these events are emitted by the CLI; do not record them again.
The lines below are the events only this turn can see, each invoked only after
the event actually happens, with real values:

- after each question the user actually saw in this flow — Q1, the accept or
  test question, the destination question, the ledger question:
  `node ${CLAUDE_PLUGIN_ROOT}/scripts/trial-log.js question_asked '{"flow":"pick"}'`.
  A skipped question is never logged.
- exactly one of these on Q1's answer:
  `node ${CLAUDE_PLUGIN_ROOT}/scripts/trial-log.js pick_accepted '{"rank":<the row's 1-based position>}'` when the
  chosen planned row carries `(Recommended)`, or
  `node ${CLAUDE_PLUGIN_ROOT}/scripts/trial-log.js pick_overridden '{"chosen_rank":<the row's 1-based position, or null when the answer described something not on the list>}'`
  for any other planned row.

An accept, resume, or defer choice settles existing work rather than answering "what next", so it records neither acceptance nor override. The **defer**
sub-branch records neither either: it re-runs the menu, and that
`next-candidates --menu` call records a fresh `menu_shown`.

**Finish-first check**: if the script's `awaiting_acceptance` or `in_progress`
array is non-empty, work already exists — offer to settle it before starting
something new. Those entries take the top option slot(s) in Q1 — up to two
`awaiting_acceptance` entries, then up to two `in_progress` entries, oldest
`updated_at` first — with the first one carrying `(Recommended)`. A
finish-first recommendation never prevents choosing new work.
- `awaiting_acceptance` rows lead, labeled `Accept: <title> (<id>)`.
  Description: `why` plus "finished, waiting on you since <updated_at>". On
  that choice (**Accept**), read [accept.md](accept.md)
  (`${CLAUDE_PLUGIN_ROOT}/skills/roadmap/accept.md`) and follow it; no prompt
  is crafted for an accept.
- `in_progress` rows follow, labeled `Resume: <title> (<id>)`. Description:
  `why` plus "in progress since <updated_at>". The selected entry's full
  notes — including any dispatch marker — are fetched only after the choice.

Planned candidates fill the remaining slots. This is a suggestion, never a
gate — picking a planned candidate proceeds exactly as before.

**Single-option skip**: when the menu would hold exactly one option —
candidates, accept, and resume entries combined — skip Q1 and take that entry
as the pick (a lone accept row still runs [accept.md](accept.md), not Q2). Q2
then opens with it instead: prefix Q2's question with the entry's `title`
(`<id>`) and its `why` restated per Q1's description rule below, so the user
can still veto or redirect through Q2's escape; when Q2 is skipped because
the user already named a destination, state that title (id) and why in one
line before crafting instead. When the user already named the task they want,
take it the same way instead of asking Q1. Otherwise, two
or more options of any kind ask Q1 as usual.

**Q1** — "Which task next?" — `AskUserQuestion` in Claude Code; in Codex, the
picker in [questions.md](../foreman/questions.md), paged with a More tasks
choice when its option limit requires it, never dropping a row.
Options, one per candidate (already ranked — take the order as given,
hint or not; accept options lead, then resume options, when those arrays are
non-empty, per the finish-first check above):
- Label: `<title> (<id>)` (a Codex option string leads with the id instead).
  The first-ranked candidate's label gets `(Recommended)` appended — unless a
  finish-first option already carries it — say so with the tag instead of
  making the user infer it from list order alone.
- Description: the entry's `why` restated in your own everyday words, one
  sentence, written for a teammate who has never seen this codebase —
  never the field pasted verbatim — then the row's `reason` as a short
  trailing clause, so the user sees what put this row where it is and can
  overrule it on the spot. Use the returned `reason` as the fact it states
  (reworded to fit the sentence is fine, contradicted is not); it already
  carries the collision caution when there is one, so don't restate that
  separately. Never
  fold `what`/the file surfaces/`notes`/`unblocks` into the description — none of
  that is a pick-time decision input if the session isn't ground-truthing
  anyway (that's `foreman:survey`'s job); it only bloats the dialog. The
  overlap clause `reason` carries on a `collision:true` row is a caution,
  never a blocker.
- In Claude Code, a preview: plain text built only from the menu row's
  `title`, compact `why`, `reason`, and ranking signals, capped at ~6 lines.
  It supplements the description rule above, never replaces it. Resume rows
  use `title`, compact `why`, and `updated_at`. A harness whose
  `AskUserQuestion` doesn't support `preview` simply ignores the field —
  no fallback logic needed.

Plus the standard escape to describe something else not on the list.

**Defer**: if the user waves a candidate off as "not yet", "later", or "not
until X" — rather than just picking a different one — or names a prerequisite
outside the dependency graph, read [defer.md](defer.md)
(`${CLAUDE_PLUGIN_ROOT}/skills/roadmap/defer.md`) and follow it. Don't defer on
your own judgment — a task that merely ranks lower stays `planned`.

**Selected-entry load**: after Q1 (or the single-option skip) chooses an
entry, fetch that entry alone:
`node ${CLAUDE_PLUGIN_ROOT}/scripts/roadmap.js list --ids <id>`.
Require exactly one returned row — a missing entry means the user reselects —
and use that full row as the selected entry for every step below. Do not
fetch the other menu rows. This is where `what`,
`planned_touches`/`observed_touches`, `depends_on`, full `notes`, `doc`, and
`kind` first enter the flow. For this targeted read, the script also derives
`depends_on_docs` as bounded paths from direct dependencies; it does not
return those dependency entries.

**Resume via the live worker, before Q2**: if the picked option was a resume
entry, read [resume.md](resume.md)
(`${CLAUDE_PLUGIN_ROOT}/skills/roadmap/resume.md`) now and follow it. It
either continues the worker that already holds the task and stops, or sends
the flow on to Q2 below unchanged.

**Gather the checks before asking.** Q2's labels depend on how many
verification rows this entry actually yields, so work out the
`verification` array (step 3's bullet says how) *before* the question. The
count never removes an option — all four are always offered — it decides
which of them carries a caution.

**Q2** — the destination question. When the user already named a
destination, use it and skip the question. Otherwise read
[destination-question.md](destination-question.md)
(`${CLAUDE_PLUGIN_ROOT}/skills/roadmap/destination-question.md`) now and do
exactly what it says: it carries the question, its four always-offered
options, and the two labels that steer without locking. Foreman never asks
which model runs the work and never sets one: a background agent inherits
this session's model, and a pasted prompt runs wherever the user pastes it.

3. **Gather the judgment fields, then call `craft-handoff.js` once.** Every
   field below comes from the selected entry's own fields and the user's
   request — no investigation, same rule as the top of this branch:
   - `request` ← one specific sentence that preserves the entry's task type:
     an investigation or review asks for its findings, a decision asks for
     the choice, and neither implies a follow-up change.
   - `role`/`goal` ← a role and one goal sentence for what "done" looks
     like, drawn from the entry's `title`/`why`.
   - `purpose` — do not gather it for a roadmap pick. The script writes
     the entry's own `why`, word for word, into `task_context` as the
     purpose line ("Why this task exists: …"), so the user's stated
     intention reaches the session unparaphrased; a `purpose` passed here
     would be dropped in its favour.
   - `context` ← the entry's `what`. Do not copy its `notes`: when they
     are non-empty the script adds them to `context` itself, escaped and
     marked as recorded evidence, so the destination reads prior findings
     (a survey verdict, a defer trigger, a previous session's evidence) as
     data to check.
     `depends_on_docs` needs no gathering: when the selected entry carries a
     non-empty one, the script folds those resolved document paths into
     `context` on its own.
   - `steps`/`constraints` ← the entry's own `what`, split into what to
     implement and any hard limits or patterns to follow; an explicit file
     restriction or read-only scope the user gave goes in `constraints`. An
     investigation passes `question` instead of implementation steps.
     `task_rules` carries no read-first bullet — a reinforced handoff
     states that step once in its `<plan>` block, and a standard one carries
     the concise truth line that binds every claim in the prompt, so don't
     add a copy here.
   - `expectedFileSurface` — do not gather it either. The script fills the
     "Expected file surface:" constraint line from the entry's
     `planned_touches` on its own. Pass the field only to narrow or widen
     that list on purpose; an entry with no `planned_touches` gets no line,
     which is the one honest case.
   - `invariants` ← any assertions already stated in `why`/`what`/`notes`,
     rewritten as observable assertions — never a contract name. Nothing
     assertable means the field is omitted; that is normal.
   - `verification` ← the checks, in running order, gathered before Q2
     properly instead of settling for one inferred command: how many rows
     there are decides the split's caution, and this array is what the split
     cuts on (pass `"split":true` below). Never invent a command.
     - In Claude Code, one `Run:`/`Expected:` pair per array entry. A split
       cuts on these rows, so when a check verifies its own slice of the work,
       name that slice on its row with `goal` (and `files` when the entry's
       own fields say which). An entry with nothing runnable at all omits
       `verification` and carries `question` instead — the question under
       investigation, not a prescribed exploration sequence.
     - In Codex, write the rows as [prepare-increments.md](prepare-increments.md)
       describes.
     - In Antigravity, write them the same way, since the builder gives
       Antigravity the Codex form, but never add `reviewEachIncrement` or
       `review`: approval after each result is not available there.

     Set `testFirst: true` for the test-first ordering — write the invariant
     test first, confirm it passes against the unmodified code, break the
     invariant on purpose and confirm it goes red, then implement — only
     for a silent-failure entry, one whose breakage would pass the
     existing checks; a failing test that already catches the bug needs no
     artificial mutation exercise. Omit it otherwise.
   - `relevant_files` needs no gathering: the script resolves the selected
     entry's own `planned_touches` through `resolve-symbols.js` internally
     and cites the symbols it finds — still no investigation, since it
     reads only files the entry already named. Same for the decision-entry
     task-rule bullet, the lessons the ledger has about those files, and any
     `[Foreman: <id>]` anchor already sitting in them: all three are
     gathered by the script, nothing to gather here.

   Then, one call:
   ```
   echo '{"entry":"<id>","host":"claude|codex","destination":"task|agent|clipboard","resume":<true only if this pick came from in_progress>,"split":<true only when Q2 picked "Execute here, split by check">,"request":"<specific request preserving the task type>","judgment":{"role":"<role>","goal":"<goal sentence>","context":"<context prose>","steps":["<what to implement/fix>"],"constraints":["<hard limits, patterns to follow>"],"verification":[{"run":"<exact command>","expected":"<pass/fail signal>"}],"testFirst":<true only for a silent-failure entry>,"invariants":["<one observable assertion per line>"]}}' | node ${CLAUDE_PLUGIN_ROOT}/scripts/craft-handoff.js
   ```
   `host` is `claude` in Claude Code, `codex` in Codex and `antigravity` in
   Antigravity, which the builder gives the Codex form of the prompt. In
   Claude Code, remember: the copy of this skill you are reading has
   the variable already resolved to a version-pinned cache path — type
   `${CLAUDE_PLUGIN_ROOT}` back literally in the stdin JSON above and in
   the delivery calls below; the gate errors on a resolved plugins-cache
   path. In Codex and Antigravity, send the JSON through a payload file or
   here-string as the runtime describes.

   Returns one JSON line: `{ok, prompt, profile, signals, tasks?,
   ledger_ask?, gate, warnings}`. `profile` and `signals` are internal
   bookkeeping — never name either in anything the user reads. Surface any top-level
   `warnings` verbatim whenever that array is non-empty — including when
   `ok` is `true`, since a path not on disk yet, or an unanswerable
   verification command, has to be judged before delivery. When `ok` is
   `false`, don't retry blind and never deliver it. Each `gate.errors` entry
   is `{error, fix, example}` — `error` names the judgment field that's too
   thin (missing steps, missing verification, an unresolved reference),
   `fix` is the one action that clears it, and `example` is the shape to
   copy when a literal helps more than a sentence. Feed that JSON back to
   yourself verbatim, repair the named field from the entry and the user's
   request, and re-call, rather than resending the same stdin hoping it
   passes; show the errors to the user when the repair needs their answer.
   Never invent symbols to satisfy the gate, and never claim its mechanical
   preflight established that the work is correct.

   **`ledger_ask: true`** — the first moment lesson lines could pay. Ask the
   question in [ledger-question.md](ledger-question.md)
   (`${CLAUDE_PLUGIN_ROOT}/skills/roadmap/ledger-question.md`) once, before
   delivering.

4. **Foreman never marks the entry `in_progress` itself.** It stays
   `planned` — even after this prompt is assembled, delivered, or copied —
   until whichever session actually starts the work opens it: in Claude Code
   through the task hook or the `update-status` call embedded in step 3's
   prompt, in Codex and Antigravity through `hooks/codex-task.js start`.
   Picking or copying a task is not the same as starting it; only the
   session that begins acting on it should say so.
5. Deliver via whatever Q2 picked by following [delivery.md](delivery.md)
   (`${CLAUDE_PLUGIN_ROOT}/skills/roadmap/delivery.md`), using the `prompt`
   (and `tasks[]` when present) craft-handoff just returned — never re-derive,
   re-split, or re-embed any of it.

**Hard rule — state this explicitly if the user pushes back**: this skill
never silently executes a task — work starts only once the user has chosen a
destination, in Q2 or in their own request — and it never mentions or routes
to any other plugin. "Do it now" means `Execute here`, not this skill
deciding on its own.
