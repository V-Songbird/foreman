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
does: the entry's paths and symbols get checked mechanically by
`resolve-symbols.js` while the prompt is built, and the handoff checks the
rest of its claims once the work starts. Never tell the user a pick was
checked against the code, and never say the work has been confirmed —
nothing here has read the code, and nothing here has run.

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

<!-- [Foreman: 209] -->
**Trial log.** Which row the user chose exists only in this turn — no script
and no hook can see it, so these lines are the only reason the recommendation
numbers exist at all. Each is a no-op unless the project set `trialLog`, so
none needs a check first and it never blocks the flow.

- once, right after `next-candidates --menu` returns:
  `node ${CLAUDE_PLUGIN_ROOT}/scripts/trial-log.js menu_shown '{"candidates":<rows Q1 will show>,"hint":<true when --hint was passed>}'`.
  `candidates` counts every row the user reads, the accept and resume rows
  included, capped at 2 of each exactly as the finish-first check caps them.
  The single-option skip records it too, with `candidates: 1` — a menu of one
  is still a recommendation that was accepted or wasn't.
- once, on a menu built with `--hint`:
  `node ${CLAUDE_PLUGIN_ROOT}/scripts/trial-log.js hint_used '{"hit":<the script's own hint_matched>}'`
- once, when Q1 is asked:
  `node ${CLAUDE_PLUGIN_ROOT}/scripts/trial-log.js question_asked '{"flow":"pick"}'`
- exactly one of these on Q1's answer:
  `node ${CLAUDE_PLUGIN_ROOT}/scripts/trial-log.js pick_accepted '{"rank":<the row's 1-based position>}'` when the
  chosen row carries `(Recommended)`, or
  `node ${CLAUDE_PLUGIN_ROOT}/scripts/trial-log.js pick_overridden '{"chosen_rank":<the row's 1-based position, or null when the answer described something not on the list>}'`
  for any other row.

An accept or resume choice settles existing work rather than answering "what
next", so it records neither. The **defer** sub-branch records neither
either: it re-runs the menu, and the re-asked Q1 emits a fresh `menu_shown`.

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
`what`, `planned_touches`/`observed_touches`, `depends_on`, full `notes`, `doc`, and
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

