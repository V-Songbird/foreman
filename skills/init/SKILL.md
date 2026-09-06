---
name: init
description: Initialize a project's Foreman roadmap and config from its goals and repository context, or append to an existing roadmap. Use for Foreman setup or an explicitly requested reinitialization; preserves existing history and settings unless replacement was authorized.
---

# Initialize Foreman

Read [the shared runtime](../foreman/runtime.md). This flow creates
`ROADMAP.jsonl` and `.foreman/config.json` using the project's existing context.
Use `scripts/roadmap.js` for every entry write and [the schema](../../roadmap-schema.md)
when needed. Keep setup focused on the project, near-term goals, and the draft.

## Existing project

If a roadmap exists, use an explicit user instruction to choose append or
replace; otherwise ask: start fresh, add to the existing roadmap, or cancel.
Appending preserves all existing entries and the config. Cancel changes nothing.

Replacement requires a recoverable copy before clearing. First attempt the
pathspec commit `git commit -m "chore: snapshot roadmap before foreman re-init" -- ROADMAP.jsonl`.
Never stage broad paths or sweep unrelated staged work into the snapshot.
Treat a clean, already committed roadmap as recoverable only after verifying
its bytes match the committed version and naming that revision.

If the snapshot fails, stop before clearing anything. Offer these recovery
choices, using text if the question tool cannot represent all four:

- `Retry the snapshot` after the git problem is resolved.
- `Save a timestamped backup instead`: copy to
  `ROADMAP.jsonl.backup-YYYYMMDD-HHMMSS` and, when present,
  `.foreman/config.json.backup-YYYYMMDD-HHMMSS`, using the actual current stamp.
  Use native shell copy operations, verify both copies, and report their paths.
  The backups stay untracked and temporary; the user deletes them when satisfied.
- `Continue without a snapshot — the old roadmap is lost`: proceed only on
  the user's explicit choice, never by inference from an earlier overwrite.
- `Cancel`: leave everything untouched.

Clear only after a verified snapshot, verified backup, or explicit acceptance
of data loss. Record the old highest id first, including archive history:
old trailers and anchors survive, so new entries must not reuse those ids.
The first replacement `add` carries `"ids_after":"<old max>"`.

## Understand and draft

Use the user's supplied project description and goals. For missing context,
ask what the project does and its near-term goals, offering to read the repo
and propose them. Ground proposals in README, manifests, entrypoints, and recent
git history; distinguish those proposals from goals the user actually stated.
An empty or unreadable project requires the missing description.

Draft roughly 3–8 useful tasks in plain words: title and why. Use fewer when
the user's scope calls for fewer. Dependencies connect only work that must
happen first; do not manufacture a graph. Predicted paths can be areas or
empty for unknown new code. Identify decision tasks as such.

A request to initialize from already specified tasks authorizes their creation.
When goals or scope were inferred, show the concrete draft and ask for the
needed direction before writing. Explain that the new config will be `{}`:
built-in defaults apply, final acceptance stays on, and optional ledger and
checkpoint-policy choices wait until they matter. The user is reviewing both
artifacts, not just the task names. Revise the draft when requested.

## Write and preserve

1. Add entries in dependency order through `roadmap.js add`, supplying title,
   why, what, source, depends_on, planned_touches, and optional decision kind.
   Direct user goals use `source:"user"`; assistant-proposed goals retain their
   actual origin with `source:"codex-suggested"`. The CLI computes ids, dates,
   replay deduplication, and status.
   An earlier successful `add` must exist before another references its id.
2. Write `.foreman/config.json` as `{}` only if missing. If it exists, leave it
   exactly as it is, including a recorded answer to a first-relevant ask.
   Re-init must not throw away ledger or checkpoint choices. A malformed
   existing config is reported and preserved. `ledger` stays absent initially:
   an absent key records that the user was never asked.
3. Commit only the artifacts this flow wrote, respecting the user's branch
   constraints and the shared runtime's ownership rules. A pathspec commit of
   those files avoids capturing unrelated staged work. Do not overwrite,
   stage, or commit an existing config that this flow did not change.
   If committing is blocked, report the written artifacts and the reason;
   never claim setup was committed or completed when it was not.

Report task count and relevant warnings, preserve every successful partial add
if a later one fails, and point to the roadmap skill for the first pick.

## Trial events

Each is a no-op unless the project set `trialLog` and never blocks the flow.
Record actual interactions, not hypothetical interview steps:

- When setup starts:
  `node <plugin-root>/scripts/trial-log.js init_started '{}'`
- After each question:
  `node <plugin-root>/scripts/trial-log.js question_asked '{"flow":"init"}'`
- Once snapshot recovery resolves:
  `node <plugin-root>/scripts/trial-log.js recovery_attempted '{"kind":"reinit-snapshot","success":<boolean>}'`
- Only once the written artifacts are committed:
  `node <plugin-root>/scripts/trial-log.js init_completed '{"tasks":<successful adds>}'`

Count successful adds, not the drafted total. Cancelled or blocked setup can
leave `init_started` with no `init_completed`; that is an honest unfinished run.
