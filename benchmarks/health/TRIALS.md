# Project trials: recommendation quality

Three of the nine metrics in [`roadmap-health.js`](roadmap-health.js) cannot be
read off the roadmap files. Whether a user *accepts* Foreman's recommendation,
how often they pick something else, and whether a hint finds what they meant
are facts about a person choosing — they only exist if a session records the
choice as it happens.

This document defines that recording so it can be switched on later. **Nothing
records anything today.** No skill and no hook writes a trial log; entry 142
defines the measurement, and acting on it is separate work. The analysis half
is real code and ships now: `roadmap-health.js --trial-log <path>` computes the
three rates over a log in this format, and reports them `null` with
`"no_trial_log"` when there is none.

## What a trial may record

Counts, booleans, and ranks. That is the whole vocabulary.

- **Never** a title, `why`, `what`, note, hint word, file path, entry id,
  project name, or anything typed by the user.
- The only correlating value is `session`: an opaque random token minted per
  session, not derived from the project path, the user, or any id. It exists so
  a menu and the pick that answered it can be paired; it identifies nothing
  outside the log.
- Ranks are positions in a menu the user just saw. A rank is not a task.
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

| `event` | Extra fields | Written when |
| --- | --- | --- |
| `menu_shown` | `candidates` (integer, rows offered), `hint` (boolean) | A candidate menu was put in front of the user |
| `pick_accepted` | `rank` (integer, 1-based position of the recommended row) | The user took the row Foreman recommended |
| `pick_overridden` | `chosen_rank` (integer, or `null` for an off-menu answer) | The user took a different row, or described something else |
| `hint_used` | `hit` (boolean) | A pick hint was passed to the ranker |

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

## Where each event would be recorded

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
