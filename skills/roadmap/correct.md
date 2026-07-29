# Branch: Correct a task

The user wants an existing entry fixed, not a new one: reworded, retargeted
at different files, or reclassified. **This branch does not investigate the
codebase** — no `Read`, no `Grep`. The user says what is wrong; the entry
says what it currently claims.

1. `node ${CLAUDE_PLUGIN_ROOT}/scripts/roadmap.js list --ids <id>` — the
   entry as stored. If the user named the task by words rather than id, run
   `list --summary` first to resolve it.
2. Show the current value against the proposed one for each field being
   corrected (`title`, `why`, `what`, `kind`, `planned_touches` — nothing else
   is correctable here: status is `update-status`, dependencies are
   `update-deps`, notes only ever append, and `observed_touches` is mechanical
   history the command refuses outright). Then **one** `AskUserQuestion`:
   `Apply the correction` / `Never mind`. `planned_touches` is a full
   replacement, so show the whole new list, not just the additions.
3. `echo '{"id":"...","expected_updated_at":"<the updated_at from step 1>","expected":{"what":"<the what step 1 just returned>"},"what":"..."}' | node ${CLAUDE_PLUGIN_ROOT}/scripts/roadmap.js correct`
   — pass the fetched `updated_at` verbatim as `expected_updated_at`; it is
   what stops a correction composed against an older version from
   overwriting a newer one. `expected_updated_at` is date-only, so a second
   same-day correction still needs `expected`: one entry per field being
   corrected, each holding the CURRENT value step 1 just read back (`kind`
   and `planned_touches` need one too, the latter the whole current array) —
   this is what catches the case the date alone cannot. On a mismatch (either
   guard) the script names the current value: re-fetch (step 1), re-check
   the correction still makes sense against the newer text, and ask again.
   Only `planned`/`in_progress`/`deferred` entries are correctable, and a
   title another entry already has is refused.
4. Confirm back in one line: the id and the response's `changed` list (a
   field the user restated identically will not be in it). Surface any
   `warnings` verbatim. Git holds what the entry used to say — don't copy
   the old wording into `notes`.
