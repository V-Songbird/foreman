# Branch: Pick the next task

<!-- [Foreman: 141] -->
This is **Fast pick**, the default and the whole of this branch — nothing
below changes because the other mode exists. **Reconcile and pick** is the
deeper mode for when the roadmap itself has gone stale: it repairs the
near-term entries first, then runs this same flow on the repaired data.

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

<!-- [Foreman: 141] -->
### Reconcile and pick — the deeper mode, only when the user asks

The second confidence mode, in this order: **investigate → propose → apply →
recommend.** It is composition, not a second pick flow — a survey pass scoped
to the near-term entries, then Fast pick unchanged on the repaired data:

1. **Investigate** — run step 1's `next-candidates --menu` first and take the
   **near-term set** from that one result: every `candidates[].id`, plus every
   `in_progress[].id`, plus every `awaiting_acceptance[].id`. That is the
   whole definition — no second call computes it, and nothing outside that
   menu is near-term. Hand those ids to `foreman:survey` as its scope (its
   "Pick the scope" step takes a given set verbatim) and let it run through
   to its own report.
2. **Propose**, then **apply** — survey's own machinery, untouched: an
   evidence-backed concrete proposal per finding, approval per finding, and
   `correct`/`update-deps`/`update-status` for only what the user approved,
   with an unconfirmed breadcrumb for what it could not ground. Nothing here
   overrides any of it. A pass that finds nothing is a clean result, not a
   failure — say so and go on to 3.
3. **Recommend** — re-run `next-candidates --menu`, because the approved
   repairs may have changed statuses, dependencies, and planned surfaces, so
   the menu from 1 is stale. Then continue through Fast pick's steps below
   exactly as written. The pick is not a different pick; it just reads
   repaired data.

**Offering it from Fast pick — one line, never a run.** Fast pick may mention
this mode once, in a single line, when its own data already shows staleness.
Never as a blocking question, never started on your own, and never because the
roadmap merely looks old. Two mechanical signals, both already in hand:
- a menu `in_progress` or `awaiting_acceptance` row whose `updated_at` is more
  than **30 days** before today (the same stale signal step 3's profile check
  reads);
- the selected entry's `notes` carrying a `survey (unconfirmed):` breadcrumb —
  a lead an earlier survey could not ground, visible after the selected-entry
  load.

Menu candidate rows carry neither `updated_at` nor `notes`, so there is no
staleness to read there — don't fetch any to find some. If the user says yes,
start at 1 above; if they don't answer or say no, Fast pick continues
unchanged.

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
there were no marker — go on to Q2 and craft the re-crafted prompt (the
resume case, step 3) from the entry's notes. Never surface the SendMessage
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

Never call `mcp__ccd_session__spawn_task` for any of these — it has a known
bug where tasks spawned through it don't get MCP tools. `TaskCreate`,
`Agent`, and the clipboard mechanics in step 5 below are the only three
delivery paths, regardless of Desktop or CLI.

**Q3 — execution mode**, asked only when Q2's answer was `Execute here`.
The other two destinations skip it entirely. "How should it run here?"
Options, in this order:
- `Tasks from the checks (Recommended)` — one tracked task per
  verification command, each finished task checkpointed as a commit on a
  dedicated branch (the checkpoint protocol in step 5 below)
- `One task, then work it` — a single tracked task carrying the whole
  prompt
- `Run now, no tracking` — start immediately, no task rows

`AskUserQuestion` appends its own free-text option; never author one — a
user's free text naming the pieces, or a fixed number of tasks, both mean
"Tasks from the checks" cuts into that many slices at whatever verification
boundaries exist instead of one-per-check. Don't add a confirmation
question for either — the created rows are the preview, and a wrong one is
removed with `TaskUpdate` `status: "deleted"`.

