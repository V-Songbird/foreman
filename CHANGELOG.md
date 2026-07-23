# Changelog

All notable changes to Foreman are documented here. Foreman was named
Relay through 0.4.8-alpha — see the 0.5.0-alpha entry below for the
rename; earlier entries below refer to the plugin by its name at the
time, not retroactively edited. Foreman is a monorepo-folder plugin — its
version is owned by `.claude-plugin/marketplace.json` at the repo root,
not by `foreman/.claude-plugin/plugin.json` (which carries no version
field by convention).

## [0.40.0-alpha] — 2026-07-22

### Added

- New `fableEnabled` setting in `.foreman/config.json` (default `false`). Declare it `true` when your plan can run Fable 5, and tasks with two or more verification checks gain a `Fable — orchestrates workers per slice` option in the executing-model question: Fable never edits files itself, it dispatches one implementer subagent per check and reviews each result before accepting it.
- The prompt gate (`check-prompt.js`) gained an `--orchestration` flag that verifies the orchestration block rides verbatim, and flags it when it appears for any other executing model.

## [0.39.0-alpha] — 2026-07-22

### Added

- Prompts copied to the clipboard with two or more verification checks now carry the checkpoint protocol, with the project's `checkpoints` settings baked in.

### Changed

- The background-Agent destination now notes it is best for orchestration; checkpoint branches and commits stay with the crafting session.

## [0.38.0-alpha] — 2026-07-22

### Changed

- `/foreman:init` no longer asks which model will run crafted prompts. Foreman now recommends a model per task at craft and dispatch time for you to confirm or override, and `targetModel` in `.foreman/config.json` stays available as an optional pin.

## [0.37.0-alpha] — 2026-07-22

### Added

- A `decisionLog` block in `.foreman/config.json` turns on per-task decision docs, with `enabled`, `dir`, and `gate` keys, plus `FOREMAN_DECISION_LOG` and `FOREMAN_DECISION_LOG_DIR` environment overrides.
- Crafted prompts now include a decision-log section when the feature is on, instructing the session to write an ADR doc and mark the code it governs with an anchor comment.
- Roadmap entries gained an optional `doc` field recording where a task's decision lives, or `"none"` when it decided nothing worth an ADR.
- Closing a task now checks that its decision doc is recorded and, when one is named, that a commit carries the matching anchor comment — configurable as a silent, nudging, or blocking check.
- Reading or editing a file with a decision-doc anchor comment now surfaces the doc it points to.
- A decision-doc template ships at `decision-doc-template.md`.

## [0.36.0-alpha] — 2026-07-22

### Added

- A `checkpoints` block in `.foreman/config.json` configures how task-split runs commit their work: `baseBranch`, `branch`, `push`, and `onFinish` — every key optional.

### Changed

- Checkpoint commits now stay local by default; set `checkpoints.push` to `true` to push each one.

## [0.35.0-alpha] — 2026-07-22

### Added

- Task-split runs checkpoint each finished task as a commit on a dedicated `foreman/<slug>` branch, created automatically when the run starts from the default branch.
- When a task-split run ends, Foreman asks whether to squash merge, merge, open a PR, or keep the checkpoint branch.

## [0.34.0-alpha] — 2026-07-21

### Changed

- Picking the next task is friendlier: candidate descriptions and the delivery message now restate a task in plain English for someone new to the codebase, and when only one task is open the pick question is skipped.

## [0.33.0-alpha] — 2026-07-21

### Added

- A task's dependencies can now be removed, not just added — `update-deps` takes `remove_depends_on`. This is the way back when a task you depend on gets dropped.
- Adding a task now rejects a dependency on an id that doesn't exist, instead of accepting a reference that would keep the task off the pick list forever.
- Each note appended to a task now lands on its own dated line, so a task worked across several sessions reads as a log.
- Adding a task now checks whether it's already on the roadmap first, and asks before writing a near-duplicate.
- Review status now says when a task's blocker has been dropped or rejected, so you can tell it apart from one that's merely waiting.

### Changed

