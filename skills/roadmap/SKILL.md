---
name: roadmap
description: Ongoing entry point for a project's ROADMAP.jsonl. Pick the next task to work on (reasons about dependencies and file-touch collisions like a software architect, then crafts a self-contained handoff prompt), add a new task, or review roadmap status.
when_to_use: Trigger when the user asks what to work on next, wants to add something to the roadmap, wants to see roadmap status, says "what's next", "pick a task", "add to the roadmap", "roadmap status", or invokes /foreman:roadmap.
argument-hint: "<optional — a task description to add, or a hint about what to pick next>"
allowed-tools: AskUserQuestion, Read, Write, Bash, PowerShell, TaskCreate, Agent
---

# foreman:roadmap — pick, add to, or review the project roadmap

All reads/writes to `ROADMAP.jsonl` at the project root go through
`${CLAUDE_PLUGIN_ROOT}/scripts/roadmap.js` — never `Read`/`Edit` the file
directly, the script enforces id computation and parse-before/after-write
mechanically. Skim `${CLAUDE_PLUGIN_ROOT}/roadmap-schema.md` if you need
field semantics beyond what's obvious from the names.

**Pre-check**: if `ROADMAP.jsonl` doesn't exist at the project root, tell
the user to run `/foreman:init` first and stop here.

---

## Call 1 — menu

**Q1** — "What do you need?"
Options:
- `Pick the next task` — read the roadmap, reason about what to work on
  next, craft a handoff prompt for it.
- `Add a task` — append a new entry to the roadmap.
- `Review status` — read-only summary of where every task stands.

If args were provided and read like a task description rather than a
question, treat it as a seed for "Add a task" and skip this call.

---

## Branch: Pick the next task

**This branch does not investigate the codebase. At all.** No `Read`, no
`Grep`, no exploring files to confirm or expand what an entry says. The
picked entry's own fields are the only input to the prompt. Verifying
those claims against reality is the handed-off session's job, at the start
of *its* work — that's exactly what the `<truth_grounding>` block in
`prompt-template.md` exists for. Picking a task should be fast: one
mechanical call, one question, assemble, done.

1. `node ${CLAUDE_PLUGIN_ROOT}/scripts/roadmap.js next-candidates` —
   already filtered (unblocked: `planned` with every `depends_on` done),
   ranked (most-unblocking first, then oldest), limited to 3 by default,
   with a `collision` flag per candidate (its `touches` overlaps a
   currently-`in_progress` task's). Do not re-derive this by calling
   `list` and reasoning over the whole file yourself — that's exactly the
   cost `next-candidates` exists to cut.

   **Never paste or print this JSON output into your chat response.** It's
   input to the next step, not something to show — the full `what`/
   `touches`/`notes`/`unblocks` fields are context for *you* to weigh
   candidates and craft the eventual handoff prompt, not content a human
   needs dumped in front of them before they've even picked a task.
2. Go straight to Q1 below — no narrative recap of the candidates in prose
   first, the question *is* the presentation.

**Q1** — "Which task next?"
Options, one per candidate (already ranked, take the order as given):
- Label: `<title> (<id>)`. The first-ranked candidate's label gets
  `(Recommended)` appended — it's first for a reason (most-unblocking, or
  oldest on a tie), say so with the tag instead of making the user infer it
  from list order alone.
- Description: `why` only, trimmed to one sentence if it runs longer. Never
  fold `what`/`touches`/`notes`/`unblocks` into the description — none of
  that is a pick-time decision input if the session isn't ground-truthing
  anyway (that's `foreman:survey`'s job); it only bloats the dialog. Add
  "(possible file overlap with in-progress work)" to the description if
  `collision:true` — still a caution, not a blocker.

Plus the standard escape to describe something else not on the list.

**Q2** — "How do you want to run this?" — ask this now, before the prompt
exists, not after. There is nothing to preview yet; the destination decides
how the prompt gets built and delivered, not the other way around.
Options:
- `Execute with TaskCreate` — track it and work it in this session
- `Execute with a background Agent` — offload it, get notified on completion
- `Copy prompt to clipboard` — just get the text, no execution

