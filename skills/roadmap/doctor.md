# Branch: Check the roadmap

Read-only unless the user asks to fix something. This branch never edits
`ROADMAP.jsonl` directly — each repair below is its own named `roadmap.js`
subcommand, and the structural check never inspects implementation code or
selects work.

1. `node ${CLAUDE_PLUGIN_ROOT}/scripts/roadmap.js doctor` — no stdin, no
   required flags. Returns `{ok, findings, summary:{errors,warnings}}`.
   Every run closes with one `severity: "info"` finding naming the hook
   events Foreman depends on in each host. It is a disclosure, not a defect,
   and it counts toward neither summary total — so read health off
   `summary`, never off whether `findings` is empty. Both totals zero: say
   the roadmap is healthy, pass on the disclosure in one line, and stop.
2. Render the remaining findings in plain words, grouped by what's wrong —
   never dump the raw JSON. Read out each finding's id(s) and its one-line
   `message`, then name the repair by what it's about:
   - format version wrong (`unsupported_schema_version`) → `migrate`
   - an id claimed twice (`duplicate_id`) → `reassign-id`, naming the specific
     row; the same id in both `ROADMAP.jsonl` and the archive
     (`duplicate_across_files`) → inspect which copy is current, then re-run
     the interrupted `archive` (or `restore`) on that id
   - wrong/missing `title`, `why`, `what`, `kind`, or `planned_touches` →
     `correct`, with expected values
   - an unrecognized status (`unknown_status`) → `update-status`
   - a bad `depends_on` edge (missing target, self-reference, repeat,
     cycle, or stuck on a dropped/rejected entry) → `update-deps`
   - a `done`/`awaiting_acceptance` entry with no commits and no notes →
     `annotate` with the actual findings
   - a missing-but-defaulted array (`depends_on`/`planned_touches`/
     `observed_touches`/`commits`/`notes`), a self-dependency, or a
     repeated dependency (`repairable: true`) → offer
     `roadmap.js doctor --fix`, which applies only those mechanical repairs
   - anything else — a malformed id, an unrecognized `source`/`model`/
     `effort`, a bad date, two entries that just read alike
     (`similar_titles`), or a `.foreman/config.json` finding — has no
     `roadmap.js` repair command; say so and name the field rather than
     guessing one
3. Show the concrete repair for each finding. An explicit request to fix these
   mechanical defects permits applying the reported repairs, one command per
   finding, each reported as it lands. A health-check request alone stays
   read-only: ask which repair to run, one finding at a time —
   `AskUserQuestion` in Claude Code, the picker in
   [questions.md](../foreman/questions.md) in Codex. This branch never chains
   repairs beyond what the user asked for, and never hand-edits the stores.
