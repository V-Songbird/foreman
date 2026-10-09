# 1. Pick the scope

<!-- [Foreman: 141] -->
If a caller handed over a set of ids, that set **is** the scope — args naming
specific tasks, or **Reconcile and pick**'s near-term set (the pick flow in
[pick.md](../roadmap/pick.md) derives it from one `next-candidates --menu`
result: the candidate rows plus the `in_progress` and `awaiting_acceptance`
rows). Run `list --ids <those ids>`, drop any that don't exist or are terminal
(`done`/`dropped`/`rejected` — history its commits already describe) and say
which you dropped, and skip the `next-candidates` call below. Scoping decides
which entries get investigated and nothing else: steps 2–4 run exactly as
written, on whatever the scope holds. Otherwise:

`node ${CLAUDE_PLUGIN_ROOT}/scripts/roadmap.js next-candidates`
(default `--limit 3`) — candidates already include each one's own
`depends_on`, no separate call needed just to get that.

Survey the top candidates only — the same 3 by default that a pick shows.
This is deliberately not the whole backlog: a hidden dependency or stale claim
matters most for what's about to be picked. If `total_unblocked` is larger
than what you surveyed, say so when reporting back — don't imply full
coverage silently.

Collect the exact set of dependency ids referenced across all candidates'
`depends_on` (dedup). If non-empty, resolve just those —
`node ${CLAUDE_PLUGIN_ROOT}/scripts/roadmap.js list --ids <comma-joined ids>`
— never the unfiltered `list`, which loads the whole file just to answer a
question about a handful of ids.

**Mechanical pre-check, not an investigator's job:** that `list --ids` call
already answered whether each entry's commits exist — every finished entry it
returns carries `commit_evidence`
(`commit_count`/`resolved_count`/`unresolved`/`has_trailer_match`). Read it;
do not re-derive it with `git cat-file` (which only ever asks the project
repo, so a commit living in a submodule comes back "missing" when it is
right there) and do not spend investigators on it. `unresolved` lists the shas
git could not find; `has_trailer_match: true` means a commit message names the
entry, which is the whole evidence a staged close leaves — an entry with
`commit_count: 0` and a trailer match is recorded, not empty.

Same reasoning applies to `planned_touches`: collect every path named across
the candidates being surveyed (dedup), and check existence directly —
`test -e <path>` (Bash) / `Test-Path -LiteralPath <path>` (PowerShell), relative to the
project root, one call per unique path (or a short loop in one call).
Refuse paths outside the project before reading them. Build a
`path_exists: true/false` map from this too — no investigator needs a round
trip of its own just to learn a file isn't there. A missing path is a
**question, not a verdict**: `planned_touches` is a forward-looking best
guess written at `add`/`init` time and routinely names files the task will
create, so absence alone is not stale scope. Survey only ever ranges over
that predicted half — `observed_touches` is derived from commits that
already landed, so there is nothing there to ground-truth and nothing
`correct` could repair.

One more mechanical fact, gathered once regardless of which path above set
the scope: a **not-done digest** — `id`, `title`, `planned_touches` for
every entry currently `planned`, `in_progress`, `awaiting_acceptance`, or
`deferred` (the whole not-done backlog, not just the candidates being
surveyed) — `node ${CLAUDE_PLUGIN_ROOT}/scripts/roadmap.js list --status
planned,in_progress,awaiting_acceptance,deferred --summary` (`--summary`
rows already carry exactly this: `id`/`title`/`status`/`depends_on`/
`planned_touches` — never the unfiltered `list`, which would also load the
prose fields for entries nobody is investigating). Checks 3 and 4 in step 2
compare each candidate against this digest, not against a fresh roadmap
read — it exists precisely so an investigator never has to open
`ROADMAP.jsonl` itself to answer "does this overlap something else
unfinished".
