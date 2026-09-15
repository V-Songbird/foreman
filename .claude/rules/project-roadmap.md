# One roadmap for Foundry development

Development of this Foundry collection uses the parent Foundry ROADMAP.jsonl.
Do not create or maintain a separate project roadmap inside foreman, hush,
razor or their platform worktrees. Run roadmap commands from Foundry and ensure
any host project-directory override points at that same root. Plugin tests and
source commands can still run from their own checkout.

Version Foundry's root ROADMAP.jsonl and its .foreman/config.json,
.foreman/notes.jsonl and .foreman/archive.jsonl when present. These preserve
planning, shared settings, lessons and archived task history in a fresh clone.
Trial logs, session markers, locks and temporary execution state remain local.
Do not publish an entire .foreman directory by removing its exclusions.

This governs maintenance of the collection, not the unrelated user projects
where a plugin is installed. Test fixtures and archival backups are not active
project roadmaps. Do not change the plugin's general project-resolution behavior
to force all installations to use a particular Foundry checkout.

Before importing work, compare identities, dependencies and history. Keep
existing Foundry IDs; preserve free source IDs and remap collisions with an
explicit provenance map. Preserve dates, notes and acceptance state. Related
work on another platform does not establish completion of an existing task.

The former Foreman-local IDs 294–300 map to Foundry 302–308. ID 301 is unchanged;
read its current status from the root roadmap. Historical notes retain their original local
IDs, interpreted through docs/shared/validation/roadmap-reconciliation-2026-09-08.md.
