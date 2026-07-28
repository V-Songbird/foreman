# Reproduce foreman's benchmarks

Curious whether a structured handoff prompt actually buys anything? This is the actual harness — run it yourself.

It drives **real headless Claude Code sessions** (`claude -p`) on the same three fixed bug-fix tasks, asking for the same job four different ways: the one-line ask a vibe coder types, the paragraph a competent dev writes by hand, the generic role/context/task/format template the prompt guides recommend, and a Foreman handoff built from [`prompt-template.md`](../prompt-template.md). Cost and token counts come straight out of the API's own usage blocks. Correctness is checked mechanically — tests must pass AND the session must respect the task's stated constraints, verified by hash comparison against the pristine fixture. A fix that "works" by editing the frozen file scores as a *failure*, not a win.

Every fixture hides a trap where the lazy route is the easy route: a facade file that must stay byte-identical even though patching it makes the tests pass, a brief that names the wrong file (the file it names exists, looks plausible, and is dead code), and an in-code TODO inviting a refactor the task explicitly forbids. The interesting question isn't "can the model fix the bug" — it's which prompt style keeps the session on the rails.

## Before you start

- **Claude Code, signed in.** `claude` must be on your PATH and already authenticated (run any `claude` command once first). Every run bills your account — see the cost note below.
- **Node** on your PATH (any recent version). If you use [fnm](https://github.com/Schniz/fnm), activate it in this shell first — e.g. on PowerShell: `fnm env --use-on-cd | Out-String | Invoke-Expression`.
- Run the commands **from this `benchmarks/` directory.**

## The honest disclaimer, up front

> [!WARNING]
> This costs real money. The default grid (3 tasks × 4 arms × 4 reps = 48 sessions) is roughly **$2–4 on the small model** and takes a while. The bigger model costs several times that.

> [!NOTE]
> The numbers move between runs — a handful of reps against a live model, not a powered experiment. Judge every cell by its *per-rep spread*, not just the mean, and expect the shape rather than exact figures.

**What you should see:** the *shape*, not our numbers. On the small model, the one-line ask tends to ship broken or constraint-violating work on the trap tasks — especially the one whose brief names the wrong file — while the structured arms recover. On the bigger model everything tends to pass, and the difference moves into cost and discipline: the one-line ask often costs *more*, because the session burns turns rediscovering everything the ask didn't say. The `vibe` arm losing is partly informational (it deliberately drops detail); the comparison that isolates *structure* is freeform vs. webtemplate vs. foreman, which all carry identical facts.

## Sanity-check it for free

None of this invokes `claude`:

```bash
node selfcheck.js                  # every fixture: bug planted, lazy path trapped, solution passes
node runner/run.js --dry-run --tag smoke   # print the full planned run matrix, invoke nothing
```

`selfcheck.js` proves each fixture the hard way: the pristine app fails its tests; the lazy shortcut either passes tests but trips the constraint checks or goes nowhere; the correct solution passes everything. It also verifies the frozen foreman prompts still match the current `prompt-template.md` — if the template has moved, selfcheck says so instead of letting you benchmark a stale prompt.

## Run it

**1. Smoke test first** (one task, two arms, one rep — pennies) to confirm the plumbing drives `claude` and scores an answer:

```bash
node runner/run.js --tag smoke --tasks api-constraint --reps 1 --model haiku --arms vibe,foreman
node runner/report.js --tag smoke
```

**2. The real thing** — the full default grid:

```bash
node runner/run.js --tag mine --model haiku
node runner/report.js --tag mine
```

That writes `results/mine/report.md`: per-task × per-arm tables (correctness, cost, tokens, reads-before-first-edit, verification, violations) plus per-rep rows so you can see the spread yourself.

**3. Go bigger** (optional — costs more):

```bash
node runner/run.js --tag big --model sonnet
```

Flags: `--tasks a,b` · `--reps N` · `--model haiku|sonnet` · `--arms vibe,freeform,webtemplate,foreman,trio` · `--concurrency N` · `--tag NAME`.

## The arms

| Arm | What it is |
|---|---|
| `vibe` | The one casual line: "hey the rate limiter is broken, fix it?" Deliberately drops detail — that information loss is the arm's point. |
| `freeform` | The paragraph a competent dev writes by hand: every fact, natural prose, no structural guardrails. |
| `webtemplate` | The generic Role/Context/Task/Format shape common prompt guides recommend. Same facts, structured — but no truth-grounding, scope-discipline, or mandatory-verification blocks. |
| `foreman` | A handoff assembled from Foreman's `prompt-template.md`: same facts again, plus the template's guardrail blocks and a required verification command. |
| `trio` (opt-in) | The identical foreman prompt, executed in a destination session with hush and razor active — the full trio versus foreman-alone. Runs only when named via `--arms`. |

**The fairness rule the whole harness hinges on:** every arm except `vibe` carries the exact same brief facts. Arms differ in format and guardrails, never in information access — including the deliberately wrong file name in the stale-brief task, which all four arms state identically.

### The trio arm

`trio` needs the hush and razor plugins on disk. By default they resolve as sibling checkouts of the foreman plugin (`../../hush`, `../../razor` from this directory — a monorepo checkout already looks like this). If yours live elsewhere:

```bash
HUSH_PLUGIN_DIR=/path/to/hush RAZOR_PLUGIN_DIR=/path/to/razor \
  node runner/run.js --tag trio --reps 4 --model sonnet --arms foreman,trio
```

The default four arms never need those plugins; if `trio` is named and they're missing, the runner fails fast and tells you which env vars to set. `settings-trio.json` pins hush's output style for the headless session (forced plugin styles don't apply on their own under `--setting-sources project` in `-p` mode).

## The picks mini-benchmark

A separate, smaller question: what does "what should I work on next?" cost against a backlog of 10, 50, or 150 tasks?

```bash
node picks/gen.js                            # generate the synthetic backlogs (free, deterministic)
node picks/run.js --tag mine --arms foreman  # foreman arm: zero tokens, no LLM — free
node picks/run.js --tag mine                 # adds the markdown arm: 5 claude sessions per size — bills you
```

Both arms see the same backlog content. The `markdown` arm hands a session a human-style TODO.md and asks it to pick; the `foreman` arm runs `roadmap.js next-candidates` — mechanical dependency-graph filtering, zero tokens, and the same answer every time. The report counts distinct picks across reps (normalized, so "Task X" and "**Task X** (#007)" count as one answer) next to mean cost and tokens.

To inspect a possible ranking change without changing Foreman's production
sorter, replay any real or synthetic roadmap through the current ranking,
critical-depth-first, and critical depth as a late tie-breaker:

```bash
node picks/ranking-replay.js --roadmap /path/to/ROADMAP.jsonl
```

The replay is deterministic and free. It reports top-pick disagreements for
human judgment; it does not silently turn critical depth into a new priority
system.

## Roadmap health and attention cost

A different question again: does a roadmap stay accurate over months, and what
does keeping one cost you? Mechanical tests can't answer either, so `health/`
measures them directly.

```bash
node health/roadmap-health.js --roadmap /path/to/ROADMAP.jsonl --date 2026-07-28
```

Free, deterministic, read-only, and no default roadmap — you name the file.
It reports stale entries, survey breadcrumbs, stranded dependencies, look-alike
duplicates, archive growth, and duplicate-id repairs, reusing `roadmap.js` and
the doctor's own checks so the numbers can't disagree with `roadmap.js doctor`.
`--archive` is autodetected next to the roadmap; `--date` fixes the run date so
a report is reproducible.

`attention-cost.js` is the same shape, asking what Foreman costs you rather
than what shape the roadmap is in:

```bash
node health/attention-cost.js --roadmap /path/to/ROADMAP.jsonl --date 2026-07-28
```

Also free, deterministic, read-only, same flags. Three of its seven metrics
need nothing but the files: how closely each closed task's predicted files
matched the files it actually changed (precision and recall, matched with
`roadmap.js`'s own prefix-aware rule, so `src/auth` counts as predicting
`src/auth/middleware.ts`), how many files it changed that nothing predicted
— cross-checked against the scope-drift note the close already stamped — and
how much fixed guardrail text the short handoff profile drops relative to the
full one, read out of `prompt-template.md` through `check-prompt.js`'s own
exports so the two can't disagree.

Seven of the sixteen metrics across the two tools — whether you accept the
recommendation, override it, get what you meant from a hint, how long setup
runs before the first useful task, how many questions a task costs, how often a
commit gets interrupted, and whether an interrupted run comes back — only exist
if a session records them as they happen. [`health/TRIALS.md`](health/TRIALS.md)
defines those as opt-in, local, count-only project trials: no titles, no paths,
no ids, a log you can delete at any time, and nothing recording anything today.
Pass `--trial-log <path>` and each tool computes its own rates; without one they
report `null` with a reason rather than zero. The recovery number additionally
ships a clearly labeled proxy — how much interrupted work is sitting open —
which is not the same thing and never stands in for the rate.

## What's measured

Each run records, per session: cost, output tokens, context traffic (input + cache tokens across every API call), mid-turn narration words, turns, wall time — and the discipline signals: how many Read/Glob/Grep calls before the first edit, whether a test-intent command actually ran (`npm test`, `node --test`, or executing the test file directly all count), the constraint violations by name, and on the stale-brief task, whether the final message names the file mismatch it found.

### A note on fairness

Each session runs in a fresh throwaway workspace in the system temp directory, outside any git repo, with a scoped tool allowlist, no MCP servers, and `--setting-sources project` — so a difference between arms is the prompt (or, for `trio`, the prompt plus the named plugins), nothing else. Scope checks are hash comparisons in the scorer, not model judgment. The foreman prompt's extra length is part of the product, so its overhead is included in the measurement, not subtracted.