**Selected-task preparation**: after the destination/mode questions and
before Q4, run `node ${CLAUDE_PLUGIN_ROOT}/scripts/render-sections.js`
exactly once. Its `modelSuggestions`, `fableEnabled`, and `targetModel`
fields are what gate Q4 and the executing-model step below —
`craft-handoff.js` resolves this same config again internally when it
assembles, so this call is only for those gating decisions, never for reuse
in assembly. Surface its `warnings` now, if any. Project-section rendering
is deliberately delayed until a task has been selected.

<!-- [Foreman: 111] -->
**Q4 — match the recommendation**, asked only when the selected-task
preparation result has `modelSuggestions: true` — it defaults to `false`,
and a project that leaves it off never sees this question or any
model/effort line anywhere in this branch. Then, and only then, asked when
Q2's answer was `Execute here`, once per handoff and never once per task
row, after Q3 and
**before the first task row is created**. The other two destinations skip
it — they always ask their own executing-model question instead (step 3
below), since a dispatch needs a model named. State BOTH halves of the
recommendation in the question's context, one line each with the reason
behind it: the model per `prompt-template.md`'s "Model fit" note, the
effort per its "Effort fit" note. This is the only place the model half is
ever said on this destination.
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

3. **Gather the judgment fields, then call `craft-handoff.js` once.** Every
   field below comes from the selected entry's own fields — no
   investigation, same rule as the top of this branch:
   - `role`/`goal` ← a role and one goal sentence for what "done" looks
     like, drawn from the entry's `title`/`why`.
   - `context` ← the entry's `what`, plus its `notes` when non-empty,
     attributed as prior recorded findings on this entry (a survey verdict,
     a defer trigger, a previous session's evidence) — the selected-entry
     read already carries them, so this stops the destination re-deriving
     what someone already wrote down. `depends_on_docs` needs no gathering:
     when the selected entry carries a non-empty one, the script folds
     those resolved decision-doc paths into `context` on its own.
   - `steps`/`constraints` ← the entry's own `what`, split into what to
     implement and any hard limits or patterns to follow. `task_rules` carries no read-first bullet — the fixed `<plan>` block
     states that step once for every handoff, and `truth_grounding` already
     carries the verify-before-acting mandate, so don't add a third copy
     here.
   - `expectedFileSurface` ← the entry's `planned_touches`, when known, as
     a plain string — the script turns it into the constraint line itself:
     "Expected file surface: <paths>. Anything beyond this list gets
     flagged to the user before it is written, not after." Omit the field
     when the surface genuinely isn't known yet.
   - `invariants` ← any assertions already stated in `why`/`what`/`notes`,
     rewritten as observable assertions — never a contract name. Nothing
     assertable means the field is omitted; that is normal.
   - `verification` ← the `Run:`/`Expected:` pairs, in running order, one
     per array entry. When Q3 picked `Tasks from the checks`, gather these
     properly instead of settling for one inferred command — a single
     check yields a single task, and this array is what the split cuts on
     (pass `"split":true` below). Set `testFirst: true` for the test-first ordering — write the invariant
     test first, confirm it passes against the unmodified code, break the
     invariant on purpose and confirm it goes red, then implement — only
     for a silent-failure entry, one whose breakage would pass the
     existing checks; omit it otherwise. An entry
     with nothing runnable at all omits `verification` and carries
     `question` instead — the question under investigation, not a
     prescribed exploration sequence.
   - `relevant_files` needs no gathering: the script resolves the selected
     entry's own `planned_touches` through `resolve-symbols.js` internally
     and cites the symbols it finds — still no investigation, since it
     reads only files the entry already named. Same for the decision-entry
     task-rule bullet and the `<decision_log>` block: both are baked
     automatically from the selected entry's `kind` and the project's
     `decisionLog` setting, nothing to gather here.

   **Executing model — background Agent and clipboard only**, once
   `verification` above is known: ask craft-prompt's Call 6 question here,
   before the call below — same wording, same slots and substitutions
   (`Fable` included only when `fableEnabled` is `true`). When
   `modelSuggestions` is `true`, seed the recommended default per
   `prompt-template.md`'s "Model fit" note; when it's `false`, ask with no
   seeded default. Either way, also state the effort recommendation in one
   line of the delivery message, per the "Effort fit" note's
   verification-cost rule — never a dispatch value: the `Agent` tool takes no effort argument, so the operator acts on it instead of it being set.
   Pass the confirmed model as `model` below.

   Then, one call:
   ```
   echo '{"entry":"<id>","destination":"task|agent|clipboard","resume":<true only if this pick came from in_progress>,"split":<true only when Q3 picked "Tasks from the checks">,"model":"<haiku|sonnet|opus|fable — agent/clipboard only, when gathered above>","judgment":{"role":"<role>","goal":"<goal sentence>","context":"<context prose>","steps":["<what to implement/fix>"],"constraints":["<hard limits, patterns to follow>"],"expectedFileSurface":"<planned_touches, when known>","verification":[{"run":"<exact command>","expected":"<pass/fail signal>"}],"testFirst":<true only for a silent-failure entry>,"invariants":["<one observable assertion per line>"]}}' | node ${CLAUDE_PLUGIN_ROOT}/scripts/craft-handoff.js
   ```
   Remember: the copy of this skill you are reading has
   the variable already resolved to a version-pinned cache path — type
   `${CLAUDE_PLUGIN_ROOT}` back literally in the stdin JSON above and in
   the delivery calls below; the gate errors on a resolved plugins-cache
   path.

   Returns one JSON line: `{ok, prompt, profile, signals, tasks?, gate,
   warnings}`. `profile` and `signals` come from the same mechanical
   signals `prompt-template.md`'s "Handoff profiles" section defines —
   never a judgment call on this branch's part; state them in the delivery
   message's brief (step 5). When `ok` is `false`, don't retry blind: show
   `gate.errors` (and any `gate.warnings`) to the user instead — each names
   the judgment field that's too thin (missing steps, missing
   verification, an unresolved reference) — gather that field properly and
   re-call, rather than resending the same stdin hoping it passes.