- Re-running `/foreman:init` over an existing project now commits a snapshot of your old roadmap before starting fresh, and keeps any settings it doesn't own instead of replacing the whole config file.
- A handoff prompt now carries the task's own recorded notes, so prior findings reach the session doing the work.
- A `.foreman/config.json` that exists but can't be read as JSON now says so, instead of silently falling back to defaults.

### Fixed

- A task's file hints no longer count as stale just because a file isn't there yet — the survey now needs evidence the file once existed and moved.

## [0.32.0-alpha] — 2026-07-21

### Added

- A handoff run in this session can now be split into several tracked tasks — one per verification command, each blocked on the one before it. A single task, or no task rows at all, stay available, and the free-text answer takes a fixed number of tasks instead.

### Changed

- The in-session handoff is now called `Execute here` and asks how the work should be tracked once you pick it.

## [0.31.0-alpha] — 2026-07-19

### Added

- Prompts handed to a background Agent now carry the official autonomous-operation reminder — those sessions have no user to answer questions, and the agent harness doesn't provide it. The prompt gate enforces it for that destination and flags it as misplaced elsewhere.
- Review-flavored prompts now tell the reviewer that reporting sound work is a valid outcome, so they stop inventing gaps.

## [0.30.0-alpha] — 2026-07-19

### Changed

- Setup's persona-and-voice question now names razor and hush as examples and takes multiple selections, so a project running only one of them gets exactly the right config.

## [0.29.0-alpha] — 2026-07-19

### Changed

- Prompts crafted for an `opus` target now also leave out the step-by-step read/run scaffolding, matching `sonnet` and `fable`. `haiku` still gets full elaboration, and `inherit` keeps the standard shape.

## [0.28.0-alpha] — 2026-07-19

### Changed

- Prompts crafted for a `sonnet` target now also leave out the step-by-step read/run scaffolding, the same treatment `fable` targets already get. Constraints and the verification requirement are unchanged.

## [0.27.0-alpha] — 2026-07-18

### Changed

- Prompts crafted for a `fable` target now leave out the step-by-step read/run scaffolding — the model sequences its own exploration. Constraints and the verification requirement are unchanged.

## [0.26.0-alpha] — 2026-07-18

### Changed

- Crafting a prompt for the clipboard now asks which model will run it, the same question background-Agent handoffs already got.
- A concrete answer to that question now tailors the prompt's level of detail to the model actually running the task, overriding the project's `targetModel` default.

## [0.25.0-alpha] — 2026-07-18

### Added

- `targetModel` now accepts `fable`, matching the models a background Agent can run on. Crafted prompts keep the standard level of detail for it.
- Crafted prompts can carry a purpose sentence — what the output feeds and who it's for — so the destination session can calibrate depth.
- Pure-investigation handoffs now hand over the question under investigation and the exact commands worth running, instead of a prescribed step sequence.
- The prompt gate warns when a prompt asks the destination session to echo its reasoning in the response — phrasing that can be refused outright on newer models.

## [0.24.5-alpha] — 2026-07-18

Docs only. The README is rebuilt around a TL;DR up top and one unified section order shared with hush and razor, including a new how-it-works table.

## [0.24.4-alpha] — 2026-07-17

Doc-only: rewrote the README in the marketplace's sharpened voice, and fixed the install command, which was missing `@foundry`. No behavior change.

## [0.24.3-alpha] — 2026-07-17

Doc-only: dropped the bar visual from the renamed-file chart in favor of the same plain-list style as the other two benchmark charts, and tightened the README's wording to match the rest of the marketplace's voice. No behavior change.

## [0.24.2-alpha] — 2026-07-17

Doc-only: the three benchmark charts now carry dark-mode-aware colors and the same title/subtitle treatment as the header chart. No behavior change.

## [0.24.1-alpha] — 2026-07-17

Doc-only: the README header now carries a benchmark chart and tagline, matching hush and razor. No behavior change.

## [0.24.0-alpha] — 2026-07-16

### Added

