# Branch: Pick the next task

<!-- [Foreman: 141] -->
This is **Fast pick**, the default and the whole of this branch — nothing
below changes because the other mode exists. **Reconcile and pick** is the
deeper mode for when the roadmap itself has gone stale: it repairs the
near-term entries first, then runs this same flow on the repaired data.

**This branch does not investigate the codebase. At all.** No file reads, no
searches, no exploring files to confirm or expand what an entry says. The
selected entry's own fields are the only input to the prompt. Verifying
those claims against reality is the handed-off session's job, at the start
of *its* work — that's exactly what the `<truth_grounding>` block in
`prompt-template.md` exists for. Do not read the full backlog to re-derive
the menu either: the script ranks it, and its order is Foreman's
recommendation, not a claim to have found the objectively best task.

Say it that way whenever the flow explains itself, and never more than it
does: the entry's paths and symbols get checked mechanically by
`resolve-symbols.js` while the prompt is built, and the handoff checks the
rest of its claims once the work starts. Never tell the user a pick was
checked against the code, and never say the work has been confirmed —
nothing here has read the code, and nothing here has run.

## The loop

1. Run `node ${CLAUDE_PLUGIN_ROOT}/scripts/roadmap.js step pick`. With a pick
   hint, add `--hint "<the hint's words>"` and read [hint.md](hint.md)
   (`${CLAUDE_PLUGIN_ROOT}/skills/roadmap/hint.md`). When the user already
   named the entry they want, run `step pick --chose <id>` instead.
2. Read `next` in the one JSON line it prints and do that row of the table
   below.
3. A row that ends with `then` runs that command next, placeholders filled
   in, and the loop goes back to 2.

The output is input for you. **Never paste or print it into your chat
response.** `ok:false` carries an `error` that says what to fix: fix it and
run the step again, asking the user only when the fix needs their answer.

| `next` | Do |
| --- | --- |
| `ask_q1` | Go straight to the question, with no recap of the rows first: the question is the presentation. Ask `question` with one option per `options` row, in order (see Questions). Label: the row's `label`, exactly. Description: the row's `why` in your own everyday words, one sentence for a teammate who has never seen this codebase, then its `reason` as a short trailing clause, reworded to fit but never contradicted. `reason` already carries any collision caution, and a collision is a caution, never a blocker; never add `what`, file surfaces, `notes` or `unblocks`. A recommended accept or resume row never stops the user choosing new work. With `hint_matched:false`, first say in one line that nothing matches the hint. Then run `then` with the chosen row's `id`; `other` when the user described something not on the list; `defer` when they waved a candidate off as "not yet", "later" or "not until X", or named a prerequisite outside the dependency graph. |
| `accept` | Read [accept.md](accept.md) (`${CLAUDE_PLUGIN_ROOT}/skills/roadmap/accept.md`) and follow it for `entry`. No prompt is crafted for an accept. |
| `resume` | Read [resume.md](resume.md) (`${CLAUDE_PLUGIN_ROOT}/skills/roadmap/resume.md`) and follow it for `entry`. When it sends the flow on, do the `gather_checks` row. |
| `defer` | Read [defer.md](defer.md) (`${CLAUDE_PLUGIN_ROOT}/skills/roadmap/defer.md`) and follow it, then run `then`. Don't defer on your own judgment — a task that merely ranks lower stays `planned`. |
| `gather_checks` | Write the verification rows from `entry`'s own fields (see Checks). Then run `then` with `<n>` the number of rows, plus the flags under Q2 flags that hold. When the user already named a destination, add `--dest <here\|split\|agent\|clipboard>` to that command; the reply is `craft`. |
| `ask_q2` | Ask it directly, with no permission preamble, and only once. Ask `question` with the four `options`, in order, label and description exactly as given (see Questions). When `question` opens with an entry's `title (id):` and its `why`, keep the title and id, restate that `why` in your own everyday words, one sentence, and keep the rest exactly: this is how the user can still veto or redirect a pick they did not choose. Then run `then` with the chosen option's `dest`; a free-text answer names the nearest one, and a fixed number of tasks is `split`. A cautioned choice is built as asked, with no second question and no talking the user out of it; if its capability does not exist in this session, say so plainly. |
| `craft` | With `intro`, state its `title` (`id`) and `why` in one line first. Then craft and deliver (see Craft), with `craft`'s fields as given. |
| `empty` | Tell the user in one line that nothing is ready to start, and stop. |

`stale:true` in any reply is the one signal for offering the deeper mode,
below. Work starts only once the user has chosen a destination, in Q2 or in
their own request.

