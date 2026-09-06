# Correct a task

This branch applies the user's correction; it does not investigate the codebase.

1. Fetch only the selected entry with `roadmap.js list --ids <id>`. Resolve a
   title through `list --summary` first if needed.
2. Prepare current → proposed values for `title`, `why`, `what`, `kind`, or
   `planned_touches`. A planned-file array is replaced in full, so show the
   complete replacement. Apply an explicit, sufficiently specified correction;
   ask only when the proposed meaning is still uncertain or was inferred.
3. Call `roadmap.js correct` with this shape:
   `{"id":"...","expected_updated_at":"<read timestamp>","expected":{"what":"<read value>"},"what":"<new value>"}`.
   Include `expected.<field>` for every field changed, including `kind` and
   the whole `planned_touches` array. The date is date-only; expected values
   are the guard against two same-day corrections.
4. On a stale timestamp or expected-value rejection, re-read the entry and
   re-evaluate current → proposed. Ask again if the intervening change makes
   intent unclear. Never copy values from the error just to force the write.
5. Report id and changed fields. Unchanged input is a no-op.

Correctable statuses: `planned`, `in_progress`, `awaiting_acceptance`, `deferred`.
Terminal entries remain history. Use `update-status` for status,
`update-deps` for dependency edges, and `annotate` for appended notes.
`observed_touches` is mechanical history and cannot be corrected.

After an actual question, record
`node <plugin-root>/scripts/trial-log.js question_asked '{"flow":"correct"}'`.
This is a no-op unless the project set `trialLog` and never blocks the flow.
