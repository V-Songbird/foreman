# Changelog

All notable changes to Foreman are documented here. Foreman was named
Relay through 0.4.8-alpha — see the 0.5.0-alpha entry below for the
rename; earlier entries below refer to the plugin by its name at the
time, not retroactively edited. Foreman is a monorepo-folder plugin — its
version is owned by `.claude-plugin/marketplace.json` at the repo root,
not by `foreman/.claude-plugin/plugin.json` (which carries no version
field by convention).

## [0.14.4-alpha] — 2026-07-05

### Fixed — narration-bounding sentence restored; guardrail blocks no longer license mid-turn speech

The 0.14.3-alpha experiment is refuted: a real foreman-dispatched session
(rAthena stub round-trip test task, un-numbered template, a
silence-focused output style active in the destination environment)
showed the receiving agent narrating every `task_rules` bullet transition
anyway. De-numbering alone was not enough — the bullet sequence still
reads as a script, so the 0.14.2-alpha closing sentence is restored
verbatim (including 0.13.1-alpha's "not in prose between tool calls"
line). The de-numbered bullets stay: they weren't sufficient, but they
weren't harmful either.

Additionally, the same trace showed the guardrail blocks contributing:
`truth_grounding`'s "trust reality, say so explicitly" and
`scope_discipline`'s "say so explicitly first" read as instructions to
speak aloud mid-turn, which outranks any silence output style.
Reworded — `truth_grounding` now says "name the discrepancy in your
final report" (anchoring the speech to the deliverable, not the work),
and `scope_discipline` says "flag it to the user first" (the one place
speech genuinely must precede action, kept, minus the narration-register
phrasing). 110 tests unchanged.

## [0.14.3-alpha] — 2026-07-05

### Changed — experiment: drop the narration-bounding sentence, de-number task_rules

Reverses part of 0.14.2-alpha as a deliberate experiment: the closing
sentence added to bound narration to the active output style is removed
entirely (along with 0.13.1-alpha's original "not in prose between tool
calls" line it was appended to), and `task_rules`' `Step 1:`/`Step 2:`/
`Step 3:` labels are now plain unlabeled bullets. Hypothesis under test —
the numbered-step structure itself, not the missing meta-instruction, was
inducing the narration `project_foreman_state.md` traced in 0.14.2-alpha;
if de-numbering alone holds, the closing sentence was unnecessary.
`craft-prompt/SKILL.md`'s Q4 and `roadmap/SKILL.md`'s Step-1-default
prose updated to match the unlabeled format; checklist item updated from
"numbered steps" to "read/analyze/implement steps". 110 tests unchanged.
Revert 0.14.2-alpha if a follow-up real-session trace shows narration
returned.

## [0.14.2-alpha] — 2026-07-05

### Changed — closing line now bounds narration for any active output style

`prompt-template.md`'s closing line (the one reworded in 0.13.1-alpha to
stop inducing step-by-step narration) gained a second sentence: the
numbered `task_rules` steps and the `scope_discipline` roadmap commands
are a working plan, not a script to narrate — whatever output style
governs the destination session decides what gets said aloud. Traced to a
real foreman-dispatched session where a receiving agent announced every
step transition and intermediate roadmap-bookkeeping commit, which an
active silence-focused output style would otherwise have suppressed. One
line, style-name-agnostic (same principle as 0.14.0-alpha's
detection-to-declaration move — no plugin is named or detected). 110
tests unchanged.

## [0.14.1-alpha] — 2026-07-05

### Changed — third-party plugin names removed everywhere

Follow-up to the README/description de-branding: `prompt-template.md`'s
craft-time guidance, `scripts/render-sections.js`'s comments, the
render-sections test fixtures, and this changelog's own historical entries
now describe third-party style plugins generically (persona-style plugin,
tone plugin, flag files) instead of naming them. No behavioral change —
110 tests unchanged.

## [0.14.0-alpha] — 2026-07-05

### Changed — style-plugin compatibility flips from detection to declaration

`inheritOperatorTone` and the third-party flag-file sniffing are gone.
The old model required foreman to know each style plugin's on-disk marker
case by case, and hush already broke it: an output-style plugin leaves no
flag file to detect. The project now declares the prompt shape it wants in
`.foreman/config.json`, and any present or future style plugin is
compatible by construction:

- `usePersona` (boolean, default `true`) — `true`: `task_context` opens
  with "You are a [role]"; `false`: domain framing ("Domain:
  [specialization]"), the behavior previously triggered by detecting a
  persona-injecting style plugin. Replaces `inheritOperatorTone`, which is
  now ignored (no users yet — hard removal, no deprecation shim).
- `omitSections: ["tone"]` — already existed; now the *only* mechanism for
  dropping the `<tone>` block, replacing the tone-plugin-active special case.

Also removes a semantic wart: detection was time-skewed (flags read at
craft time, prompt runs later); a declaration can't go stale.
`render-sections.js` loses `flagsActive`/`claudeConfigDir`/
`readInheritOperatorTone` and no longer touches `$CLAUDE_CONFIG_DIR` at
all; the template and checklist lose all plugin-specific prose. 110 tests
(was 111 — six flag-detection tests replaced by five declaration tests).

## [0.13.1-alpha] — 2026-07-05

### Changed — crafted prompts no longer induce visible step narration

The template's closing line "Think step by step before making changes.
Consider edge cases before writing code." was a narration inducer on
thinking models: phrased as a prompt instruction, it invites externalizing
the steps as prose between tool calls (observed live in a foreman-dispatched
session: "Task 4 done. Now task 5 —" ticking through a 5-index migration).
Now reads "Reason through the approach and edge cases in your thinking
before editing — not in prose between tool calls." Style-neutral: same
rigor, routed to thinking blocks, regardless of which communication style
(hush, a third-party plugin, default) the consuming session runs.

## [0.13.0-alpha] — 2026-07-05

### Changed — full-plugin token/mechanization audit: two Claude-driven steps moved into existing scripts

Requested full re-pass over every file in the plugin looking for remaining
spots where Claude was still doing deterministic work by hand, after the
0.4.3–0.10.0-alpha rounds already covered the obvious CRUD/ranking/dedup
cases. Found two, both the same shape as prior fixes (fold a mechanical
fact into a script's output instead of having Claude/an agent re-derive
it):

- **`scripts/render-sections.js` now also resolves `inheritOperatorTone`
  and the two style-plugin active flags**, with the same precedence
  `prompt-template.md` used to spell out across two separate craft-time
  steps (a `Read` of `.foreman/config.json`, then a conditional
  Bash/PowerShell `test -f`/`Test-Path` against the two flag files) —
  encoded once, in code. `prompt-template.md`'s craft-time environment
  check collapses from three tool calls (`Read` config, flag-file test,
  `node render-sections.js`) into **one** — this runs on every single
  prompt assembly in both `craft-prompt` and `roadmap`'s pick-next-task
  branch, so it's the highest-frequency path in the plugin. `<task_context>`
  and `<tone>` now read the two active flags off that one call's
  output instead of instructing a fresh file check. Neither skill file
  needed changes — both already say "follow `prompt-template.md` exactly"
  per the 0.10.0-alpha dedup, so they inherit the new behavior by reading
  the template fresh.
- **`foreman:survey`'s mechanical pre-check (added 0.10.0-alpha for
  commit-existence) now also covers `touches` path existence** — one
  `test -e`/`Test-Path` per unique path across all surveyed candidates,
  before dispatching agents, building a `path_exists` map handed to each
  `Explore` agent instead of letting every agent independently spend a
  `Read`/`Glob` call discovering a path is missing. A missing path is
  itself `stale-touches` evidence; agents now only spend a real tool call
  on the semantic content-match check for paths confirmed to exist.

