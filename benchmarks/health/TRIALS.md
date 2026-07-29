# Project trials: recommendation quality, attention cost, and recovery

Three of the nine metrics in [`roadmap-health.js`](roadmap-health.js) cannot be
read off the roadmap files. Whether a user *accepts* Foreman's recommendation,
how often they pick something else, and whether a hint finds what they meant
are facts about a person choosing — they only exist if a session records the
choice as it happens.

<!-- [Foreman: 143] -->
Four of the seven in [`attention-cost.js`](attention-cost.js) are the same kind
of fact seen from the other side: how long setup runs before the first useful
task, how many questions a task costs, how often a commit is interrupted, and
whether an interrupted or failed run comes back. The roadmap records what work
happened, never what it cost the person doing it, so these need the same
recording.

This document defines that recording. The analysis half is real code:
`roadmap-health.js --trial-log <path>` computes the three recommendation rates
over a log in this format, `attention-cost.js --trial-log <path>` computes the
four attention and recovery ones, and both report `null` with
`"no_trial_log"` when there is none.

<!-- [Foreman: 208] -->
**Half of it records today.** [`scripts/trial-log.js`](../../scripts/trial-log.js)
is the writer, and every event a script or hook already sees is wired: it
costs no skill instruction, because those calls were being made anyway. Not
yet recorded are the events only the model can see — which menu row a user
chose, and that a question was asked. Those are the `pick_accepted`,
`pick_overridden`, `question_asked`, `init_started`, `init_completed`,
`reinit-snapshot` and `failed-verification-retry` rows below, and they are
marked ✗ in the tables. Until they are wired, `recommendation_acceptance`,
`override_rate` and `questions_per_task` stay `null`.

## What a trial may record

Counts, booleans, ranks, elapsed seconds, and names from a closed list. That is
the whole vocabulary.

- **Never** a title, `why`, `what`, note, hint word, file path, entry id,
  project name, or anything typed by the user.
- The only correlating value is `session`: an opaque random token minted per
  session, not derived from the project path, the user, or any id. It exists so
  a menu and the pick that answered it can be paired; it identifies nothing
  outside the log.
- Ranks are positions in a menu the user just saw. A rank is not a task.
- Elapsed seconds are a duration between two of this log's own events, never a
  wall-clock time. A duration says how long something took; it does not say
  when anyone was at their desk.
- Every `flow`, `hook`, `reason_class`, and `kind` value is one name from the
  closed list this document fixes below — Foreman's own branch and refusal
  names, decided at write time, never free text and never a message a script
  or git produced. `safe-commit`'s dirty-tree `reason` string in particular is
  prose about the user's working tree and is deliberately **not** what
  `reason_class` records.
- **Opt-in.** No trial runs unless the user turns it on, and turning it on is a
  question about *this* project, not a global default.
- **Local.** The log is `.foreman/trial-log.jsonl` in the project — the same
  directory as `config.json` and `archive.jsonl`, and never uploaded anywhere.
  Foreman has no hosted service and this must not become the reason it needs
  one.
- **Deletable.** Deleting the file at any moment is a supported action that
  needs no cleanup: nothing reads it except this benchmark, and a missing log
  means the rates are `null`, not zero.
- Append-only, one JSON object per line. A partially written last line is
  tolerated — `loadTrialLog` counts it as malformed and keeps the rest.

## Event records

Every line carries `event`, `ts` (date only, `YYYY-MM-DD` — the day is enough
resolution for a rate, and a timestamp is one more identifying signal), and
`session`. Per type:

### Recommendation events

| | `event` | Extra fields | Written when |
| --- | --- | --- | --- |
| ✓ | `menu_shown` | `candidates` (integer, rows offered), `hint` (boolean) | A candidate menu was put in front of the user |
| ✗ | `pick_accepted` | `rank` (integer, 1-based position of the recommended row) | The user took the row Foreman recommended |
| ✗ | `pick_overridden` | `chosen_rank` (integer, or `null` for an off-menu answer) | The user took a different row, or described something else |
| ✓ | `hint_used` | `hit` (boolean) | A pick hint was passed to the ranker |