- Every assembled prompt is now checked before delivery — a handoff with a missing section, an altered guardrail, or an unfilled placeholder never ships.
- Picking the next task now weighs the whole chain of open work waiting behind each candidate, not just its direct dependents, and prefers a candidate whose files aren't already being touched by in-progress work.
- `/foreman:roadmap <hint>` now ranks candidates by hint relevance mechanically, with the same answer every time.
- Setup now asks whether finishing a task should be held until its roadmap entry is closed (`taskCloseGate`), instead of the setting being config-file-only.

### Changed

- Already-closed tasks no longer count toward a candidate's importance ranking.
- The long-notes warning now triggers only on genuinely oversized appends.

## [0.23.0-alpha] — 2026-07-16

### Added

- Setup now also asks which model will run crafted prompts and handoffs (Haiku, Sonnet, Opus, or no fixed model), stored alongside the other project settings.
- Crafted prompts and roadmap handoffs scope their level of detail to that declared model — a Haiku target gets fuller elaboration, every other setting keeps the standard level.
- Picking the next task now flags a candidate whose description may need more than a declared Haiku target reliably handles.
- Handing a prompt off to a background agent now asks which model should run it, defaulted from the project's declared model. Copying a prompt to the clipboard instead shows a recommended model alongside the file path.

## [0.22.0-alpha] — 2026-07-15

### Added

- A task completing against a still-open roadmap entry now gets a reminder — or, with `taskCloseGate` set to `block`, is held until the entry is closed.
- Picking the next task now shows each candidate's fuller detail (and, when resuming, prior findings) in a preview you can check before choosing, without cluttering the question itself.
- craft-prompt can now emit a prompt plus an enforced JSON Schema for use as a Workflow stage.
- Background-agent handoffs can now be resumed by continuing the original agent instead of rebuilding the prompt.

## [0.21.1-alpha] — 2026-07-13

Doc-only: the README logo now adapts to dark mode (white silhouette instead of black). No behavior change.

## [0.21.0-alpha] — 2026-07-10

### Added

- Tasks created from a Foreman handoff in the same session are now marked
  in progress automatically the moment the task exists — no longer only
  when the session gets around to it.
- The repository now ships a reproducible benchmark harness — see
  [benchmarks/](benchmarks/).

## [0.20.0-alpha] — 2026-07-10

### Added

- Starting a session in a project with unfinished roadmap work now shows
  a short reminder of what's still in progress, and flags tasks that
  haven't moved in days.
- Asking for the next task now offers to finish an in-progress task
  first — and rebuilds its handoff prompt, carrying over any findings
  already recorded on the entry.

### Fixed

- The follow-up-fix reminder after a commit now appears once per task per
  day instead of on every commit.

## [0.19.0-alpha] — 2026-07-10

### Added

- Roadmap reviews on large roadmaps are now much cheaper: status
  summaries load a compact view of every task instead of every task's
  full text.

### Fixed

- Fixed an issue where a failed `git commit` could still trigger
  Foreman's after-commit prompts when an exit-code-preserving plugin was
  also installed.

### Changed

- Sessions running as a background agent now leave verification-gated
  tasks in progress and skip discovery questions instead of trying to
  ask a user who isn't there.
- Crafting a prompt costs less.

## [0.18.1-alpha] — 2026-07-10

### Fixed

- Fixed an issue where a session could quietly work around an outdated
  claim in its handoff prompt without ever mentioning the mismatch — it
  is now always stated in the final message, even under a minimal output
  style.

## [0.18.0-alpha] — 2026-07-10

### Added

- `/foreman:init` now asks whether finished-looking commits should be
  marked done right away or wait for your confirmation.
- `/foreman:roadmap` accepts a hint about what to pick next (e.g.
  `/foreman:roadmap something quick on auth`) and weighs the candidates
  against it.

### Changed

- Prompts handed to a background agent now keep Foreman's minimal
  default tone even when the project omits the tone section.
- Picking the next task is one round trip faster.

## [0.17.0-alpha] — 2026-07-10

### Added

- New `annotate` subcommand for notes-only roadmap updates — appends a
  note and refreshes the entry's timestamp without changing its status,
  so a breadcrumb write can no longer knock an entry back to an earlier
  status.

