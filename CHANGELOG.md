# Changelog

All notable changes to Foreman are documented here. Foreman was named
Relay through 0.4.8-alpha — see the 0.5.0-alpha entry below for the
rename; earlier entries below refer to the plugin by its name at the
time, not retroactively edited. Foreman is a monorepo-folder plugin — its
version is owned by `.claude-plugin/marketplace.json` at the repo root,
not by `foreman/.claude-plugin/plugin.json` (which carries no version
field by convention).

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