```jsonl
{"event":"menu_shown","ts":"2026-07-28","session":"k3f9a2","candidates":3,"hint":false}
{"event":"pick_accepted","ts":"2026-07-28","session":"k3f9a2","rank":1}
{"event":"menu_shown","ts":"2026-07-28","session":"k3f9a2","candidates":3,"hint":true}
{"event":"hint_used","ts":"2026-07-28","session":"k3f9a2","hit":true}
{"event":"pick_overridden","ts":"2026-07-28","session":"k3f9a2","chosen_rank":3}
```

`rank` is usually 1, but not by definition: the finish-first check can put an
accept or resume row above the recommendation, which moves the `(Recommended)`
tag down the list. Recording the position keeps that visible instead of
assuming it away.

<!-- [Foreman: 143] -->
### Attention and recovery events

| | `event` | Extra fields | Written when |
| --- | --- | --- | --- |
| ✓ | `session_start` | — | A main session started on a project that has a roadmap |
| ✗ | `init_started` | — | `/foreman:init` began its first question |
| ✗ | `init_completed` | `tasks` (integer, entries written) | `/foreman:init`'s write phase finished and committed |
| ✓ | `first_pick` | `seconds_since_init` (integer, or `null`), `sessions_since_init` (integer, or `null`) | The first handoff of this project was delivered |
| ✗ | `question_asked` | `flow` (one of `init`, `pick`, `add`, `correct`, `status`, `survey`, `sprint`) | One `AskUserQuestion` call was put to the user |
| ✓ | `commit_interrupted` | `hook` (one of `safe-commit`, `post-commit`, `task-completed`), `reason_class` (see below) | A Foreman commit path stopped and handed the decision back |
| partly | `recovery_attempted` | `kind` (one of `reinit-snapshot`, `resume-in-progress`, `failed-verification-retry`), `success` (boolean) | A recovery path ran to a definite outcome |

`recovery_attempted` records `resume-in-progress` today, both halves.
`reinit-snapshot` and `failed-verification-retry` both sit inside a skill flow
and are not written yet.

<!-- [Foreman: 208] -->
`first_pick`'s `seconds_since_init` is always `null` as recorded today, and
that is not a placeholder. This log stores dates, never times, so an elapsed
duration cannot be derived from it — it would have to be measured inside one
process that saw both ends, and no process sees both. `sessions_since_init`
is a count of `session_start` rows and is real whenever `init_completed` has
been recorded.

```jsonl
{"event":"session_start","ts":"2026-07-28","session":"m7q1x4"}
{"event":"init_started","ts":"2026-07-28","session":"m7q1x4"}
{"event":"init_completed","ts":"2026-07-28","session":"m7q1x4","tasks":6}
{"event":"question_asked","ts":"2026-07-28","session":"m7q1x4","flow":"init"}
{"event":"first_pick","ts":"2026-07-28","session":"m7q1x4","seconds_since_init":214,"sessions_since_init":0}
{"event":"commit_interrupted","ts":"2026-07-28","session":"m7q1x4","hook":"safe-commit","reason_class":"unexpected_files"}
{"event":"recovery_attempted","ts":"2026-07-28","session":"m7q1x4","kind":"resume-in-progress","success":true}
```

`seconds_since_init` is the gap between this project's `init_completed` and its
first delivered handoff, and it is `null` whenever the two fall in different
sessions — a number covering an overnight gap would measure sleep, not setup.
`sessions_since_init` counts `session_start` events in between and is the
honest answer in that case, so the two are recorded together and analyzed
separately. Both are `null` on a project whose init predates the trial.

`reason_class` is one of the refusal names `scripts/safe-commit.js` already
returns — `dirty_tree` (its `begin` reporting `dirty: true`),
`head_moved_since_baseline`, `no_task_changes`, `unexpected_files`,
`staging_incomplete`, `staging_failed`, `post_commit_attestation_failed` —
plus `verification_declined` for the `requireVerification` hold. Names only:
never the count of dirty files, never which files were unexpected.

