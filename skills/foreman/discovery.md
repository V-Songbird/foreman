# Discovery during execution

During the task, retain concrete bugs, design ideas, optimization opportunities,
and other improvements observed beyond its scope. Before reporting completion,
review these findings even after an investigation or work without a commit.
Include findings returned by subagents. Use evidence already observed: paths,
symbols, behavior and impact. A concrete missing behavior or improvement can
qualify without being a reproduced bug; label uncertainty and propose an
investigation when the cause is unknown. Do not launch another audit or invent findings.

In the executing project, require `ROADMAP.jsonl` and honor
`.foreman/config.json`'s `discoverySuggestions:false`. A missing setting defaults
to enabled. If disabled or no roadmap exists, skip this discovery workflow.

A background subagent returns candidates and evidence to its coordinator;
it must not discard them, ask the user, or add entries itself. The coordinator
or user-facing executor handles the following steps:

1. Run `roadmap.js check-duplicate` with each candidate's title and why before
   offering it. Suppress rejected matches; for other existing matches, reference
   the entry only when new evidence adds something. Do not repeat a proposal
   already answered or pending in this conversation.
2. For each unmatched candidate, explain the finding and ask the user:
   **Add to roadmap / Execute here / Execute with a background subagent / Reject**.
   Use the active host's available question mechanism, or ask a concise
   plain-text question if no suitable tool is available. Wait for a decision before adding
   inferred work or expanding scope; honor an explicit decision already given.
3. Add uses `roadmap.js add` with `source:codex-suggested` and `status:planned`.
   An explicit Reject uses the same call with `status:rejected`. Execute choices
   authorize only the chosen finding and destination; follow the normal execution
   workflow and do not infer permission to create a sidebar task.

Use the currently installed Foreman `scripts/roadmap.js`, resolving its location
from the loaded Foreman skill. Supply JSON safely through a UTF-8 payload file
or safely quoted stdin. Write dense why/what from existing evidence.

For separate authorized work already implemented inline, offer **Log it / Skip**.
Only on Log it, add and record its actual completion and evidence, honoring
`requireVerification` and never inventing a commit. Discovery does not reopen
the original task or replace its acceptance. Say nothing when there are no
concrete, untracked candidates.
