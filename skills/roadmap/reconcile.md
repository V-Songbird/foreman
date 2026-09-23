<!-- [Foreman: 141] -->
# Reconcile and pick — the deeper mode, only when the user asks

The second confidence mode, reached from [pick.md](pick.md) only when the user
asks for it, in this order:
**investigate → propose → apply → recommend.**
It is composition, not a second pick flow — a survey pass scoped to the
near-term entries, then Fast pick unchanged on the repaired data:

1. **Investigate** — run pick.md's step 1, `next-candidates --menu`, first
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
3. **Recommend** — re-run `next-candidates --menu`, because the approved
   repairs may have changed statuses, dependencies, and planned surfaces, so
   the menu from 1 is stale. Then continue through pick.md's Fast pick steps
   exactly as written, with this menu as its step 1. The pick is not a
   different pick; it just reads repaired data.
