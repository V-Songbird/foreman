# Branch: Correct a task

The user wants an existing entry fixed, not a new one: reworded, retargeted
at different files, or reclassified. **This branch does not investigate the
codebase** — no file reads, no searches. The user says what is wrong; the entry
says what it currently claims.

1. `node ${CLAUDE_PLUGIN_ROOT}/scripts/roadmap.js list --ids <id>` — the
   entry as stored. If the user named the task by words rather than id, run
   `list --summary` first to resolve it.
2. Show the current value against the proposed one for each field being
   corrected (`title`, `why`, `what`, `kind`, `planned_touches` — nothing else
   is correctable here: status is `update-status`, dependencies are
   `update-deps`, notes only ever append through `annotate`, and
   `observed_touches` is mechanical history the command refuses outright).
   `planned_touches` is a full replacement, so show the whole new list, not
   just the additions. When the user already gave the exact new value, apply
   it. When the proposed wording is yours, or the request leaves the new value
   open, ask **one** question first — `AskUserQuestion` in Claude Code, the
   picker in [questions.md](../foreman/questions.md) in Codex:
   `Apply the correction` / `Never mind`.
3. `echo '{"id":"...","expected_updated_at":"<the updated_at from step 1>","expected":{"what":"<the what step 1 just returned>"},"what":"..."}' | node ${CLAUDE_PLUGIN_ROOT}/scripts/roadmap.js correct`
   — pass the fetched `updated_at` verbatim as `expected_updated_at`; it is
   what stops a correction composed against an older version from
   overwriting a newer one. `expected_updated_at` is date-only, so a second
   same-day correction still needs `expected`: one entry per field being
   corrected, each holding the CURRENT value step 1 just read back (`kind`
   and `planned_touches` need one too, the latter the whole current array) —
   this is what catches the case the date alone cannot. On a mismatch (either
   guard) the script names the current value: re-fetch (step 1), show the
   correction against the newer text, and ask again before writing. Never copy
   values from the error just to force the write.
   Correctable statuses: `planned`, `in_progress`, `awaiting_acceptance`,
   `deferred` — a terminal entry is history its own commits already
   describe. A title another entry already has is refused.
4. Confirm back in one line: the id and the response's `changed` list (a
   field the user restated identically will not be in it). Surface any
   `warnings` verbatim. Git holds what the entry used to say — don't copy
   the old wording into `notes`.

---

<!-- [Foreman: 209] -->
## Trial log

After each question the user actually saw in this branch, one silent line:

```
node ${CLAUDE_PLUGIN_ROOT}/scripts/trial-log.js question_asked '{"flow":"correct"}'
```

One event per question interaction, never one per field it carried — the cost
being measured is the interruption. It is a no-op unless the project set
`trialLog`, so it needs no check first and never blocks the flow.