## Where each event would be recorded

### Recommendation events

Exact branches in `skills/roadmap/SKILL.md`, Fast pick (and, unchanged,
whenever Reconcile and pick composes it):

- **`menu_shown`** — step 1, immediately after
  `roadmap.js next-candidates --menu` returns and before Q1 is asked.
  `candidates` counts every row the user will see: `candidates[]` plus the
  accept/resume rows the finish-first check promotes. The **single-option
  skip** takes this path too (`candidates: 1`), even though no question is
  asked — a menu of one is still a recommendation the user accepted or didn't.
  Reconcile and pick's step 3 re-runs the menu, so it emits a second
  `menu_shown` and its pick events belong to that one.
- **`pick_accepted`** — Q1's answer branch, when the chosen option is the row
  carrying `(Recommended)`.
- **`pick_overridden`** — the same branch, when the answer is any other row
  (`chosen_rank` = its 1-based position), or the standard escape describing
  something not on the list (`chosen_rank: null`). The **defer** sub-branch
  ("not yet", "later") is not a pick: it writes no event, re-runs the menu, and
  the re-asked Q1 emits a fresh `menu_shown`.
- **`hint_used`** — step 1's hint sub-branch, once per menu built with
  `--hint`. `hit` is the script's own `hint_matched`, which is already exactly
  this fact: `false` means no candidate matched any hint word and the order is
  just the standard ranking.

Accept and resume choices from the finish-first check settle existing work
rather than answering "what next", so they record neither `pick_accepted` nor
`pick_overridden`. They are counted in the `menu_shown` row's `candidates`
because the user had to read past them.

<!-- [Foreman: 143] -->
### Attention and recovery events

Each of these already has a surface that reads the roadmap or asks the
question, so switching a trial on adds a write to an existing branch and
nothing else:

- **`session_start`** — `hooks/session-start.js`, on the same `startup|clear`
  matcher that already gates it, and **before** its silent-when-nothing-to-say
  return. The hook stays silent either way; the event is the denominator for
  `sessions_since_init`, so it cannot depend on whether there happened to be an
  open entry to mention.
- **`init_started`** — `skills/init/SKILL.md`, at the first question actually
  put to the user: the Pre-check's Q1 on a project that already has a roadmap,
  Call 1's Q1 otherwise. A Pre-check `Cancel` therefore leaves an
  `init_started` with no `init_completed`, which is the correct record of an
  abandoned setup.
- **`init_completed`** — the same file's Write phase, after the `add` loop and
  the commit of both files. `tasks` is how many `add` calls succeeded, not how
  many were drafted.
- **`first_pick`** — `skills/roadmap/SKILL.md`, Pick the next task, at delivery
  of the assembled handoff (step 3's `check-prompt.js` pass, immediately before
  the prompt goes to its destination), and only when the log holds no earlier
  `first_pick`. A pick that never survived the gate is not a first useful task.
- **`question_asked`** — every `AskUserQuestion` call in `skills/`, one event
  per call, `flow` naming the branch it sits in and never the question:
  `init` for all three of `skills/init/SKILL.md`'s calls, `pick` / `add` /
  `correct` / `status` for `skills/roadmap/SKILL.md`'s four branches (Call 1's
  menu and the archive-finished-work ask belong to the branch the user ends up
  in), `survey`, and `sprint` for the experimental skill. A question batched
  into one call with others is one event — the cost being measured is the
  interruption, not the number of fields in it.
- **`commit_interrupted`** — every `ok:false` return from
  `scripts/safe-commit.js` (`begin` reporting `dirty: true`, and `finish`'s
  `head_moved_since_baseline` / `no_task_changes` / `unexpected_files` /
  `staging_incomplete`), recorded by the caller that receives it, plus
  `hooks/task-completed.js` when `requireVerification` holds a close
  (`verification_declined`). `hook` names the surface, `reason_class` copies
  the refusal name verbatim and nothing else from the result.
