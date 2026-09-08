# How do you want to run this?

This is the shared destination question for roadmap picks and standalone prompt
crafting. Ask it before assembly unless the user already specified a destination.
Destination and execution mode are one choice, with no model-selection question.
Gather rows through [prepare-increments.md](prepare-increments.md). An explicit
request for review after each result travels as `reviewEachIncrement:true` with
any selected destination, without a second opt-in question.

Keep Foreman's four options in this base order; move the recommendation first
when the question tool requires it:

1. **Execute here** — work the whole prompt in this session.
2. **Execute here, split by check** — ordered work units with a checkpoint after
   each completed row, using the template's checkpoint protocol. When the user
   requested review, acceptance also precedes any eligible checkpoint.
3. **Execute with a background agent** — delegate through the available Codex
   collaboration tools; this session coordinates and owns commits.
4. **Copy prompt to clipboard** — deliver a self-contained prompt without execution.

Use [the shared picker protocol](../foreman/questions.md), preferring
`request_user_input_async` with all four options in one selectable question:
"How do you want to run this?" Include each description and any current caution
in its option string. If the permitted tool allows only three options, first
offer Execute here, Background agent, and Clipboard; after Execute here, ask
Whole task or Split by check. Carry the recommendation into the appropriate
group and follow-up. Preserve all four destinations and accept an explicit
split choice without the follow-up. Honor a free-text destination or a
user-specified number of slices. If background
delegation is unavailable, disclose that limitation and offer the portable
prompt; do not create a new sidebar task without an explicit user request.

## Collect the answer

Follow the shared protocol's submission, waiting, and fallback rules. Assemble
and deliver only after the user chooses, reusing that choice without asking
again. This is an execution preference; present the picker directly without a
permission preamble or an explanation that the skill requires it.

## Read the signals

Before asking, run `node "<plugin-root>/scripts/safe-commit.js" begin`.
This is a read-only probe. Only `dirty:false` means checkpointing can be
recommended; `ledger_dirty` with `dirty:false` is Foreman's own bookkeeping.
A dirty or unavailable repository means split work still runs in order but
creates no checkpoint branch and makes no automated commits.

Use only a current, reliable context-occupancy signal supplied by the host.
Unknown context is unknown; do not inspect account rate limits or infer a
percentage from transcript length, model name, or another host's configuration.

Exactly one option gets `(Recommended)`. Take the first applicable rule:

1. A reliable current context signal says this session is filling up:
   recommend clipboard. A subagent still returns its result into this session.
2. Other work is running, the selected candidate's `collision` is explicitly
   false, the tree probe returned `dirty:false`, and there is a runnable check:
   recommend the background agent when delegation is available. For an explicitly
   reviewed run, a coordinator able to relay results to the human must also be
   available; background execution alone does not prove that channel exists. The selected
   resumed task does not count as other work; a missing collision value is
   unknown. Standalone craft has no roadmap menu, so this rule does not apply.
3. At least two increment rows, each later row has its own meaningful work slice,
   and `dirty:false`: recommend split by check.
4. Otherwise: recommend execute here.

Count each mixed Run/Look row once. Runnable verification means an actual
`run` command, not merely a nonempty verification array. Human-only rows may
justify a local split when they carry distinct work; they cannot satisfy the
background rule's executable-check condition.

The background agent leads only under rule 2. Give the reason in everyday
words in that option's description, without exposing internal scoring.

## Cautions preserve choice

Use `(Caution)` once on an option with a currently true reason against it:

| Option | Reason |
| --- | --- |
| Split by check | dirty/unavailable tree: no branch or checkpoint commits |
| Split by check | fewer than two increment rows: no useful split |
| Split by check | later rows have no work slice: they would only repeat checks |
| Background agent | planned files collide with running work |
| Background agent | no runnable verification (`review` alone is not a command) |
| Background agent | explicitly requested review has no known human/coordinator channel |
| Background agent | dirty/unavailable tree: shared-tree work needs coordination |
| Background agent | this host has no callable delegation capability |

Execute here and clipboard have no automatic caution. Never label the same
option both recommended and cautioned; re-check the signals if they disagree.
Do not hide a cautioned option or ask for its choice a second time.
The actual execution capability must still exist; be candid when it does not.

Delivery, clipboard handling, and checkpoint commits are specified in
[delivery.md](delivery.md). There is no forced model or reasoning override.