### Changed

- Duplicate checking now matches against every roadmap entry, not just
  declined ones, and reports each match's status — the post-commit
  discovery flow no longer re-suggests work that is already planned, in
  progress, or done.

### Fixed

- Roadmap writes are now atomic — an interruption mid-write can no
  longer corrupt `ROADMAP.jsonl`.
- Fixed an issue where roadmap dates used the UTC day instead of the
  local one, so commits made near midnight could miss the same-day
  follow-up nudge.

## [0.16.2-alpha] — 2026-07-09

### Changed

- Roadmap handoff prompts now have the destination session commit code
  changes before closing an entry as `done`, so the entry always carries
  the commit sha; tasks that change nothing still close without one.

## [0.16.1-alpha] — 2026-07-09

Doc-only: the README now documents the config settings and the recommended shape when running alongside razor and hush. No behavior change.

## [0.16.0-alpha] — 2026-07-09

### Added

- `/foreman:init` now also asks whether other plugins already own the
  persona and voice in your sessions, and writes the matching
  `usePersona` / `omitSections` config so crafted prompts defer to them
  from the start.
- Roadmap handoff prompts now tell the destination session how to close
  the entry when the work concludes — status, findings in `notes`, and
  the commit — with the chat reply kept to the outcome plus a pointer at
  the entry.

### Changed

- Handoff prompts now defer the final message's voice to whatever output
  style governs the destination session, and route full findings to
  their durable home (the roadmap entry, the commit message) rather than
  the chat reply.
- The default tone block now yields on its own when an output style
  already governs the session's voice, even without an `omitSections`
  opt-out.

## [0.15.2-alpha] — 2026-07-08

Doc-only: plugin.json's description now matches the marketplace listing text. No behavior change.

## [0.15.1-alpha] — 2026-07-08

### Fixed

- Picking a task no longer marks it in progress right away. The roadmap
  now only shows a task as in progress once a session actually starts
  working it, not the moment it's picked or copied.

### Changed

- "Copy prompt to clipboard" is now the recommended choice when picking
  the next task.

## [0.15.0-alpha] — 2026-07-08

### Added

- Tasks can now be marked **deferred** — parked on the roadmap while they
  wait on some trigger (a prerequisite shipping, real demand, a fourth
  duplicate worth abstracting). Deferred tasks stay visible in a roadmap
  review but no longer surface when you ask what to work on next, so
  "someday" items stop being recommended ahead of ready work. When you
  pick a task, you can wave off a "not yet" candidate and Foreman offers
  to defer it on the spot.

## [0.14.4-alpha] — 2026-07-05

### Fixed

- Fixed guardrail wording that could cause a dispatched agent to narrate
  its work step-by-step in chat instead of working silently and
  reporting only in its final response.

## [0.14.3-alpha] — 2026-07-05

### Changed

- Task steps in generated prompts are now plain bullets instead of
  numbered steps.

## [0.14.2-alpha] — 2026-07-05

### Changed

- Generated prompts include a line clarifying that task steps are a
  working plan, not a script to narrate aloud.

## [0.14.1-alpha] — 2026-07-05

### Changed

- Removed references to specific third-party plugin names from prompts
  and docs; style-plugin compatibility is now described generically.

## [0.14.0-alpha] — 2026-07-05

### Changed

- Style-plugin compatibility (persona and tone) is now configured
  explicitly via `.foreman/config.json` instead of being auto-detected
  from other installed plugins.
- Added `usePersona` config option (default `true`), controlling whether
  generated prompts open with a persona sentence or generic domain
  framing.
- Removed `inheritOperatorTone` — replaced by `usePersona` and the
  existing `omitSections` option.

## [0.13.1-alpha] — 2026-07-05

### Changed

- Reworded the prompt template's closing instruction so generated
  prompts no longer induce excessive step-by-step narration in the
  receiving session.

## [0.13.0-alpha] — 2026-07-05

### Changed