No `roadmap.js` change — this pass found nothing left to mechanize there,
it's already the CRUD/ranking/dedup CLI 0.4.3–0.10.0-alpha built. No hook
change either — both hooks were already pure deterministic Node with zero
Claude-in-the-loop processing.

111 tests total (105 existing + 6 new, covering `render-sections.js`'s
`inheritOperatorTone` and style-plugin flag resolution and its
precedence over the on-disk flag files).

## [0.12.0-alpha] — 2026-07-05

### Added

- **`omitSections`** — the inverse of `customSections`: an optional array
  in `.foreman/config.json` naming template tags to always drop from every
  assembled prompt, instead of re-answering `craft-prompt`'s "which
  optional sections" question every time. Only the template's
  already-conditional tags are valid — `tone`, `example`, `background`,
  `output_format` — anything else (a typo, or a guardrail like
  `scope_discipline`/`truth_grounding`/`task_context`/`task_rules`) is
  rejected with a warning by `scripts/render-sections.js`, never silently
  honored. A project-level `omitSections` wins over a per-prompt selection
  when the two conflict. `render-sections.js` now returns `omit` alongside
  `sections` in one call — same script, extended, not a new one.
- `prompt-template.md`'s step 2 (renamed "Custom sections and omissions")
  and each of the four omittable blocks gained an inline note instructing
  the craft-time drop. Noted in the docs: omitting `background` also drops
  `<relevant_files>` (nested inside it), so `truth_grounding`'s "read the
  cited files" instruction has nothing left to point to — a real trade-off,
  not hidden from the user.

## [0.11.0-alpha] — 2026-07-05

### Added

- **`customSections`** — an optional array in `.foreman/config.json`
  letting a project bake its own recurring instructions (compliance
  notice, house style, team checklist) into every prompt
  `craft-prompt`/`roadmap` assemble, without editing the plugin's own
  `prompt-template.md` (which lives under `${CLAUDE_PLUGIN_ROOT}` and gets
  overwritten on plugin update/reinstall). Each entry is
  `{tag, content}`, rendered as `<tag>content</tag>` and inlined after
  `task_rules`.
- **`scripts/render-sections.js`** — new mechanical validator/renderer for
  `customSections`, following the same pattern `roadmap.js` set for
  CLI-enforced logic instead of leaving validation to skill-prose trust:
  rejects a bad tag format (`^[a-z][a-z0-9_]*$`), a tag reserved by the
  fixed template, a duplicate tag, or empty content — each skipped with a
  warning rather than failing the whole prompt. Content is XML-escaped
  automatically so user-authored text can't corrupt the surrounding
  prompt structure. `truth_grounding` and `scope_discipline` stay fixed
  and non-overridable — custom sections are additive only.
- `prompt-template.md`'s craft-time environment check gained a step 2
  that runs `render-sections.js` and inlines its output at a new
  `[CUSTOM SECTIONS]` placeholder; `craft-prompt/SKILL.md` and
  `roadmap/SKILL.md` needed no changes — both already assemble prompts by
  following `prompt-template.md`, the same dedup principle 0.10.0-alpha
  established.

## [0.10.0-alpha] — 2026-07-04

### Fixed — two real bugs found by a full-plugin token/correctness audit

- **`craft-prompt/SKILL.md` was missing `Read` from `allowed-tools`**, despite
  its 0.9.0-alpha craft-time gate instructing it to `Read`
  `.foreman/config.json`. Introduced with `inheritOperatorTone`, never
  caught until this pass.
- **`hooks/post-commit.js`'s `commitFailed` checked a field that was never
  real.** Confirmed against `code.claude.com/docs/en/hooks.md`: `PostToolUse`'s
  Bash exit code is a top-level `exit_code` field; `tool_response` is stdout
  *text* (a string), not an object. The old check
  (`tool_response?.exit_code ?? tool_output?.exit_code`) always evaluated to
  `undefined` in real usage — every failed `git commit` silently fired the
  status-sync/discovery nudges anyway, since day one (0.4.0-alpha). Fixed to
  read `data.exit_code` directly; the two exit-code tests that encoded the
  wrong shape now encode the real one.

### Changed — dedup, mechanical checks over LLM judgment, and a misplaced hook moved to where it belongs

- **`craft-prompt/SKILL.md` no longer duplicates `prompt-template.md`'s XML
  template and checklist** (~115 lines). It now says "follow
  `prompt-template.md` exactly" plus a field-source mapping, the same
  pattern `roadmap/SKILL.md` already used. Every prior edit to the shared
  template (`inheritOperatorTone`, `scope_discipline`, the tone gate) had to
  touch both files in lockstep by discipline, not structure — this was the
  single biggest duplication in the plugin.
