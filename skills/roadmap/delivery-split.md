# Deliver: Execute here, split by check

Read this with [delivery.md](delivery.md): its shared rules, its `Execute here`
section and its host rule still apply.

The craft call passed `"split":true`, so `tasks[]` holds the rows: the full
prompt on row 1, the entry paragraph on the last row only — already baked,
never re-split by hand. Work them in order; each row's check verifies that
row's own work.

A fixed number of tasks the user asked for, in the request or as the answer to
the destination question, is honored: the split then cuts into that many
slices at whatever verification boundaries exist instead of one per row. Don't
add a confirmation question — the created rows are the preview (in Claude Code,
a wrong one is removed with `TaskUpdate` `status: "deleted"`).

- In Claude Code, one `TaskCreate` per row, in order (each row's own
  `subject`/`description`, plus its own present-continuous `activeForm`), each
  chained to the previous one with `TaskUpdate` `addBlockedBy: ["<previous
  task's id>"]`; `TaskUpdate` per row as you go.
- In Codex, keep that order with a supported plan tool or an explicit local
  sequence; there is no assumed native task-dependency API. When
  `reviewEachIncrement:true` is present, follow the
  [increment review protocol](increment-review.md) after every result — the
  same protocol is embedded in the generated prompt, including for one
  reviewed row. Keep the current result pending until a real answer arrives; a
  passing check or a submitted question does not permit the next row or the
  parent close. When resuming, follow
  [resume-increments.md](resume-increments.md) before dependent work.

**Checkpoint protocol.** The one copy lives in
[prompt-template.md](../../prompt-template.md)
(`${CLAUDE_PLUGIN_ROOT}/prompt-template.md`), section "Checkpointing a
task-split run". Read that section before an implementation split run, or a
run producing explicitly authorized decision artifacts, and follow it exactly:
it owns the config defaults, the `safe-commit.js begin` boundary, the branch
rule, the per-task commit — including the `unexpected_files` refusal, which is
shown to the user and re-run with `--allow-unexpected` only on their approval
(an explicit earlier authorization of those files counts) — the rule that
checkpoints stay local and are never pushed, the roadmap-entry close, and what
happens to the branch at the end. A branch restriction the user gave overrides
every configured finish policy. Two things that section does not say and this
flow does: a roadmap handoff always carries an entry, so its entry close
always applies — make exactly the close the last row's entry paragraph names,
and no other: the staged close at the project root, the commit inside the
submodule for an entry whose files all sit in one, or the commit before the
close for a project that git-ignores `ROADMAP.jsonl`; and skip checkpointing
and just work the tasks if git is unavailable.

An investigation (`judgment.question`) uses split rows to collect diagnostic
evidence: skip checkpointing, branch creation, staging, and commits; a failed
check remains evidence, never a reason to implement. For a decision,
checkpoint only explicitly authorized decision artifacts.
