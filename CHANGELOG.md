# Changelog

All notable changes to Foreman are documented here. Foreman was named
Relay through 0.4.8-alpha — the 0.5.0-alpha entry below records the
rename, and older entries keep the name they shipped under. Looking for a
version number? It lives in the
[foundry marketplace](https://github.com/V-Songbird/foundry) listing —
that's why `plugin.json` here carries none.

## Unreleased

### Changed

- Commit-time roadmap suggestions are on by default. After a commit, Foreman offers work worth tracking that it spotted in the change. Set `"discoverySuggestions": false` in `.foreman/config.json` to turn it off.
- Foreman no longer asks whether you want them. It just does it, until you say otherwise.

## 2.0.0 — 2026-08-21

Foreman kept two separate records of what a finished task learned. There is one now, called the ledger.

### Added

- A task now starts out knowing which earlier task governs the code it is about to touch. Put a `[Foreman: 019]` comment next to code some task settled, and anyone handed work on that file is told which task it was, by name.

### Changed

- One switch instead of two: `"ledger": {"enabled": true}`. If your settings still say `decisionLog` or `areaNotes`, leave them — both still work and both mean the ledger.
- Foreman no longer writes decision documents, and no longer hands you a template to fill in. Where you write your decisions down is yours. Put one at `docs/foreman/019.md` and a `[Foreman: 019]` comment will point people at it.
- `decision-log.md` is now [`ledger.md`](ledger.md), and covers the whole thing on one page in plain language.

### Removed

- `decisionLog.gate` no longer does anything. Nothing stops you finishing a task because a document is missing.

## 1.4.0 — 2026-08-19

### Added

- Opening a file that a recorded lesson names now shows you that lesson right there, next to any decision note the file already carried. Needs `areaNotes` on.
- A lesson that turns out to be wrong can now be retired. It stops being quoted into later work, and stops taking up room there.
- `roadmap.js note-prune` clears out lessons nothing can learn from any more — the ones whose files are all gone, and the ones already retired. It asks first, and `--dry-run` shows what would go.

### Changed

- `areaNotes` is now labelled Beta where you turn it on, and the question says turning it back off doesn't delete anything you've already saved.
- The README is plainer. Same features, fewer words that assume you already know how Foreman works.

### Fixed

- Repairing a duplicated task id no longer lets a lesson recorded under that id claim a freshness it cannot know. The lesson still shows, and its "unchanged since" now reads as unknown.

## 1.3.0 — 2026-08-18

### Added

- A finishing task can now leave one sentence about the code it touched, and the next task that plans to open those same files gets it back. Off until you turn on `areaNotes`. Read the store any time with `roadmap.js notes`.
- Two interview questions that only offered one answer now offer two: "what is this project?" and "what are the near-term goals?" both accept "read the repo and work it out".
- Building a prompt now offers real file choices, read from your repository, instead of asking you to type the paths from memory. Whatever you pick is yours to correct, and nothing is used until you choose it.
- A prompt that fails its checks now comes back with the fix for each problem, and an example to copy where one helps.
- With `trialLog` on, the log now also covers the parts only the session can see: which task you picked from the menu, whether you took the recommendation, when setup started and finished, and how many questions each flow asked.

### Fixed

- When a handoff quotes what an earlier task recorded, each line now says whether those files have changed since. Anything git cannot answer says so, rather than reading as current.
- Four optional-section questions in `/foreman:craft-prompt` offered a single choice. Each now offers a real second answer, and choosing it drops the section instead of leaving it empty.
- Foreman left one empty lock folder in your system temp directory per project it ever locked, and never removed them. They are cleaned up when the last hold on a project ends.

## 1.2.1 — 2026-08-13

### Fixed

- A shorter handoff is now held to the same rule as a long one: its verification steps must say when to stop retrying a fix.

## 1.2.0 — 2026-08-13

### Fixed

- A decision entry picked from the roadmap is now asked to decide and say why the chosen option wins, instead of being told to implement it.
- Picking a task now shows the preflight warnings — a stale planned path, a file outside the project, a verification command nothing answers to — even when the handoff passes its checks.
- Finishing a task now stops if the decision doc it names is empty or is still the untouched template.

### Changed

- A background agent now stops and asks when the work genuinely needs you — a destructive or irreversible action, a real scope change, or input only you can provide — and ends its turn there rather than on a promise to continue.
- The structural roadmap check is now reached by asking for it, rather than from the roadmap menu.
- A survey now reports a dependency it can see but cannot pin to a line, marked unconfident, instead of dropping it.

## 1.1.3 — 2026-08-11

### Changed

- The repository no longer carries benchmark run data. The record format and the validator stay.

## 1.1.2 — 2026-08-08

### Changed

- A finished task now says in its own final message that it needs your accept or decline, instead of waiting until your next request to mention it.

## 1.1.1 — 2026-08-07

### Changed

- Documentation updates.

## 1.1.0 — 2026-08-07

### Added

- `/foreman:craft-prompt` now asks how well you know the code it is about to write a prompt for, and offers a blind spot pass when the area is new to you. An answer of "I don't know" to any interview question is carried into the prompt as a stated unknown instead of a guess.

## 1.0.4 — 2026-08-07

### Changed

- Documentation updates. No behavior changed.

## 1.0.2 — 2026-08-06

### Changed

- The README now opens with a hero graphic of one task id walking the trail from roadmap to git history, and the decision-log's paper-trail diagram was redrawn with bigger type.

### Removed

- An internal planning note that was published by mistake (`docs/foreman/097.md`).

### Fixed

- Links in `TRIALS.md` that still pointed at the health tools' old location.

## [1.0.1] — 2026-08-06

### Changed

- The benchmark harness no longer ships in the installed plugin — it lives in the marketplace repo. The trial-log privacy contract moved to [`TRIALS.md`](TRIALS.md) at the plugin root, and the health tools now live under `scripts/health/`.
- Touching files in a project with no decision-log folder no longer pays the anchor scan.
- Both prompt-crafting flows now read the destination question from one shared file, so a fix to it reaches both.

### Fixed

- `settings.md` now describes `taskCloseGate`'s block mode as it behaves: the first completion attempt is stopped, and the retry passes.

## [1.0.0] — 2026-08-01

### Added

- A handoff now names the finished tasks that already worked in the files this one plans to touch, and what each of them recorded — only when the file is one that few tasks have ever reached, so a busy shared file stays quiet.
- Checking the roadmap now also lists the Claude Code hook events Foreman relies on, so a Foreman that has gone quiet can be diagnosed instead of guessed at.
- Foreman now commits to a never-list: teams, dashboards, wikis, review pipelines, agent-role workflows, batch or parallel runs, schedulers, and hosted state. Nothing on it ships in a 1.x release, and an item comes off it only in a major version, with the reason written down. The README carries it.
- Roadmap mutations now report newly unblocked, newly blocked, and stranded dependent tasks when the change creates them.
- Crafting a prompt now checks whether the verification command can actually run in this project, and says so before the prompt is handed off.
- A file that already imports the same helper is offered as a pattern to imitate, so the prompt cites a real example instead of general advice.
- Each file a task touches now carries the date it last changed, making it clear which of the task's claims may have aged.
- Closing a task now notes how far the files it predicted differ from the files it actually changed.
- Foreman can now check the whole roadmap and its settings file for structural problems — missing fields, unknown values, dangling or circular dependencies, look-alike tasks, finished tasks with nothing recording what happened — repair the unambiguous ones on request, and report the rest instead of guessing. Every roadmap write is held to the same contract, so a mutation can no longer leave the file in a state Foreman cannot read back.
- A task's title, rationale, description, kind, and planned files can now be corrected after the fact — ask Foreman to fix a stale entry instead of dropping it and adding a replacement. Only tasks still open can be corrected, and a correction written against an older version of the entry is refused instead of overwriting a newer one.
- The roadmap file now records which format it is written in, so a roadmap from a newer Foreman is refused with one clear message instead of being misread. An older roadmap upgrades itself automatically the first time Foreman changes it — a timestamped backup is taken first — and `migrate` remains available to do the same upgrade by hand, up front.
- Finished tasks can now be archived out of the roadmap and restored back — ask Foreman to archive the done ones and they leave the active list while keeping their ids and staying available for history, duplicate checks, and anything still depending on them.
- Work that is finished but not yet accepted now says so: a task waiting on your yes sits in `awaiting_acceptance` instead of looking like it is still being worked on. Foreman offers to accept it when you next ask what to work on, mentions it at session start, and sends it back to in progress — with what you said — when you tell it the work is not ready.
- Two branches that each added a task can no longer leave the merged roadmap broken: Foreman now reports which tasks ended up sharing an id, what still depends on it, and which commits already carry it, then renumbers the ones you don't keep — links to the task that keeps the id survive the repair untouched.
- Foreman now has one entrance: describe what you want in plain language — add work, see where the project stands, fix a stale entry, pick what to work on, or check the roadmap against the code and then pick — and it goes to the flow that handles it. The specialized commands still work directly and are now documented as the advanced way in.
- Added a roadmap health report you can run on any roadmap, and a records validator that checks a stated number against the run behind it.
- Foreman now offers at session start to archive finished roadmap entries once 20 or more sit in the active roadmap. Offer only — nothing moves without you.

### Changed

- Picking a task now costs at most two questions before the prompt exists: which task, then how to run it. Destination and execution mode are one question, and the split-by-check option appears only when the task really has two or more checks to split on. The option that creates a git branch is no longer the recommended one.
- The end-of-run question about a checkpoint branch — squash, merge, PR, or keep — is now asked once and remembered in `.foreman/config.json`.
- Foreman no longer narrates its own scoring when it hands a task over, and it names task states in everyday words instead of the values stored in the file.
- `/foreman:init` now writes an empty settings file. Every optional behavior already has a safe default in the code that reads it; writing them out again only created a second copy that could drift.
- `settings.md` is now split into the handful of settings you might change and everything else, and `roadmap-schema.md` no longer restates the command reference — `roadmap.js --help` is the one copy.
- Getting a task now has two named modes. **Fast pick** is the default and is unchanged — it reads no code and recommends from the roadmap it already has. **Reconcile and pick** is the deeper one: it checks the near-term tasks against your actual code, proposes a concrete repair for each thing it finds, applies only what you approve, and recommends from the corrected roadmap. Fast pick may mention the deeper mode in one line when what it just read looks stale, but it never starts it for you.
- Why-notes now belong to decision work only. A task added to resolve a question (`kind: "decision"`) is the one thing that earns a decision note; ordinary implementation work is never asked for one, never held at completion for a missing one, and its handoff no longer carries the write-a-note instruction — whatever `decisionLog` is set to. Notes and anchors already in a repo keep surfacing when you open the files they tag.
- Building a prompt from scratch is now an advanced tool rather than part of normal use: `/foreman:craft-prompt` answers only an explicit ask for a standalone prompt, and Foreman describes itself by the job it actually does — keeping the roadmap honest, recommending the next task, and handing it off cleanly.
- Ordinary fresh work now gets a short handoff instead of the full-strength one. Foreman picks between a standard and a reinforced prompt from mechanical signals only — whether the task was already started, overlaps in-progress work, has gone stale, carries unusually many dependencies or notes, or is a decision with nothing runnable to check it — and says which profile it chose and why. Reinforced is unchanged, and the rule that closure notes must cite observed work holds in both.
- A task's planned files and the files it actually changed are now two separate records, so the pre-work overlap check no longer counts a finished task's committed files as a conflict. Existing roadmaps read fine as they are, and the first change Foreman makes to one converts both the roadmap and the archive automatically, taking a timestamped backup of each — everything already recorded becomes the planned half.
- Every view now reports the same task-to-commit facts from one interpreter: a commit recorded on a task resolves whether it lives in the project repo or a submodule, so a finished task whose commit sits in a submodule is no longer reported as missing its evidence, and a task closed inside its own commit is recognized as recorded rather than empty.
- After-commit discovery is now opt-in and no longer reads your backlog into each commit's context. Projects that relied on it being on by default will stop seeing suggestions — set `discoverySuggestions: true` in `.foreman/config.json` to keep it. With it on, it no longer lists every planned task; each candidate suggestion is checked for duplicates one at a time instead, so the cost no longer grows with the roadmap.
- Surveying the roadmap now proposes concrete fixes for stale task descriptions and planned files — the current wording against the suggested one, with the evidence behind it — applies only the ones you approve one by one, and leaves findings it cannot ground as an unconfirmed note instead of rewriting anything.
- Picking the next task now loads a compact choice menu and fetches full detail only for the selected entry.
- Roadmap writes now serialize automatically across concurrent Foreman sessions, and repeating an exact task add safely reuses the existing entry.
- Task closure notes must cite observed work or outcomes instead of treating the planned task description as proof.
- A commit that looks like it finishes a task now records the work and asks you to confirm it's verified before the task is closed. Set `requireVerification` to `false` to close it as soon as the commit lands.
- Every offered task now says why it is where it is in the order — the hint it matched, the open work behind it, the overlap it avoided, or its age — and Foreman calls the result its recommendation rather than the best task, since the pick is still yours. Wording across the README, skills, and the plugin description now reserves "preflighted", "grounded", and "verified" for the confidence a step has actually reached.
- Setting a project up now asks three things — what the project is, what its near-term goals are, and whether the drafted roadmap looks right — instead of an interview about optional policy. Everything else gets a safe default (confirmation before a task is closed, no completion gate), and the optional behaviors are raised one at a time when they first matter: discovery after a commit it would have run on, decision notes when you add your first decision task, checkpoint policy at your first split run. Answers are remembered, and a re-init no longer overwrites them.
- Foreman's commits now go through one shared safe-commit routine instead of `git add -A`: it takes a baseline before the work starts, stages only the files that changed after it, stops and names anything the task never declared, and makes no automated commit at all on a tree that was already dirty — a run that starts dirty says so once and leaves every change for you to commit.
- Surveying the roadmap now hands each investigating agent a compact digest of every unfinished task, so hidden-dependency and duplicate checks compare against real entries instead of relying on the agent re-reading the roadmap itself.

### Removed

- The `targetModel` setting is gone. It tuned how much detail a handoff spelled out, and no code read it any more.
- The `customSections` setting is gone. Adding your own XML blocks to every crafted prompt was a prompt-engineering surface Foreman no longer holds.
- The `checkpoints.push` setting is gone. Checkpoint commits always stay local now — the default ending squashes and deletes the checkpoint branch, so pushing each commit published work that was about to be rewritten.

### Fixed

- Two of Foreman's hooks no longer run in projects that never set up a roadmap: opening a file and editing a file both stay silent there, as the other four already did.
- Blocking a direct edit of `archive.jsonl` now applies only to this project's own copy, instead of any file anywhere with that name.
- Recording a usage trial no longer costs a run its automated commits: the trial log counts as Foreman's own bookkeeping, like the roadmap and the archive.
- The session-start archive offer and the after-commit discovery invite no longer repeat every single time they'd otherwise fire — the archive offer waits at least 7 days between offers, and the discovery invite waits at least a day, per project.
- Re-initializing a project can no longer discard an existing roadmap after a failed snapshot: Foreman stops before clearing anything and offers to retry the snapshot, save a timestamped backup beside the roadmap, continue without one after you say so explicitly, or cancel.
- A roadmap can now pass 999 tasks safely: task ids of four or more digits are created, validated, ordered, committed, and closed the same way three-digit ones always were, instead of being silently unreadable to commit trailers, decision anchors, and hooks.
- Closing a task with a commit that lives in a submodule now records the files that commit changed, instead of recording nothing.
- Fixed an issue where a corrupt `ROADMAP.jsonl` silently paused Foreman's commit bookkeeping — the after-commit check now says so and points at the report-only `roadmap.js doctor`.
- Picking the next task now warns about overlap with a folder that work is already underway in, instead of only when both tasks name the exact same path — a task planning `src/auth/` no longer looks safe while `src/auth/middleware.ts` is being changed. Recommendations and the commit primitive now share one path-matching rule, so Windows separators, trailing slashes, and casing can't hide an overlap from either.
- Fixed an issue where starting a task turned off automated commits on a project that keeps its roadmap in git: marking the task in progress counted as a dirty tree. Foreman's own bookkeeping files no longer count, and they still stay out of a task's commit unless the close declares them.
- Fixed an issue where a handed-off task closed itself straight to done even with `requireVerification` on: the handoff now tells the closing session to record the work as awaiting your acceptance, the same hold the after-commit check already applied.
- Closing a task now refuses a recorded commit that is not actually a git sha, instead of storing any text as permanent evidence — and when staging the roadmap alongside a close fails, the handoff now says to stage it by hand so the close doesn't miss its own commit.
- A task's planned files can no longer name paths outside the project: adding or correcting one refuses absolute or escaping paths, and the symbol preflight reports such a path instead of reading the file it points at — so a roadmap arriving from a branch or merge cannot pull outside file contents into a handoff.
- Re-initializing over an existing roadmap now continues task ids past the old file's highest one instead of starting at 001 again, so commit trailers and code anchors from the old roadmap can no longer point at unrelated new tasks.
- Blocking a direct edit of the roadmap file now names every command the CLI actually accepts, including `correct`, `update-deps`, `reassign-id`, `doctor`, and `migrate` — a session fixing a stale entry is no longer handed a list that leaves out the fix it needs.
- Fixed an issue where two same-day corrections to the same task could silently overwrite each other: correcting a task now also requires your own view of the current wording for each field you're changing, and a mismatch is refused with the same re-read-and-retry message as a stale correction.
- Fixed an issue where a `git commit` made outside the current project — in an unrelated repository elsewhere on disk — could still be read against this project's roadmap. The after-commit check now confirms the commit actually landed in the project or one of its submodules before reading anything, and stays silent otherwise.
- Fixed an issue where a commit made inside a submodule was tagged and trailer-matched against the parent repository's last commit instead of its own — the after-commit check now reads the commit's own repository.
- Fixed an issue where a follow-up fix committed while a task sat waiting on your acceptance got no nudge and its commit was silently lost — the after-commit check now also watches tasks awaiting acceptance, however long they've been waiting, the same way it already watched tasks finished earlier that day.
- Fixed an issue where closing a task that renamed or deleted a file (`git mv`, `git rm`) could crash the commit step outright instead of committing normally.
- Fixed an issue where a project's own `CHANGELOG.md` was treated like Foreman's own bookkeeping files: a task closing with an edited changelog silently left it uncommitted, and a roadmap close that declared it could fail after the commit already landed. A project's changelog now commits normally.
- Fixed an issue where the backup file an automatic roadmap upgrade leaves beside the roadmap could stall automated commits, or make a roadmap close refuse outright, on the exact turn the upgrade fired. That backup is now recognized as Foreman's own bookkeeping everywhere the roadmap and archive already are, and it can no longer ride into a close's commit.
- Fixed an issue where a corrupted archive-offer state file could silence the session-start archive offer permanently instead of just for its usual re-ask window.
- Correcting a task's planned files no longer refuses a caller who simply reordered them — the current value is compared as a set, not position by position — and `expected.touches` is now accepted as an alias for `expected.planned_touches`, matching the same alias already accepted on the value being corrected to.

## [0.46.0-alpha] — 2026-07-24

### Changed

- `Execute here` is now the recommended, default pick for running a task or a handoff prompt.

## [0.45.0-alpha] — 2026-07-24

### Added

- `/foreman:init` now asks whether to enable the decision log and writes the choice into the project config, instead of leaving it as a setting you'd only find by reading the table.
- Picking a task surfaces the decision docs recorded by the tasks it depends on, so work that builds on an earlier decision reads it instead of re-deciding it.

## [0.44.0-alpha] — 2026-07-23

### Changed

- Why-notes write nothing unless a project turns them on. `decisionLog.enabled` defaults to `false`, so no decision docs are added to a repo and no anchor comments are added to its source until it's set `true`.

### Added

- `decision-log.md` documents why-notes in full: what a note and an anchor look like, where the `Foreman: <id>` line on your commits comes from, every config key, and both environment overrides.

## [0.43.0-alpha] — 2026-07-23

### Removed

- The `nudge` setting is gone from `taskCloseGate` and `decisionLog.gate`. Both now accept `off` or `block`, and both default to `off` — a project that wants the close gate enforced sets `block` explicitly. A config still holding `nudge` falls back to `off`.

### Fixed

- The close gate's reminder mode produced no message at all. Its replacement, `block`, holds the completion and states what to close.

## [0.42.0-alpha] — 2026-07-23

### Added

- A roadmap entry can now be marked `kind: "decision"` for tasks that resolve a question rather than ship code — the pick flow hands it a decide-don't-build task rule instead of implementation steps.

### Removed

- The Fable-orchestrator option is gone. Fable now always runs tasks directly, the same as any other model.

### Changed

- `/foreman:init` now asks whether the project can run Fable 5 (Max plan or API only). Say yes and `Fable` becomes a selectable model alongside Haiku, Sonnet, and Opus; say no (the default) and it's left out of the menu entirely.

## [0.41.0-alpha] — 2026-07-23

### Added

- Roadmap closes can now land inside the closing commit itself: pass `staged:true` to `update-status` after staging your work — touches derive from the index, ROADMAP.jsonl is staged alongside, and a final `Foreman: <id>` line in the commit message links entry and commit, with no sha to record and no roadmap change left uncommitted.
- Bug-fix prompts now ask for the failing output verbatim and carry it in the prompt, so the handed-off session reads the real error instead of a paraphrase.
- Relevant files can include a `Pattern:` line naming an existing implementation for the new code to imitate.

### Changed

- Roadmap discovery suggestions are now on by default — set `discoverySuggestions: false` to silence the after-commit nudge.
- Per-task decision docs are now on by default — set `decisionLog.enabled: false` to opt out.
- The "what does done look like" question now nudges performance and coverage goals toward a concrete metric and threshold.
- The post-commit reminder recognizes `Foreman: <id>` commit trailers: no follow-up nudge for an entry the commit already closes, and a pointer at the named entry when one is still open.
- When a Fable orchestrator sends a worker back, the follow-up brief now names the specific gap the work missed.
- The decision-log audit follows trailer-linked commits when an entry records no sha.

## [0.40.2-alpha] — 2026-07-22

### Changed

- A roadmap pick headed for a background Agent or the clipboard now confirms the executing model with the same question `craft-prompt` asks — Fable-orchestrator offer included — instead of a recommendation line in the delivery message. Copied prompts also carry the confirmed model's recommendation line.

## [0.40.1-alpha] — 2026-07-22

### Fixed

- A custom section can no longer use the reserved `decision_log` tag and shadow the template's decision-log block — it is skipped with a warning, like the other reserved tags.
- The `update-deps` error message now mentions `remove_depends_on` alongside `add_depends_on`.
- Documentation corrected where it lagged the code: the template's settings shape, the schema doc's completion-check coverage, a broken README link, and init's list of preserved config keys.

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
