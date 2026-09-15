---
name: survey
description: "Advanced surface, normally reached through the `foreman` entrance's Reconcile and pick mode, which hands it a near-term set of ids to scope the pass to. Ground-truths the roadmap's near-term candidates against the actual codebase — a read-only investigation checks whether each candidate's planned_touches/depends_on still match reality, then proposes a concrete, evidence-backed repair for every finding (hidden dependency, already-done, stale description or planned files), applies only the ones you approve, and persists them back into ROADMAP.jsonl so future sessions pick them up automatically. Also retires any recorded lesson the same evidence contradicts, so a wrong claim stops being quoted into later handoffs. It costs materially more than a plain pick, which is why it is explicit: a fast pick or old roadmap alone does not trigger it."
when_to_use: "Reached through the `foreman` entrance for Reconcile and pick; trigger directly when a power user explicitly asks to reconcile, audit, double-check, or verify the roadmap's ordering — 'survey the roadmap', 'audit the next tasks', 'double-check what's next', 'is the roadmap still accurate', or invokes /foreman:survey. Never trigger automatically from foreman:roadmap's pick-next-task flow, a commit, or any other implicit signal."
argument-hint: "<optional — a task id or two to focus on, otherwise surveys the top unblocked candidates>"
allowed-tools: AskUserQuestion, Read, Bash, PowerShell, Agent
---

# foreman:survey — ground-truth the roadmap's near-term candidates

Foreman runs in Claude Code and in Codex. Every step applies to both unless it names a host. Read [the shared runtime](../foreman/runtime.md) first: it covers plugin paths, JSON payloads, questions and authorization for both hosts.

This is the advanced code investigation flow, the one Foreman flow that
investigates the codebase against the roadmap. Fast pick does not run it: it
reads more code and costs more than ranking stored tasks, so it runs only when
someone asks for it.

Use `${CLAUDE_PLUGIN_ROOT}/scripts/roadmap.js` for all roadmap reads and
mutations — never read or edit `ROADMAP.jsonl` directly — and run it with
`--help` for the command shapes. Read the **Fields** section of
[roadmap-schema.md](../../roadmap-schema.md)
(`${CLAUDE_PLUGIN_ROOT}/roadmap-schema.md`) for field semantics.

**Pre-check**: if `ROADMAP.jsonl` doesn't exist at the project root, offer
to set up the roadmap first (`/foreman:init` in Claude Code; in
Codex, [the init skill](../init/SKILL.md)) and stop here.

---

## 1. Pick the scope

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

---

## 2. Investigate each candidate in parallel

Give each candidate one read-only investigator. In Claude Code, dispatch one
`Agent` (`subagent_type: Explore`) per candidate, in parallel (single
message, multiple tool calls). In Codex, use available collaboration
subagents for independent candidates, limiting concurrency to actual
capacity. If delegation is unavailable or there is only one small candidate,
investigate locally. Collect every result before claiming the survey
complete.

Each investigator gets a self-contained prompt built from the candidate's own
fields plus the resolved-dependency, exists-map, and not-done-digest context
gathered in step 1:

- The candidate's `id`, `title`, `why`, `what`, `planned_touches`, `depends_on`.
- For each path in `planned_touches`: the pre-computed `path_exists` flag from
  step 1 — the investigator consumes this fact, it does not re-check it.
- For each id in `depends_on`: that entry's `title`, `status`, `commits`,
  and its `commit_evidence` from step 1 — the investigator consumes this fact,
  it does not re-derive it.
- The **not-done digest** from step 1 — `id`/`title`/`planned_touches` for
  every other not-done entry — for checks 3 and 4 below. The investigator
  judges hidden dependencies and overlaps against this supplied digest; it does
  not read `ROADMAP.jsonl` to get it.
