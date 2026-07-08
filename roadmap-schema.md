# Foreman — ROADMAP.jsonl schema

<!-- foreman:roadmap-schema lastmod:2026-07-04 -->

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
| `status` | enum | yes | `planned \| in_progress \| done \| dropped \| rejected`. See below. |
| `source` | enum | yes | `user` (added directly by a person) or `claude-suggested` (originated from the commit-hook discovery flow). |
| `depends_on` | array\<string\> | yes (may be `[]`) | Ids of tasks that must be `done` before this one is unblocked. |
| `touches` | array\<string\> | yes (may be `[]`) | Flat file/area path hints, e.g. `"src/auth/middleware.ts"` or `"src/auth/"`. Plain strings only — no need for glob/AST matching at this scale, this is for eyeballed collision checks. Starts as a pre-work guess (may be an area-level hint, not exact); `update-status` folds in the real footprint two ways (**append-only**, same spirit as `commits` — never shrinks): automatically, whatever files the given `commit`'s own diff touched (`git show`, best-effort — silent if git or the sha is unavailable), plus optionally `add_touches` for anything outside that commit's diff. Still not required to be exhaustive: `commits[]` is the ground truth via `git show --stat`, `touches` is a convenience index on top of it, not a second ledger. |
| `commits` | array\<string\> | yes (may be `[]`) | Short SHAs (`git rev-parse --short HEAD` output) that implemented this task. |
| `created_at` | string (`YYYY-MM-DD`) | yes | Set once, at creation, never rewritten. |
| `updated_at` | string (`YYYY-MM-DD`) | yes | Rewritten on every change to the entry. |
| `notes` | string | yes (may be `""`) | Free text. **Append-only** — add to it, never overwrite what's already there. Each individual append should be a short breadcrumb (warns past ~240 chars), not a paragraph — and never a serialized JSON blob (e.g. dumping an imported/legacy record's full JSON as a string here defeats the point of a structured schema; if migrating from another tracker, map its fields onto `why`/`what`/`touches` instead of stuffing the original object into `notes`). |

### `status` values

- `planned` — not started. May be blocked (see below).
- `in_progress` — actively being worked.
- `done` — finished; `commits` should be non-empty.
- `dropped` — was `planned`/`in_progress`, later decided not worth doing.
- `rejected` — a `claude-suggested` entry the user explicitly declined at
  proposal time. It never becomes `planned`. Kept on record (instead of just
  not writing it) so the discovery flow can check existing `rejected`
  entries before re-suggesting the same idea on a future commit.

**There is no stored `blocked` status.** Blocked-ness is derived at read
time: a `planned` task with any `depends_on` id whose entry isn't `done` yet
is blocked. Computing this live means there's one less state that can drift
out of sync with reality.

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
| `add` | JSON via stdin: `title`, `why`, `what`, `source`, optional `depends_on`/`touches`/`notes`/`status` | Computes `id` as `max(existing)+1`, defaults `status` to `"planned"` (only `"planned"` or `"rejected"` are valid at creation — a task doesn't start out `in_progress`/`done`/`dropped`), stamps `created_at`/`updated_at`, appends the line, re-validates the file. Returns the new `entry`. |
| `update-status` | JSON via stdin: `id`, `status`, optional `commit`, optional `notes`, optional `add_touches` (array of paths) | Transitions status, appends `commit` to `commits[]` (no duplicates), **appends** `notes` (never overwrites). If `commit` is given, runs `git show --name-only --relative` on it and folds every changed path into `touches` automatically (no duplicates, fails soft — a missing git binary, non-git project, or unknown sha just means nothing gets derived, the rest of the call still succeeds); `add_touches` folds in more paths on top, for anything outside that commit's diff. Bumps `updated_at`, re-validates the file. Returns the updated `entry`, plus `derived_touches` when the git derivation found anything. |
| `update-deps` | JSON via stdin: `id`, `add_depends_on` (non-empty array of ids) | Adds ids to an existing entry's `depends_on` (no duplicates), rejects unknown ids, self-dependencies, and any addition that would close a dependency cycle (direct or transitive — walks the existing graph before writing), bumps `updated_at`. For a hidden dependency discovered after the entry was created — `add` only sets `depends_on` at creation time, this is the only way to correct it later. Structural, not a breadcrumb: this changes what `next-candidates` computes as unblocked, so it's the mechanism `foreman:survey` uses to make a finding persist across sessions instead of just noting it. |
| `list` | optional flags: `--status planned,in_progress`, `--ids 002,005` (combinable, AND semantics) | Returns `entries` — filtered by whichever flags are given, everything otherwise. Read-only. `--ids` exists so a caller that only needs a handful of specific entries (`foreman:survey` resolving a few `depends_on` ids) doesn't have to load the whole file. |
| `next-candidates` | optional flag: `--limit N` (default 3 — matches `AskUserQuestion`'s 4-option cap, leaving one slot for the "something else" escape hatch) | Mechanical filter (unblocked: `planned`, every `depends_on` done) + rank (most `depends_on`-referenced first as a derived importance proxy — no stored priority field — then oldest `created_at`) + a `collision` flag per candidate (its `touches` overlaps a currently-`in_progress` entry's) + each candidate's `notes` and `depends_on` (so a breadcrumb left by `foreman:survey`, and the ids needed to resolve its own dependencies, are both visible without a separate `list` call). Returns `{"candidates":[...], "total_unblocked": N}`. This is what `foreman:roadmap`'s "Pick the next task" calls — never `list` + manual filtering for that flow, `next-candidates` exists specifically to avoid loading the whole file into context just to do graph filtering that needs no judgment. |
| `check-duplicate` | JSON via stdin: `title`, `why` | Word-overlap (Jaccard) match against `rejected` entries only. Returns `{"duplicate": bool, "matches": [...]}`. Not semantic — a cheap filter to stop re-asking about something already declined, not a guarantee. |

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
[`README.md`](README.md#the-config-file); the one relevant to this file's
own consumer (`post-commit.js`) is `discoverySuggestions` — missing or
unparseable → treated as `false` (silent, no nudging).

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
  ranking) or `update-status` (stale/duplicate/already-done, notes-only or a
  user-confirmed status change) — never a direct `Edit`.
- `foreman/hooks/post-commit.js` — the only caller that reads the file
  in-process (it `require()`s `roadmap.js`'s `readEntries` directly, same
  Node process, no subprocess) to decide whether to mention status-sync at
  all. It never writes to the file itself — it only emits instructions
  telling Claude to call `update-status`/`add`/`check-duplicate` via Bash,
  keeping every actual write in a reviewable, skill- or Claude-driven path
  rather than a hook's hands.
