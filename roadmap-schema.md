# Foreman — ROADMAP.jsonl schema

<!-- foreman:roadmap-schema lastmod:2026-07-28 -->

`ROADMAP.jsonl` lives at the **project root** (not inside this plugin) and is
committed to git — it's a visible, shared record of the project's plan, not
internal Foreman state. One JSON object per line (JSON Lines, not a JSON
array): one line = one task. Line-per-task is deliberate — changing one
task's status touches exactly one line, so `git diff` on this file shows a
clean one-line change per update instead of reformatting the whole file.

All reads and writes go through `scripts/roadmap.js` — a small CLI, not a
long-running server (Claude shells out once per call, same as any other
Bash invocation). It exists because this file gets touched on every commit
with discovery on, not rarely — the CRUD mechanics (id computation,
parse-before/after-write, notes append-only) are now enforced in code
instead of re-derived by Claude from prose every time, which is both
cheaper (one Bash call instead of Read+reason+Edit+Read) and safer (no
hand-formatted JSON to get wrong). Never `Read`/`Edit` `ROADMAP.jsonl`
directly — see "Using roadmap.js" below.

This isn't just convention — `hooks/guard-roadmap-edit.js` (`PreToolUse`
on `Edit`/`Write`) denies any direct edit of a file named `ROADMAP.jsonl`
or `archive.jsonl` (see [Archived entries](#archived-entries--foremanarchivejsonl)),
pointing back at the CLI. `Read` is still fine (inspecting the file is
harmless), only writing to it directly is blocked. `Bash` stays open as
an escape hatch for the rare case where the file is corrupt and the CLI
itself can't parse it to operate on it.

---

## Format version

The file may declare its format on an **optional first line**:

```jsonl
{"foreman_roadmap_format":2}
```

It is recognized by shape — the `foreman_roadmap_format` key and no `id` —
so it can never be confused with a task, and a task can never be confused
with it. Every reader goes through `roadmap.js`'s `readEntries`, which
consumes that line and hands callers only the entries; nothing else has to
know it exists.

**Absence means format 1.** A file whose first line is a normal entry — which
is every roadmap written before this marker existed — is format 1. So is one
whose marker is malformed or sitting below an entry: no reader honors those,
so they declare nothing. Every write stamps the line (exactly one, always
first), so any roadmap Foreman mutates carries the version it was written at.

A file declaring a version **newer** than the running Foreman understands is
refused outright: every subcommand fails with `{"ok":false,"error":"…"}`
naming the file's version, the supported version, and the fix (upgrade the
plugin, or migrate with the Foreman that wrote it). Guessing at entries whose
rules this version does not know is how a roadmap gets silently mangled.

### Format 2 — the file surface is two fields

Format 2 replaced the single `touches` array with `planned_touches` (the
editable prediction) and `observed_touches` (append-only, derived at close).
One array could not be both: a close folded commit-derived paths into the
same field the pre-work collision check read, so a long-running entry
accumulated a footprint that flagged every later candidate as colliding.

**Reading an older file still works everywhere.** `readEntries` normalizes a
format-1 file to the current shape *in memory* — the whole old `touches`
array becomes `planned_touches`, `observed_touches` starts empty — so `list`,
`next-candidates`, `doctor` and the hooks all work on an unmigrated roadmap
and the file on disk is left byte-identical.

**Writing to one migrates it first, automatically.** Any mutation on a file
below the current format runs the same backup-then-rewrite `migrate`
performs before applying the change, and folds a `migrated` field
(`{from, to, backup}`) into that mutation's own result. `migrate` stays
available for a caller who wants the same upgrade done explicitly, up
front, with nothing else changing.

`migrate` brings **both** files — `ROADMAP.jsonl` and `.foreman/archive.jsonl`
when the project has one — up to the current format, each with its own
timestamped backup, and is safe to repeat: it compares each file with what
the current format would produce, and does nothing at all when they match.
When it does rewrite, it first copies the file to
`<file>.backup-<YYYYMMDD-HHmmss>` beside it and returns that path. The 1 → 2
step is purely mechanical and runs **no git**: nothing in a v1 file records
which of its paths were guessed and which were derived, so the whole array
becomes the prediction (which `correct` can fix) and the observed half starts
empty, filled by the next close. A marker that is malformed (not a whole
number ≥ 1) or sitting below an entry is a `doctor` **error** — `migrate` is
its repair, never `doctor --fix`.

---

## Fields

| Field | Type | Required | Meaning |
|---|---|---|---|
| `id` | string | yes | Sequential id of **three or more digits, zero-padded to at least three** (`"001"`, `"002"`, ... `"999"`, then `"1000"`, `"1001"`, ...). Past 999 there is no further padding and no leading zero, so `"01000"` is not an id. Compute as `max(existing ids) + 1` **numerically** over a **fresh full parse of the file**, immediately before writing — never by lexicographic order, which would put `"1000"` before `"999"`. Existing ids are never re-padded. |
| `title` | string | yes | Short imperative summary, e.g. `"Add JWT refresh middleware"`. **Unique across entries** — `add`'s exact-title replay dedup keys off it, so `correct` refuses a title another entry already carries. Correctable on an active entry with `correct`. |
| `why` | string | yes | The rationale — the problem or need this task addresses. **Keep it to 1-2 sentences** (`roadmap.js` warns past ~240 chars) — this gets re-read on every `list`/`next-candidates` call, a wall of text multiplies cost across every future call, not just this one. Correctable on an active entry with `correct`. |
| `what` | string | yes | What the task concretely consists of. A bit more room than `why` (warns past ~400 chars) since concrete detail (paths, line ranges) belongs here — but still a description, not a design doc. Correctable on an active entry with `correct`. |
| `status` | enum | yes | `planned \| in_progress \| awaiting_acceptance \| deferred \| done \| dropped \| rejected`. See below. |
| `source` | enum | yes | `user` (added directly by a person) or `claude-suggested` (originated from the commit-hook discovery flow). |
| `depends_on` | array\<string\> | yes (may be `[]`) | Ids of tasks that must be `done` before this one is unblocked. |
| `planned_touches` | array\<string\> | yes (may be `[]`) | The **prediction**: flat file/area path hints for the surface this task is expected to touch, e.g. `"src/auth/middleware.ts"` or `"src/auth/"`. Plain strings only — no need for glob/AST matching at this scale, this is for eyeballed collision checks (matched folder-aware: an area hint owns every path beneath it). Written at `add` (which also accepts the legacy key `touches` as an input alias for this field) and **editable**: `correct` replaces the whole array, so a wrong guess can shrink. Nothing else writes it — a close never folds into it, which is what keeps it a forecast. This is the **only** surface the pre-work collision checks read (`next-candidates`' `collision`, the post-commit correlation tag): collision asks "would starting this put two sessions in the same files", which is a question about intent, never about where an entry has already been. Hand-written, so it is also the half `doctor` holds to the `invalid_path` trust boundary. |
| `observed_touches` | array\<string\> | yes (may be `[]`) | The **history**: what the work actually reached, derived mechanically at close and **append-only**, same spirit as `commits` — never shrinks, never hand-edited, and not correctable (`correct` refuses it; a wrong observation means the wrong commit was recorded). `update-status` fills it two ways: automatically, whatever files the given `commit`'s own diff touched (`git show`, best-effort — silent if git or the sha is unavailable) or, on a `staged:true` close, the index; plus optionally `add_touches` for anything outside that diff. Not required to be exhaustive: `commits[]` is the ground truth via `git show --stat`, this is a convenience index on top of it, not a second ledger. Deliberately kept out of every collision check — a path committed last week conflicts with nobody. It comes from git, so its contents are whatever git reported and `doctor` does not police them for path safety. |
| `commits` | array\<string\> | yes (may be `[]`) | Short SHAs (`git rev-parse --short HEAD` output) that implemented this task. Stays `[]` on a `staged:true` close, where the closing commit's `Foreman: <id>` message trailer is the entry↔commit link instead — a commit can't contain its own sha, and the trailer is what lets the close land *inside* the commit (`git log --grep "Foreman:"` recovers the sha). |
| `created_at` | string (`YYYY-MM-DD`) | yes | Set once, at creation, never rewritten. |
| `updated_at` | string (`YYYY-MM-DD`) | yes | Rewritten on every change to the entry. Doubles as `correct`'s staleness guard (`expected_updated_at`), and the split there is honest: it is **date-only**, so two corrections on the same day both match it — those are caught by `correct`'s per-field content check instead (`expected.<field>` must equal the stored value, so a correction composed against text it never saw is refused). What the date guard catches is the multi-day case: a session applying a correction composed against an entry it read days ago, on top of someone else's newer one. |
| `notes` | string | yes (may be `""`) | Free text. **Append-only** — add to it, never overwrite what's already there. Each append lands on its own `YYYY-MM-DD`-stamped line, written by the script; don't hand-write a date into the note text. The embedded newlines are JSON-escaped, so the file stays one line per entry. This is the durable home for full findings, not a one-line breadcrumb — a dense paragraph of specific findings (exact paths/symbols, what was tried, what shipped) is expected and normal (warns past ~3000 chars). Still never a serialized JSON blob (e.g. dumping an imported/legacy record's full JSON as a string here defeats the point of a structured schema; if migrating from another tracker, map its fields onto `why`/`what`/`planned_touches` instead of stuffing the original object into `notes`). |
| `doc` | string | no — omitted entirely when not set | An optional pointer at a document this project already keeps about this entry. Foreman authors no document and templates none: it only reads. Recorded on `add`/`update-status` as exactly `"none"` (nothing was written down outside the ledger) or a relative path ending in `.md` (no leading slash, no drive letter, no `..` segments), by convention `<ledger.dir>/<id>.md` (default `docs/foreman/<id>.md`, path configurable). Never backfilled onto existing entries and never defaulted, and nothing demands it — an entry where the field was never passed simply has no `doc` key. Direct dependencies' `doc` paths ride into a handoff as `depends_on_docs`. Code points back at an entry with an anchor comment, `[Foreman: <id>[, <id>...]]` (ids of three or more digits, zero-padded to at least three, comma-separated — e.g. `// [Foreman: 019]` or `// [Foreman: 019, 034]`); `DECISION_ANCHOR_RE`/`anchorIdsIn`/`anchorHasId` in `scripts/roadmap.js` are the one shared definition of that format. |
| `model` | enum | no — omitted entirely when not set | `haiku \| sonnet \| opus \| fable` — which model **actually executed** this entry, recorded on `update-status` (typically the close), never on `add` (an entry being created hasn't run yet). Deliberately not compared against the model that was recommended at craft time: the difference between recommendation and reality is the signal being captured, so nothing warns when they diverge. Self-reported by whoever closes the entry — it cannot be detected, since hook input carries no model. Extend the accepted set in `scripts/roadmap.js` (`MODELS`) when a new model ships. |
| `effort` | enum | no — omitted entirely when not set | `low \| medium \| high \| xhigh \| max` — the reasoning effort the executing session ran at, recorded the same way and under the same rules as `model`. Also self-reported: the `Agent` tool takes no effort argument, so effort is never dispatched, only whatever the session was already set to. Accepted set is `EFFORTS` in `scripts/roadmap.js`. |
| `kind` | enum | no — omitted entirely when `build` | The task's purpose: `"build"` (implement a slice — the default, so it's never written to the file) or `"decision"` (resolve an open question, producing a recorded decision rather than code). Set at `add`, `update-status`, or `correct` (reclassifying back to `"build"` drops the key), same omit-when-default shape as `doc`: only `"decision"` is stored, and an entry with no `kind` key is a build. `foreman:roadmap`'s pick flow reads it and, for a decision entry, adds a "decide, don't build" rule to the handoff prompt. It exists because a decision-shaped entry with no such rule gets implemented straight into code a measurable fraction of the time instead of decided; `kind` is what declares the difference once, on the entry, instead of hoping each session infers it. |

### `status` values

- `planned` — not started, and ready to be picked. May be blocked (see below).
- `in_progress` — actively being worked. Also where partial, blocked, and
  verification-failed work sits: the work is not finished.
- `awaiting_acceptance` — the implementation is finished **and its checks
  ran**; the only thing missing is the user's acceptance. It exists because
  active work, failed verification, and finished-but-unapproved work all used
  to read `in_progress`, so the roadmap could not say which one it was. It is
  a status value and nothing more — no review platform, no assignment, no
  approval workflow. It is **open**, not terminal: it does not satisfy a
  dependent that needs its parent `done`, it cannot be archived, and it is
  never offered as a `next-candidates` pick (its work is done — offering it as
  a task to start would be a lie). Set it only when both halves are true;
  work that merely committed is still `in_progress`.
- `deferred` — recorded, but deliberately parked: it's waiting on an
  external trigger the user hasn't marked as met (a prerequisite feature
  shipping, a fourth copy appearing before an abstraction earns its keep, a
  user actually asking for the thing). Kept on the roadmap so the intent
  isn't lost, but **excluded from `next-candidates`** so it never surfaces as
  a "do this next" pick. When the trigger fires, move it back to `planned`
  via `update-status`. This is a judgment call the user (or Claude, on the
  user's behalf) makes — unlike `blocked`, it can't be derived, because the
  gating condition lives outside the roadmap. Use it instead of leaving a
  "not yet" task as `planned`, where it would keep ranking as a candidate,
  and instead of `dropped`, which means abandoned rather than postponed.
- `done` — finished; linked to the work either by non-empty `commits` or by
  a `Foreman: <id>` trailer in the closing commit's message (a `staged:true`
  close). A pure-investigation close may have neither.
- `dropped` — was `planned`/`in_progress`/`awaiting_acceptance`, later decided
  not worth doing.
- `rejected` — a `claude-suggested` entry the user explicitly declined at
  proposal time. It never becomes `planned`. Kept on record (instead of just
  not writing it) so the discovery flow can check existing `rejected`
  entries before re-suggesting the same idea on a future commit.

**There is no stored `blocked` status.** Blocked-ness is derived at read
time: a `planned` task with any `depends_on` id whose entry isn't `done` yet
is blocked. Computing this live means there's one less state that can drift
out of sync with reality. `deferred` is different — it's a *stored*
decision, not a derived one, precisely because its trigger condition can't
be read off the roadmap graph.

### Commit evidence

`commits[]` and the `Foreman: <id>` message trailer are the two ways an entry
is linked to git, and **`scripts/commit-evidence.js` is the only thing that
interprets either** — the doctor, the close gate, `safe-commit` and
the survey flow all read entry↔commit facts through it, so no two views can
answer the same question differently. It resolves a sha in the project repo
*and* in every submodule declared in `.gitmodules` (a Foreman commit routinely
lives in one), normalizes a short sha to the full one, and never throws: no
git, no repo, or an unknown sha leaves a fact unresolved rather than failing.

`list --ids` adds a read-time `commit_evidence` object — never stored — to
rows that have a claim to back (any entry with recorded commits, plus every
`done`/`awaiting_acceptance` entry). Four fields:

| field | meaning |
| --- | --- |
| `commit_count` | how many shas the entry records |
| `resolved_count` | how many of those git found, here or in a submodule |
| `unresolved` | the shas it did not find — **"not resolvable from here"** (rewritten history, an unfetched submodule, no git at all), a question rather than a verdict that the commit never existed |
| `has_trailer_match` | whether some commit's message names this entry — the only evidence a `staged:true` close leaves, so `commit_count: 0` with a trailer match is recorded work, not an empty record |

`doctor`'s `terminal_without_evidence`/`awaiting_without_evidence` warnings
deliberately count *recorded* commits, not resolved ones: they run on every
write and in projects with no git, so asking git is the job of the views that
can afford it.

### Lifecycle

```text
planned ──> in_progress ──> awaiting_acceptance ──> done
   │             │      <────────────┘
   ├─> deferred ─┘  (recovery: the user says it isn't ready)
   └─> dropped / rejected        (side-exits, from any open status)
```

The canonical path is `planned → in_progress → awaiting_acceptance → done`,
with `awaiting_acceptance → in_progress` as the recovery path when the user
says it isn't ready (record what they said in `notes` — that is the whole
value of sending it back rather than closing it). `deferred` returns to
`planned` when its trigger fires; `dropped`/`rejected` are side-exits
available from any open status.

**This is the documented lifecycle, not a transition matrix.**
`update-status` deliberately enforces no ordering: a `planned → done` fast
close for a one-line fix, a reopen of a `done` entry a follow-up invalidated,
and every other legitimate path all still work, exactly as before. Only two
rules are mechanical, and both are about a state nothing should be able to
*claim*:

1. `add` cannot create an entry as `awaiting_acceptance` — creation statuses
   remain `planned` and `rejected`. Nothing is finished the moment it is
   written down.
2. `next-candidates` never offers an `awaiting_acceptance` entry as a
   candidate — it filters to `planned`, and awaiting work is not work to
   start. It surfaces in that command's own `awaiting_acceptance` array
   instead, where the action is *accept*, not *do*.

**Openness.** `awaiting_acceptance` counts as **open** everywhere openness is
asked about: it does not satisfy a dependency (a dependent still needs its
parent `done`), it is not exempt from `stranded_dependency`, it cannot be
archived (terminal only), it stays correctable, and it counts toward the
`unblocks` totals behind a candidate. The one place it is deliberately *not*
grouped with `in_progress` is the **collision** flag, which is the proxy for
"someone is mid-flight in these files": awaiting work is already committed, so
its predicted surface cannot conflict with anything and flagging it would be
noise.

**Downgrade note.** An older Foreman rejects a file containing this status —
`unknown_status`, an error, from every command that validates. This is
accepted: the format marker governs *format* upgrades, not enum growth, so
adding a status value does not bump it. Roll forward (upgrade the plugin)
rather than editing the file back.

---

## Writing claude-suggested entries — pack context now, it's free

When an entry's `source` is `claude-suggested` (the commit-hook discovery
flow), write it dense: use everything already sitting in this session's
context — exact file paths and line ranges, function/symbol names, the
specific behavior or error observed, why it matters — and put it in `what`,
`why`, `planned_touches`, and `notes`. This is the cheapest moment to capture that
detail: it costs nothing extra right now (already in context), and it saves
whoever picks up the task later (`foreman:roadmap`, and the session it hands
off to) from re-deriving it from scratch, which costs real tokens then.

