---
name: survey
description: Advanced surface, normally reached through the `foreman` entrance's Reconcile and pick mode, which hands it a near-term set of ids to scope the pass to. Ground-truths the roadmap's near-term candidates against the actual codebase — an Explore agent checks whether each candidate's planned_touches/depends_on still match reality, then proposes a concrete repair for every finding (hidden dependency, already-done, stale description or planned files), applies only the ones you approve, and persists them back into ROADMAP.jsonl so future sessions pick them up automatically. It costs materially more than a plain pick, which is why it is explicit.
when_to_use: Reached through the `foreman` entrance for Reconcile and pick; trigger directly when a power user explicitly asks to reconcile, audit, double-check, or verify the roadmap's ordering — "survey the roadmap", "audit the next tasks", "double-check what's next", "is the roadmap still accurate", or invokes /foreman:survey. Never trigger automatically from foreman:roadmap's pick-next-task flow, a commit, or any other implicit signal.
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
directly — run it with `--help` for the command shapes. Read the **Fields**
section of `${CLAUDE_PLUGIN_ROOT}/roadmap-schema.md` for field semantics.

**Pre-check**: if `ROADMAP.jsonl` doesn't exist at the project root, tell
the user to run `/foreman:init` first and stop here.

---

## 1. Pick the scope

<!-- [Foreman: 141] -->
If a caller handed over a set of ids, that set **is** the scope — args naming
specific tasks, or **Reconcile and pick**'s near-term set (`foreman:roadmap`'s
pick branch derives it from one `next-candidates --menu` result: the candidate
rows plus the `in_progress` and `awaiting_acceptance` rows). Run `list --ids
<those ids>`, drop any that don't exist or are terminal
(`done`/`dropped`/`rejected` — history its commits already describe) and say
which you dropped, and skip the `next-candidates` call below. Scoping decides
which entries get investigated and nothing else: steps 2–4 run exactly as
written, on whatever the scope holds. Otherwise:

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

**Mechanical pre-check, not an agent's job:** that `list --ids` call already
answered whether each entry's commits exist — every finished entry it
returns carries `commit_evidence`
(`commit_count`/`resolved_count`/`unresolved`/`has_trailer_match`). Read it;
do not re-derive it with `git cat-file` (which only ever asks the project
repo, so a commit living in a submodule comes back "missing" when it is
right there) and do not spend agents on it. `unresolved` lists the shas git
could not find; `has_trailer_match: true` means a commit message names the
entry, which is the whole evidence a staged close leaves — an entry with
`commit_count: 0` and a trailer match is recorded, not empty.

Same reasoning applies to `planned_touches`: collect every path named across
the candidates being surveyed (dedup), and check existence directly —
`test -e <path>` (Bash) / `Test-Path <path>` (PowerShell), relative to the
project root, one call per unique path (or a short loop in one call).
Build a `path_exists: true/false` map from this too — no agent needs a
`Read`/`Glob` round trip just to learn a file isn't there. A missing path
is a **question, not a verdict**: `planned_touches` is a forward-looking best
guess written at `add`/`init` time and routinely names files the task will
create, so absence alone is expected on a healthy backlog and proves
nothing by itself. Survey only ever ranges over that predicted half —
`observed_touches` is derived from commits that already landed, so there is
nothing there to ground-truth and nothing `correct` could repair.

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
read — it exists precisely so an Explore agent never has to open
`ROADMAP.jsonl` itself to answer "does this overlap something else
unfinished".

---

## 2. Investigate each candidate in parallel

Dispatch one `Agent` (`subagent_type: Explore`) per candidate, in parallel
(single message, multiple tool calls). Each gets a self-contained prompt —
it has no memory of this conversation — built from the candidate's own
fields plus the resolved-dependency, exists-map, and not-done-digest
context gathered in step 1:

- The candidate's `id`, `title`, `why`, `what`, `planned_touches`, `depends_on`.
- For each path in `planned_touches`: the pre-computed `path_exists` flag from step
  1 — the agent consumes this fact, it does not re-check it with its own
  `Read`/`Glob` call.
- For each id in `depends_on`: that entry's `title`, `status`, `commits`,
  and its `commit_evidence` from step 1 — the agent consumes this fact, it
  does not re-derive it.