4. **Foreman never marks the entry `in_progress` itself.** It stays
   `planned` — even after this prompt is assembled, delivered, or copied —
   until whichever session actually starts the work runs the
   `update-status` call embedded in step 3 above. Picking or copying a task
   is not the same as starting it; only the session that begins acting on
   it should say so.
5. Deliver via whatever Q2 picked, using the `prompt` (and `tasks[]` when
   present) craft-handoff just returned — never re-derive, re-split, or
   re-embed any of it. Open every delivery message with a brief: one or two
   sentences in everyday words on what is about to change and why it
   matters, drawn from the entry's `why` and `what` only, restated for a
   teammate who has never seen this codebase — never the fields pasted
   verbatim — plus the returned `profile` and which `signals` fired, in
   plain words. The brief is chat-only; `prompt`/`tasks[]` stay dense and
   untranslated, and neither is ever pasted or printed into the chat
   response — they are data for a tool call, not something to show.
   - **`Execute here`**:
     - `Run now, no tracking` — work `prompt` directly in this session; no
       task rows exist, so nothing mechanizes the entry's status — its own
       embedded instructions carry that end to end.
     - `One task, then work it` — one `TaskCreate` (`subject` a verb-first
       imperative ≤60 chars derived from the entry's `title`, `description`
       = `prompt`, `activeForm` its present-continuous form), then work it
       in this session with `TaskUpdate` marking it `in_progress` then
       `completed`.
     - `Tasks from the checks` — pass `"split":true` in the craft-handoff
       call above to get `tasks[]` (one row per `Run:`/`Expected:` pair,
       the full prompt on row 1, the entry paragraph on the last row only —
       already baked, never re-split by hand); one `TaskCreate` per row, in
       order (each row's own `subject`/`description`, plus its own
       present-continuous `activeForm`), each chained to the previous one
       with `TaskUpdate` `addBlockedBy: ["<previous task's id>"]`; work
       them in order, `TaskUpdate` per row as you go, and follow the
       checkpoint protocol below as each task's check passes.

     On either tracked mode, Foreman's `task-created` hook marks the entry
     `in_progress` mechanically the moment the row carrying the embedded
     paragraph is created (it reads the entry id out of it) — finding it
     already `in_progress` when the embedded instruction runs is expected,
     and re-running that update is a harmless no-op.

     **Checkpoint protocol — `Tasks from the checks` only, two or more
     tasks.** Read the `checkpoints` block of `.foreman/config.json` first
     (`branch` `true`, `onFinish` `"ask"`, `baseBranch` unset are the
     defaults for a missing file/block/key). Before task 1:
     `node ${CLAUDE_PLUGIN_ROOT}/scripts/safe-commit.js begin` — a
     `dirty:true` result means this run makes no automated commits at all:
     say so once, work the tasks, and leave every change in the tree for
     the user. Otherwise settle the branch (create `foreman/<slug>` only
     when `branch` is `true` and currently on the base branch — `baseBranch`
     when set, or detect it with
     `git symbolic-ref --short refs/remotes/origin/HEAD`, name after
     `origin/`, fallback `main`); then, after each task's check passes:
     `echo '{"expected":["<files that task changed>"],"message_title":"task <n>/<total>: <task subject>"}' | node ${CLAUDE_PLUGIN_ROOT}/scripts/safe-commit.js finish --baseline <the current baseline>`
     — never `git add -A`, the primitive owns staging, and its `commit` is
     the next task's baseline. The last checkpoint carries the
     roadmap-entry close: stage with `safe-commit.js finish --no-commit`,
     close with `staged:true`, then commit with `Foreman: <id>` as the
     message's final line — the entry paragraph and gate rules above are
     unchanged. After the last task, and only if this run created the
     branch, `onFinish` decides its fate: `"ask"` (the default) asks
     `Squash merge (Recommended)` / `Merge` / `Open a PR` / `Keep the
     branch`; a concrete value acts directly, no question. Skip
     checkpointing and just work the tasks if git is unavailable.
   - **Background Agent**: call `Agent` with `prompt` = the returned
     `prompt`, `description` = a 3-5 word summary, `run_in_background:
     true`, and `model` = the confirmed executing model from step 3 as its
     literal string when concrete. The tool result trails with the
     dispatched agent's id (`agentId: a<16 hex>`). Capture it immediately
     with one annotate call, so a later session can resume this exact agent
     instead of re-crafting a prompt from its notes:
     `` echo '{"id":"<id>","notes":"dispatched to background agent `<agent-id>`"}' | node ${CLAUDE_PLUGIN_ROOT}/scripts/roadmap.js annotate `` (the
     script date-stamps each appended note itself — don't write one in)
     The phrase "background agent" followed by the backticked id is the
     exact marker grammar the resume flow above parses — the id's own
     charset (`a` + lowercase hex) never needs escaping.
   - **Clipboard**: `Write` the returned `prompt` to a temp file first —
     never pass it as an inline shell string, a large prompt breaks shell
     quoting and the copy silently fails. Then pipe the file's content into
     the clipboard command: `Get-Content -Raw <file> | Set-Clipboard` on
     Windows, `pbcopy < <file>` on macOS, `xclip -selection clipboard <
     <file>` (or `wl-copy < <file>`) on Linux. Mention the file path too,
     in case the clipboard step fails. If no clipboard tool is available at
     all, show the prompt in a fenced `xml` code block instead — the one
     exception to never printing it into chat. Add the same "Recommended
     model: [Haiku/Sonnet/Opus/Fable] — this prompt's elaboration level was
     calibrated for it." line when step 3's confirmed executing model is
     concrete; skip the line when it resolved to `inherit` or nothing was
     named. Any checkpoint protocol a multi-check prompt needs already
     rides inside `prompt`'s own `task_rules` — craft-handoff baked it in;
     nothing more to do here.

**Hard rule — state this explicitly if the user pushes back**: this skill
always asks before doing anything — it never silently executes a task, and
it never mentions or routes to any other plugin. "Do it now" means
picking `Execute here` above, not this skill deciding on its own.