- **`recovery_attempted`, `reinit-snapshot`** — `skills/init/SKILL.md`, Write
  phase step 1's four-option question after a failed snapshot. `success: true`
  for a retry that exited 0 or a backup that copied; `success: false` for
  `Continue without a snapshot` and for `Cancel`. One event per resolution, not
  per retry loop.
- **`recovery_attempted`, `resume-in-progress`** — two halves, written by the
  two surfaces that already read the roadmap. `success: true` from
  `hooks/task-completed.js` when an entry that carried commits or
  `observed_touches` *before* this session reaches a terminal status — an
  interrupted run that came back. `success: false` from
  `hooks/session-start.js`, once per startup, for each open entry it surfaces
  that already carries commits — a run that has not come back yet. A resume
  that takes three days is therefore three failures and one success: the rate
  is a per-day view of recovery, not a per-run one, and `attempts` is reported
  beside it so that stays visible. Pairing the halves per run would need an
  entry identifier in the log, and no privacy-safe version of that is worth the
  number.
- **`recovery_attempted`, `failed-verification-retry`** — the destination
  session, at the bounded fix loop `prompt-template.md`'s verification block
  fixes ("after two failed fix attempts, stop and report"): `success: true`
  when a retry made the command pass, `false` when the ceiling was reached.
  Only a tracked destination can record it — a clipboard handoff runs where
  this log does not exist, so its retries are invisible and the metric is a
  floor, never a total.

## The analysis

`roadmap-health.js --trial-log .foreman/trial-log.jsonl` adds three metrics:

- **`recommendation_acceptance`** — `pick_accepted / (pick_accepted +
  pick_overridden)`, with `menus_shown` alongside it.
- **`override_rate`** — `pick_overridden / (pick_accepted + pick_overridden)`.
- **`hint_success`** — `hint_used` with `hit: true` over all `hint_used`.

Acceptance and override are each computed from their own event count, not as
one minus the other. They sum to 1 in a complete log, so a pair that does not
is evidence of dropped events rather than a hidden preference. A log with no
decisions in it reports `null` with `"no_events"` — an empty trial is not a 0%
acceptance rate.

<!-- [Foreman: 143] -->
`attention-cost.js --trial-log .foreman/trial-log.jsonl` adds four more, over
the same log:

- **`setup_to_first_task`** — the median `seconds_since_init` across
  `first_pick` events, with `seconds_samples` beside it, and the median
  `sessions_since_init` reported separately for the picks that crossed a
  session boundary. Two shapes of the same question, never averaged together.
- **`questions_per_task`** — `question_asked` over the number of tasks taken,
  broken down `by_flow`. The denominator is 142's own decision count,
  `pick_accepted + pick_overridden`, and the output names it: nothing in the
  log marks a task *finished*, so this is questions per task **taken**, which
  is a slightly optimistic reading of PRODUCT-STRATEGY.md's "questions per
  completed task" and is labeled rather than silently substituted.
- **`commit_interruptions`** — `commit_interrupted` over the same denominator,
  broken down `by_reason` and `by_hook`. A `dirty_tree` refusal and an
  `unexpected_files` stop are both interruptions but not the same product
  problem, so the breakdown is the number that matters and the aggregate is
  context.
- **`recovery_success`** — `recovery_attempted` with `success: true` over all
  of them, with `by_kind` giving reinitialization, resume, and failed
  verification their own attempt/success pairs. PRODUCT-STRATEGY.md asks about
  those three separately and the aggregate hides which one is failing.

The three derivable metrics in the same report — task-to-commit accuracy,
dirty-file capture, and prompt overhead — need no trial and are computed from
the roadmap and `prompt-template.md` alone.

`recovery_success` also carries a `proxy` block, and it is labeled `proxy`
because it is not the metric: it counts open entries that already have commits
or `observed_touches` behind them — runs that *were* interrupted — using the
same mechanical `resumed` signal `prompt-template.md`'s profile rule uses. It
says how much interrupted work exists, never how much of it recovered. Without
a trial that is the honest ceiling, and it is reported next to a `null` rate
rather than in place of one.

