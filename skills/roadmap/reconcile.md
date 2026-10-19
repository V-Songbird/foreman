<!-- [Foreman: 141] -->
# Reconcile and pick — the deeper mode, only when the user asks

The second confidence mode, reached from [pick.md](pick.md) only when the user
asks for it, in this order:
**investigate → propose → apply → recommend.**
It is composition, not a second pick flow — a survey pass scoped to the
near-term entries, then Fast pick unchanged on the repaired data:

1. **Investigate** — run
   `node ${CLAUDE_PLUGIN_ROOT}/scripts/roadmap.js next-candidates --menu` first
   and take the **near-term set** from that one result:
   every `candidates[].id`, plus every
   `in_progress[].id`, plus every `awaiting_acceptance[].id`. That is the
   whole definition — no second call computes it, and nothing outside that
   menu is near-term. Hand those ids to `foreman:survey`
   ([survey](../survey/SKILL.md)) as its scope (its "Pick the scope" step
   takes a given set verbatim) and let it run through to its own report.
2. **Propose**, then **apply** — survey's own machinery, untouched: an
   evidence-backed concrete proposal per finding, the user's authorization for
   each repair, and `correct`/`update-deps`/`update-status` for only what the
   user authorized, with an unconfirmed breadcrumb for what it could not
   ground. Nothing here overrides any of it: let its evidence, review, and
   authorized repairs finish. A pass that finds nothing is a clean result, not
   a failure — say so and go on to 3.
3. **Recommend** — start pick.md's loop from its first step, because the
   approved repairs may have changed statuses, dependencies, and planned
   surfaces, so the menu from 1 is stale; that first step builds a fresh one.
   Then continue through pick.md's loop
   exactly as written. The pick is not a
   different pick; it just reads repaired data.
