---
name: roadmap
description: Ongoing entry point for a project's ROADMAP.jsonl. Pick the next task to work on (ranks candidates deterministically by dependencies and file-touch collisions, shows why each is where it is, then crafts a self-contained handoff prompt), add a new task, correct a stale one, or review roadmap status.
when_to_use: Trigger when the user asks what to work on next, wants to add something to the roadmap, wants to fix or reword an entry that already exists, wants to see roadmap status, says "what's next", "pick a task", "add to the roadmap", "that task's description is wrong", "roadmap status", or invokes /foreman:roadmap.
argument-hint: "<optional — a task description to add, or a hint about what to pick next>"
allowed-tools: AskUserQuestion, Read, Write, Bash, PowerShell, TaskCreate, TaskUpdate, Agent, SendMessage
---

# foreman:roadmap — pick, add to, correct, or review the project roadmap

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
- `Correct a task` — fix a stale title, why, what, kind, or planned files
  on an entry that already exists.
- `Review status` — read-only summary of where every task stands.

If args were provided and read like a task description rather than a
question, treat it as a seed for "Add a task" and skip this call. If they
read like a pick request or a hint about what to pick ("what's next on
auth", "something quick I can finish today"), go straight to "Pick the
next task" with the hint in hand — that branch says what to do with it.
If they name an entry that already exists and say what's wrong with it
("003's what is out of date", "retarget 007 at the proxy"), that's
"Correct a task".

If they ask to clear out or archive finished work ("archive the finished
tasks", "get the done ones out of the way"), skip the menu: run `list
--status done,dropped,rejected --summary`, show those ids, and ask **one**
`AskUserQuestion` (`Archive them` / `Leave them`). On yes, `echo
'{"ids":["001","002"]}' | node ${CLAUDE_PLUGIN_ROOT}/scripts/roadmap.js
archive` — one call, all the ids, nothing else moves. `restore` with the
same shape is the way back if one has to change again.

---

## Branch: Pick the next task

**This branch does not investigate the codebase. At all.** No `Read`, no
`Grep`, no exploring files to confirm or expand what an entry says. The
selected entry's own fields are the only input to the prompt. Verifying
those claims against reality is the handed-off session's job, at the start
of *its* work — that's exactly what the `<truth_grounding>` block in
`prompt-template.md` exists for. Picking a task should be fast: one compact
mechanical menu, one question, then one detailed read of the selected entry
only.

Say it that way whenever the flow explains itself, and never more than it
does: the entry is **preflighted at craft time** — its paths and symbols
get checked mechanically by `resolve-symbols.js`, nothing else does — and
**the handoff verifies the claims during work**. A task is only
**grounded** when something actually investigated its substance
(`foreman:survey`, or the handoff's own truth-grounding once the work
starts), and only **verified** once the finished work passed its checks
and the user accepted it. Never tell the user a pick was checked against
the code, and never call an entry grounded or verified here.

1. `node ${CLAUDE_PLUGIN_ROOT}/scripts/roadmap.js next-candidates --menu` —
   already filtered (unblocked: `planned` with every `depends_on` done),
   ranked (most open work waiting behind it first — `unblocks_total`
   counts the whole dependency chain, not just direct dependents — then
   collision-free before colliding, then oldest), limited to 3 by
   default, with a `collision` flag per candidate (its `planned_touches`
   overlaps a currently-`in_progress` task's `planned_touches` — predicted
   surfaces only, never where either has already been — folder-aware, so a planned
   `src/auth/` collides with an in-progress `src/auth/middleware.ts` and
   vice versa) and a `reason` per candidate — the
   ranking key that actually placed that row. This is Foreman's
   **recommended** ordering, the default one, not a claim to have found
   the objectively best task: the sort knows dependencies, hint words,
   collisions, and age, and nothing about product value, urgency, or
   effort. Do not re-derive this by calling
   `list` and reasoning over the whole file yourself — that's exactly the
   cost `next-candidates` exists to cut. `--menu` returns only choice-time
   fields; do not fetch or reconstruct the unselected entries' details.

   **If args carried a pick hint**, pass it to the script instead of
   filtering yourself: `--hint "<the hint's words>"`. Relevance ranking is
   mechanical — the script scores each candidate by how many of the
   hint's words appear in its fields and sorts by that first, so take the
   returned order as given, same as the no-hint case. If the result says
   `hint_matched: false`, say in one line that nothing matches the hint
   and present the returned top 3 as usual — never invent a candidate to
   satisfy a hint, and never let a hint surface a blocked or
   non-`planned` entry (the script's filter already decided that).

   **Never paste or print this JSON output into your chat response.** It's
   input to the next step, not something to show. It deliberately contains
   only the short `why`, collision state, and ranking signals needed for
   the choice.
2. Go straight to Q1 below — no narrative recap of the candidates in prose
   first, the question *is* the presentation.

**Finish-first check**: if the script's `awaiting_acceptance` or `in_progress`
array is non-empty, work already exists — offer to settle it before starting
something new. Those entries take the top option slot(s) in Q1 (at most 2 of
each; oldest `updated_at` first), with the first one carrying
`(Recommended)`:
- `awaiting_acceptance` rows lead, labeled `Accept: <title> (<id>)`.
  Description: `why` plus "finished, waiting on you since <updated_at>". On
  that choice, ask once whether the work holds up; accepting closes it —
  `echo '{"id":"<id>","status":"done"}' | node ${CLAUDE_PLUGIN_ROOT}/scripts/roadmap.js update-status`
  — and declining sends it back with what they said:
  `echo '{"id":"<id>","status":"in_progress","notes":"<what they said>"}' | node ${CLAUDE_PLUGIN_ROOT}/scripts/roadmap.js update-status`.
  Either way, say what changed and stop; no prompt is crafted for an accept.
- `in_progress` rows follow, labeled `Resume: <title> (<id>)`. Description:
  `why` plus "in progress since <updated_at>". Preview: `title`, compact
  `why`, and `updated_at`. The selected entry's full notes — including any
  background-agent marker — are fetched only after the choice.

Planned candidates fill the remaining slots. This is a suggestion, never a
gate — picking a planned candidate proceeds exactly as before.

**Single-option skip**: when the menu would hold exactly one option —
candidates, accept, and resume entries combined — skip Q1 and take that entry
as the pick (a lone accept row still runs the accept flow above, not Q2). Q2 then opens with it instead: prefix Q2's question with the
entry's `title` (`<id>`) and its `why` restated per Q1's description
rule below, so the user can still veto or redirect through Q2's escape.
Two or more options of any kind ask Q1 as usual.

**Q1** — "Which task next?"
Options, one per candidate (already ranked — take the order as given,
hint or not; accept options lead, then resume options, when those arrays are
non-empty, per the finish-first check above):
- Label: `<title> (<id>)`. The first-ranked candidate's label gets
  `(Recommended)` appended — unless a resume option already carries it —
  say so with the tag instead of making the user infer it from list order
  alone.
- Description: the entry's `why` restated in your own everyday words, one
  sentence, written for a teammate who has never seen this codebase —
  never the field pasted verbatim — then the row's `reason` as a short
  trailing clause, so the user sees what put this row where it is and can
  overrule it on the spot. Use the returned `reason` as the fact it states
  (reworded to fit the sentence is fine, contradicted is not); it already
  carries the collision caution when there is one, so don't restate that
  separately. Never
  fold `what`/the file surfaces/`notes`/`unblocks` into the description — none of
  that is a pick-time decision input if the session isn't ground-truthing
  anyway (that's `foreman:survey`'s job); it only bloats the dialog. The
  overlap clause `reason` carries on a `collision:true` row is a caution,
  never a blocker.
- Preview: plain text built only from the menu row's `title`, compact
  `why`, `reason`, and ranking signals, capped at ~6 lines. It
  supplements the description rule above, never replaces it. Resume rows
  use `title`, compact `why`, and `updated_at`. A harness whose
  `AskUserQuestion` doesn't support `preview` simply ignores the field —
  no fallback logic needed.

Plus the standard escape to describe something else not on the list.

If the user waves a candidate off as "not yet", "later", or "not until
X" — rather than just picking a different one — offer to mark it
`deferred` so it stops resurfacing as a recommendation:
`echo '{"id":"<id>","status":"deferred","notes":"deferred: <trigger>"}' | node ${CLAUDE_PLUGIN_ROOT}/scripts/roadmap.js update-status`
(capture the trigger they named in `notes`). Then re-run
`next-candidates --menu` and re-ask Q1. Don't defer on your own judgment —
only when the user signals it; a task that's merely lower-priority stays
`planned`.

**Selected-entry load**: after Q1 (or the single-option skip) chooses an
entry, fetch that entry alone:
`node ${CLAUDE_PLUGIN_ROOT}/scripts/roadmap.js list --ids <id>`.
Require exactly one returned row and use that full row as the selected entry
for every step below. Do not fetch the other menu rows. This is where
`what`, `planned_touches`/`observed_touches`, `depends_on`, full `notes`, decision-doc fields, and
`kind` first enter the flow. For this targeted read, the script also derives
`depends_on_docs` as bounded paths from direct dependencies; it does not
return those dependency entries.

**Resume via the original agent, before Q2**: if the picked option was a
resume entry and the selected entry's full `notes` carry the
background-agent marker (the phrase
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
- `Execute here (Recommended)` — run it in this session. Leads because
  it's the common case: pick a task, work it, done — no extra hop through
  a clipboard or a second agent.
- `Execute with a background Agent` — offload it, get notified on completion — best for orchestration, where this session owns the commits
- `Copy prompt to clipboard` — just get the text, no execution

The `spawn_task` ban applies here — see `prompt-template.md`'s "Delivery
mechanics" section.

**Q3 — execution mode**, asked only when Q2's answer was `Execute here`.
The other two destinations skip it entirely. "How should it run here?" —
options and their free-text rule are `prompt-template.md`'s "Delivery
mechanics" section, verbatim.

**Selected-task preparation**: after the destination/mode questions and
before Q4 or prompt assembly, run
`node ${CLAUDE_PLUGIN_ROOT}/scripts/render-sections.js` exactly once. This
satisfies the template's craft-time step 0; reuse its output during
assembly and surface its `warnings` now, if any. Project-section rendering
is deliberately delayed until a task has been selected.

<!-- [Foreman: 111] -->
**Q4 — match the recommendation**, asked only when the selected-task
preparation result has `modelSuggestions: true` — it defaults to `false`,
and a project that leaves it off never sees this question or any
model/effort line anywhere in this branch. Then, and only then, asked when
Q2's answer was `Execute here`, once per handoff and never once per task
row, after Q3 and
**before the first task row is created**. The other two destinations skip
it — there the model is a dispatch value the Model fit bullet already
confirms. State BOTH halves of the recommendation in the question's
context, one line each with the reason behind it: the model per
`prompt-template.md`'s "Model fit" note, the effort per its "Effort fit"
note. This is the only place the model half is ever said on this
destination.
"This task suggests <model> at <effort>. Run it there instead?" — never
worded as raising, upgrading, or bumping the session. Foreman cannot see
what this session is running, so it cannot know whether the recommendation
is a step up, a step down, or already matched — a session on Opus told a
task suits Sonnet is being asked to go *down*. The question names where the
task fits and nothing about the distance to it.

`Proceed as-is (Recommended)` runs at whatever this session already has;
`Start it in a fresh session` puts the prompt on the clipboard for a session
already set to <model> at <effort>, delivered exactly as the `Copy prompt to
clipboard` destination does and stopping there — nothing runs here and no
task row is created.

Changing this session's model or effort in place is deliberately not on the
list: either change invalidates the prompt cache, so every remaining turn
re-reads the whole conversation. A fresh session pays that once, at the
shortest history it will ever have. A background `Agent` is not the
substitute either — that call takes a `model` but no effort argument.

Foreman cannot compare the two itself and must not try: hook input
carries no model at all, and effort is readable only inside a hook, never
by a skill. The user's answer IS the comparison, and the switch is theirs
to make — this never sets a model, never blocks, never records anything,
and neither recommendation is ever written into the assembled prompt.

`Run now, no tracking` creates no task row, so neither `task-created.js`
nor `task-completed.js` fires: the entry's opening and its close gate both
fall back to the prompt's own embedded instructions, exactly as on the
clipboard path. Say that in one line when the user picks it, so a project
running `taskCloseGate: "block"` knows the gate is not in play this time.

3. Craft the handoff prompt using `${CLAUDE_PLUGIN_ROOT}/prompt-template.md`'s
   XML structure, straight from the selected entry's fields — no verification
   pass:
   - `task_context` goal ← `title` + `why`
   - `background` / `context` ← `what`, plus the selected entry's `notes` when
     non-empty, attributed as prior recorded findings on this entry (a
     survey verdict, a defer trigger, a previous session's evidence) — the
     selected-entry read already carries them, so this stops the
     destination re-deriving what someone already wrote down
   - `relevant_files` seed ← `planned_touches` (the entry's own prediction —
     `observed_touches` is where past closes landed, not what this handoff is
     about), run once through
     `node ${CLAUDE_PLUGIN_ROOT}/scripts/resolve-symbols.js` (the
     template's step 0b) — the selected entry's paths and its `what` go in, a
     symbol map comes out. This is a mechanical call, not investigation:
     it reads no file you choose and forms no judgment, so the
     no-investigation rule at the top of this branch still holds. Cite the
     returned `files[].symbols` in `relevant_files`; a `missing` path and
     an `unresolved` name each go into the handoff as a stated
     discrepancy, since the entry's own fields are all this branch has to
     correct them with. Don't upgrade the paths any other way.
   - `invariants`, `Expected file surface:`, and test-first ordering — the
     template's three optional per-task fields, all derived from the
     selected entry's own recorded fields, no extra question:
     - `invariants` ← the assertions already stated in `why`/`what`/`notes`,
       rewritten as observable assertions. A contract named in those fields
       goes in as the assertion behind it, never as the name — and when the
       entry names a contract without saying what it asserts, say exactly
       that in the line, so the destination knows to establish it rather
       than infer it. Nothing assertable means the block is omitted; that
       is normal.
     - `Expected file surface:` ← the selected entry's `planned_touches` as
       given, followed by the flag-before-writing sentence the template
       supplies. That field is unverified area-level hints — the entry's
       prediction — which is precisely why it belongs here as a baseline to
       flag against rather than as a fact.
     - test-first ordering ← only when the entry describes a failure that
       would pass the existing checks. Omit it otherwise.
   - `depends_on_docs` — when the selected entry carries a non-empty one (the
     resolved decision-doc paths of its dependencies), list those paths in
     the handoff (in `background`/`context`) so the destination reads those
     decisions before starting, instead of silently re-deciding a settled
     question. Omit when empty.
   - `task_rules` carries no read-first bullet: the fixed `<plan>` block
     states that step once for every handoff, and `truth_grounding` already
     carries the verify-before-acting mandate — a third copy here would be
     the same sentence three times. The bullets, tone, and the verification
     command — ask the same way `craft-prompt` does only if genuinely not
     inferable from the entry; don't turn this into a second interview.
     One exception: when Q3 picked `Tasks from the checks`, the
     verification commands are what the split cuts on, so gather them
     properly instead of settling for one inferred command — a single
     check yields a single task.
   - **Decision entry** — when the selected entry carries `kind: "decision"`
     (surfaced by `list --ids`), this task resolves an open question,
     not a build. Make the first `task_rule` (before the explore bullet):
     "This is a decision, not a build: resolve the open question — state the
     choice and the reason it wins over the alternatives — and do **not**
     write implementation code for it. The deliverable is the decision."
     This is the measured lever — without it, a decision-shaped entry gets
     implemented straight into code a real fraction of the time. It pairs
     with `decision_log`: a decision entry's product is its doc, so when the
     `<decision_log>` block is present (below), the recorded choice lands
     there and the close carries the `doc` path rather than `"none"`. An
     entry with no `kind` key is an ordinary build — add nothing.
   - Model fit — **only when the selected-task preparation result has
     `modelSuggestions: true`**; it defaults to `false`, and when it is
     `false` this bullet and the Effort fit bullet below both produce
     nothing. Call 6's executing-model question still runs on the
     dispatching destinations, since a dispatch needs a model named, but
     with no recommended default and no `(Recommended)` label. A
     DISPATCH-time recommendation, judged now from this
     selected entry's own `planned_touches`/`what` (recorded fields only, same
     no-investigation rule as the rest of this branch), never at pick time
     or when the entry was created. If `.foreman/config.json` pins a
     concrete `targetModel` (already in hand from the selected-task
     preparation call), that project declaration is the recommendation;
     otherwise (`inherit`, the default) recommend a model per
     `prompt-template.md`'s "Model fit" note — including its grounded
     caution for a `what` that reconciles stale, conflicting, or renamed
     references, which hit a real capability cliff on Haiku in every prompt
     format tested. For a background-`Agent` or clipboard destination,
     confirm it with `craft-prompt`'s Call 6 question, asked here once the
     verification checks are known and before assembly — same wording,
     same slots and substitutions (`Fable` included only when
     `fableEnabled` is `true`). The answer keeps its two jobs: it
     tunes the assembled prompt's elaboration, and a background `Agent`
     dispatch passes it as that
     call's literal `model` (`haiku`/`sonnet`/`opus`/`fable`, omitted for
     inherit/varies). An `Execute here` run has no dispatch value to set,
     so it states the recommendation in Q4 above instead — the work runs
     in this session, so no model choice exists and the resolved
     `targetModel` drives elaboration unchanged. The operator's answer is
     the decision — never an automatic switch, never inside the assembled
     prompt itself (the target model never sees a description of its own
     expected failure modes), never a block, never a status or schema
     change.
   - Effort fit — gated on `modelSuggestions` exactly as Model fit above
     is; say nothing about effort when it is `false`. The same
     recommendation's second half, per
     `prompt-template.md`'s "Effort fit" note, decided once this task's
     verification commands are known (they are the input to it). State it
     in one line of the delivery message — the setting plus the
     verification-cost reason behind it — on every destination, including
     `Execute here`, where it applies to this session's own effort and
     rides Q4's context alongside the model half. Never a dispatch value:
     the `Agent` tool takes no effort argument, so the operator acting on
     it is the whole mechanism. Q4 asks whether to run the task where the
     recommendation points, never which effort to use — the recommendation
     itself is not a question.
   - `decision_log` — when the selected-task preparation result carries
     `decisionLog.enabled` true, include the template's `<decision_log>`
     block, substituting its `dir` for `<dir>` and this entry's id for
     every `<entry-id>`. Omit the block when `enabled` is false (the
     default). This is the only thing that connects the entry's close to a
     decision doc, so its `doc` field on the close command (below) is
     paired with it.
   - Add one more fixed paragraph right after `scope_discipline`, naming
     this entry's id, so the destination session — not Foreman — is the one
     that flips it to `in_progress`. Write `${CLAUDE_PLUGIN_ROOT}` into it
     as that literal string — the copy of this skill you are reading has
     the variable already resolved to a version-pinned cache path, and
     baking that in breaks the prompt on the next version bump; the gate
     errors on it:
     "This task is ROADMAP.jsonl entry `<id>`. Mark it `in_progress` before
     doing anything else — Foreman's picking flow deliberately leaves it
     `planned` until you do:
     `echo '{"id":"<id>","status":"in_progress"}' | node
     ${CLAUDE_PLUGIN_ROOT}/scripts/roadmap.js update-status`
     Then take the commit boundary before touching any file:
     `node ${CLAUDE_PLUGIN_ROOT}/scripts/safe-commit.js begin`
     Keep its `baseline.head`. A `dirty:true` result means the tree
     already carries someone else's changes: tell the user in one line,
     then do the work and make NO commit at all — leave everything in the
     tree for them. Never stage around it.
     When the work concludes, close the entry the same way — the status it
     actually earned (`done`, `dropped`, `rejected`) and your full findings
     in `notes`. If the work changed code, land the close inside the same
     commit instead of after it. Stage the task's own files with the
     safe-commit primitive — never `git add -A`:
     `echo '{"id":"<id>","expected":["<the files this task owns>"]}' | node
     ${CLAUDE_PLUGIN_ROOT}/scripts/safe-commit.js finish --baseline <baseline.head> --no-commit`
     It stages only what changed since the baseline and refuses on any file
     `expected` doesn't cover, naming them in `unexpected_files` — show
     those to the user and re-run with `--allow-unexpected` only once they
     approve. Then close with `staged:true` (the script folds the staged
     files into `observed_touches` and stages ROADMAP.jsonl alongside), then commit
     once with `Foreman: <id>` as the final line of the message — that
     trailer is the durable link between entry and commit, so no sha gets
     recorded and the roadmap never trails uncommitted:
     `echo '{"id":"<id>","status":"<status>","staged":true,"notes":"<findings>"}' | node
     ${CLAUDE_PLUGIN_ROOT}/scripts/roadmap.js update-status`
     A task that changed nothing (pure investigation) closes without
     staging or trailer. If the commit already landed before the close,
     pass `"commit":"<sha>"` instead of `staged` — that path still works
     and auto-folds observed_touches from the commit's diff.
     When this prompt carries a `<decision_log>` block, add `doc` to that
     close call — the decision doc's path, or `"none"` when nothing was
     decided:
     `echo '{"id":"<id>","status":"<status>","staged":true,"notes":"<findings>","doc":"<path or none>"}' | node
     ${CLAUDE_PLUGIN_ROOT}/scripts/roadmap.js update-status`
     Also add `model` and `effort` to that close call — what actually ran
     this task, not what was recommended for it:
     `echo '{"id":"<id>","status":"<status>","staged":true,"notes":"<findings>","model":"<haiku|sonnet|opus|fable>","effort":"<low|medium|high|xhigh|max>"}' | node
     ${CLAUDE_PLUGIN_ROOT}/scripts/roadmap.js update-status`
     Omit either one you genuinely don't know rather than guessing — an
     absent field reads as unrecorded, a wrong one silently poisons the
     corpus.
     The entry's `notes` is where the depth lives; your final chat message
     states the outcome and points at the entry."

     **Baking in the model** — on a background-`Agent` dispatch the
     confirmed executing-model answer IS the `Agent` call's `model` value,
     so it's already known here: substitute it into that close call
     literally, and the closing session reports only its effort. Every
     other destination leaves both placeholders in place — an `Execute
     here` run's model was never asked, and a pasted prompt's is whatever
     the user pasted it into. Never bake in an effort: effort is not a
     dispatch value, so craft time never learns it.

     **Resume variant** — when the chosen task came from `in_progress`
     (the finish-first check), the entry was already started by an earlier
     session, so swap the paragraph's opening for:
     "This task is ROADMAP.jsonl entry `<id>`, already marked `in_progress`
     by an earlier session — don't re-mark it; earlier findings may sit in
     its `notes` (included below), read them before re-deriving anything."
     and keep the closing instructions (status earned, findings in `notes`,
     staged close with the `Foreman: <id>` trailer) unchanged. Include the entry's existing `notes` in
     `background`/`context` — for a resume they're prior findings, exactly
     the context the destination shouldn't have to rebuild.

   Then run `prompt-template.md`'s mechanical gate on the assembled prompt
   (its "Mechanical gate" section has the exact call — pass
   `--entry <id>`, plus `--resume` for a resumed pick) and fix every error
   until it passes before delivering.
4. **Foreman never marks the entry `in_progress` itself.** It stays
   `planned` — even after this prompt is assembled, delivered, or copied —
   until whichever session actually starts the work runs the
   `update-status` call embedded in step 3 above. Picking or copying a task
   is not the same as starting it; only the session that begins acting on
   it should say so.
5. Deliver via whatever Q2 picked. Each destination's mechanics are
   `prompt-template.md`'s "Delivery mechanics" section; the `Execute here`
   sub-mode is Q3's answer, and `subject` derives from the entry's `title`.
   Whatever the destination, open the delivery message with a brief: one
   or two sentences in everyday words on what is about to change and why
   it matters, drawn from the entry's `why` and `what` only, restated for
   a teammate who has never seen this codebase — never the fields pasted
   verbatim. The brief is chat-only; the assembled prompt keeps every
   field dense and untranslated.
   What this skill layers on top:
   - **`Execute here`**: on `Run now, no tracking`, nothing mechanizes the
     entry's status, so the prompt's own embedded instructions carry it end
     to end. On `Tasks from the checks`, the entry paragraph rides the last
     row only, per the splitting section.

     On either tracked mode, Foreman's `task-created` hook marks the entry
     `in_progress` mechanically the moment the row carrying the embedded
     paragraph is created (it reads the entry id out of it) — finding it
     already `in_progress` when the embedded instruction runs is expected,
     and re-running that update is a harmless no-op. Still use `TaskUpdate`
     (a separate, session-local tracker) for each row's own `in_progress`/
     `completed` transitions as you go.
   - **Background Agent**: the tool result trails with the dispatched
     agent's id (`agentId: a<16 hex>`). Capture it immediately with one
     annotate call, so a later session can resume this exact agent instead
     of re-crafting a prompt from its notes:
     `` echo '{"id":"<id>","notes":"dispatched to background agent `<agent-id>`"}' | node ${CLAUDE_PLUGIN_ROOT}/scripts/roadmap.js annotate `` (the
     script date-stamps each appended note itself — don't write one in)
     The phrase "background agent" followed by the backticked id is the
     exact marker grammar the resume flow above parses — the id's own
     charset (`a` + lowercase hex) never needs escaping.
   - **Clipboard**: the same "Recommended model:" line `craft-prompt`'s
     Deliver step adds, when the confirmed model is concrete.

**Hard rule — state this explicitly if the user pushes back**: this skill
always asks before doing anything — it never silently executes a task, and
it never mentions or routes to any other plugin. "Do it now" means
picking `Execute here` above, not this skill deciding on its own.

---

## Branch: Add a task

1. Gather via free text: `title`, `why`, `what`, and optionally
   `depends_on` (existing ids) and `planned_touches` (path/area hints — the
   predicted surface; the observed one is derived at close, never given here).
   Don't force
   the user through every field if they've already given enough in a
   one-line description (args or a natural request) — ask only for what's
   missing. If the task reads as resolving an open question rather than
   building something — the phrasing is a choice ("X or Y?", "decide
   whether…", "pick an approach") — pass `kind: "decision"` so the pick
   flow later hands it a decide-don't-build rule. A build is the default;
   don't ask unless the entry genuinely looks like a decision.
   When this is a `kind: "decision"` entry, `Read` `.foreman/config.json`:
   if it carries no `decisionLog` key at all, the user has never been asked,
   and this is the first moment it matters — ask once (`AskUserQuestion`)
   whether Foreman should keep a short "why we picked this" note for
   decisions and show it to later tasks that build on them, then write the
   answer as `"decisionLog": {"enabled": <bool>}`, preserving every other
   key. Write it either way: recording the decline is what stops the
   question from coming back. A key that is already present is an answer —
   don't re-ask.
2. Before writing it, check it isn't already tracked:
   `echo '{"title":"...","why":"..."}' | node ${CLAUDE_PLUGIN_ROOT}/scripts/roadmap.js check-duplicate`
   — matches carry each entry's status. On a match, name the existing
   id/title/status in one line and ask whether to add anyway
   (`AskUserQuestion`: `Add it anyway` / `Never mind`); a `rejected` match
   means the user already declined this, say so. No match: add it without
   comment. If the user confirms an exact-title match is genuinely separate,
   ask them for a distinguishing title; exact adds are always replay-safe and
   never have an override. Ask *before* the write, not after — `add` has no
   undo: the only exit is `update-status dropped`, which leaves the row in
   the file forever. Wording that later turns out wrong is repairable (see
   "Correct a task"); a task that shouldn't exist is not.
3. `echo '{"title":"...","why":"...","what":"...","source":"user","depends_on":[...],"planned_touches":[...]}' | node ${CLAUDE_PLUGIN_ROOT}/scripts/roadmap.js add`
   — the script computes the id, validates required fields (including that
   every `depends_on` id already exists), and confirms the file is still
   well-formed after writing. An exact replay safely returns the existing
   entry with `deduped: true` instead of adding another row.
4. Confirm back to the user with the task's id and title (from the script's
   JSON response). If `deduped: true`, say it was already tracked and no
   duplicate was created. Surface any `warnings` the response carries,
   verbatim, in the same line.

---

## Branch: Correct a task

The user wants an existing entry fixed, not a new one: reworded, retargeted
at different files, or reclassified. **This branch does not investigate the
codebase** — no `Read`, no `Grep`. The user says what is wrong; the entry
says what it currently claims.

1. `node ${CLAUDE_PLUGIN_ROOT}/scripts/roadmap.js list --ids <id>` — the
   entry as stored. If the user named the task by words rather than id, run
   `list --summary` first to resolve it.
2. Show the current value against the proposed one for each field being
   corrected (`title`, `why`, `what`, `kind`, `planned_touches` — nothing else
   is correctable here: status is `update-status`, dependencies are
   `update-deps`, notes only ever append, and `observed_touches` is mechanical
   history the command refuses outright). Then **one** `AskUserQuestion`:
   `Apply the correction` / `Never mind`. `planned_touches` is a full
   replacement, so show the whole new list, not just the additions.
3. `echo '{"id":"...","expected_updated_at":"<the updated_at from step 1>","what":"..."}' | node ${CLAUDE_PLUGIN_ROOT}/scripts/roadmap.js correct`
   — pass the fetched `updated_at` verbatim as `expected_updated_at`; it is
   what stops a correction composed against an older version from
   overwriting a newer one. On a mismatch the script names the current
   value: re-fetch (step 1), re-check the correction still makes sense
   against the newer text, and ask again. Only `planned`/`in_progress`/
   `deferred` entries are correctable, and a title another entry already
   has is refused.
4. Confirm back in one line: the id and the response's `changed` list (a
   field the user restated identically will not be in it). Surface any
   `warnings` verbatim. Git holds what the entry used to say — don't copy
   the old wording into `notes`.

---

## Branch: Review status

Read-only. `node ${CLAUDE_PLUGIN_ROOT}/scripts/roadmap.js list --summary`
— id/title/status/depends_on per entry, which is everything the render
below needs; the full entries' prose would multiply the payload for
nothing on a large roadmap. Render a compact list grouped by `status`
(`awaiting_acceptance` first — those are finished and waiting on the user,
the only group that needs them to act — then `in_progress`, then `planned`
— noting which are blocked and on what, derivable from `depends_on` plus
the other entries' statuses — then
`deferred`, then `done`, `dropped`, `rejected` last). When a `planned`
entry's blocker resolves to an entry that is `dropped` or `rejected` — or
to an id no entry has — say so explicitly rather than calling it plain
"blocked": it will not reappear in the pick list until that dependency is
moved back with `update-status`, or its edge is removed with
`update-deps`'s `remove_depends_on`. Finished work that has been archived
is not in this render at all — `list --archived --summary` returns it in
the same shape when the user asks for the history. If any `deferred`
entries exist, fetch just those in full for the "waiting on what" word —
`list --ids <deferred ids>` — drawn from their `why`/`notes`. No writes,
no further questions.
