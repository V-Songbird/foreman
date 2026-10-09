# 3. Confirm before writing anything

Present findings to the user — one line per candidate, `valid` ones need
no more than a mention. For anything else, **ask before persisting**: a
survey finding is a read of the evidence, not an automatic mutation, and a
request to inspect remains read-only for substantive changes. When the user
already explicitly authorized applying grounded repairs, apply those within
that scope without asking for the same authorization again.

For every finding that carries a concrete proposal, show three things
before asking or applying it: the entry's **id and title**, the **current value →
proposed value**, and the **evidence line(s)** the investigator cited. Show
`planned_touches` in full on both sides — `correct` replaces the array, so a
partial list would read as the entire new one. The user is approving a
specific string; the specific string has to be on screen.

**Approval is per finding.** Ask one question per entry: `AskUserQuestion`
in Claude Code; in Codex, the picker in [questions.md](../foreman/questions.md);
with no usable question tool, one self-contained plain-text question. When
several fields of the same entry changed together (a rewritten `what` and a
corrected `planned_touches` — the user may well want one and not the other),
each field is its own choice; in Claude Code, use `multiSelect`.
Batch at most a handful of entries into one question, and only while every
option still names its own entry and field.
**Never offer a single blanket "apply everything"**.

The `echo` lines show each payload's shape; when one carries evidence or
rewritten text, send it the way [the shared runtime](../foreman/runtime.md)
describes rather than inside shell quotes.

- **`hidden-dependency`** → on confirm:
  `echo '{"id":"<candidate>","add_depends_on":["<dep-id>"]}' | node ${CLAUDE_PLUGIN_ROOT}/scripts/roadmap.js update-deps`
  This is structural — `next-candidates` will now correctly treat the
  candidate as blocked until `<dep-id>` is `done`. It is baked into the graph
  the ranking algorithm reads, so a later session honors it without anyone
  having to remember a note.
- **`already-done` / `duplicate`** → on confirm:
  `echo '{"id":"<candidate>","status":"dropped","notes":"survey: <one-line evidence>"}' | node ${CLAUDE_PLUGIN_ROOT}/scripts/roadmap.js update-status`
  (or `"done"` with the actual `commit` if the evidence points to a specific
  commit that already did the work). Do not manufacture a completion SHA.
- **`stale-description` / `stale-touches`** with a concrete proposal → on
  confirm, apply it with `correct`, the one command that can replace
  `what`/`planned_touches` on a live entry ([correct.md](../roadmap/correct.md)
  uses the same call):
  1. `node ${CLAUDE_PLUGIN_ROOT}/scripts/roadmap.js list --ids <candidate>`
     — re-read the entry immediately before writing. Its `updated_at` is
     the value the write is guarded by, the investigators ran for a
     while in between, and `next-candidates` does not return that field at
     all.
  2. `echo '{"id":"<candidate>","expected_updated_at":"<the updated_at that read just returned>","expected":{"what":"<the what that read just returned>","planned_touches":[<the planned_touches that read just returned>]},"what":"<approved what>","planned_touches":[<approved paths>]}' | node ${CLAUDE_PLUGIN_ROOT}/scripts/roadmap.js correct`
     — only the approved fields go in the payload, each paired with its own
     `expected.<field>` holding the CURRENT value that same read (1) just
     returned; a field the user declined is simply absent from both, and
     `planned_touches` is sent as the whole replacement array in both
     places.
  3. If the script refuses with `was last updated … , not …` or
     `… no longer matches expected.<field>`, another session changed the
     entry between that read and this write. **Re-read
     (1), re-show current → proposed against the newer text, and ask
     again** — the approval covered text that no longer exists. Never re-send with
     the `updated_at` from the error message to force it through.

  `correct` refuses terminal (`done`/`dropped`/`rejected`) entries and a
  title another entry already holds, on its own — a stale description
  found on a terminal entry is history its commits describe, not a repair.
- **Uncertain findings are never applied.** Evidence gathered but no
  grounded replacement (the investigator's `confident: false`), or a proposal
  neither you nor the user can pin down here: it lands as exactly one
  breadcrumb, marked unconfirmed so a later session reads it as a lead and
  not as a fact — status untouched, no field rewritten:
  `echo '{"id":"<candidate>","notes":"survey (unconfirmed): <one-line evidence>"}' | node ${CLAUDE_PLUGIN_ROOT}/scripts/roadmap.js annotate`
  (the script date-stamps each appended note itself — don't write one in)
  `annotate` exists precisely for this write: unlike `update-status`, it
  can't regress the entry to a status read before the survey ran (e.g.
  re-asserting `planned` on an entry another session has since moved to
  `in_progress`).
  This is a soft signal, not a mechanical reorder — `next-candidates` now
  returns this candidate's `notes`, so the next pick sees it as context, but
  ranking itself (`unblocks_total`, then `unblocks`, then no-collision, then
  `created_at`) doesn't change. Explain that such notes inform future prompts
  but do not reorder the mechanical ranking.
- **A read-only request writes nothing.** When the user asked only to check,
  report uncertain findings as leads in step 4 instead of writing breadcrumbs.
- **A declined proposal writes nothing.** No note, no refusal breadcrumb,
  no status change. It goes in the report (step 4), not in the roadmap.

Never write on an unconfirmed finding, and never touch `ROADMAP.jsonl`
directly — every write above goes through `roadmap.js`, same as every other
Foreman flow.