- **`roadmap.js list` gained an `--ids` filter** (combinable with
  `--status`), and **`next-candidates`'s candidates now include their own
  `depends_on`**. `foreman:survey` used to load the *entire* `list` just to
  resolve a handful of dependency ids for 3 candidates — real waste on a
  large roadmap. It now resolves exactly the ids it needs.
- **`foreman:survey` no longer asks an Explore agent to verify commit
  existence** — "does this SHA actually exist in git history" is a
  deterministic fact (`git cat-file -e <sha>`), not a judgment call. The
  orchestrating skill now checks it once, mechanically, before dispatching
  agents, and hands each agent the answer instead of having every parallel
  agent re-derive the same fact independently.
- **`roadmap/SKILL.md`'s `task_rules` Step 1 default** no longer restates
  `truth_grounding`'s mandate in different words right below the fixed
  block that already says it — shortened to a pointer.
- **`hooks/post-commit.js`'s `discoveryBlock`** no longer says "never act
  without asking" twice in the same string.
- **`hooks/run-tests-on-edit.js` moved out of `foreman/` entirely**, to
  `.claude/hooks/run-tests-on-edit.js` at the repo root, registered via a
  new (committed) `.claude/settings.json`. It was scoped to Foreman by
  mistake — it's dev tooling for whoever works on *any* plugin in this
  monorepo, not a feature Foreman should ship to installers (it never fired
  for them anyway; only edits inside the plugin's own source tree trigger
  it). Generalized to detect which plugin owns an edited `scripts/`/`hooks/`
  file (walks up to the nearest `.claude-plugin/plugin.json` marker) and
  reruns *that* plugin's own tests, not just Foreman's.
  `.gitignore`'s blanket `.claude/` exclusion narrowed to `.claude/*` with
  explicit `!.claude/settings.json`/`!.claude/hooks/` exceptions, so this
  hook (and only this) is actually committed and shared.

87 tests total in Foreman's own suite (94 existing − 10 for the removed
`run_tests_on_edit.test.js` + 3 new: 2 for `list --ids`, 1 for
`next-candidates`'s `depends_on`). The moved hook has its own 10-test suite
at `.claude/hooks/run-tests-on-edit.test.js`, outside Foreman's count since
it isn't part of the distributed plugin.

## [0.9.5-alpha] — 2026-07-04

### Added — scope-creep discipline, at both touch points Foreman actually controls

Real scenario: mid-session, the user asks "could X also work like this?"
about something outside the current task's stated scope; Claude just
implements it inline, in the same commit, with no roadmap entry ever
recording it happened. Not mechanically detectable from a bare git diff
(no way to distinguish "task legitimately grew" from "unrelated feature
got bundled in") — needs Claude's own in-the-moment judgment. Considered
and rejected a `SessionStart` hook (the mechanism style/memory plugins
use) for this: Foreman deliberately removed its own every-session hook in
the 0.4.0-alpha redesign, and a `SessionStart` hook fires before Claude
even knows what the session will touch — it can't carry a specific task's
`what` the way a targeted instruction can. Two touch points instead, both
already-existing mechanisms:

- **`prompt-template.md` and `craft-prompt/SKILL.md`'s embedded copy**
  gained a fixed `<scope_discipline>` block (always included, same
  standing as `truth_grounding`): if a request diverges from the task's
  stated goal, flag it explicitly rather than folding it in silently, then
  — if `ROADMAP.jsonl` exists — log it as its own entry via `add` followed
  immediately by `update-status` to `done` with the commit (it already
  happened, so it's created and closed in the same breath, never left
  `planned`). No `ROADMAP.jsonl` → just flagging it is enough. Covers any
  session Foreman itself launched with a specific task in scope.
- **`hooks/post-commit.js`'s `discoveryBlock`** gained a second scan: the
  existing "spot future opportunities" pass now also asks Claude to check
  the inverse — work already implemented in this commit beyond what any
  `in_progress` task's `what` describes — and log it already-done (same
  `add` + `update-status` pair) rather than a future-facing `planned`
  entry. Same `discoverySuggestions` flag gates it, no new config field.
  Covers organic sessions post-hoc, from the commit alone.

94 tests total (93 existing + 1 new, for the `discoveryBlock` addition —
the `scope_discipline` prompt-template addition has no executable logic to
test, same as `truth_grounding`).

## [0.9.4-alpha] — 2026-07-04

### Added — `requireVerification`, an opt-in gate on Claude self-certifying a task `done`

