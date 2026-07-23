# Foreman — ROADMAP.jsonl schema

<!-- foreman:roadmap-schema lastmod:2026-07-22 -->

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
on `Edit`/`Write`) denies any direct edit of a file named `ROADMAP.jsonl`,
pointing back at the CLI. `Read` is still fine (inspecting the file is
harmless), only writing to it directly is blocked. `Bash` stays open as
an escape hatch for the rare case where the file is corrupt and the CLI
itself can't parse it to operate on it.

---

## Fields

| Field | Type | Required | Meaning |
|---|---|---|---|
| `id` | string | yes | Zero-padded sequential id (`"001"`, `"002"`, ...). Compute as `max(existing ids) + 1` over a **fresh full parse of the file**, immediately before writing. |
| `title` | string | yes | Short imperative summary, e.g. `"Add JWT refresh middleware"`. |
| `why` | string | yes | The rationale — the problem or need this task addresses. **Keep it to 1-2 sentences** (`roadmap.js` warns past ~240 chars) — this gets re-read on every `list`/`next-candidates` call, a wall of text multiplies cost across every future call, not just this one. |
| `what` | string | yes | What the task concretely consists of. A bit more room than `why` (warns past ~400 chars) since concrete detail (paths, line ranges) belongs here — but still a description, not a design doc. |
| `status` | enum | yes | `planned \| in_progress \| deferred \| done \| dropped \| rejected`. See below. |
| `source` | enum | yes | `user` (added directly by a person) or `claude-suggested` (originated from the commit-hook discovery flow). |
| `depends_on` | array\<string\> | yes (may be `[]`) | Ids of tasks that must be `done` before this one is unblocked. |
| `touches` | array\<string\> | yes (may be `[]`) | Flat file/area path hints, e.g. `"src/auth/middleware.ts"` or `"src/auth/"`. Plain strings only — no need for glob/AST matching at this scale, this is for eyeballed collision checks. Starts as a pre-work guess (may be an area-level hint, not exact); `update-status` folds in the real footprint two ways (**append-only**, same spirit as `commits` — never shrinks): automatically, whatever files the given `commit`'s own diff touched (`git show`, best-effort — silent if git or the sha is unavailable), plus optionally `add_touches` for anything outside that commit's diff. Still not required to be exhaustive: `commits[]` is the ground truth via `git show --stat`, `touches` is a convenience index on top of it, not a second ledger. |
| `commits` | array\<string\> | yes (may be `[]`) | Short SHAs (`git rev-parse --short HEAD` output) that implemented this task. Stays `[]` on a `staged:true` close, where the closing commit's `Foreman: <id>` message trailer is the entry↔commit link instead — a commit can't contain its own sha, and the trailer is what lets the close land *inside* the commit (`git log --grep "Foreman:"` recovers the sha). |
| `created_at` | string (`YYYY-MM-DD`) | yes | Set once, at creation, never rewritten. |
| `updated_at` | string (`YYYY-MM-DD`) | yes | Rewritten on every change to the entry. |
| `notes` | string | yes (may be `""`) | Free text. **Append-only** — add to it, never overwrite what's already there. Each append lands on its own `YYYY-MM-DD`-stamped line, written by the script; don't hand-write a date into the note text. The embedded newlines are JSON-escaped, so the file stays one line per entry. This is the durable home for full findings, not a one-line breadcrumb — a dense paragraph of specific findings (exact paths/symbols, what was tried, what shipped) is expected and normal (warns past ~3000 chars). Still never a serialized JSON blob (e.g. dumping an imported/legacy record's full JSON as a string here defeats the point of a structured schema; if migrating from another tracker, map its fields onto `why`/`what`/`touches` instead of stuffing the original object into `notes`). |
| `doc` | string | no — omitted entirely when not set | A forced choice recorded on `add`/`update-status`: exactly `"none"` (this task decided nothing worth an ADR) or a relative path ending in `.md` (no leading slash, no drive letter, no `..` segments) under the project's decision-log dir (default `docs/foreman/<id>.md`, path configurable). Never backfilled onto existing entries and never defaulted — an entry predating this field, or one where the field was never passed, simply has no `doc` key. Code points back at the doc with an anchor comment, `[Foreman: <id>[, <id>...]]` (3-digit zero-padded ids, comma-separated — e.g. `// [Foreman: 019]` or `// [Foreman: 019, 034]`); `DECISION_ANCHOR_RE`/`anchorIdsIn`/`anchorHasId` in `scripts/roadmap.js` are the one shared definition of that format. |

### `status` values

- `planned` — not started, and ready to be picked. May be blocked (see below).
- `in_progress` — actively being worked.
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
- `dropped` — was `planned`/`in_progress`, later decided not worth doing.
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

---

## Writing claude-suggested entries — pack context now, it's free

When an entry's `source` is `claude-suggested` (the commit-hook discovery
flow), write it dense: use everything already sitting in this session's
context — exact file paths and line ranges, function/symbol names, the
specific behavior or error observed, why it matters — and put it in `what`,
`why`, `touches`, and `notes`. This is the cheapest moment to capture that
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

