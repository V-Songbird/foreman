# Branch: Check the roadmap

Read-only unless the user asks to fix something. This branch never edits
`ROADMAP.jsonl` directly — each repair below is its own named `roadmap.js`
subcommand, and the structural check never inspects implementation code or
selects work.

1. `node ${CLAUDE_PLUGIN_ROOT}/scripts/roadmap.js doctor` — no stdin, no
   required flags. Returns `{ok, findings, summary:{errors,warnings}}`.
   A `severity: "info"` finding is a disclosure, not a defect, and counts
   toward neither summary total: every run closes with one naming the hook
   events Foreman depends on in each host (`hook_dependencies`), and
   `notes_dead_record` counts lessons whose files are all gone. So read
   health off `summary`, never off whether `findings` is empty. Both totals
   zero: say the roadmap is healthy, pass on each info finding in one line,
   and stop.
2. Render the remaining findings in plain words, grouped by what's wrong —
   never dump the raw JSON. Read out each finding's id(s) and its one-line
   `message`, then name the repair by what it's about:
   - format version wrong (`unsupported_schema_version`) → `migrate`
   - an id claimed twice (`duplicate_id`) → `reassign-id`, naming the specific
     row; the same id in both `ROADMAP.jsonl` and the archive
     (`duplicate_across_files`) → inspect which copy is current, then re-run
     the interrupted `archive` (or `restore`) on that id
   - an id that fails the id format (`invalid_id`) → `reassign-id` with the
     entry's exact title as `keep`; leave `id` out when the message names it
     by code point
   - wrong/missing `title`, `why`, `what`, `kind`, or `planned_touches` →
     `correct`, with expected values
   - an unrecognized or missing status (`unknown_status`) → `update-status`
   - an unrecognized `model` or `effort`, or a bad `doc` (`invalid_doc`) →
     `update-status` with the entry's current status and the corrected field
   - a character a reader cannot see (`hidden_characters`) → by its field:
     `title`, `why`, `what` or `planned_touches` → `correct`; `doc` →
     `update-status` with `doc`; `notes` (`repairable: true`) → offer
     `roadmap.js doctor --fix`, which deletes only those characters and keeps
     every line; an entry it lists under `refused` would read as a
     credential once stripped, so pass on that message and leave it for the
     user; a `notes` finding that is not repairable (the id is invalid or
     held twice, or the entry is archived) has no repair command until
     `reassign-id` or `restore` makes it repairable — say so
   - a lesson record carrying one (`notes_hidden_characters`) →
     `note-supersede` with each record key the message names
   - lessons whose files are all gone (`notes_dead_record`) → `note-prune`,
     only when the user asks to prune
   - a bad `depends_on` edge (missing target, self-reference, repeat,
     cycle, or stuck on a dropped/rejected entry) → `update-deps`
   - a `done`/`awaiting_acceptance` entry with no commits and no notes →
     `annotate` with the actual findings
   - a missing-but-defaulted array (`depends_on`/`planned_touches`/
     `observed_touches`/`commits`/`notes`), a self-dependency, or a
     repeated dependency (`repairable: true`) → offer
     `roadmap.js doctor --fix`, which applies only those mechanical repairs
   - anything else — an unrecognized `source`, a bad date, two entries that
     just read alike (`similar_titles`), a `.foreman/config.json` finding, or
     a `.foreman/notes.jsonl` that is unreadable, in an unknown format or has
     lines it skips — has no `roadmap.js` repair command; say so, name the
     field and pass on the step the message names rather than guessing one
3. Show the concrete repair for each finding. An explicit request to fix these
   mechanical defects permits applying the reported repairs, one command per
   finding, each reported as it lands. A health-check request alone stays
   read-only: ask which repair to run, one finding at a time —
   `AskUserQuestion` in Claude Code, the picker in
   [questions.md](../foreman/questions.md) in Codex. This branch never chains
   repairs beyond what the user asked for, and never hand-edits the stores.