**Trial log.** The step records the events this flow can see —
`menu_shown` and `hint_used` with the menu, `question_asked` after
`--after q1` or `--after q2`, and `pick_accepted` or `pick_overridden` for a
planned row chosen at Q1; these events are emitted by the CLI; do not record
them again. Pass `--after` only when the user actually saw that question, so
a skipped question is never logged. An accept, resume, or defer choice
settles existing work, so the step records no pick event for it. The step
counts one question per answer: when Q1 paged with More tasks, or Codex
split Q2 over two calls, record each extra call yourself with
`node ${CLAUDE_PLUGIN_ROOT}/scripts/trial-log.js question_asked '{"flow":"pick"}'`.
A valid call records nothing unless the project set `trialLog`, so it needs
no check first; a malformed one fails in every project. Either way it never
blocks the flow.

### Questions

- In Claude Code, one `AskUserQuestion`. It appends its own free-text
  option; never author one. It takes four options at most: with more rows,
  show the first three and `More tasks`, and on that choice the next ones the
  same way, never dropping a row. Give each Q1 option a plain-text preview
  of up to six lines built only from its label, `why` and `reason`.
- In Codex, the picker in [questions.md](../foreman/questions.md): each
  option string is the label, then ` - ` and the description. It pages Q1
  with a More tasks choice, and it says how the four destinations fit a
  three-option limit.
- In Antigravity, one `ask_question`, each description in its own option
  text; the tool supplies the free-text answer itself.

### Q2 flags

The step probes the tree itself, as `safe-commit.js begin` does, and applies
the destination rules of
[destination-question.md](destination-question.md)
(`skills/roadmap/destination-question.md`), which craft-prompt still reads;
the two copies change together. Add a flag only when its condition holds:

- `--runnable <r>`: fewer than all rows have a `run` command; `<r>` is how
  many do. A human review is not a command.
- `--slices <s>`: `<s>` rows after the first name their own slice of the
  work.
- `--context-high`: in Claude Code, a `[Foreman] Context reading for the
  destination question` arrived this turn. Codex and Antigravity supply
  none. No reading means unknown, so never infer one.
- `--no-delegate`: this session has no callable way to start a background
  agent.
- `--no-reviewer`: in Codex, review after each result was requested and no
  human or coordinator channel is known to accept each one.

Foreman never asks which model runs the work and never sets one: a
background agent inherits this session's model, and a pasted prompt runs
wherever the user pastes it.

<!-- [Foreman: 141] -->
## Reconcile and pick — the deeper mode, only when the user asks

When the user asks for it, read [reconcile.md](reconcile.md)
(`${CLAUDE_PLUGIN_ROOT}/skills/roadmap/reconcile.md`) and follow it: it scopes
a survey pass to the near-term entries, then runs this flow's loop on the
repaired data.

**Offering it from Fast pick — one line, never a run.** Fast pick may mention
this mode once, in a single line, when its own data already shows staleness.
Never as a blocking question, never started on your own, and never because the
roadmap merely looks old — age alone never starts a survey. The step reports
`stale:true` on two mechanical signals:
- a menu `in_progress` or `awaiting_acceptance` row whose `updated_at` is more
  than **30 days** before today (the same stale signal the craft profile
  reads);
- the selected entry's `notes` carrying a `survey (unconfirmed):` breadcrumb —
  a lead an earlier survey could not ground.

If the user says yes, read [reconcile.md](reconcile.md) and start at its step 1;
if they don't answer or say no, Fast pick continues unchanged.

## Checks

Q2's labels depend on how many verification rows this entry yields, so
write them *before* the question, in running order, properly instead of
settling for one inferred command. The count never removes an option — all
four are always offered — it decides which of them carries a caution. Never
invent a command.

- In Claude Code, one `Run:`/`Expected:` pair per row:
  `{"run":"<exact command>","expected":"<pass signal>"}`. A split cuts on
  these rows, so when a check verifies its own slice of the work, name that
  slice on its row with `goal` (and `files` when the entry's own fields say
  which). An entry with nothing runnable at all has no rows and carries
  `question` instead — the question under investigation, not a prescribed
  exploration sequence.
- In Codex, write the rows as [prepare-increments.md](prepare-increments.md)
  describes.
- In Antigravity, write them the same way, since the builder gives
  Antigravity the Codex form, but never add `reviewEachIncrement` or
  `review`: approval after each result is not available there.

## Craft

**Gather the judgment fields, then call `craft-handoff.js` once.** Every
field below comes from the selected entry's own fields and the user's
request — no investigation, same rule as the top of this branch:
- `request` ← one specific sentence that preserves the entry's task type:
  an investigation or review asks for its findings, a decision asks for
  the choice, and neither implies a follow-up change.
- `role`/`goal` ← a role and one goal sentence for what "done" looks
  like, drawn from the entry's `title`/`why`.
- `purpose` — do not gather it for a roadmap pick. The script writes
  the entry's own `why`, word for word, into `task_context` as the
  purpose line ("Why this task exists: …"), so the user's stated
  intention reaches the session unparaphrased; a `purpose` passed here
  would be dropped in its favour.