- Ask it to check, and report a verdict for each:
  1. **Touches still real?** A path step 1 flagged missing is
     `stale-touches` only if it can be shown to have *once existed and
     moved* — `git log --diff-filter=D -- <path>`, or `--follow` showing a
     rename. Nothing found means the task simply hasn't created it yet:
     verdict stays `valid`, nothing to annotate. When a path did move, the
     investigator returns the **whole corrected `planned_touches` array** —
     the new path in place of the old one, retaining unaffected paths —
     because `correct` replaces that field wholesale rather than merging a
     diff into it. For paths confirmed to exist, does their current content
     still match what `what` describes? (`git log --oneline -- <path>`
     plus a read of the file's current state.) Where it no longer does,
     that is `stale-description`, and the investigator returns a **rewritten
     `what`**: the same task re-described against the code as it now
     stands, ready to be stored verbatim — not a summary of the drift.
  2. **Dependencies actually satisfied?** If step 1's `commit_evidence`
     already lists a `done` entry's commit as `unresolved`, flag it with no
     further check: an unresolved commit means not resolvable here, not
     fabricated. Otherwise, for commits that resolved, do they plausibly
     implement what that entry's `title`/`what` claims? (this half stays
     semantic — read the commit, judge the match)
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
     `title` in the supplied not-done digest? Do not treat a similar title
     alone as proof.

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
  replacement can be grounded, the investigator returns it with
  `confident: false` and says what it could not determine, keeping the
  evidence either way. That flag is what step 3 reads to choose between
  proposing a repair and leaving a breadcrumb.

---

## 3. Confirm before writing anything

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

---

<!-- [Foreman: 247] -->
## 3b. The lessons recorded about the same files

Survey is the only flow that has already read the code a recorded lesson
describes, so it is the only place a wrong one gets retired. Nothing else in
Foreman can tell a claim that aged badly from one that was never true.

One call, for the candidates you surveyed, with their `planned_touches` joined:

```
node ${CLAUDE_PLUGIN_ROOT}/scripts/roadmap.js notes --paths <comma-joined paths>
```

Skip the whole step when it returns no records — that one call answers both
"is the feature on" and "is there anything here", and it costs nothing to ask.

Two kinds of record are worth the user's attention, and no others:

- **`staleness: "stale"` whose claim the step-2 evidence contradicts.** The
  files under it moved, and the investigators that just read those files
  reported something different.
- **Any record the step-2 evidence contradicts outright**, whatever its label.
  A `fresh` label says the files have not changed since the claim was
  recorded. It never says the claim was right when it was written.

**A stale label on its own is not a finding.** It is a prompt to look, and the
looking already happened in step 2.

For each record worth offering, show the lesson verbatim, its label, and the
evidence line that contradicts it, then ask the same way and under the same
approval rule as step 3: keep it, or retire it. On retire:

```
echo '{"key":"<the key notes reported>","by_entry":"<the surveyed entry>"}' | node ${CLAUDE_PLUGIN_ROOT}/scripts/roadmap.js note-supersede
```

Retiring stops the line being served and stops it spending the handoff's
capped serving window. It does not delete it, and it does not record what the
truth is instead: the corrected fact belongs on the `lesson` of whichever task
next closes in that code, where it arrives with its own anchor and date.

**Pruning is a separate ask and it comes last.** It is the one command in
Foreman that rewrites the lesson store, so it never runs on an inference about
what the user probably wants:

```
node ${CLAUDE_PLUGIN_ROOT}/scripts/roadmap.js note-prune --dry-run
```

That writes nothing and reports what would go — records whose every file is
gone, and records already retired. Show the count and ask once, unless the
user already explicitly asked to prune that set. Only on a yes, or that
explicit request, run the same command without `--dry-run`. When the dry run
reports nothing, skip the ask entirely.

---

## 4. Report

Short summary: candidates surveyed (and how many were left unsurveyed, if
any), verdicts, what got written. Lessons retired and records pruned get one
line each when either happened, and no line at all when neither did. Separate
the three outcomes in one line each: corrections applied, findings left
unconfirmed as breadcrumbs, and proposals declined (declined ones exist only
here — nothing about them was written). If no writes happened, say the
roadmap is unchanged — this skill running is not itself news. For
**Reconcile and pick**, return these results to the pick flow before it
refreshes its menu; do not quietly continue on the old ranking.

---

<!-- [Foreman: 209] -->
## Trial log

After each question interaction the user actually sees in this flow, one
silent line:

```
node ${CLAUDE_PLUGIN_ROOT}/scripts/trial-log.js question_asked '{"flow":"survey"}'
```

One event per interaction, never one per question: one `AskUserQuestion` call
in Claude Code, however many questions it batches; one picker call or one
plain-text question in Codex. A skipped question is never logged. It is a
no-op unless the project set `trialLog`, so it needs no check first and never
blocks the flow.