Distinct from the SHA/touches staleness gaps fixed in 0.9.1–0.9.3: those
were about data (making the record accurate). This one is about the
`done` label itself — today `post-commit.js` lets Claude call
`update-status` with `"done"` unilaterally the moment it thinks a commit
finished a task, with no human sign-off. Considered adding a new `status`
enum value (`"qa"`/`"testing"`) for this but rejected it: it would touch
`next-candidates`' `doneIds`-based dependency-unblocking logic, `foreman:
survey`'s already-done detection, `STATUSES`/`CREATE_STATUSES`, and every
doc/test that enumerates statuses — real surface area for what turns out
to be a pure workflow-sequencing concern, not a new task state.

- **`.foreman/config.json` gains `requireVerification`** (boolean, default
  `false` — off by default since it adds a confirmation step to every
  task, including trivial ones). `true`: `hooks/post-commit.js`'s
  in-progress nudge still records the commit's SHA and auto-derived
  `touches` immediately (data isn't worth gating on a human), but
  withholds `status:"done"` — instead it tells Claude to ask the user
  (`AskUserQuestion`) whether the work is actually verified, and only
  call a follow-up `update-status` with `"done"` on confirmation. Doesn't
  touch the freshly-done follow-up branch (that's about recording a fix on
  an *already legitimately done* task, orthogonal to this gate).
- No `roadmap.js`/schema change — same reasoning as `inheritOperatorTone`,
  a pure prompt/hook-instruction gate needs no new stored state beyond the
  one config flag.
- `README.md`'s config table and hooks section updated.

93 tests total (89 existing + 4 new).

## [0.9.3-alpha] — 2026-07-04

### Changed — `touches` now auto-derives from the commit's own diff, not just manual `add_touches`

Last version added `add_touches` so `touches` could be corrected at
completion time — but it still relied on Claude recalling every file it
touched from memory and typing it into the JSON payload, when git already
has the exact, definitive list for any commit already being passed in the
same call.

- **`roadmap.js update-status`**: when `commit` is given, runs `git show
  --pretty=format: --name-only --relative <sha>` (fails soft — no git, not
  a git project, or an unknown sha just means nothing gets derived, the
  rest of the call still succeeds) and folds every changed path into
  `touches` automatically, same append-only merge `add_touches` already
  used. `add_touches` still exists for paths outside that specific
  commit's diff (or when git derivation isn't available) but is no longer
  the primary mechanism.
- Considered whether auto-derived paths (which include routine bookkeeping
  files like `CHANGELOG.md`/`marketplace.json` in this repo's own
  convention) would pollute `next-candidates`' `collision` flag with false
  positives. Concluded no: `collision` only compares a `planned` candidate's
  own `touches` (set at creation, before any derivation ever runs on it)
  against `in_progress` entries' `touches` — a shared bookkeeping file
  showing up in both would be a real, not spurious, overlap.
- `hooks/post-commit.js`'s nudges simplified to match: no more telling
  Claude to list touched files itself, passing `commit` already covers it.
- `tests/helpers.js` gained `initGitRepo`/`commitFile` for tests that need
  a real git history. `roadmap-schema.md`/`README.md` updated.

89 tests total (85 existing + 4 new, covering the git-derived path,
merging with manual `add_touches`, an unknown-sha fail-soft case, and the
no-commit-given case).

## [0.9.2-alpha] — 2026-07-04

### Added — `add_touches`, so `touches` stops going stale the moment work starts

`touches` was set once at task creation from whatever investigation
happened beforehand — sometimes shallow, sometimes from a different
session's context — and nothing ever updated it once the real work
revealed a wider or different footprint. Lower stakes than the SHA gap
fixed last version (`commits[]` already makes the real footprint
recoverable via `git show --stat`), but still a real staleness gap for
anyone skimming `ROADMAP.jsonl` directly for audit/backtracking.

Deliberately did **not** go as far as rewriting `why`/`what` at completion
time (a broader ask that came up alongside this one) — that would erase
the plan-vs-actual distinction (real audit value: shows scope drift) and
reopen the cost problem 0.4.4-alpha already fixed (long fields making every
future `list`/`next-candidates` call more expensive). `touches` stays
append-only instead, same treatment as `commits[]`; narrative drift belongs
in `notes`, not a rewritten record.

- **`roadmap.js update-status`** gained optional `add_touches` (array of
  paths) — folds new paths into `touches` (dedup, never removes, same
  spirit as `commits[]`). Rejects a non-array value.
- **`hooks/post-commit.js`**: both status-sync nudges (in-progress →
  done, and the 0.9.1-alpha same-day follow-up case) now also suggest
  `add_touches` in the same `update-status` call — cheap since Claude
  already knows what it edited this session, no `git diff` needed; omit it
  if `touches` was already accurate.
- `roadmap-schema.md`'s `touches` field and `update-status` row, and
  `README.md`'s hooks section, updated to describe the new behavior.

85 tests total (81 existing + 4 new: 3 for `add_touches` in `roadmap.js`,
1 for its mention in the post-commit hook's output).

## [0.9.1-alpha] — 2026-07-04

### Fixed — follow-up fix commits after a task is marked `done` were silently losing their SHA

Real-repo usage: a session finishes task X, marks it `done`, commits the
SHA. The user then reports a bug, the session fixes it and commits again —
but `post-commit.js`'s status-sync nudge only ever fired for `in_progress`
entries, so once a task is `done` it gets zero further nudges, ever. That
second commit's SHA (and the fact it was a fix for X) had nowhere to go
and was silently lost. Repeats for every subsequent bugfix in the same
loop.

- **`hooks/post-commit.js`**: the status-sync check now also matches
  entries `status: "done"` with `updated_at` equal to today — a same-day
  completion is the concrete signal for "still in the working session that
  just touched this," same reasoning as the existing in_progress check.
  `statusSyncBlock` takes both matching lists and emits a second sentence
  for the freshly-done case: append the new SHA via the same `update-status`
  call (same status, `commits[]` just grows), explicitly not a status
  change, and explicitly silent if the commit doesn't actually relate to
  either list.
- **`scripts/roadmap.js`** exports its existing `today()` helper so
  `post-commit.js` doesn't duplicate the date-formatting logic.
- `tests/post_commit.test.js` gained 3 cases: fires for a done-today entry,
  stays silent for a done-on-an-earlier-day entry, and both in_progress +
  freshly-done surface together in one commit's output.

81 tests total (78 existing + 3 new).

## [0.9.0-alpha] — 2026-07-04

### Added — `.foreman/config.json`'s `inheritOperatorTone`, removed `foreman:toggle-discovery`

0.6.2-alpha made prompt assembly check the *operator's* personal
style-plugin flag files unconditionally. That conflates
two different axes: an operator's personal Claude Code tooling preference,
and a project's policy for how its own prompts should read. A project
whose prompts get consumed by whoever's machine happens to craft them has
no way to say "always read the same regardless of who's crafting" — until
now.

- **`inheritOperatorTone`** (new `.foreman/config.json` field, boolean,
  default `true` when missing/unparseable — matches every prior version's
  behavior). `prompt-template.md`'s craft-time check now reads this first:
  `false` skips the style-plugin flag-file check entirely and
  uses the plain defaults (direct role sentence, minimal/professional
  tone) no matter what's actually active on the crafting machine.
  `craft-prompt/SKILL.md`'s embedded copy and both checklists updated to
  match.
- **Removed `foreman:toggle-discovery`** (added last version). Two boolean
  fields don't need a dedicated skill to flip them — `.foreman/config.json`
  is small enough to `Read`/`Write` directly, same as `foreman:init` always
  has. Its only job (flip `discoverySuggestions` without re-running the
  whole `init` interview) is now just "ask Claude to edit the file," backed
  by full field docs in `README.md`'s new "The config file" section.
- `roadmap-schema.md`'s `.foreman/config.json` section trimmed to a pointer
  at `README.md` for full field reference, since it now covers two fields
  serving two different consumers (`post-commit.js` vs. prompt assembly)
  rather than one.

No `roadmap.js` change — this file was already outside the CLI's scope.
66 tests total, unchanged.

## [0.8.0-alpha] — 2026-07-04

### Added — test-on-edit hook

`tests/` covers every CRUD invariant `scripts/roadmap.js` and the other
hooks enforce, but nothing ran it automatically — a regression there sat
silent until someone ran the suite by hand.

- **`hooks/run-tests-on-edit.js`** — new `PostToolUse` hook, matcher
  `^(Edit|Write)$`. Filters by path itself (matchers can't do this): only
  an edit under this plugin's own `scripts/` or `hooks/` directories (any
  `.js` file, case-insensitive) triggers a rerun of `node --test
  tests/*.test.js` (a bare directory arg makes this node version try to
  `require()` it instead of recursing — the glob is what actually works).
  Silent when green, same as every other Foreman hook; on red, returns
  `additionalContext` with the pass/fail counts and the command to get the
  full trace. Strips `NODE_TEST_CONTEXT`/`NODE_CHANNEL_FD` before spawning
  the nested `node --test` — inherited from this hook's *own* test running
  under `node --test`, they make the nested process misbehave and exit
  silently instead of reporting real results.
- Wired into `hooks/hooks.json` as a second `PostToolUse` entry (30s
  timeout — the suite itself runs in ~2-5s, headroom for a cold start).
- `tests/run_tests_on_edit.test.js` covers the path-matching logic
  directly, plus two full end-to-end runs (via a throwaway temp plugin
  root, never the real `scripts/roadmap.js`) proving the hook stays silent
  against a green copy and reports failure against a deliberately broken
  one.

## [0.7.1-alpha] — 2026-07-04

### Fixed — `update-deps` rejects dependency cycles

`update-deps` already rejected unknown ids and self-dependencies but not an
*indirect* cycle: adding `add_depends_on` that closes a loop (e.g. `002`
depends on `001`, then a later call makes `001` depend on `002`) left both
entries permanently unblockable — `next-candidates` requires every
`depends_on` to be `done`, so neither can ever satisfy the other. Silent,
no error, no way to notice short of manually walking the graph.

- `scripts/roadmap.js`'s new `reaches(entries, startId, targetId)` walks
  `depends_on` chains from each proposed dependency; if it can reach the
  entry being updated, adding it would close a cycle, so `cmdUpdateDeps`
  now rejects it (checked before any write, alongside the existing
  unknown-id and self-dependency checks).
- `roadmap-schema.md`'s `update-deps` row updated to document the new
  rejection.

## [0.7.0-alpha] — 2026-07-04

### Added — `foreman:toggle-discovery`

`.foreman/config.json`'s `discoverySuggestions` flag could previously only
be set during `/foreman:init`'s one-time interview — flipping it later
meant hand-editing the file (no guard hook covers it, unlike
`ROADMAP.jsonl`, but also no sanctioned mechanical path either).

- **`skills/toggle-discovery/SKILL.md`** — reads the current flag (missing/
  unparseable treated as off, same as `post-commit.js` itself), asks which
  way to set it (or reads `on`/`off`/`enable`/`disable` straight from args),
  and if the state actually changes, merges the new value into the existing
  config object (preserving any other keys) and commits just that file —
  same convention `foreman:init` already uses for this file.
- Implemented as a Skill, not a `commands/*.md` file, despite the original
  ask being phrased as "a command" — matches every other Foreman entry
  point (`init`/`roadmap`/`craft-prompt`/`survey`) and the `plugin-dev`
  `command-development` skill's own guidance that `.claude/commands/` is
  the legacy format now that Skills cover the same ground plus
  `when_to_use` natural-language triggering.
- `roadmap-schema.md`, `README.md`, `plugin.json` updated. `README.md` also
  gained the `foreman:survey` entry it was missing since 0.6.0-alpha.

No `roadmap.js` change — `.foreman/config.json` was already a direct
`Read`/`Write` file outside the CLI's scope. 66 tests total, unchanged.

## [0.6.2-alpha] — 2026-07-04

### Fixed — tone/role checked at craft time instead of embedded as a runtime self-check

The `<tone>` block used to tell the *spawned* session to read the
tone plugin's flag file itself and branch at runtime. That's backwards on
two counts: it's an extra Bash call the destination session pays for
something knowable right now, and it can't see persona-style plugins at
all — `task_context`'s "You are a [role]" sentence and a persona plugin's
own SessionStart-injected identity are two competing identity claims with
no reconciliation, since such plugins weren't part of Foreman's picture
when the template was written.

- **`prompt-template.md` and `craft-prompt/SKILL.md`'s embedded copy**: both
  style-plugin flag files are now checked once, at craft
  time, by whichever skill is assembling the prompt (one combined Bash/
  PowerShell call) — not written into the prompt as something the spawned
  session figures out later.
  - Tone-plugin flag found (and no custom `Tone` selected) → the whole
    `<tone>` block is omitted from the assembled prompt. That plugin's own
    `SessionStart` hook re-establishes terse mode on any session that
    actually runs the prompt regardless, so restating it is redundant and
    one more thing that can go stale between crafting and execution.
  - Persona-plugin flag found → `task_context` opens with domain framing
    ("Domain: [role].") instead of "You are a [role]." — no longer a second
    identity sentence competing with that plugin's own persona injection.
  - Neither flag found → same defaults as before (minimal/professional
    tone, direct role sentence).
- Both files' handoff checklists and `README.md`'s "Default tone" paragraph
  updated to describe the craft-time check instead of the old runtime one.

No `roadmap.js` change — this is a prompt-authoring fix only, all 66 tests
still pass.

## [0.6.1-alpha] — 2026-07-04

### Fixed — Pick-next-task dumped raw JSON, showed more candidates than the dialog could use

Real usage showed two things: `next-candidates`' full JSON response (every
candidate's `what`/`touches`/`notes`/`unblocks`) got echoed verbatim into
the chat response before the picker even asked a question — clutter no
human needed, since the session isn't ground-truthing any of it (that's
`foreman:survey`'s job). And it fetched/showed 5 candidates while
`AskUserQuestion` only ever surfaces 3 of them plus "something else" —
`next-candidates`' 4-option cap already meant 2 of the 5 fetched were
always thrown away.

- **`roadmap.js next-candidates` default `--limit` changed from 5 to 3** —
  matches `AskUserQuestion`'s 4-option cap (3 tasks + the escape hatch),
  nothing fetched now goes unused.
- **`skills/roadmap/SKILL.md`'s pick-next-task branch rewritten**: forbids
  pasting the raw `next-candidates` JSON into the chat response outright;
  goes straight to `AskUserQuestion` instead of a prose recap first; each
  option's description is `why` only (no `what`/`touches`/`notes`/
  `unblocks` folded in); the top-ranked candidate's label gets
  `(Recommended)` appended instead of leaving the ranking implicit in list
  order alone.
- `foreman:survey` and `roadmap-schema.md` updated to match the new
  default of 3.

66 tests total (65 existing + 1 new, for the default-limit-of-3 behavior).

## [0.6.0-alpha] — 2026-07-04

### Added — `foreman:survey`, on-demand ground-truthing of near-term roadmap candidates

`foreman:roadmap`'s pick-next-task branch ranks purely mechanically
(unblocks count, then oldest) and never checks the codebase — deliberately,
per 0.4.4-alpha. That left a real gap: nothing ever re-checked whether a
`done` task's `commits` actually exist, whether a candidate's `touches`
still match reality, or whether a dependency exists in the code that
`depends_on` never modeled. `foreman:survey` closes that gap as a separate,
explicitly-triggered skill — never wired into the fast pick-next-task path,
so the mechanical branch stays exactly as cheap as 0.4.4-alpha made it.

- **`roadmap.js` gained `update-deps`** — adds ids to an existing entry's
  `depends_on` (no duplicates, rejects unknown ids and self-dependencies).
  `add` only sets `depends_on` at creation time; this is the only way to
  correct it afterward. This is what makes a survey finding durable across
  sessions: a hidden dependency gets written into the graph
  `next-candidates` already reads, so a completely new session picks up the
  corrected order automatically — no memory or cache involved, just the
  same file everyone already reads.
- **`next-candidates` now returns each candidate's `notes`** — previously
  omitted from the output entirely, so a breadcrumb left by `update-status`
  was invisible to the picking flow unless something separately called
  `list`. This is the soft-signal path for findings that aren't a hard
  block (a preference or insight without a structural reason) — visible as
  context to whoever picks next, not a guaranteed mechanical reorder.
- **`skills/survey/SKILL.md`** — surveys the top unblocked candidates (same
  default 5 as `foreman:roadmap`, not the whole backlog), dispatches one
  `Explore` agent per candidate in parallel to check touches/dependencies/
  duplication against the actual code, then asks before persisting any
  finding via `update-deps` or `update-status`. Never touches
  `ROADMAP.jsonl` directly, same as every other Foreman flow.

65 tests total (58 existing + 7 new: 6 for `update-deps`, 1 for `notes`
surfacing in `next-candidates`).

## [0.5.0-alpha] — 2026-07-03

### Changed — renamed from Relay to Foreman

No installed users yet (single-project testing only), so the rename cost
nothing beyond the mechanical work: `relay/` → `foreman/` (`git mv`,
history preserved), every `/relay:*` skill invocation → `/foreman:*`,
`.relay/config.json` → `.foreman/config.json` (in code, not just docs —
`hooks/post-commit.js`'s `readConfig`, `tests/helpers.js`'s `writeConfig`),
`[Relay]`/`Relay:` message prefixes in both hooks → `[Foreman]`/`Foreman:`,
`marketplace.json`/`plugin.json` `name`/`source`/`homepage`, every doc
cross-reference.

Reasoning: "Relay" fit the prompt-handoff pillar (craft-prompt, pass a
fully-briefed prompt to another session) but never fit the roadmap pillar
(tracking, sequencing, dependency graphs — nothing about "relay" suggests
that to a cold reader). "Foreman" fits both without a stretch: a foreman
keeps the work plan (roadmap), decides what's next, and hands each worker
a fully-briefed assignment (the crafted prompt) — the same shape as this
plugin's actual two pillars, not just the handoff tail end of one of them.

## [0.4.8-alpha] — 2026-07-03

### Removed — the `.claude/rules/` drafting added in 0.4.7-alpha

Reverted same-day, after direct feedback: the only genuinely new content a
drafted rule file could add (project description, goals, conventions) is
exactly the interpreted/synthesized content the user didn't want. Strip
that out and what's left — "check `/relay:roadmap`, don't hand-edit
`ROADMAP.jsonl`" — is fully redundant with mechanisms that already work
without depending on a rules file being loaded or remembered:
`guard-roadmap-edit.js` denies the direct edit and explains why in the
same message; `post-commit.js` nudges at the exact moment it matters
instead of sitting as passive context; `skills/roadmap/SKILL.md`'s own
`description`/`when_to_use` frontmatter is what Claude Code already uses
to discover the skill. No version of this feature was left that was both
static (what was asked for) and non-redundant (worth keeping). `relay:init`
is back to bootstrapping only `ROADMAP.jsonl` and `.relay/config.json`.

## [0.4.7-alpha] — 2026-07-03

### Added — optional starter `.claude/rules/` file in `relay:init`

`relay:init` can now draft `.claude/rules/project-conventions.md`
alongside `ROADMAP.jsonl` — one more optional question (draft it? any
always-follow conventions?), then written and committed with the rest.
Verified the actual `.claude/rules/` mechanism against the official docs
first (`claude-directory.md`): files without `paths:` frontmatter load at
session start like `CLAUDE.md`; with `paths:` globs they load only when a
matching file enters context. This feature uses no `paths:` — a general,
always-loaded primer, not path-scoped.

Deliberately limited: the rule file is built **only** from what the
interview gathers, never from exploring the codebase — consistent with
every other Relay flow staying cheap (no ground-truthing before handoff).
For an existing project with real conventions to capture accurately, a
human-reviewed rule file beats one drafted from a five-question interview;
`relay:init` says so explicitly rather than pretending otherwise. Skips
the whole call silently if `.claude/rules/project-conventions.md` already
exists — no clobbering.

## [0.4.6-alpha] — 2026-07-03

### Added — hooks/guard-roadmap-edit.js, mechanical enforcement of the CLI-only rule

"Never `Read`/`Edit` `ROADMAP.jsonl` directly, use `roadmap.js`" has been
prose since 0.4.3-alpha — nothing actually stopped a direct `Edit`/`Write`.
Every guarantee the CLI provides (sequential ids, parse-before/after-write,
append-only notes, length warnings) only holds if the CLI is actually the
only path in. Closed that gap the same way `pre-tool-use.js` once gated
`spawn_task` (see [[feedback_relay_spawn_task_gate]] for the precedent,
though that specific hook is long gone) — a `PreToolUse` deny, not another
reminder.

- **`hooks/guard-roadmap-edit.js`** — `PreToolUse` on `Edit`/`Write`,
  denies the call if the target file's basename is `ROADMAP.jsonl`
  (case-insensitive), pointing back at `roadmap.js --help`. `Read` is
  unaffected. `Bash` is deliberately left open — if the file is ever
  corrupt enough that the CLI itself can't parse it, that's the sanctioned
  repair path, same as `relay:init`'s own `> ROADMAP.jsonl` reset on
  Overwrite.

58 tests total (49 existing + 9 new).

## [0.4.5-alpha] — 2026-07-03

### Fixed — --help, verbose chat output, and leaked XML tags

Two more real-usage findings: `roadmap.js --help` errored (`unknown
subcommand: --help`) — Claude's first instinct when it didn't remember the
exact invocation, forcing a `roadmap-schema.md` read just to recover. And
the handed-off session's final chat message dumped a massive wall of
investigation detail wrapped in a raw `<findings>` tag — a machine-parsing
convention shown literally to a human reading chat.

- **`roadmap.js` gained `--help`/`-h`/no-args** — prints subcommand usage
  and stdin/flag shapes instead of erroring, matching the Unix convention
  Claude reached for first.
- **Default `<tone>` replaced**: "Technical and direct, ground every
  conclusion..." (now redundant with `truth_grounding`, which already owns
  grounding) → checks the terse-tone plugin's flag file and goes terse
  if one is active, otherwise minimal/professional — silent by
  default, only what the user needs to know, no unnecessary jargon.
- **Default `<output_format>` stopped forcing an XML wrap.** Both
  `prompt-template.md` and `craft-prompt`'s embedded copy now default to a
  plain human-readable summary; XML-tag wrapping is opt-in only (`Custom
  output format`), for when something downstream genuinely parses the
  result — and even then, a plain-language summary goes above the tagged
  block so a human reading chat directly isn't just shown raw markup.

49 tests total (46 existing + 3 new for `--help`).

## [0.4.4-alpha] — 2026-07-03

### Fixed — Pick-next-task was doing ground-truth investigation it shouldn't

A real-repo trace showed `/relay:roadmap`'s "Pick the next task" branch
burning ~100k tokens on one invocation: `list`-then-manually-filter-and-rank
over a large roadmap, then ~11 `Read`/`Grep` calls exploring the codebase to
"verify/tighten" the picked entry's `touches` hints before assembling the
prompt — including re-reading the same file twice across two separate
batches. That's backwards: `<truth_grounding>` exists precisely so the
*handed-off* session verifies claims at the start of its own work; the
picker verifying anything first duplicates that cost for no reason. Also
visible in the trace: one roadmap entry's `notes` held a full paragraph
plus an entire legacy tracker's JSON record serialized as a string inside
it — bloating every future `list` call that touches that entry.

- **`roadmap.js next-candidates`** (new subcommand) — mechanical filter
  (unblocked: `planned`, every `depends_on` done) + rank (most
  `depends_on`-referenced first — a derived importance proxy, still no
  stored priority field — then oldest `created_at`) + a `collision` flag
  per candidate. `skills/roadmap`'s Pick-next-task branch now calls this
  instead of `list` + reasoning over the whole file.
- **Pick-next-task branch rewritten to forbid exploration outright**:
  "This branch does not investigate the codebase. At all." The prompt is
  assembled straight from the picked entry's fields; `touches` passes
  through as unverified area-level hints. The assembled prompt's
  `task_rules` Step 1 now defaults to "explore `relevant_files` first" —
  explicitly handing verification to the recipient instead of the picker
  attempting it. `prompt-template.md`'s checklist gained a note
  distinguishing `craft-prompt` (user-supplied exact files) from
  `relay:roadmap` (entry-derived, `truth_grounding` covers the gap).
- **Field-length warnings**: `add`/`update-status` return a non-fatal
  `warnings` field when `why` (>240 chars), `what` (>400 chars), or a
  single `notes` append (>240 chars) run long — the write still succeeds,
  but Claude sees the nudge to trim. `roadmap-schema.md` explicitly warns
  against serializing an entire legacy record into `notes`; map fields
  onto `why`/`what`/`touches` instead.
- **Clipboard fixed to file-mediated only**: the observed trace showed one
  failed inline-clipboard attempt before a working file-based fallback —
  large prompts as inline shell strings break quoting. Both
  `craft-prompt` and `roadmap` now always `Write` to a temp file first,
  then pipe the file's content into the clipboard command; no more
  try-inline-then-fallback.

46 tests total (36 existing + 10 new: 7 for `next-candidates`, 3 for the
length warnings).

## [0.4.3-alpha] — 2026-07-03

### Added — `scripts/roadmap.js`, a mechanical CRUD CLI for ROADMAP.jsonl

Every `ROADMAP.jsonl` read/write used to be Claude's own Read+reason+Edit+
Read-to-verify — repeated on every commit with discovery on. That's pure
token overhead for fully deterministic work (id computation, JSON
formatting, parse-before/after-write, append-only notes). Moved it into a
small Node CLI, same pattern as `hestia/scripts/run_audit.js` (subcommand +
flags for reads, JSON via stdin for writes, JSON via stdout for results —
no server, no daemon, Claude just shells out once per call):

- `add` — computes `id`, defaults `status:"planned"` (or `"rejected"` for
  the discovery flow's Reject path — both use the same call now), stamps
  timestamps, validates.
- `update-status` — transitions status, appends `commit`/`notes` (never
  overwrites), re-validates.
- `list` — optional `--status` filter, read-only.
- `check-duplicate` — cheap word-overlap (Jaccard) match against `rejected`
  entries, so the discovery flow stops re-asking about declined ideas
  instead of re-reading and eyeballing the whole file every time.

Rewired all three callers: `hooks/post-commit.js` (`require()`s
`readEntries` in-process for the cheap in-progress check instead of a text
substring match; its instruction blocks now tell Claude to shell out to the
CLI instead of hand-editing), `skills/init` (Write phase loops `add`
instead of `JSON.stringify`-by-hand), `skills/roadmap` (all three branches
— dropped `Edit` from `allowed-tools` entirely, there's no longer a
sanctioned way to hand-edit the file from either skill).
`roadmap-schema.md`'s "Write invariants" section became "Using roadmap.js"
— the same guarantees, now enforced in code instead of re-derived from
prose every time. 36 tests total (17 existing + 19 new for the CLI).

## [0.4.2-alpha] — 2026-07-03

### Added — token-conscious discovery entries + truth-grounding mandate

Two additions aimed at reducing token spend for whoever picks up Relay's
output later:

- **`roadmap-schema.md`** gained a "Writing claude-suggested entries" rule:
  when the commit hook's discovery flow adds an entry, write `what`/`why`/
  `touches`/`notes` as dense as possible using only what's already in the
  session's context (exact paths, line ranges, symbol names) — and
  explicitly do NOT run extra `Read`/`Grep`/`Bash` calls just to enrich the
  entry, since that spends tokens now instead of saving them for later.
  `hooks/post-commit.js`'s discovery block carries the same instruction at
  the point Claude actually acts on it. The worked example's
  `claude-suggested` entry was rewritten denser to demonstrate the target.
- **`prompt-template.md`** (and its embedded copy in `craft-prompt/SKILL.md`)
  gained a fixed, always-included `<truth_grounding>` block: the handed-off
  session must verify every claim in the prompt against the actual
  codebase at the start of its work rather than assuming it's still
  accurate — the prompt may have been crafted earlier and run later via
  `TaskCreate` or a background `Agent`. Added to both checklists.

## [0.4.1-alpha] — 2026-07-03

### Changed — retired `spawn_task`, three explicit execution options

`mcp__ccd_session__spawn_task` has a known bug: tasks spawned through it
don't get MCP tools. Every handoff point in Relay (`craft-prompt`'s final
call, `roadmap`'s "Pick the next task" branch, the commit hook's discovery
block) now offers three options instead:

- **Execute with TaskCreate** — `TaskCreate` tracks it, worked in the
  current session (`TaskUpdate` to `in_progress`/`completed`).
- **Execute with a background Agent** — `Agent` with `run_in_background:
  true`, notified on completion.
- **Copy prompt to clipboard** — platform-appropriate clipboard command
  (`Set-Clipboard`/`clip` on Windows, `pbcopy` on macOS, `xclip`/`wl-copy`
  on Linux), falling back to a fenced code block if unavailable.

`prompt-template.md`'s checklist and "when not to hand off" section were
generalized off spawn_task-specific field names (`title`/`tldr`) to the
mechanism-agnostic `subject`/`description` naming `TaskCreate` and `Agent`
actually use. `allowed-tools` in both skills dropped `spawn_task`, added
`Bash`/`PowerShell` (clipboard) and `TaskCreate`/`Agent` where missing.

## [0.4.0-alpha] — 2026-07-03

### Changed — pivot from delegation-doctrine coach to prompt-engineering + roadmap plugin

Relay dropped its `SessionStart` doctrine injection and the four hooks
supporting it, and gained a second pillar: a per-project, git-committed
`ROADMAP.jsonl` plus the skills to bootstrap and drive it.

- **Removed** `hooks/session-start.js` (every-session delegation-doctrine
  injection), `hooks/pre-tool-use.js` (global `spawn_task` template-read
  gate), `hooks/post-tool-use.js` (post-Agent/Workflow spawn nudge),
  `hooks/stop.js` (end-of-session deferred-work sweep), and
  `hooks/user-prompt-submit.js` (multi-part/deferred-language regex hints).
- **Added** `hooks/post-commit.js` — the one remaining hook, `PostToolUse`
  on `Bash`/`PowerShell`, fires only on an actual `git commit`. Silent by
  default (no `ROADMAP.jsonl` → nothing happens). When present, offers a
  status-sync nudge (close out an `in_progress` task on the commit that
  finished it) and, opt-in only, a discovery nudge (ask the user what to
  do with confirmed follow-up opportunities spotted in that commit's work
  — never acts without asking).
- **Added** `roadmap-schema.md` — the `ROADMAP.jsonl` field reference:
  `id`, `title`, `why`, `what`, `status`
  (`planned|in_progress|done|dropped|rejected`), `source`
  (`user|claude-suggested`), `depends_on`, `touches`, `commits`,
  `created_at`, `updated_at`, `notes`. No parser/writer script — Claude
  reads/writes the file directly, guided by this doc's write invariants.
- **Added** `/relay:init` — bootstraps `ROADMAP.jsonl` and
  `.relay/config.json` for a project: asks what it is and its near-term
  goals, asks the key policy question (accept Claude-suggested roadmap
  entries after commits — yes/no), drafts an initial task set, gets
  approval, writes and commits both files.
- **Added** `/relay:roadmap` — the ongoing entry point: pick the next task
  (reasons about `depends_on` ordering and `touches` collisions, then
  crafts a self-contained handoff prompt using `prompt-template.md`'s
  shape — hands off only, never executes inline, never routes to Forge),
  add a task, or review status.
- **Kept unchanged**: `/relay:craft-prompt` and `prompt-template.md` —
  already self-contained, already the prompt-engineering pillar this
  redesign builds on.

### Housekeeping

- Added this `CHANGELOG.md` and `README.md` — both were missing despite
  the repo's `CONTRIBUTING.md` requiring them for every plugin.
- Added `tests/` (`node --test`) covering `post-commit.js`.
- `plugin.json` description/keywords rewritten to reflect the new scope;
  marketplace.json entry bumped `0.3.2-alpha` → `0.4.0-alpha`.

## [0.3.2-alpha] — 2026-07-01

Enriched session-start injection (delegation-doctrine era — see above,
superseded by 0.4.0-alpha).

## [0.2.1-alpha] and earlier

Delegation-doctrine era: zero-config coaching toward `spawn_task`,
`mark_chapter`, and `Agent`/`Workflow` usage, plus the original
`/relay:craft-prompt` skill. Superseded by 0.4.0-alpha.