- `context` ← the entry's `what`. Do not copy its `notes`: when they
  are non-empty the script adds them to `context` itself, escaped and
  marked as recorded evidence, so the destination reads prior findings
  (a survey verdict, a defer trigger, a previous session's evidence) as
  data to check.
  `depends_on_docs` needs no gathering: when the selected entry carries a
  non-empty one, the script folds those resolved document paths into
  `context` on its own.
- `steps`/`constraints` ← the entry's own `what`, split into what to
  implement and any hard limits or patterns to follow; an explicit file
  restriction or read-only scope the user gave goes in `constraints`. An
  investigation passes `question` instead of implementation steps.
  `task_rules` carries no read-first bullet — a reinforced handoff
  states that step once in its `<plan>` block, and a standard one carries
  the concise truth line that binds every claim in the prompt, so don't
  add a copy here.
- `expectedFileSurface` — do not gather it either. The script fills the
  "Expected file surface:" constraint line from the entry's
  `planned_touches` on its own. Pass the field only to narrow or widen
  that list on purpose; an entry with no `planned_touches` gets no line,
  which is the one honest case.
- `invariants` ← any assertions already stated in `why`/`what`/`notes`,
  rewritten as observable assertions — never a contract name. Nothing
  assertable means the field is omitted; that is normal.
- `verification` ← the rows from Checks; a split cuts on them.

  Set `testFirst: true` for the test-first ordering — write the invariant
  test first, confirm it passes against the unmodified code, break the
  invariant on purpose and confirm it goes red, then implement — only
  for a silent-failure entry, one whose breakage would pass the
  existing checks; a failing test that already catches the bug needs no
  artificial mutation exercise. Omit it otherwise.
- `relevant_files` needs no gathering: the script resolves the selected
  entry's own `planned_touches` through `resolve-symbols.js` internally
  and cites the symbols it finds — still no investigation, since it
  reads only files the entry already named. Same for the decision-entry
  task-rule bullet: the script gathers it, nothing to gather here.

Then, one call, with `entry`, `host`, `destination`, `resume` and `split`
copied from the step's `craft`, through a quoted heredoc so an apostrophe in
the prose keeps its quoting:
```
node ${CLAUDE_PLUGIN_ROOT}/scripts/craft-handoff.js <<'EOF'
{"entry":"<id>","host":"claude|codex|antigravity","destination":"task|agent|clipboard","resume":<from craft>,"split":<from craft>,"request":"<specific request preserving the task type>","judgment":{"role":"<role>","goal":"<goal sentence>","context":"<context prose>","steps":["<what to implement/fix>"],"constraints":["<hard limits, patterns to follow>"],"verification":[{"run":"<exact command>","expected":"<pass/fail signal>"}],"testFirst":<true only for a silent-failure entry>,"invariants":["<one observable assertion per line>"]}}
EOF
```
In Claude Code, remember: the copy of this skill you are reading has
the variable already resolved to a version-pinned cache path — type
`${CLAUDE_PLUGIN_ROOT}` back literally in the stdin JSON above and in
the delivery calls below; the gate errors on a resolved plugins-cache
path. In Codex and Antigravity, a payload file in the project's `tmp/` or a
here-string carries the same JSON, as the runtime describes.

Returns one JSON line: `{ok, prompt, profile, signals, tasks?, gate,
warnings}`. `profile` and `signals` are internal bookkeeping — never name
either in anything the user reads. Surface any top-level `warnings`
verbatim whenever that array is non-empty — including when `ok` is
`true`, since a path not on disk yet, or an unanswerable verification
command, has to be judged before delivery. When `ok` is `false`, don't
retry blind and never deliver it. Each `gate.errors` entry is
`{error, fix, example}` — `error` names the judgment field that's too
thin (missing steps, missing verification, an unresolved reference),
`fix` is the one action that clears it, and `example` is the shape to
copy when a literal helps more than a sentence. Feed that JSON back to
yourself verbatim, repair the named field from the entry and the user's
request, and re-call, rather than resending the same stdin hoping it
passes; show the errors to the user when the repair needs their answer.
Never invent symbols to satisfy the gate, and never claim its mechanical
preflight established that the work is correct.

Deliver via the destination the user chose by following [delivery.md](delivery.md)
(`${CLAUDE_PLUGIN_ROOT}/skills/roadmap/delivery.md`), using the `prompt`
(and `tasks[]` when present) craft-handoff just returned — never re-derive,
re-split, or re-embed any of it.

**Foreman never marks the entry `in_progress` itself.** It stays `planned`
— even after this prompt is assembled, delivered, or copied — until
whichever session actually starts the work opens it: in Claude Code through
the task hook or the `update-status` call embedded in the prompt, in Codex
and Antigravity through `hooks/codex-task.js start`. Picking or copying a
task is not the same as starting it; only the session that begins acting on
it should say so.

**Hard rule — state this explicitly if the user pushes back**: this skill
never silently executes a task — work starts only once the user has chosen a
destination, in Q2 or in their own request — and it never mentions or routes
to any other plugin. "Do it now" means `Execute here`, not this skill
deciding on its own.