- The **not-done digest** from step 1 — `id`/`title`/`planned_touches` for
  every other not-done entry — for checks 3 and 4 below. The agent judges
  hidden dependencies and overlaps against this supplied digest; it does
  not read `ROADMAP.jsonl` to get it.
- Ask it to check, and report a verdict for each:
  1. **Touches still real?** A path step 1 flagged missing is
     `stale-touches` only if it can be shown to have *once existed and
     moved* — `git log --diff-filter=D -- <path>`, or `--follow` showing a
     rename. Nothing found means the task simply hasn't created it yet:
     verdict stays `valid`, nothing to annotate. When a path did move, the
     agent returns the **whole corrected `planned_touches` array** — the new path
     in place of the old one, every unaffected path kept — because
     `correct` replaces that field wholesale rather than merging a diff
     into it. For paths confirmed to exist, does their current content
     still match what `what` describes? (`git log --oneline -- <path>`
     plus a read of the file's current state.) Where it no longer does,
     that is `stale-description`, and the agent returns a **rewritten
     `what`**: the same task re-described against the code as it now
     stands, ready to be stored verbatim — not a summary of the drift.
  2. **Dependencies actually satisfied?** If step 1's `commit_evidence`
     already lists a `done` entry's commit as `unresolved`, that alone is a
     red flag — no further check needed. Otherwise, for commits that resolved,
     do they plausibly implement what that entry's `title`/`what` claims?
     (this half stays semantic — read the commit, judge the match)
  3. **Hidden dependency?** Reading the code the candidate's
     `planned_touches` point to, does it already reference/import/call
     something that another entry in the **supplied not-done digest** claims
     via its own `planned_touches`, which isn't in this candidate's
     `depends_on`? Then the same question in reverse: does anything
     *outside* this candidate's `planned_touches` consume the code it
     changes, in a way that makes another entry in the digest depend on
     this one? Check against the digest handed to you, not a fresh
     `ROADMAP.jsonl` read. Report every relation you can see in either
     direction, including one you can see but cannot pin to a line — mark
     that `confident: false` and say what you could not pin down. Step 3
     filters; a dependency you leave out here is not recoverable there,
     because it is the one verdict that reorders future picks.
  4. **Already done, or duplicate?** Does the working tree already contain
     what `what` describes, or does it closely overlap another entry's
     `title` in the supplied not-done digest?

  Verdict per candidate: `valid` (nothing found) | `hidden-dependency` |
  `stale-description` | `stale-touches` | `already-done` | `duplicate`.
  Every non-`valid` verdict must cite the file:line or commit that grounds
  it, or be marked `confident: false` with what it could not pin down —
  never a bare verdict carrying neither.

  A `stale-description` or `stale-touches` verdict carries **two** things
  or it is not reportable as one: the **evidence** — the file paths and
  symbols it actually opened, and what it found there instead — and a
  **concrete proposed replacement value**, a finished `what` string or a
  complete `planned_touches` array, ready to be written as-is. A vague "this looks
  stale" is not a finding of this kind. When the evidence is real but no
  replacement can be grounded, the agent returns it with
  `confident: false` and says what it could not determine, keeping the
  evidence either way. That flag is what step 3 reads to choose between
  proposing a repair and leaving a breadcrumb — an agent that invents a
  replacement it cannot ground turns a survey into a rewrite.

---

## 3. Confirm before writing anything

Present findings to the user — one line per candidate, `valid` ones need
no more than a mention. For anything else, **ask before persisting**
(`AskUserQuestion`) — a survey finding is Claude's read of the evidence,
not an automatic mutation.

For every finding that carries a concrete proposal, show three things
before asking: the entry's **id and title**, the **current value →
proposed value**, and the **evidence line(s)** the agent cited. Show
`planned_touches` in full on both sides — `correct` replaces the array, so a
partial list would read as the entire new one. The user is approving a
specific string; the specific string has to be on screen.

**Approval is per finding.** One `AskUserQuestion` per entry, using
`multiSelect` when several fields of the same entry changed together (a
rewritten `what` and a corrected `planned_touches` — the user may well want one
and not the other). Batch at most a handful of entries into one question,
and only while every option still names its own entry and field. **Never
offer a single blanket "apply everything"**: an approval that covers
findings the user did not read one at a time is not the confirmation this
step exists to collect.

- **`hidden-dependency`** → on confirm:
  `echo '{"id":"<candidate>","add_depends_on":["<dep-id>"]}' | node ${CLAUDE_PLUGIN_ROOT}/scripts/roadmap.js update-deps`
  This is structural — `next-candidates` will now correctly treat the
  candidate as blocked until `<dep-id>` is `done`. This is the mechanism
  that makes a finding from this session visible to a completely different
  session later: it's baked into the graph the ranking algorithm reads,
  not a note someone has to remember to check.
- **`already-done` / `duplicate`** → on confirm:
  `echo '{"id":"<candidate>","status":"dropped","notes":"survey: <one-line evidence>"}' | node ${CLAUDE_PLUGIN_ROOT}/scripts/roadmap.js update-status`
  (or `"done"` with the actual `commit` if the evidence points to a specific
  commit that already did the work).
- **`stale-description` / `stale-touches`** with a concrete proposal → on
  confirm, apply it with `correct`, the one command that can replace
  `what`/`planned_touches` on a live entry (`foreman:roadmap`'s "Correct a
  task" branch uses the same call):
  1. `node ${CLAUDE_PLUGIN_ROOT}/scripts/roadmap.js list --ids <candidate>`
     — re-read the entry immediately before writing. Its `updated_at` is
     the value the write is guarded by, the surveying agents ran for a
     while in between, and `next-candidates` does not return that field at
     all.
  2. `echo '{"id":"<candidate>","expected_updated_at":"<the updated_at that read just returned>","expected":{"what":"<the what that read just returned>","planned_touches":[<the planned_touches that read just returned>]},"what":"<approved what>","planned_touches":[<approved paths>]}' | node ${CLAUDE_PLUGIN_ROOT}/scripts/roadmap.js correct`
     — only the approved fields go in the payload, each paired with its own
     `expected.<field>` holding the CURRENT value that same read (1) just
     returned; a field the user declined is simply absent from both, and
     `planned_touches` is sent as the whole replacement array in both
     places.
  3. If the script refuses with `was last updated … , not …`, another
     session changed the entry between that read and this write. **Re-read
     (1), re-show current → proposed against the newer text, and ask
     again** — the proposal was composed against text that no longer
     exists, so it may now be wrong or already applied. Never re-send with
     the `updated_at` from the error message to force it through: that
     value is the guard, and overriding it silently overwrites someone
     else's correction.

  `correct` refuses terminal (`done`/`dropped`/`rejected`) entries and a
  title another entry already holds, on its own — a stale description
  found on a terminal entry is history its commits describe, not a repair.
- **Uncertain findings are never applied.** Evidence gathered but no
  grounded replacement (the agent's `confident: false`), or a proposal
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
  returns this candidate's `notes`, so the next `foreman:roadmap` pick sees
  it as context, but ranking itself (`unblocks_total`, then `unblocks`,
  then no-collision, then `created_at`) doesn't change. Say this explicitly if the user expects a guaranteed reorder —
  that would need a stored priority field this schema deliberately doesn't
  have (see `roadmap-schema.md`'s **Fields** section).
- **A declined proposal writes nothing.** No note, no "Claude proposed
  this and the user said no" breadcrumb, no status change. The user read
  the evidence and answered; recording the refusal on the entry would
  resurface it as a lead in every later session and quietly make saying no
  expensive. It goes in the report (step 4), not in the roadmap.

Never write on an unconfirmed finding, and never touch `ROADMAP.jsonl`
directly — every write above goes through `roadmap.js`, same as every other
Foreman flow.

---

## 4. Report

Short summary: candidates surveyed (and how many were left unsurveyed, if
any), verdicts, what got written. Separate the three outcomes in one line
each: corrections applied, findings left unconfirmed as breadcrumbs, and
proposals declined (declined ones exist only here — nothing about them was
written). If nothing was confirmed, say the roadmap is unchanged — this
skill running is not itself news.

---

<!-- [Foreman: 209] -->
## Trial log

After each `AskUserQuestion` call in this branch, one silent line:

```
node ${CLAUDE_PLUGIN_ROOT}/scripts/trial-log.js question_asked '{"flow":"survey"}'
```

One event per call, never one per question — the cost being measured is the
interruption, not how many fields it carried. It is a no-op unless the
project set `trialLog`, so it needs no check first and never blocks the flow.