| Subcommand | Input | Does |
|---|---|---|
| `add` | JSON via stdin: `title`, `why`, `what`, `source`, optional `depends_on`/`touches`/`notes`/`status`/`doc` | Rejects any `depends_on` id that doesn't already exist — an unresolvable id would strand the entry out of `next-candidates` with no way back (the edge only ever grows, and the guard hook denies the hand-edit repair). Computes `id` as `max(existing)+1`, defaults `status` to `"planned"` (only `"planned"` or `"rejected"` are valid at creation — a task doesn't start out `in_progress`/`done`/`dropped`), stamps `created_at`/`updated_at`, appends the line, re-validates the file. `doc`, if given, must be `"none"` or a relative `.md` path (rejects absolute paths, drive letters, `..` segments) — omitted from the entry entirely when not passed, never defaulted. Returns the new `entry`. |
| `update-status` | JSON via stdin: `id`, `status`, optional `commit`, optional `staged`, optional `notes`, optional `add_touches` (array of paths), optional `doc` | Transitions status, appends `commit` to `commits[]` (no duplicates), **appends** `notes` (never overwrites). If `commit` is given, runs `git show --name-only --relative` on it and folds every changed path into `touches` automatically (no duplicates, fails soft — a missing git binary, non-git project, or unknown sha just means nothing gets derived, the rest of the call still succeeds); `add_touches` folds in more paths on top, for anything outside that commit's diff. `staged: true` is the **staged close** — call it after `git add -A` and *before* committing: `touches` folds from the index (`git diff --cached`) instead of a commit, the script stages ROADMAP.jsonl itself, and the result carries `trailer` (`Foreman: <id>`) to put as the commit message's final line, so the close lands inside its own commit with no sha recorded and no roadmap ride-along; mutually exclusive with `commit`. `doc` follows the same `"none"`-or-relative-`.md`-path contract as `add` and overwrites any prior value (unlike `notes`, it isn't append-only — a task's forced choice is made once per call, not accumulated). Bumps `updated_at`, re-validates the file. Returns the updated `entry`, plus `derived_touches` when the git derivation found anything. |
| `annotate` | JSON via stdin: `id`, `notes` | **Appends** `notes` (never overwrites) and bumps `updated_at` — status untouched. The notes-only write: unlike `update-status`, it can't regress an entry's status from a stale read (e.g. re-asserting `planned` on an entry another session moved to `in_progress` in the meantime). Use it whenever the only thing changing is a breadcrumb. Returns the updated `entry`. |
| `update-deps` | JSON via stdin: `id`, plus at least one of `add_depends_on` / `remove_depends_on` (arrays of ids) | Adds ids to an existing entry's `depends_on` (no duplicates), rejects unknown ids, self-dependencies, and any addition that would close a dependency cycle (direct or transitive — walks the existing graph before writing), bumps `updated_at`. `remove_depends_on` drops edges and needs no guard of its own — a removal can't create a cycle or a dangling reference, and removing an id that isn't there is a no-op. It is the recovery path when a dependency was later `dropped`, which would otherwise leave the dependent permanently un-pickable. For a hidden dependency discovered after the entry was created — `add` only sets `depends_on` at creation time, this is the only way to correct it later. Structural, not a breadcrumb: this changes what `next-candidates` computes as unblocked, so it's the mechanism `foreman:survey` uses to make a finding persist across sessions instead of just noting it. |
| `list` | optional flags: `--status planned,in_progress`, `--ids 002,005` (combinable, AND semantics), `--summary` | Returns `entries` — filtered by whichever flags are given, everything otherwise. Read-only. `--ids` exists so a caller that only needs a handful of specific entries (`foreman:survey` resolving a few `depends_on` ids) doesn't have to load the whole file. `--summary` strips each entry to `id`/`title`/`status`/`depends_on` — what a whole-roadmap render (`foreman:roadmap`'s Review status) actually needs; fetch the few entries that need prose via a follow-up `--ids` call. |
| `next-candidates` | optional flags: `--limit N` (default 3 — matches `AskUserQuestion`'s 4-option cap, leaving one slot for the "something else" escape hatch), `--hint "words"` (rank by relevance first — the fraction of the hint's words found in each candidate's `title`/`why`/`what`/`touches`/`notes`; adds `hint_score` per candidate and a top-level `hint_matched`, `false` when no candidate matched at all) | Mechanical filter (unblocked: `planned`, every `depends_on` done) + rank (`unblocks_total` — every *open* entry waiting behind this one, directly or down the dependency chain; closed dependents don't count — then direct `unblocks`, then no-collision before collision, then oldest `created_at`; no stored priority field) + a `collision` flag per candidate (its `touches` overlaps a currently-`in_progress` entry's) + each candidate's `notes` and `depends_on` (so a breadcrumb left by `foreman:survey`, and the ids needed to resolve its own dependencies, are both visible without a separate `list` call). Returns `{"candidates":[...], "total_unblocked": N, "in_progress":[...]}` — `in_progress` carries every started entry (id/title/why/what/touches/depends_on/notes/updated_at) so the pick flow can offer to finish existing work first, and re-craft a resume prompt, without a second call. This is what `foreman:roadmap`'s "Pick the next task" calls — never `list` + manual filtering for that flow, `next-candidates` exists specifically to avoid loading the whole file into context just to do graph filtering that needs no judgment. |
| `check-duplicate` | JSON via stdin: `title`, `why` | Word-overlap (Jaccard) match against **all** entries, any status. Returns `{"duplicate": bool, "matches": [...]}`; each match carries its `status`, so a caller can tell "already declined" (`rejected` — skip silently) from "already on the roadmap" (`planned`/`in_progress`/`done`/... — skip, or link the existing id). Not semantic — a cheap filter to stop re-suggesting known work, not a guarantee. |

Examples:
```
echo '{"title":"Add JWT refresh middleware","why":"...","what":"...","source":"user"}' \
  | node ${CLAUDE_PLUGIN_ROOT}/scripts/roadmap.js add

echo '{"id":"002","status":"done","commit":"a1b2c3d"}' \
  | node ${CLAUDE_PLUGIN_ROOT}/scripts/roadmap.js update-status
# touches auto-folds a1b2c3d's changed files; add_touches only needed for
# paths outside that commit's own diff:
echo '{"id":"002","status":"done","commit":"a1b2c3d","add_touches":["docs/migration.md"]}' \
  | node ${CLAUDE_PLUGIN_ROOT}/scripts/roadmap.js update-status

# staged close — the roadmap change rides inside the closing commit itself:
git add -A
echo '{"id":"002","status":"done","staged":true,"notes":"..."}' \
  | node ${CLAUDE_PLUGIN_ROOT}/scripts/roadmap.js update-status
git commit -m "Add JWT refresh middleware" -m "Foreman: 002"

echo '{"id":"004","add_depends_on":["002"]}' \
  | node ${CLAUDE_PLUGIN_ROOT}/scripts/roadmap.js update-deps

node ${CLAUDE_PLUGIN_ROOT}/scripts/roadmap.js next-candidates --limit 5

node ${CLAUDE_PLUGIN_ROOT}/scripts/roadmap.js list --ids 002,005
```

The invariants this replaces (kept here as the contract the script
guarantees, not as steps Claude performs by hand anymore): parse the whole
file before any write and fail loudly on a corrupt line rather than write
on top of unknown-bad state; re-parse after writing to confirm the file is
still well-formed JSONL; `notes` is append-only; `updated_at` changes on
every write to an entry, `created_at` never does.

---

## Worked example

A 4-task file showing a dependency chain and one Claude-suggested entry:

```jsonl
{"id":"001","title":"Design auth token schema","why":"No agreed token shape before middleware work starts.","what":"Decide access/refresh token fields and expiry policy.","status":"done","source":"user","depends_on":[],"touches":["docs/auth-design.md"],"commits":["a1b2c3d"],"created_at":"2026-06-20","updated_at":"2026-06-22","notes":""}
{"id":"002","title":"Add JWT refresh middleware","why":"Sessions expire mid-request under load; users get silently logged out.","what":"Refresh the access token in middleware before its 15-min expiry.","status":"in_progress","source":"user","depends_on":["001"],"touches":["src/auth/middleware.ts"],"commits":[],"created_at":"2026-06-22","updated_at":"2026-07-03","notes":""}
{"id":"003","title":"Add refresh-token revocation endpoint","why":"No way to force-expire a stolen refresh token today.","what":"POST /auth/revoke — deletes the refresh token server-side.","status":"planned","source":"user","depends_on":["002"],"touches":["src/auth/routes.ts"],"commits":[],"created_at":"2026-06-22","updated_at":"2026-06-22","notes":""}
{"id":"004","title":"Extract duplicated retry logic in API clients","why":"Same exponential-backoff loop (3 attempts, 200ms base) copy-pasted across 3 files, spotted while implementing task 002.","what":"Pull the retry loop out of src/api/githubClient.ts:40-58, src/api/slackClient.ts:22-40, and src/api/jiraClient.ts:15-33 into one shared src/api/retry.ts helper; point all three callers at it.","status":"planned","source":"claude-suggested","depends_on":[],"touches":["src/api/githubClient.ts","src/api/slackClient.ts","src/api/jiraClient.ts","src/api/retry.ts"],"commits":[],"created_at":"2026-07-03","updated_at":"2026-07-03","notes":"surfaced via post-commit discovery scan on commit a1b2c3d"}
```

`003` is blocked right now — derived, not stored — because `002` isn't
`done` yet. `004` shows both the discovery flow's shape (`source:
"claude-suggested"`, a `notes` breadcrumb pointing back at the commit that
surfaced it) and the density "Writing claude-suggested entries" above asks
for — exact paths and line ranges instead of a vague "the fetch wrapper."

---

## `.foreman/config.json`

Sibling runtime file, also at the project root, also committed. Plain JSON,
no CLI wraps it (unlike `ROADMAP.jsonl`) — edited directly with `Read`/
`Write` when a flag needs to change. Full field reference is in
[`README.md`](README.md#settings); the one relevant to this file's
own consumer (`post-commit.js`) is `discoverySuggestions` — missing or
unparseable → treated as `true` (on by default); set it `false` to silence it.

---

## Who reads and writes this file

All access — from any caller — goes through `scripts/roadmap.js`, and
`hooks/guard-roadmap-edit.js` mechanically blocks the alternative (direct
`Edit`/`Write`), not just prose.

- `foreman:init` — creates it (loops `add` once per drafted task).
- `foreman:roadmap` — `next-candidates` (Pick next task), `add` (Add a task),
  `list` (Review status), `update-status` (Pick next task sets
  `in_progress`). Pick next task does not `Read`/`Grep` the codebase to
  verify a candidate before crafting its prompt — see `prompt-template.md`'s
  `truth_grounding` block, which is exactly the mechanism that makes that
  safe to skip at pick time.
- `foreman:survey` — the one caller that *does* investigate the codebase
  against the roadmap, on purpose, only when explicitly invoked (never from
  `foreman:roadmap`'s fast pick-next-task path — see 0.4.4-alpha's changelog
  entry for why that path forbids exploration). Writes findings back via
  `update-deps` (hidden dependency found — structural, changes future
  ranking), `update-status` (duplicate/already-done, a user-confirmed
  status change), or `annotate` (stale-touches breadcrumb — notes-only,
  status untouched) — never a direct `Edit`.
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
  `in_progress` entries exist, flagging ones with no recent activity, so
  work left dangling by a dead session surfaces instead of rotting. Never
  writes, never instructs an action without the user asking.
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
  and, depending on the `taskCloseGate` setting, reminds you or holds the
  completion until the entry is closed through `roadmap.js` in the usual
  way. With `decisionLog` enabled, it also audits a `done` close: the
  entry must record its `doc` (a path or `"none"`), and a named doc must
  exist with an anchor comment in one of the entry's commits — enforced
  per `decisionLog.gate`. Any other state, id, or description: silent
  no-op.