- Prompt assembly and `foreman:survey` now resolve style-plugin flags
  and file-existence checks internally, cutting down the extra tool
  calls previously needed on every prompt assembly and survey.

## [0.12.0-alpha] — 2026-07-05

### Added

- `omitSections` config option in `.foreman/config.json` — lets a
  project always drop specific optional prompt sections (`tone`,
  `example`, `background`, `output_format`) instead of being asked every
  time a prompt is crafted.

## [0.11.0-alpha] — 2026-07-05

### Added

- `customSections` config option in `.foreman/config.json` — lets a
  project bake its own recurring instructions (compliance notices, house
  style, checklists) into every generated prompt without editing the
  plugin's own template.

## [0.10.0-alpha] — 2026-07-04

### Fixed

- Fixed `craft-prompt` failing to read project config due to a missing
  tool permission.
- Fixed the post-commit hook not correctly detecting failed `git commit`
  runs, which meant status-sync nudges could fire after a failed commit.

### Changed

- Reduced duplication between `craft-prompt` and the shared prompt
  template.
- `roadmap.js list` now supports filtering by `--ids`, and candidate
  results include their own dependency ids directly.
- `foreman:survey` no longer asks an agent to verify commit existence —
  it's checked automatically before agents are dispatched.
- The test-on-edit hook moved out of the plugin into the repo's shared
  dev tooling, where it reruns tests for whichever plugin is being
  edited, not just Foreman.

## [0.9.5-alpha] — 2026-07-04

### Added

- Foreman now flags scope creep: if a request during a task diverges
  from its stated goal, it says so explicitly and logs the extra work as
  its own roadmap entry instead of folding it in silently.
- The post-commit hook also checks for work already completed beyond an
  in-progress task's description and logs it as done.

## [0.9.4-alpha] — 2026-07-04

### Added

- New `requireVerification` config option (default off). When enabled,
  Foreman asks for explicit user confirmation before marking a task
  `done` instead of self-certifying completion.

## [0.9.3-alpha] — 2026-07-04

### Changed

- A task's recorded `touches` (files affected) is now derived
  automatically from the commit's actual diff when a commit SHA is
  provided, instead of relying only on manually-listed files.

## [0.9.2-alpha] — 2026-07-04

### Added

- New `add_touches` option on `update-status` lets a task's recorded
  file list be corrected or extended as work progresses, instead of
  staying fixed at whatever was known at creation time.

## [0.9.1-alpha] — 2026-07-04

### Fixed

- Fixed follow-up fix commits made after a task was already marked
  `done` silently losing their commit reference. The post-commit hook
  now also nudges for same-day follow-up commits on completed tasks.

## [0.9.0-alpha] — 2026-07-04

### Added

- New `inheritOperatorTone` config option lets a project fix its prompt
  tone/persona regardless of which style plugins are installed for
  whoever is crafting the prompt.

### Removed

- Removed `foreman:toggle-discovery` — the same settings can now be
  edited directly in `.foreman/config.json`.

## [0.8.0-alpha] — 2026-07-04

### Added

- New hook automatically reruns the plugin's test suite whenever a file
  under its own `scripts/` or `hooks/` directory is edited, surfacing
  regressions immediately.

## [0.7.1-alpha] — 2026-07-04

### Fixed

- Fixed `update-deps` allowing indirect dependency cycles (two tasks
  depending on each other through a chain), which could leave both tasks
  permanently unable to be marked ready. Cycles are now rejected.

## [0.7.0-alpha] — 2026-07-04

### Added

- New `foreman:toggle-discovery` skill lets the discovery-suggestions
  setting be flipped at any time, instead of only during initial setup.

## [0.6.2-alpha] — 2026-07-04

### Fixed

- Tone and persona/role are now resolved once when a prompt is crafted
  instead of as a runtime check inside the generated prompt, fixing a
  conflict with persona-style plugins that inject their own identity.

## [0.6.1-alpha] — 2026-07-04

### Fixed

- Pick-next-task no longer dumps raw candidate data into the chat before
  asking which task to work on.
- Reduced the number of candidates fetched from 5 to 3, matching how
  many the picker actually presents.