**Gather the checks before asking.** Q2's options depend on how many
`Run:`/`Expected:` pairs this entry actually yields, so work out the
`verification` array (step 3's bullet says how) *before* the question. One
check or none means there is nothing to split, and the split option below
simply does not appear.

**Q2** — the destination question. Read
`${CLAUDE_PLUGIN_ROOT}/skills/roadmap/destination-question.md` now and do
exactly what it says: it carries the question and its options (the split
option appears only when the gathered `verification` array holds two or
more pairs), the delivery-path rule, and the render-sections
`fableEnabled` resolve that follows the answer — that resolve gates the
executing-model question below. The checkpoint protocol and clipboard
mechanics it defers to are step 5 below.

3. **Gather the judgment fields, then call `craft-handoff.js` once.** Every
   field below comes from the selected entry's own fields — no
   investigation, same rule as the top of this branch:
   - `role`/`goal` ← a role and one goal sentence for what "done" looks
     like, drawn from the entry's `title`/`why`.
   - `purpose` ← one sentence for what the finished work feeds or who
     reads it, when the entry's `why` names that; omit the field when
     `why` says nothing beyond the goal itself, which is the common case.
   - `context` ← the entry's `what`, plus its `notes` when non-empty,
     attributed as prior recorded findings on this entry (a survey verdict,
     a defer trigger, a previous session's evidence) — the selected-entry
     read already carries them, so this stops the destination re-deriving
     what someone already wrote down. `depends_on_docs` needs no gathering:
     when the selected entry carries a non-empty one, the script folds
     those resolved document paths into `context` on its own.
   - `steps`/`constraints` ← the entry's own `what`, split into what to
     implement and any hard limits or patterns to follow. `task_rules` carries no read-first bullet — a reinforced handoff
     states that step once in its `<plan>` block, and a standard one carries
     the concise truth line that binds every claim in the prompt, so don't
     add a copy here.
   - `expectedFileSurface` ← the entry's `planned_touches`, when known, as
     a plain string — the script turns it into the constraint line itself:
     "Expected file surface: <paths>. Anything beyond this list gets
     flagged to the user before it is written, not after." Omit the field
     when the surface genuinely isn't known yet.
   - `invariants` ← any assertions already stated in `why`/`what`/`notes`,
     rewritten as observable assertions — never a contract name. Nothing
     assertable means the field is omitted; that is normal.
   - `verification` ← the `Run:`/`Expected:` pairs, in running order, one
     per array entry. Gather these before Q2, properly, instead of settling
     for one inferred command: how many pairs there are is what decides
     whether Q2 offers the split at all, and this array is what the split
     cuts on (pass `"split":true` below). Set `testFirst: true` for the test-first ordering — write the invariant
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
     task-rule bullet, the lessons the ledger has about those files, and any
     `[Foreman: <id>]` anchor already sitting in them: all three are
     gathered by the script, nothing to gather here.

   Then, one call:
   ```
   echo '{"entry":"<id>","destination":"task|agent|clipboard","resume":<true only if this pick came from in_progress>,"split":<true only when Q2 picked "Execute here, split by check">,"judgment":{"role":"<role>","goal":"<goal sentence>","context":"<context prose>","steps":["<what to implement/fix>"],"constraints":["<hard limits, patterns to follow>"],"expectedFileSurface":"<planned_touches, when known>","verification":[{"run":"<exact command>","expected":"<pass/fail signal>"}],"testFirst":<true only for a silent-failure entry>,"invariants":["<one observable assertion per line>"]}}' | node ${CLAUDE_PLUGIN_ROOT}/scripts/craft-handoff.js
   ```
   Remember: the copy of this skill you are reading has
   the variable already resolved to a version-pinned cache path — type
   `${CLAUDE_PLUGIN_ROOT}` back literally in the stdin JSON above and in
   the delivery calls below; the gate errors on a resolved plugins-cache
   path.

   Returns one JSON line: `{ok, prompt, profile, signals, tasks?,
   ledger_ask?, gate, warnings}`. `profile` and `signals` are internal
   bookkeeping — never name either in anything the user reads. Surface any top-level
   `warnings` verbatim whenever that array is non-empty — including when
   `ok` is `true`, since a stale path or an unanswerable verification
   command has to be fixed before delivery. When `ok` is `false`, don't retry blind: show
   `gate.errors` (and any `gate.warnings`) to the user instead. Each entry
   is `{error, fix, example}` — `error` names the judgment field that's too
   thin (missing steps, missing verification, an unresolved reference),
   `fix` is the one action that clears it, and `example` is the shape to
   copy when a literal helps more than a sentence. Feed that JSON back to
   yourself verbatim, gather the named field properly, and re-call, rather
   than resending the same stdin hoping it passes.
   **`ledger_ask: true` — the first moment lesson lines could pay.**
   It appears only when a finished entry already touched files this one
   plans to and the setting has never been put to the user. Ask once, before
   delivering:

   > "**[Beta]** A finished task already touched these files. Should a close
   > be able to record one durable sentence about a code area, quoted back to
   > later tasks that plan to touch the same files? This one is new and may
   > still have rough edges. Turning it off later changes nothing you have
   > already recorded."
   > Options: `Yes, record and quote lessons`, `No, keep handoffs as they are`

   The `[Beta]` marker is part of the question, not decoration — it is the
   user's only warning before a setting starts writing a file into their
   repository. Keep it, and keep the sentence that says the answer is
   reversible: the honest reason to say yes to a young feature is that saying
   no later costs nothing.

   Write the answer straight into `.foreman/config.json` as
   `{"ledger":{"enabled":<true|false>}}`, preserving every other key —
   a written `false` is what stops the question being asked again. Never
   re-craft the prompt because of the answer: it takes effect on the next
   pick, which is soon enough for a setting nobody has been using.

4. **Foreman never marks the entry `in_progress` itself.** It stays
   `planned` — even after this prompt is assembled, delivered, or copied —
   until whichever session actually starts the work runs the
   `update-status` call embedded in step 3 above. Picking or copying a task
   is not the same as starting it; only the session that begins acting on
   it should say so.
   **Executing model — background Agent and clipboard only.** Now that the
   prompt exists, ask craft-prompt's Call 6 question — same wording, same
   slots and substitutions (`Fable` included only when `fableEnabled` is
   `true`), asked with no seeded default. Read
   `${CLAUDE_PLUGIN_ROOT}/skills/craft-prompt/SKILL.md`, section "Call 6 —
   executing model (conditional)", now and ask exactly what it carries —
   that section is the one copy of the wording, the option set, and the
   `Other` hint; never restate any of it here. This is the one question that
   comes after the prompt: the `Agent` tool needs a model named, and a
   clipboard prompt is about to be pasted into a session the user chooses.
   `Execute here` never asks it — the session already has a model.
5. Deliver via whatever Q2 picked, using the `prompt` (and `tasks[]` when
   present) craft-handoff just returned — never re-derive, re-split, or
   re-embed any of it. Open every delivery message with a brief: one or two
   sentences in everyday words on what is about to change and why it
   matters, drawn from the entry's `why` and `what` only, restated for a
   teammate who has never seen this codebase — never the fields pasted
   verbatim. The brief is chat-only; `prompt`/`tasks[]` stay dense and
   untranslated, and neither is ever pasted or printed into the chat
   response — they are data for a tool call, not something to show.
   - **`Execute here`** — one `TaskCreate` (`subject` a verb-first
     imperative ≤60 chars derived from the entry's `title`, `description`
     = `prompt`, `activeForm` its present-continuous form), then work it
     in this session with `TaskUpdate` marking it `in_progress` then
     `completed`.
   - **`Execute here, split by check`** — pass `"split":true` in the
     craft-handoff call above to get `tasks[]` (one row per
     `Run:`/`Expected:` pair, the full prompt on row 1, the entry paragraph
     on the last row only — already baked, never re-split by hand); one
     `TaskCreate` per row, in order (each row's own `subject`/`description`,
     plus its own present-continuous `activeForm`), each chained to the
     previous one with `TaskUpdate` `addBlockedBy: ["<previous task's
     id>"]`; work them in order, `TaskUpdate` per row as you go, and follow
     the checkpoint protocol below as each task's check passes.

     On either `Execute here` option, Foreman's `task-created` hook marks the entry
     `in_progress` mechanically the moment the row carrying the embedded
     paragraph is created (it reads the entry id out of it) — finding it
     already `in_progress` when the embedded instruction runs is expected,
     and re-running that update is a harmless no-op.

     **Checkpoint protocol — `Execute here, split by check` only.** The one
     copy lives in `${CLAUDE_PLUGIN_ROOT}/prompt-template.md`, section
     "Checkpointing a task-split run". Read that section now and follow it
     exactly: it owns the config defaults, the `safe-commit.js begin`
     boundary, the branch rule, the per-task commit — including the
     `unexpected_files` refusal, which is shown to the user and re-run with
     `--allow-unexpected` only on their approval — the rule that
     checkpoints stay local and are never pushed, the roadmap-entry close,
     and what happens to the branch at the end. This is the only moment
     this branch reads that file. Two things that section does not say and
     this flow does: a `foreman:roadmap` handoff always carries a roadmap
     entry, so its roadmap-entry close always applies here — stage with
     `safe-commit.js finish --no-commit`, close with `staged:true`, then
     commit with `Foreman: <id>` as the message's final line; and skip
     checkpointing and just work the tasks if git is unavailable.
   - **Background Agent**: call `Agent` with `prompt` = the returned
     `prompt`, `description` = a 3-5 word summary, `run_in_background:
     true`, and `model` = the executing model just confirmed above, as its
     literal string (`haiku`/`sonnet`/`opus`/`fable`) when concrete; omit
     the `model` parameter entirely when that answer was an `Other` that
     named no concrete model. The tool result trails with the
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
     exception to never printing it into chat. Name the executing model
     confirmed above in one line, so the user pastes it into the right kind
     of session. Any checkpoint protocol a multi-check prompt needs already
     rides inside `prompt`'s own `task_rules` — craft-handoff baked it in;
     nothing more to do here.

**Hard rule — state this explicitly if the user pushes back**: this skill
always asks before doing anything — it never silently executes a task, and
it never mentions or routes to any other plugin. "Do it now" means
picking `Execute here` above, not this skill deciding on its own.
