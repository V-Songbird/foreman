# Branch: Add a task

1. Gather via free text: `title`, `why`, `what`, and optionally
   `depends_on` (existing ids) and `planned_touches` (path/area hints — the
   predicted surface; the observed one is derived at close, never given here).
   Don't force
   the user through every field if they've already given enough in a
   one-line description (args or a natural request) — ask only for what's
   missing. If the task reads as resolving an open question rather than
   building something — the phrasing is a choice ("X or Y?", "decide
   whether…", "pick an approach") — pass `kind: "decision"` so the pick
   flow later hands it a decide-don't-build rule. A build is the default;
   don't ask unless the entry genuinely looks like a decision.
   When this is a `kind: "decision"` entry, `Read` `.foreman/config.json`:
   if it carries no `decisionLog` key at all, the user has never been asked,
   and this is the first moment it matters — ask once (`AskUserQuestion`)
   whether Foreman should keep a short "why we picked this" note for
   decisions and show it to later tasks that build on them, then write the
   answer as `"decisionLog": {"enabled": <bool>}`, preserving every other
   key. Write it either way: recording the decline is what stops the
   question from coming back. A key that is already present is an answer —
   don't re-ask.
2. Before writing it, check it isn't already tracked:
   `echo '{"title":"...","why":"..."}' | node ${CLAUDE_PLUGIN_ROOT}/scripts/roadmap.js check-duplicate`
   — matches carry each entry's status. On a match, name the existing
   id/title/status in one line and ask whether to add anyway
   (`AskUserQuestion`: `Add it anyway` / `Never mind`); a `rejected` match
   means the user already declined this, say so. No match: add it without
   comment. If the user confirms an exact-title match is genuinely separate,
   ask them for a distinguishing title; exact adds are always replay-safe and
   never have an override. Ask *before* the write, not after — `add` has no
   undo: the only exit is `update-status dropped`, which leaves the row in
   the file forever. Wording that later turns out wrong is repairable (see
   "Correct a task"); a task that shouldn't exist is not.
3. `echo '{"title":"...","why":"...","what":"...","source":"user","depends_on":[...],"planned_touches":[...]}' | node ${CLAUDE_PLUGIN_ROOT}/scripts/roadmap.js add`
   — the script computes the id, validates required fields (including that
   every `depends_on` id already exists), and confirms the file is still
   well-formed after writing. An exact replay safely returns the existing
   entry with `deduped: true` instead of adding another row.
4. Confirm back to the user with the task's id and title (from the script's
   JSON response). If `deduped: true`, say it was already tracked and no
   duplicate was created. Surface any `warnings` the response carries,
   verbatim, in the same line.
