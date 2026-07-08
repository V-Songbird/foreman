---
name: survey
description: Ground-truth the roadmap's near-term candidates against the actual codebase — an Explore agent checks whether each candidate's touches/depends_on still match reality, then persists any real finding (hidden dependency, already-done, stale) back into ROADMAP.jsonl so future sessions pick it up automatically.
when_to_use: Trigger when the user explicitly asks to reconcile, audit, double-check, or verify the roadmap's ordering — "survey the roadmap", "audit the next tasks", "double-check what's next", "is the roadmap still accurate", or invokes /foreman:survey. Never trigger automatically from foreman:roadmap's pick-next-task flow, a commit, or any other implicit signal.
argument-hint: "<optional — a task id or two to focus on, otherwise surveys the top unblocked candidates>"
allowed-tools: AskUserQuestion, Read, Bash, PowerShell, Agent
---

# foreman:survey — ground-truth the roadmap's near-term candidates

This is the one Foreman flow that deliberately investigates the codebase
against the roadmap. `foreman:roadmap`'s pick-next-task branch explicitly
does **not** do this — see the 0.4.4-alpha changelog entry, where doing
exactly this at pick time burned ~100k tokens on every invocation. Keeping
it a separate, explicitly-triggered skill is what makes both halves cheap:
the fast path stays mechanical, and ground-truthing only runs when someone
actually asks for it.

All reads/writes to `ROADMAP.jsonl` go through
`${CLAUDE_PLUGIN_ROOT}/scripts/roadmap.js` — never `Read`/`Edit` the file
directly. Skim `${CLAUDE_PLUGIN_ROOT}/roadmap-schema.md` for field semantics.

**Pre-check**: if `ROADMAP.jsonl` doesn't exist at the project root, tell
the user to run `/foreman:init` first and stop here.

---

## 1. Pick the scope

If args named specific task ids, `list --ids <those ids>` (validate they
exist and are `planned`). Otherwise:

`node ${CLAUDE_PLUGIN_ROOT}/scripts/roadmap.js next-candidates`
(default `--limit 3`) — candidates already include each one's own
`depends_on`, no separate call needed just to get that.

Survey the top candidates only — same 3 by default as `foreman:roadmap`
shows. This is deliberately not the whole backlog: a hidden dependency or
stale claim matters most for what's about to be picked, and checking every
`planned` entry every time would make this as expensive as the thing it's
trying to avoid. If `total_unblocked` is larger than what you surveyed,
say so when reporting back — don't imply full coverage silently.

Collect the exact set of dependency ids referenced across all candidates'
`depends_on` (dedup). If non-empty, resolve just those —
`node ${CLAUDE_PLUGIN_ROOT}/scripts/roadmap.js list --ids <comma-joined ids>`
— never the unfiltered `list`, which loads the whole file just to answer a
question about a handful of ids.

**Mechanical pre-check, not an agent's job:** for each resolved dependency
entry with `status:"done"`, verify each of its `commits` actually exists —
`git cat-file -e <sha>` (Bash), exit code tells you, no reasoning involved.
Build a small per-commit `exists: true/false` map from this before moving
to step 2 — a dispatched agent re-deriving something a shell command
already answered for free is pure waste, one `git cat-file` call is
cheaper than N parallel agents each running their own `git log`.

Same reasoning applies to `touches`: collect every path named across the
candidates being surveyed (dedup), and check existence directly —
`test -e <path>` (Bash) / `Test-Path <path>` (PowerShell), relative to the
project root, one call per unique path (or a short loop in one call).
Build a `path_exists: true/false` map from this too. A missing path is
already `stale-touches` evidence on its own — no agent needs a `Read`/`Glob`
round trip just to learn a file isn't there.

---

## 2. Investigate each candidate in parallel

Dispatch one `Agent` (`subagent_type: Explore`) per candidate, in parallel
(single message, multiple tool calls). Each gets a self-contained prompt —
it has no memory of this conversation — built from the candidate's own
fields plus the resolved-dependency and exists-map context gathered in
step 1:

- The candidate's `id`, `title`, `why`, `what`, `touches`, `depends_on`.
- For each path in `touches`: the pre-computed `path_exists` flag from step
  1 — the agent consumes this fact, it does not re-check it with its own
  `Read`/`Glob` call.
- For each id in `depends_on`: that entry's `title`, `status`, `commits`,
  and the pre-computed `exists` flag for each of those commits — the agent
  consumes this fact, it does not re-derive it.
- Ask it to check, and report a verdict for each:
  1. **Touches still real?** Any path step 1 already flagged missing is
     `stale-touches` evidence on its own — no further check needed for it.
     For paths confirmed to exist, does their current content still match
     what `what` describes? (`git log --oneline -- <path>` plus a read of
     the file's current state.)
  2. **Dependencies actually satisfied?** If step 1's `exists` map already
     flags a `done` entry's commit as missing, that alone is a red flag —
     no further check needed. Otherwise, for commits confirmed to exist,
     do they plausibly implement what that entry's `title`/`what` claims?
     (this half stays semantic — read the commit, judge the match)
  3. **Hidden dependency?** Reading the code the candidate's `touches`
     point to, does it already reference/import/call something that
     another *not-done* task's `touches` claims to own, which isn't in this
     candidate's `depends_on`? Only report this with a concrete
     file:line citation — no hunches.
  4. **Already done, or duplicate?** Does the working tree already contain
     what `what` describes, or does it closely overlap another entry?

  Verdict per candidate: `valid` (nothing found) | `hidden-dependency` |
  `stale-touches` | `already-done` | `duplicate`. Every non-`valid` verdict
  must cite the file:line or commit that grounds it — refuse to report a
  finding it can't point to concretely.

---

## 3. Confirm before writing anything

Present findings to the user — one line per candidate, `valid` ones need
no more than a mention. For anything else, **ask before persisting**
(`AskUserQuestion`) — a survey finding is Claude's read of the evidence,
not an automatic mutation:

- **`hidden-dependency`** → on confirm:
  `echo '{"id":"<candidate>","add_depends_on":["<dep-id>"]}' | node ${CLAUDE_PLUGIN_ROOT}/scripts/roadmap.js update-deps`
  This is structural — `next-candidates` will now correctly treat the
  candidate as blocked until `<dep-id>` is `done`. This is the mechanism
  that makes a finding from this session visible to a completely different
  session later: it's baked into the graph the ranking algorithm reads,
  not a note someone has to remember to check.
- **`already-done` / `duplicate`** → on confirm:
  `echo '{"id":"<candidate>","status":"dropped","notes":"survey <date>: <one-line evidence>"}' | node ${CLAUDE_PLUGIN_ROOT}/scripts/roadmap.js update-status`
  (or `"done"` with the actual `commit` if the evidence points to a specific
  commit that already did the work).
- **`stale-touches`** with no structural fix (the description just needs
  updating, nothing to block on) → notes-only, keep status unchanged:
  `echo '{"id":"<candidate>","status":"planned","notes":"survey <date>: <one-line evidence>"}' | node ${CLAUDE_PLUGIN_ROOT}/scripts/roadmap.js update-status`
  This is a soft signal, not a mechanical reorder — `next-candidates` now
  returns this candidate's `notes`, so the next `foreman:roadmap` pick sees
  it as context, but ranking itself (`unblocks` then `created_at`) doesn't
  change. Say this explicitly if the user expects a guaranteed reorder —
  that would need a stored priority field this schema deliberately doesn't
  have (see `roadmap-schema.md`'s comment on why not).

Never write on an unconfirmed finding, and never touch `ROADMAP.jsonl`
directly — every write above goes through `roadmap.js`, same as every other
Foreman flow.

---

## 4. Report

Short summary: candidates surveyed (and how many were left unsurveyed, if
any), verdicts, what got written. If nothing was confirmed, say the roadmap
is unchanged — this skill running is not itself news.