## [0.6.0-alpha] — 2026-07-04

### Added

- New `foreman:survey` skill: on-demand review of near-term roadmap
  candidates that checks whether touched files, dependencies, and
  completed-task commits still match reality, and can update the roadmap
  on confirmation. Runs separately from picking the next task, so that
  path stays fast.
- `update-deps` can now correct a task's dependencies after creation.
- `next-candidates` now returns each candidate's notes.

## [0.5.0-alpha] — 2026-07-03

### Changed

- Renamed the plugin from Relay to Foreman. Commands, config files, and
  docs were updated accordingly (`/relay:*` → `/foreman:*`,
  `.relay/config.json` → `.foreman/config.json`).

## [0.4.8-alpha] — 2026-07-03

### Removed

- Removed the optional `.claude/rules/` file drafting added in
  0.4.7-alpha; `foreman:init` again only bootstraps `ROADMAP.jsonl` and
  `.foreman/config.json`.

## [0.4.7-alpha] — 2026-07-03

### Added

- `relay:init` could optionally draft a starter
  `.claude/rules/project-conventions.md` file alongside the roadmap.
  (Removed again in 0.4.8-alpha.)

## [0.4.6-alpha] — 2026-07-03

### Added

- `ROADMAP.jsonl` is now protected from direct edits — attempting to
  `Edit`/`Write` it directly is blocked, with a pointer to use
  `roadmap.js` instead.

## [0.4.5-alpha] — 2026-07-03

### Fixed

- `roadmap.js --help` (and no args) now prints usage instead of
  erroring.
- Handed-off prompts no longer leak raw internal XML tags into the final
  chat message shown to users.
- Default tone is terser and less repetitive; output no longer forces an
  XML wrapper unless explicitly requested.

## [0.4.4-alpha] — 2026-07-03

### Fixed

- Pick-next-task no longer performs its own codebase investigation
  before handing off a task, removing duplicated work and a large amount
  of unnecessary token spend on a single invocation.
- Long `why`/`what`/`notes` fields are now flagged with a warning
  instead of silently bloating the roadmap file.
- Prompt handoff now always copies via a temporary file, fixing failures
  that could occur when copying large prompts directly.

### Added

- New `next-candidates` subcommand mechanically filters and ranks
  unblocked tasks instead of requiring the whole roadmap file to be
  read and reasoned over.

## [0.4.3-alpha] — 2026-07-03

### Added

- New `scripts/roadmap.js` CLI handles all roadmap reads/writes (add,
  update-status, list, check-duplicate) mechanically, replacing manual
  file editing.

## [0.4.2-alpha] — 2026-07-03

### Added

- Discovery-flow roadmap entries are now written more densely, saving
  tokens for whoever picks them up later.
- Generated prompts always include a truth-grounding instruction telling
  the receiving session to verify claims against the current codebase
  rather than assume the prompt is still accurate.

## [0.4.1-alpha] — 2026-07-03

### Changed

- Replaced the previous task-handoff mechanism with three explicit
  options: run in the current session, run in a background agent, or
  copy the prompt to the clipboard.

## [0.4.0-alpha] — 2026-07-03

### Changed

- Foreman (then named Relay) pivoted from a delegation-coaching plugin
  to a prompt-engineering and roadmap-management plugin.

### Added

- `/relay:init` — bootstraps a per-project `ROADMAP.jsonl` roadmap and
  config file.
- `/relay:roadmap` — the ongoing entry point for picking the next task,
  adding a task, or reviewing status.
- A post-commit hook that offers to sync task status and surface
  discovered follow-up work after a commit (opt-in, never acts without
  asking).

### Removed

- Removed the previous every-session delegation-doctrine coaching hooks.

## [0.3.2-alpha] — 2026-07-01

Delegation-doctrine era (superseded by 0.4.0-alpha).

## [0.2.1-alpha] and earlier

Delegation-doctrine era: initial release, coaching toward delegation
tools, plus the original `/relay:craft-prompt` skill. Superseded by
0.4.0-alpha.