**Do not explore further just to enrich the entry.** No extra `Read` or
`Grep` calls whose only purpose is gathering more detail for roadmap
fields — that spends tokens now instead of saving them later, defeating
the point. (This doesn't mean avoid `Bash` — calling `roadmap.js add` to
actually persist the entry is the mechanical step this whole section
assumes; the rule is against exploring the codebase further, not against
writing what you already know.) If a detail isn't already in context,
leave the field at its normal length rather than digging for it.

**Dense means specific, not long.** "Refresh the token in
`src/auth/middleware.ts:40-58` before it expires" is dense. Three
paragraphs explaining the history and reasoning is not — it's exactly the
kind of entry that makes every future `list`/`next-candidates` call more
expensive, for every reader, forever. `roadmap.js` will return a
`warnings` field if `why`/`what`/`notes` run long; if you see one, trim
before moving on rather than ignoring it.

---

## Using roadmap.js

`${CLAUDE_PLUGIN_ROOT}/scripts/roadmap.js`. Every subcommand prints one
JSON line to stdout: `{"ok":true, ...}` on success, `{"ok":false,"error":
"..."}` (exit code 1) on failure — parse it, don't scrape prose.

**The CLI documents itself.** Run
`node ${CLAUDE_PLUGIN_ROOT}/scripts/roadmap.js --help` for every subcommand,
its stdin shape, its flags, and what it returns. That output is generated
from the same dispatcher that runs the commands, so it cannot drift; a copy
here could. This file stays the reference for what the *fields* mean — see
[Fields](#fields) above.

The invariants the script guarantees, kept here because they are contract
rather than usage: every mutation parses the whole file before writing and
fails loudly on a corrupt line rather than writing on top of unknown-bad
state; it re-parses after writing to confirm the file is still well-formed
JSONL; `notes` is append-only; `updated_at` changes on every write to an
entry and `created_at` never does.

**Every mutation validates the entire structural contract**, not merely that
each line is valid JSON — the resulting file runs through the same checks
`doctor` reports, and the write is refused (exit 1, file untouched) if it
would carry a structural **error**. A mutation is judged on what it would
*break*, never on damage it inherited: errors already present on disk stay
allowed, so a legacy or hand-corrupted entry can still be closed instead of
stranding every write. `doctor` is what surfaces that pre-existing damage.

Every mutation also holds a project-specific operating-system temp lock from
the fresh read through the validated write. Callers do not configure or
manage it. Concurrent commands serialize automatically; a crashed owner's
lock is recovered, and a live lock that outlasts the short wait returns one
error instead of risking a lost update. Read-only commands take no lock.

---

## After a branch merge — duplicate ids

Ids are `max + 1` over one file, so two branches that each add a task both
pick the same next id, and the merge leaves two entries claiming it. Git
merges the JSONL without complaint — nothing in a line-oriented merge knows
that `id` is a key. **Detect** it with `doctor`: the collision is
`duplicate_id` (both holders in `ROADMAP.jsonl`) or `duplicate_across_files`
(one of them archived), and the finding's `detail` names every holder,
everything depending on the id, and the commits already labelled
`Foreman: <id>`. **Repair** it with `reassign-id`, naming the exact `title` of
the holder that keeps the id — usually the one those commit trailers,
`[Foreman: <id>]` anchors, and dependents already mean. Every other holder is
renumbered to a fresh id; dependents are left alone and keep pointing at the
kept holder, since the id never moved. **Then re-point what actually meant the
other side**: `reassign-id` prints `dependents_on_kept`, and `update-deps`
moves any of those edges that were written against the renumbered entry —
that is a judgment about intent, so it is never automated. **The commit
trailers stay wrong on purpose.** History is immutable, so a commit saying
`Foreman: 130` keeps saying it even after 130 became 133; the renumbered entry
records that in a dated `notes` line, and the repair result lists the affected
shas so the mismatch is known rather than discovered later.

---

## Worked example

A 4-task file showing a dependency chain and one Claude-suggested entry:

```jsonl
{"foreman_roadmap_format":2}
{"id":"001","title":"Design auth token schema","why":"No agreed token shape before middleware work starts.","what":"Decide access/refresh token fields and expiry policy.","status":"done","source":"user","depends_on":[],"planned_touches":["docs/auth-design.md"],"observed_touches":["docs/auth-design.md"],"commits":["a1b2c3d"],"created_at":"2026-06-20","updated_at":"2026-06-22","notes":""}
{"id":"002","title":"Add JWT refresh middleware","why":"Sessions expire mid-request under load; users get silently logged out.","what":"Refresh the access token in middleware before its 15-min expiry.","status":"in_progress","source":"user","depends_on":["001"],"planned_touches":["src/auth/middleware.ts"],"observed_touches":[],"commits":[],"created_at":"2026-06-22","updated_at":"2026-07-03","notes":""}
{"id":"003","title":"Add refresh-token revocation endpoint","why":"No way to force-expire a stolen refresh token today.","what":"POST /auth/revoke — deletes the refresh token server-side.","status":"planned","source":"user","depends_on":["002"],"planned_touches":["src/auth/routes.ts"],"observed_touches":[],"commits":[],"created_at":"2026-06-22","updated_at":"2026-06-22","notes":""}
{"id":"004","title":"Extract duplicated retry logic in API clients","why":"Same exponential-backoff loop (3 attempts, 200ms base) copy-pasted across 3 files, spotted while implementing task 002.","what":"Pull the retry loop out of src/api/githubClient.ts:40-58, src/api/slackClient.ts:22-40, and src/api/jiraClient.ts:15-33 into one shared src/api/retry.ts helper; point all three callers at it.","status":"planned","source":"claude-suggested","depends_on":[],"planned_touches":["src/api/githubClient.ts","src/api/slackClient.ts","src/api/jiraClient.ts","src/api/retry.ts"],"observed_touches":[],"commits":[],"created_at":"2026-07-03","updated_at":"2026-07-03","notes":"surfaced via post-commit discovery scan on commit a1b2c3d"}
```

Only `001` is closed, so it is the only entry with anything in
`observed_touches`.

`003` is blocked right now — derived, not stored — because `002` isn't
`done` yet. `004` shows both the discovery flow's shape (`source:
"claude-suggested"`, a `notes` breadcrumb pointing back at the commit that
surfaced it) and the density "Writing claude-suggested entries" above asks
for — exact paths and line ranges instead of a vague "the fetch wrapper."

---

## Archived entries — `.foreman/archive.jsonl`

Terminal entries never stop accumulating, and every `list` re-reads all of
them. `archive` moves them out of the active file; `restore` moves them
back. Nothing is deleted, and nothing is rewritten in the move.

**Storage.** `.foreman/archive.jsonl`, beside `config.json` rather than at
the project root — it is history, not the plan. Same JSONL, same fields,
same format-marker first line, written by the same writer
as `ROADMAP.jsonl` and held to the same structural contract, so it reads
(and `doctor`s) with the same parser. It is committed like the roadmap, and
`hooks/guard-roadmap-edit.js` blocks direct `Edit`/`Write` of it too.

**Move order — crash safety.** Two files cannot be renamed atomically
together, so the order is fixed: the **destination** is written first
(temp-file + rename, the same pattern every roadmap write uses), then the
source is rewritten without the entries. A crash between the two leaves the
id in *both* files rather than in neither — `doctor` reports that as
`duplicate_across_files`, and **re-running the same `archive`/`restore` call
finishes the move**, because a byte-identical copy already in the
destination is read as an interrupted move rather than a conflict. Both
commands hold the same mutation lock as every other write, and both are
all-or-nothing: one bad id refuses the whole call before anything is
written.

**Only terminal entries archive.** `done`, `dropped`, `rejected` — a
`planned`/`in_progress`/`awaiting_acceptance`/`deferred` entry would vanish
from the views that plan work. `awaiting_acceptance` is refused like any other
open status: the user can still send it back, so it is not history. Status, id, and every field survive the move unchanged.

**Id continuity.** `nextId`/`add` compute `max + 1` over **active +
archived** ids, so an archived id is never reissued — a reused id would
point every `Foreman: <id>` commit trailer and `[Foreman: <id>]` anchor that
names it at a different task. `add`'s exact-title dedup and
`check-duplicate` see archived entries too: an exact-title match on an
archived entry returns it with `deduped: true, archived: true` and writes
nothing.

**Dependency resolution.** An active entry may depend on an archived
(usually `done`) parent, and that edge keeps working everywhere dependency
status is consulted — `next-candidates` readiness, the `require_ready`
dispatch guard, the `newly_unblocked`/`stranded_dependents` graph facts, and
`doctor`'s `missing_dependency`/`stranded_dependency`. An id absent from the
active file is looked up in the archive and resolves **with its archived
status**: archived `done` satisfies the dependency, archived
`dropped`/`rejected` strands the dependent exactly as an active one would.
Only an id in neither file is `missing_dependency`. The archive is read at
most once per command, and only when an id actually fails to resolve — a
project with no archive never pays for the second file.

**Views stay active-only by construction.** `readEntries` returns the
active file, so `list`, `next-candidates`, the hooks, and everything else
exclude archived work without remembering to filter. `list --archived` is
the one way in, and it takes the same `--ids`/`--status`/`--summary`
filters. Archived entries are not editable in place: `update-status`,
`annotate`, `update-deps`, and `correct` refuse an archived id and name
`restore`.

**Guards.** The archive is a shared ledger like `ROADMAP.jsonl` — a task's
own commit must not carry it (`isSharedLedger` in `scripts/safe-commit.js`), and
safe-commit's `roadmap_close` carve-out stays `ROADMAP.jsonl` only, since a
close writes the roadmap and never the archive.

---

## The ledger — `.foreman/notes.jsonl`

Off by default (`ledger.enabled`; the older `areaNotes` and `decisionLog`
keys are read as the same setting). When on, a close may record **one durable
sentence** about the code area it touched, and a later task whose planned
files intersect that record's files is served it back.

**Record shape.** One JSON object per line, after a
`{"foreman_notes_format":1}` first line:

```json
{"area":"src/auth","paths":["src/Auth/session.js","test/helpers/clock.js"],
 "entry":"142","anchor":{"kind":"commit","sha":"a1b2c3d8"},"date":"2026-08-11",
 "lesson":"token refresh lives in src/Auth/session.js refresh(); tests MUST fake time via test/helpers/clock.js — real timers hang CI"}
```

- `paths` — the close's `observed_touches`, minus bookkeeping
  (`ROADMAP.jsonl`, `.foreman/**`, `docs/foreman/**`). Separator-normalized
  and **case-preserved**: these are handed to git and to the filesystem, where
  a lowercased path reads wrong on a case-sensitive one.
- `anchor` — `{"kind":"commit","sha":…}` when the close recorded a sha,
  `{"kind":"entry"}` otherwise, resolved later through the entry's
  `Foreman: <id>` trailers. A rebase splits a sha from its trailer, so
  commit-kind falls through to trailer resolution when the sha is gone.
- `lesson` — 500 characters, **hard refused** above it, never truncated.
- `area` — derived, cosmetic, for readable grouping only. Selection is always
  path-level.

**Writing.** Only `update-status`, only on a close, only through a `lesson`
field on the same stdin JSON — the append rides the close's existing lock.
`hooks/guard-roadmap-edit.js` blocks direct `Edit`/`Write` of the file, the
same way it blocks the roadmap and the archive. Append-only: sessions never
rewrite it, so two branches merge line by line.

**Retiring a record.** A lesson that proved wrong is retired by appending a
marker naming it, never by editing the line:

```json
{"supersedes":"a91f0c33be21","by_entry":"151","date":"2026-08-19"}
```

`supersedes` holds the record's **key**, which is derived from that record's
own `entry`, `date` and `lesson` — so every clone computes the same key and
two clones retiring the same record still merge cleanly. `notes` reports the
key of everything it serves, and `note-supersede` takes it. A retired record
disappears from every read: it stops being served into handoffs, stops showing
in `notes`, and stops spending the serving window. The line itself stays on
disk until a prune.

`foreman:survey` is the flow that offers this, because it is the only one that
has already read the code the claim describes. Retiring records nothing about
what the truth is instead — the corrected fact belongs on the `lesson` of the
next task to close in that code.

**Pruning.** `note-prune` is the one operation that rewrites this file, and it
is never automatic. It removes records whose every file is gone and records
already retired; a marker whose target this file has never carried is kept,
because that is the half-merged case and the line it retires is still inbound.
`--dry-run` reports what would go and writes nothing. `doctor` reports the
dead-record count and points here.

**What is worth recording.** A fact a *future* task in this area would need
and could not cheaply re-derive. Cite a decision document rather than
restating it. A project-wide fact belongs in `CLAUDE.md`; a fact about one
file belongs in that file; a finding specific to this task belongs in the
entry's own `notes`. Omitting the lesson is a valid outcome, and the common
one — most tasks teach nothing that generalizes.

**Overlap rules.** A record is served when any of its `paths` overlaps any of
the reading entry's `planned_touches`, folder-aware in both directions (the
same rule collision detection uses). A record whose only match is a path that
more than 20% of closed entries touched is dropped — a file everything
reaches teaches nothing about this task. At most six records, newest first,
under a 1000-character ceiling, each one whole or absent.

**Freshness.** Every served record is resolved against git at serving time and
labelled fresh, possibly-stale, or unknown. A record whose every stored file is
gone is dropped rather than served.

**Anchors at dispatch.** Beside the path-matched lessons, a handoff reads the
entry's own `planned_touches` (at most twelve files, capped reads) for
`[Foreman: <id>]` comments and names what each anchored id resolves to: that
entry's title, and its document under `ledger.dir` when one exists there. At
most six ids, first planned file wins, and the entry's own id is never quoted
back at itself. An id with neither an entry nor a document is stray bracket
text and is dropped — the same rule `hooks/ledger-recall.js` applies when the
file is opened rather than planned. This channel is independent of
`ledger.enabled`: an anchor is the project's own comment, not Foreman's state.

**Reassign-id.** For an entry-kind record the entry id *is* the anchor, and
`reassign-id` renumbers holders while immutable commit trailers keep naming
the old id. Because the id was duplicated, no record written while both
holders existed can be attributed to either — so `reassign-id` **demotes**
every record anchored to the repaired id to `{"kind":"ambiguous","was":"<id>"}`
rather than repointing it at the holder that kept the id. The lesson, its
`entry` and its `date` are true history and stay exactly as recorded; only the
freshness verdict falls to unknown, which is the honest answer. The result
reports `notes_anchors_demoted`. Demotion does not change the record's key, so
an existing supersede marker keeps working.

---

## `.foreman/config.json`

Sibling runtime file at `.foreman/config.json`, also committed. Plain JSON,
no CLI wraps it (unlike `ROADMAP.jsonl`) — edited directly with `Read`/
`Write` when a flag needs to change. Full field reference is in
[`settings.md`](settings.md); the one relevant to this file's
own consumer (`post-commit.js`) is `discoverySuggestions` — missing or
unparseable → treated as `true` (on by default); an explicit `false` is the
only way out.

---

## Who reads and writes this file

All access — from any caller — goes through `scripts/roadmap.js`, and
`hooks/guard-roadmap-edit.js` mechanically blocks the alternative (direct
`Edit`/`Write`), not just prose.

- `foreman:init` — creates it (loops `add` once per drafted task).
- `foreman:roadmap` — `next-candidates` (Pick next task), `add` (Add a task),
  `correct` (Correct a task — the guarded repair for a stale `title`/`why`/
  `what`/`kind`/`planned_touches`), `list` (Review status), and `update-status` when
  execution actually starts or finishes. Picking alone leaves the entry
  `planned`. Pick next task does
  not `Read`/`Grep` the codebase to verify a candidate before crafting its
  prompt — see `prompt-template.md`'s `truth_grounding` block, which is
  exactly the mechanism that makes that safe to skip at pick time.
- `foreman:survey` — the one caller that *does* investigate the codebase
  against the roadmap, on purpose, only when explicitly invoked (never from
  `foreman:roadmap`'s fast pick-next-task path — see 0.4.4-alpha's changelog
  entry for why that path forbids exploration). Writes findings back via
  `update-deps` (hidden dependency found — structural, changes future
  ranking), `update-status` (duplicate/already-done, a user-confirmed
  status change), `correct` (a stale `what`/`planned_touches` the survey can
  replace with a concrete, user-approved value, guarded by the
  `expected_updated_at` and per-field `expected` values its own `list --ids`
  just read), or `annotate`
  (unconfirmed finding — notes-only, status untouched) — never a direct
  `Edit`.
- `foreman/hooks/post-commit.js` — reads the file in-process (it
  `require()`s `roadmap.js`'s `readEntries` directly, same Node process,
  no subprocess) to decide whether to mention status-sync at all. It never
  writes to the file itself — it only emits instructions telling Claude to
  call `update-status`/`add`/`check-duplicate` via Bash, keeping every
  actual write in a reviewable, skill- or Claude-driven path rather than a
  hook's hands.
- `foreman/hooks/session-start.js` — same in-process read pattern, at
  session start (`startup`/`clear` only, main sessions only — SessionStart
  never fires for subagents). Emits one informational line when
  open (`in_progress` or `awaiting_acceptance`) entries exist, flagging ones
  with no recent activity and tagging the awaiting ones, so work left dangling
  by a dead session — or finished work nobody has accepted — surfaces instead
  of rotting. Never writes, never instructs an action without the user asking.
- `foreman/hooks/task-created.js` — the one hook that writes, and only
  ever the single transition `planned` → `in_progress`, through
  `roadmap.js`'s own `cmdUpdateStatus` (same invariants as every other
  write). Fires when a task is created via `TaskCreate` whose description
  carries the handoff paragraph's own entry marker — on that delivery
  path, creating the task *is* starting the work, so this performs the
  transition the embedded instruction already asks the destination to
  make, mechanically. Any other state, id, or description: silent no-op.
  The embedded instruction stays in the prompt as the fallback for the
  clipboard and background-Agent paths (and for destinations without
  Foreman installed); a second same-status update is harmless.
- `foreman/hooks/task-completed.js` — the mirror-image gate on the closing
  side. It never writes to this file — `task-created.js` remains the only
  writing hook. Fires when a task carrying the handoff paragraph's entry
  marker completes while that entry is still `planned` or `in_progress`,
  and, when `taskCloseGate` is `block`, holds the completion until the
  entry is closed through `roadmap.js` in the usual way. An
  `awaiting_acceptance` entry deliberately does **not** gate: the block's
  instruction is "close it `done`", which is exactly what that status
  withholds until the user says yes, and a session with no user to ask (a
  background agent, a fold-back) would deadlock. That entry is already
  recorded; `doctor`'s `awaiting_without_evidence` covers the case where it
  isn't. Any other state, id, or description: silent no-op.
