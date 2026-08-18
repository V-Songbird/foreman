# How to run it — the shared destination question

The one copy of the destination question both prompt-crafting skills ask
(roadmap pick's Q2, craft-prompt's Call 5) — a fix here reaches both.
`prompt-template.md`'s delivery-mechanics section names the same step for
script authors and points here; the exact wording lives here. The
executing-model question is not here: its one copy lives with
craft-prompt's Call 6, and roadmap's pick branch reads that copy.

**"How do you want to run this?"** — destination and execution mode in one
question, asked now, before the prompt exists. There is nothing to preview
yet; the answer decides how the prompt gets built and delivered, not the
other way around. Options, in this order:

- `Execute here (Recommended)` — one tracked task carrying the whole
  prompt, worked in this session. Leads because it's the common case, and
  because it changes nothing about your branches.
- `Execute here, split by check` — one tracked task per verification
  command, each finished task committed on a `foreman/<slug>` branch (the
  calling flow's delivery step owns the checkpoint protocol). **Offer this
  option only when the gathered verification commands number two or
  more.**
- `Execute with a background Agent` — offload it, get notified on completion — best for orchestration, where this session owns the commits
- `Copy prompt to clipboard` — just get the text, no execution

Never call `mcp__ccd_session__spawn_task` for any of these — it has a known
bug where tasks spawned through it don't get MCP tools. `TaskCreate`,
`Agent`, and the calling flow's clipboard mechanics are the only three
delivery paths, regardless of Desktop or CLI.

`AskUserQuestion` appends its own free-text option; never author one — a
user's free text naming the pieces, or a fixed number of tasks, both mean
the split cuts into that many slices at whatever verification boundaries
exist instead of one-per-check. Don't add a confirmation question — the
created rows are the preview, and a wrong one is removed with `TaskUpdate`
`status: "deleted"`.

## Resolve `fableEnabled` (right after the answer)

Run `node ${CLAUDE_PLUGIN_ROOT}/scripts/render-sections.js` exactly once.
Only its `fableEnabled` field is read here — it decides whether `Fable`
appears in the calling flow's executing-model question. `craft-handoff.js`
resolves the same config again internally when it assembles, so this call
is only for that one gating decision, never for reuse in assembly. Surface
its `warnings` now, if any.
