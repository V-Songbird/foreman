# How do you want to run this?

This is the shared destination question for roadmap picks and standalone prompt
crafting. Ask it before assembly unless the user already specified a destination.
Destination and execution mode are one choice, with no model-selection question.

Keep Foreman's four options, in this order:

1. **Execute here** — work the whole prompt in this session.
2. **Execute here, split by check** — ordered work units with a checkpoint after
   each successful check, using the template's checkpoint protocol.
3. **Execute with a background agent** — delegate through the available Codex
   collaboration tools; this session coordinates and owns commits.
4. **Copy prompt to clipboard** — deliver a self-contained prompt without execution.

Use the active question tool only if it can represent all four options. Otherwise
present the four options in text and ask one concise question. Do not lose a
destination because a question tool has a smaller option limit. Honor a
free-text destination or a user-specified number of slices. If background
delegation is unavailable, disclose that limitation and offer the portable
prompt; do not create a new sidebar task without an explicit user request.

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
   recommend the background agent when delegation is available. The selected
   resumed task does not count as other work; a missing collision value is
   unknown. Standalone craft has no roadmap menu, so this rule does not apply.
3. At least two checks, each later check has its own meaningful work slice,
   and `dirty:false`: recommend split by check.
4. Otherwise: recommend execute here.

The background agent leads only under rule 2. Give the reason in everyday
words in that option's description, without exposing internal scoring.

## Cautions preserve choice

Use `(Caution)` once on an option with a currently true reason against it:

| Option | Reason |
| --- | --- |
| Split by check | dirty/unavailable tree: no branch or checkpoint commits |
| Split by check | fewer than two checks: no useful split |
| Split by check | later checks have no work slice: they would only run commands |
| Background agent | planned files collide with running work |
| Background agent | no runnable verification |
| Background agent | dirty/unavailable tree: shared-tree work needs coordination |
| Background agent | this host has no callable delegation capability |

Execute here and clipboard have no automatic caution. Never label the same
option both recommended and cautioned; re-check the signals if they disagree.
Do not hide a cautioned option or ask for its choice a second time.
The actual execution capability must still exist; be candid when it does not.

Delivery, clipboard handling, and checkpoint commits are specified in
[delivery.md](delivery.md). There is no forced model or reasoning override.