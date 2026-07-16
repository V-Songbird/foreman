---
name: roadmap
description: Ongoing entry point for a project's ROADMAP.jsonl. Pick the next task to work on (reasons about dependencies and file-touch collisions like a software architect, then crafts a self-contained handoff prompt), add a new task, or review roadmap status.
when_to_use: Trigger when the user asks what to work on next, wants to add something to the roadmap, wants to see roadmap status, says "what's next", "pick a task", "add to the roadmap", "roadmap status", or invokes /foreman:roadmap.
argument-hint: "<optional — a task description to add, or a hint about what to pick next>"
allowed-tools: AskUserQuestion, Read, Write, Bash, PowerShell, TaskCreate, Agent, SendMessage
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
question, treat it as a seed for "Add a task" and skip this call. If they
read like a pick request or a hint about what to pick ("what's next on
auth", "something quick I can finish today"), go straight to "Pick the
next task" with the hint in hand — that branch says what to do with it.

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

   **In the same message**, also run
   `node ${CLAUDE_PLUGIN_ROOT}/scripts/render-sections.js` — its output is
   project-level, not task-level, and step 3 needs it no matter which
   candidate wins, so batching the two mechanical calls saves a round
   trip. This satisfies the template's craft-time step 0 — don't run it
   again at assembly, reuse this call's output (and surface its `warnings`
   then, if any).

   **If args carried a pick hint**, pass `--limit 10` instead of the
   default and choose the 3 candidates to present yourself: hint relevance
   first, then the returned order as the tiebreak. If nothing matches the
   hint, say so in one line and present the top 3 as usual — never invent
   a candidate to satisfy a hint, and never let a hint surface a blocked
   or non-`planned` entry (the script's filter already decided that).

   **Never paste or print this JSON output into your chat response.** It's
   input to the next step, not something to show — the full `what`/
   `touches`/`notes`/`unblocks` fields are context for *you* to weigh
   candidates and craft the eventual handoff prompt, not content a human
   needs dumped in front of them before they've even picked a task.
2. Go straight to Q1 below — no narrative recap of the candidates in prose
   first, the question *is* the presentation.

**Finish-first check**: if the script's `in_progress` array is non-empty,
work already started somewhere — offer to finish it before starting
something new. Those entries take the top option slot(s) in Q1 (at most 2;
oldest `updated_at` first), labeled `Resume: <title> (<id>)`, with the
first one carrying `(Recommended)`. Description: `why` plus
"in progress since <updated_at>" — plus, when the entry's `notes` carry the
background-agent marker (see step 5's delivery bullet below), "will try
resuming the original agent first". Preview: same fields as the candidate
preview below, plus a short excerpt of the entry's `notes` (prior
findings) — the reason a resume is worth previewing at all. Planned
candidates fill the remaining slots. This is a suggestion, never a gate —
picking a planned candidate proceeds exactly as before.

**Q1** — "Which task next?"
Options, one per candidate (already ranked — take the order as given, or
your hint-aware order when args supplied one; resume options lead when
`in_progress` is non-empty, per the finish-first check above):
- Label: `<title> (<id>)`. The first-ranked candidate's label gets
  `(Recommended)` appended — unless a resume option already carries it —
  it's first for a reason (most-unblocking, or oldest on a tie), say so
  with the tag instead of making the user infer it from list order alone.
- Description: `why` only, trimmed to one sentence if it runs longer. Never
  fold `what`/`touches`/`notes`/`unblocks` into the description — none of
  that is a pick-time decision input if the session isn't ground-truthing
  anyway (that's `foreman:survey`'s job); it only bloats the dialog. Add
  "(possible file overlap with in-progress work)" to the description if
  `collision:true` — still a caution, not a blocker.
- Preview: plain text built from the entry's `title`, `why`, `what`,
  `depends_on`, and `updated_at`, capped at ~10 lines. This is where the
  detail the description bullet deliberately excludes goes instead —
  visible only when the user focuses the option, never printed into chat.
  It supplements the description rule above, never replaces it. Resume
  options get the same fields plus the `notes` excerpt noted in the
  finish-first check above. A harness whose `AskUserQuestion` doesn't
  support `preview` simply ignores the field — no fallback logic needed.

Plus the standard escape to describe something else not on the list.

If the user waves a candidate off as "not yet", "later", or "not until
X" — rather than just picking a different one — offer to mark it
`deferred` so it stops resurfacing as a recommendation:
`echo '{"id":"<id>","status":"deferred","notes":"deferred: <trigger>"}' | node ${CLAUDE_PLUGIN_ROOT}/scripts/roadmap.js update-status`
(capture the trigger they named in `notes`). Then re-run
`next-candidates` and re-ask Q1. Don't defer on your own judgment — only
when the user signals it; a task that's merely lower-priority stays
`planned`.

**Resume via the original agent, before Q2**: if the picked option was a
resume entry and its `notes` carry the background-agent marker (the phrase
"background agent" followed by the backticked id — written by step 5's
delivery bullet below), try continuing that exact agent before asking
anything else. Pull the id out of the marker and call `SendMessage` with
`to: "<id>"` and a short re-brief (current status?, plus any new context
the user just gave) instead of the destination question and prompt-crafting
steps below. On success, that *is* the resume — relay what the agent
reports and stop here; the resumed agent owns closing its own entry the
same as any other handoff. On any failure (`success:false`, or the tool
isn't available), fall back **silently** to the flow below exactly as if
there were no marker — go on to Q2 and craft the re-crafted prompt (Resume
variant, step 3) from the entry's notes. Never surface the SendMessage
failure itself; the re-craft path isn't a degraded fallback, it's the
original design.

**Q2** — "How do you want to run this?" — ask this now, before the prompt
exists, not after. There is nothing to preview yet; the destination decides
how the prompt gets built and delivered, not the other way around.
Options, in this order:
- `Copy prompt to clipboard (Recommended)` — just get the text, no
  execution. Leads because nothing starts and the entry stays `planned`
  until someone actually runs the prompt (see step 4 below) — picking a
  task is not the same as starting it.
- `Execute with TaskCreate` — track it and work it in this session
- `Execute with a background Agent` — offload it, get notified on completion

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
   - `targetModel` fit — this is the DISPATCH-time judgment, made now,
     never at pick time or when the entry was created: if
     `.foreman/config.json` declares a `targetModel` other than
     `inherit` (already in hand from the render-sections.js call in step
     1), weigh it against this candidate's own `touches`/`what` —
     reasoning from those recorded fields only, same no-investigation rule
     as the rest of this branch. Foreman's own benchmark data shows a real
     capability cliff here, not a wording gap: a naming/reference mismatch
     went unresolved in every prompt format tested when the target was
     Haiku, no matter how structured the handoff. So when `targetModel`
     is `haiku` and the candidate's `what` describes reconciling stale,
     conflicting, or renamed references, mention that as a one-line
     caution in this session's own delivery message — e.g. "this may need
     more than Haiku reliably handles; consider Sonnet/Opus, or proceed
     anyway" — never inside the assembled prompt itself (the target model
     never sees a description of its own expected failure modes), never a
     block, never a status or schema change. Every other `targetModel`
     value skips this — nothing grounded suggests a caution at that scope
     for `sonnet`/`opus`, and `inherit` has no declared target to weigh
     against.
   - Add one more fixed paragraph right after `scope_discipline`, naming
     this entry's id, so the destination session — not Foreman — is the one
     that flips it to `in_progress`:
     "This task is ROADMAP.jsonl entry `<id>`. Mark it `in_progress` before
     doing anything else — Foreman's picking flow deliberately leaves it
     `planned` until you do:
     `echo '{"id":"<id>","status":"in_progress"}' | node
     ${CLAUDE_PLUGIN_ROOT}/scripts/roadmap.js update-status`
     When the work concludes, close the entry the same way — the status it
     actually earned (`done`, `dropped`, `rejected`) and your full findings
     in `notes`. If the work changed code, commit it before closing and
     pass the sha — `done` means the work landed, and the commit is what
     lands it; a task that changed nothing (pure investigation) closes
     without one:
     `echo '{"id":"<id>","status":"<status>","commit":"<sha>","notes":"<findings>"}' | node
     ${CLAUDE_PLUGIN_ROOT}/scripts/roadmap.js update-status`
     The entry's `notes` is where the depth lives; your final chat message
     states the outcome and points at the entry."

     **Resume variant** — when the chosen task came from `in_progress`
     (the finish-first check), the entry was already started by an earlier
     session, so swap the paragraph's opening for:
     "This task is ROADMAP.jsonl entry `<id>`, already marked `in_progress`
     by an earlier session — don't re-mark it; earlier findings may sit in
     its `notes` (included below), read them before re-deriving anything."
     and keep the closing instructions (status earned, findings in `notes`,
     commit-before-done) unchanged. Include the entry's existing `notes` in
     `background`/`context` — for a resume they're prior findings, exactly
     the context the destination shouldn't have to rebuild.

   **Never paste or print the assembled XML prompt into your response
   text.** It is data for `TaskCreate`'s `description`, `Agent`'s `prompt`,
   or a temp file piped to clipboard — not something to show the user. The
   one exception is already below: the clipboard-fallback fenced block when
   no clipboard tool exists.
4. **Foreman never marks the entry `in_progress` itself.** It stays
   `planned` — even after this prompt is assembled, delivered, or copied —
   until whichever session actually starts the work runs the
   `update-status` call embedded in step 3 above. Picking or copying a task
   is not the same as starting it; only the session that begins acting on
   it should say so.
5. Deliver via whatever Q2 picked:
   - **TaskCreate**: call `TaskCreate` with `subject` = a verb-first
     imperative ≤60 chars from the entry's `title`, `description` = the
     assembled XML prompt. Work it in this session. Foreman's
     `task-created` hook marks the entry `in_progress` mechanically the
     moment the task is created (it reads the entry id from the embedded
     paragraph) — finding it already `in_progress` when the embedded
     instruction runs is expected, and re-running that update is a
     harmless no-op. Still use `TaskUpdate` (a separate, session-local
     tracker) for its own `in_progress`/`completed` transitions as you go.
   - **Background Agent**: call `Agent` with `prompt` = the assembled XML
     prompt, `description` = a 3-5 word summary, `run_in_background: true`.
     The tool result trails with the dispatched agent's id (`agentId:
     a<16 hex>`). Capture it immediately with one annotate call, so a later
     session can resume this exact agent instead of re-crafting a prompt
     from its notes:
     `` echo '{"id":"<id>","notes":"dispatched to background agent `<agent-id>` (<date>)"}' | node ${CLAUDE_PLUGIN_ROOT}/scripts/roadmap.js annotate ``
     The phrase "background agent" followed by the backticked id is the
     exact marker grammar the resume flow above parses — the id's own
     charset (`a` + lowercase hex) never needs escaping.
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
it never mentions or routes to any other plugin. "Do it now" means
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

Read-only. `node ${CLAUDE_PLUGIN_ROOT}/scripts/roadmap.js list --summary`
— id/title/status/depends_on per entry, which is everything the render
below needs; the full entries' prose would multiply the payload for
nothing on a large roadmap. Render a compact list grouped by `status`
(`in_progress` first, then `planned` — noting which are blocked and on
what, derivable from `depends_on` plus the other entries' statuses — then
`deferred`, then `done`, `dropped`, `rejected` last). If any `deferred`
entries exist, fetch just those in full for the "waiting on what" word —
`list --ids <deferred ids>` — drawn from their `why`/`notes`. No writes,
no further questions.
