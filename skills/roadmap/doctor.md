# Branch: Check the roadmap

Read-only unless the user asks to fix something. This branch repairs
nothing itself and never edits `ROADMAP.jsonl` directly — each repair below
is its own named `roadmap.js` subcommand, run separately once the user
picks one.

1. `node ${CLAUDE_PLUGIN_ROOT}/scripts/roadmap.js doctor` — no stdin, no
   required flags. Returns `{ok, findings, summary:{errors,warnings}}`;
   `errors: 0` and no findings: say the roadmap is healthy and stop.
2. Render findings in plain words, grouped by what's wrong — never dump the
   raw JSON. Read out each finding's id(s) and its one-line `message`, then
   name the repair by what it's about:
   - format version wrong (`unsupported_schema_version`) → `migrate`
   - an id claimed twice (`duplicate_id`) → `reassign-id`; the same id in
     both `ROADMAP.jsonl` and the archive (`duplicate_across_files`) →
     re-run the interrupted `archive` (or `restore`) on that id
   - wrong/missing `title`, `why`, `what`, `kind`, or `planned_touches` →
     `correct`
   - an unrecognized status (`unknown_status`) → `update-status`
   - a bad `depends_on` edge (missing target, self-reference, repeat,
     cycle, or stuck on a dropped/rejected entry) → `update-deps`
   - a `done`/`awaiting_acceptance` entry with no commits and no notes →
     `annotate`
   - a missing-but-defaulted array (`depends_on`/`planned_touches`/
     `observed_touches`/`commits`/`notes`), a self-dependency, or a
     repeated dependency (`repairable: true`) → offer
     `roadmap.js doctor --fix`, which applies only those mechanical repairs
   - anything else — a malformed id, an unrecognized `source`/`model`/
     `effort`, a bad date, two entries that just read alike
     (`similar_titles`), or a `.foreman/config.json` finding — has no
     `roadmap.js` repair command; say so and name the field rather than
     guessing one
3. Ask which repair to run, one finding at a time (`AskUserQuestion`) —
   this branch never chains repairs on its own.