## Protocol

- **Unit.** One project, one developer, real work. Not a fixture: the question
  is whether a recommendation survives a roadmap that has been lived in, which
  is exactly what a synthetic backlog cannot show.
- **Duration.** 30 days minimum, because that is the window everything else
  here is measured in — the staleness threshold, and PRODUCT-STRATEGY.md's
  "stale-entry rate after 30 and 90 days". A trial shorter than one staleness
  window cannot see the failure mode it is looking for. 90 days for the
  second reading.
- **Minimum volume.** 20 recorded decisions. Below that the rate is anecdote;
  report the raw counts and no rate.
- **Baseline.** The same project's own earlier period, not another user's:
  Foreman's ordering is deterministic, so the comparison is the *roadmap*
  ageing, not the sorter changing. Read the 30-day and 90-day numbers against
  each other. A second arm — the same roadmap picked from by hand — is a
  possible extension, and is not required for the first reading.
- **Success.** PRODUCT-STRATEGY.md sets no numeric threshold and this document
  does not invent one. It states the decision the numbers feed:

  > Do not add estimates, deadlines, categories, or numeric priorities without
  > evidence. If recommendation overrides are frequent, test one minimal user
  > signal such as a temporary `focus` marker before adopting a full priority
  > system.

  So the trial's job is to answer *frequent or not*, and its exit criterion is
  the one already written down: "recommendation reasons are visible and
  override behavior is measured". A stable override rate with the acceptance
  rate holding is the release-sequence signal; an override rate that climbs as
  the roadmap ages is the case for the `focus` marker, tested on its own before
  any priority field.
- **Publication.** If a number from a trial ever supports a public claim, it
  carries what PRODUCT-STRATEGY.md's reproducibility section requires:
  configuration, duration, repetition count, aggregate and per-period results,
  and the claim's limitations. Raw logs stay private; they are the user's.

<!-- [Foreman: 143] -->
### What the attention and recovery numbers need on top

Same log, same project, same 30/90-day windows — one trial produces all seven
metrics and no separate run is needed. What differs is how much of each a
single project can supply:

- **`setup_to_first_task` is n=1 per project.** `first_pick` fires once, ever.
  A single-project trial reports one number and calls it one number; the median
  only becomes a median across separate projects' logs, each read on its own.
  This is the metric a synthetic fixture genuinely cannot fake and also the one
  a single trial can least afford to generalize from.
- **`questions_per_task` and `commit_interruptions` reuse the 20-decision
  floor.** They share the recommendation metrics' denominator, so they become
  reportable at exactly the same moment and no earlier.
- **`recovery_success` has no volume floor worth setting.** Recovery events are
  rare by design — a project that never crashes, never gets interrupted, and
  never fails a verification produces none, and that is a good outcome rather
  than a failed trial. Report `attempts` and `by_kind` raw at any count, and a
  rate only above 10 attempts of a single kind.
- **Success.** PRODUCT-STRATEGY.md again sets no numeric threshold, and this
  document again does not invent one. The decisions the numbers feed are
  already written down. The open question these answer is whether "users accept
  the setup and commit-time attention costs" — so a `commit_interruptions`
  breakdown dominated by `dirty_tree` is the safe-commit design working as
  principle 4 requires ("dirty work is never swept into a Foreman commit"), and
  one dominated by `unexpected_files` is the prediction being wrong, which is
  the derivable task-to-commit accuracy metric's problem, not the commit
  path's. For recovery, the exit criteria are the bar: "reinitialization has a
  confirmed recovery path" and "interrupted work has a tested, understandable
  recovery path" — `by_kind` says which of the three is not there yet.
- **Prompt overhead needs no trial at all**, and its decision is already
  stated: "the correct product response is likely a short default handoff and
  an optional reinforced handoff, not indiscriminate prompt reduction". The
  ratio measures whether the standard profile actually delivers that; where the
  crossover sits is a benchmark-harness question, not a trial one.