**Never call `mcp__ccd_session__spawn_task`** — it has a known bug where
tasks spawned through it don't get MCP tools.

3. Craft the handoff prompt using `${CLAUDE_PLUGIN_ROOT}/prompt-template.md`'s
   XML structure, straight from the candidate's fields — no verification
   pass:
   - `task_context` goal ← `title` + `why`
   - `background` / `context` ← `what`
   - `relevant_files` seed ← `touches`, passed through as-is (area-level
     hints, not confirmed file:line ranges — that's fine, don't upgrade
     them yourself)
   - `task_rules`' first bullet defaults to: "Explore `relevant_files` first
     (see `truth_grounding` above)." — short on purpose, `truth_grounding`
     (fixed, right above it in the same prompt) already carries the full
     verify-before-acting mandate, restating it here would just be the
     same sentence twice. The remaining bullets, tone, and the verification
     command — ask the same way `craft-prompt` does only if genuinely not
     inferable from the entry; don't turn this into a second interview.

   **Never paste or print the assembled XML prompt into your response
   text.** It is data for `TaskCreate`'s `description`, `Agent`'s `prompt`,
   or a temp file piped to clipboard — not something to show the user. The
   one exception is already below: the clipboard-fallback fenced block when
   no clipboard tool exists.
4. Before handoff, mark it in progress:
   `echo '{"id":"<id>","status":"in_progress"}' | node ${CLAUDE_PLUGIN_ROOT}/scripts/roadmap.js update-status`
   — so the commit hook's status-sync instruction has something to close
   out later.
5. Deliver via whatever Q2 picked:
   - **TaskCreate**: call `TaskCreate` with `subject` = a verb-first
     imperative ≤60 chars from the entry's `title`, `description` = the
     assembled XML prompt. Work it in this session, `TaskUpdate` to
     `in_progress` then `completed` as you go.
   - **Background Agent**: call `Agent` with `prompt` = the assembled XML
     prompt, `description` = a 3-5 word summary, `run_in_background: true`.
   - **Clipboard**: `Write` the assembled prompt to a temp file first —
     never pass it as an inline shell string, a large prompt breaks shell
     quoting and the copy fails. Then pipe the file's content into the
     clipboard command: `Get-Content -Raw <file> | Set-Clipboard` on
     Windows, `pbcopy < <file>` on macOS, `xclip -selection clipboard <
     <file>` (or `wl-copy < <file>`) on Linux. Mention the file path too,
     in case the clipboard step fails. Fall back to a fenced `xml` block
     only if no clipboard tool is available at all.

**Hard rule — state this explicitly if the user pushes back**: this skill
always asks before doing anything — it never silently executes a task, and
it never mentions or routes to Forge or any other plugin. "Do it now" means
picking `Execute with TaskCreate` above, not this skill deciding on its own.

---

## Branch: Add a task

1. Gather via free text: `title`, `why`, `what`, and optionally
   `depends_on` (existing ids) and `touches` (path/area hints). Don't force
   the user through every field if they've already given enough in a
   one-line description (args or a natural request) — ask only for what's
   missing.
2. `echo '{"title":"...","why":"...","what":"...","source":"user","depends_on":[...],"touches":[...]}' | node ${CLAUDE_PLUGIN_ROOT}/scripts/roadmap.js add`
   — the script computes the id, validates required fields, and confirms
   the file is still well-formed after writing.
3. Confirm back to the user with the new task's id and title (from the
   script's JSON response).

---

## Branch: Review status

Read-only. `node ${CLAUDE_PLUGIN_ROOT}/scripts/roadmap.js list`, render a
compact list grouped by `status` (`in_progress` first, then `planned` —
noting which are blocked and on what — then `done`, `dropped`, `rejected`
last). No writes, no further questions.
