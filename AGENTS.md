# Working on the Codex port

Work on `Codex` or another explicitly authorized non-main branch. Never
edit, commit, merge, or reset this project on `main`. Check the branch before
making changes. This repository is Foundry's Foreman submodule. Keep Codex work
on `Codex`; `Claude` contains the Claude Code version and `main` is the
documentation-only front page.

## Foundry owns this development roadmap

When maintaining Foreman as part of Foundry, use Foundry's root ROADMAP.jsonl.
Do not recreate foreman/ROADMAP.jsonl or a roadmap in a platform worktree. Run
roadmap commands from Foundry and point project-directory overrides there;
runtime tests still run from this plugin checkout. This restriction does not
apply to unrelated projects where Foreman is installed or to test fixtures.
The former local IDs 294–300 are now Foundry 302–308; 301 retains its ID. Read
current status from Foundry's roadmap and use its report to interpret historical IDs.

Preserve roadmap format 2 and legacy records. Keep CLI behavior dependency-free
and testable with Node.js. Skills belong in `skills/`, plugin metadata in
`.codex-plugin/plugin.json`, and automatically discovered hooks in
`hooks/hooks.json`. Use actual Codex capabilities; document gaps instead of
inventing tool APIs or lifecycle events. Inherit the executing model unless the
user chooses one.

Run `node --test tests/*.test.js` for runtime changes. Validate the plugin and
edited skills with the installed plugin-creator and skill-creator validators
when available. Do not install the plugin or alter a marketplace as a side
effect of running tests.

## Coordinated documentation

The Claude and Codex README of each plugin share their product narrative,
headings, order, common outcomes and decorative branding. Change common content
in both editions together. Only the six bounded native exceptions may differ:
identity, installation, commands, compatibility and actual availability,
benchmarks, and edition-specific links. Main headings stay outside exceptions.

Benchmark questions and columns stay the same. Results identify the actual host,
model, source and date. Preserve negative results and limits. Never relabel a
Claude measurement as Codex evidence, infer performance from unit tests, or fill
missing results with invented values. Use `Not measured` and state when an edition
is unavailable. Keep research and extensive methodology in Foundry documentation;
keep usage guides and plugin-specific decisions with their plugin.

When working in Foundry, use its `coordinate-readmes` skill for paired README changes and benchmark updates. Run
`node scripts/git-hooks/check-readme-parity.js --check README.md --expect Codex`
and `check-readme-nav.js` before considering the change ready. For committed
revisions use `--git-pair <plugin-repo> <Claude-ref> <Codex-ref>`. Also inspect the
original evidence: parser success is not proof of measurement quality.

Both native review agents use the Foundry README template and the same review
criteria. Platform-specific skills, rules and CI must keep this policy aligned.
Foundry hosts both platforms; its plugin-only platform-isolation rule does not
apply to the parent repository.

## Benchmark ownership

Benchmark runners, datasets, measurement tests and experiments for this collection
live in the Foundry benchmarks/<plugin>/ directory. Keep functional product tests
here; do not recreate a benchmarks/ or .benchmarks/ tree in the plugin. Local
maintenance output and backups belong in the Foundry .scratch/ directory.
Common README changes in separate platform PRs use the reciprocal PR/SHA
protocol in `.github/README_COORDINATION.md`. A candidate-pair check does not
replace the final integrated-branch comparison before selectors or pins publish.
