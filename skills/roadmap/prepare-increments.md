# Prepare meaningful increments

Use this reference when gathering verification for a roadmap or standalone
handoff. Carry `reviewEachIncrement:true` only when the user explicitly asked
to try and approve each result before the next. Preserve that choice through
assembly and delivery; it is not a project setting. Ordinary split requests do
not enable it. A supplied destination remains the destination: do not ask again
or replace it to accommodate review.

Start with outcomes the user can evaluate, not a list of commands or files to
create. One increment may contain several implementation steps. For example,
opening and closing a usable form is one result; creating a component and then
running its tests are not two separately delivered features.

For each distinct result, gather one `judgment.verification` row:

- `goal`: the observable outcome, with `files` naming the known owned surface.
  Use the narrowest known surface; do not invent paths or pretend a forecast is
  verified. A specific `subject` may name the row when useful.
- `run` and `expected`: a real command and its pass signal, when applicable.
  Keep the project's established command syntax. Only these commands go to
  command preflight; never send a human action to the command resolver.
- `review.action` and `review.expected`: what the person should do or inspect,
  and the intended result including important limits. This pair may accompany
  automated checks for the very same result, or be the row's only check.

Require at least one complete pair. Do not invent a command because an outcome
needs human review. Missing commands do not turn an implementation request into
an investigation. In an explicitly reviewed run, every row needs `review`, even
when automation checks the same behavior. Ask only for facts that cannot be
inferred from the user's stated outcome and available evidence; do not ask
whether to enable review again after the user requested it.

Keep checks for one outcome on the same row. When several required commands
belong to that result, use the existing project aggregate command or a valid
shell sequence with correct failure handling; preserve each required check and
its signal. Do not create empty later rows just for lint, typecheck or a second
look at unchanged work. If outcomes cannot be separated meaningfully, use one
row and preserve the requested review.

For example, one result can carry both kinds of evidence:

```json
{
  "goal": "Open and close the sign-in form",
  "files": ["src/SignInForm.tsx"],
  "run": "npm test -- SignInForm",
  "expected": "Opening, Escape and focus checks pass",
  "review": {
    "action": "Open the form, close it with Escape, then open it again",
    "expected": "The form behaves as intended; authentication is not included yet"
  }
}
```

This is a shape example, not a command or file to copy into another project.
An automatic-only row keeps `{run,expected,goal,files}` without `review`; a
human-only row omits `run` and its `expected`. The assembler accepts `review`,
not a second `look` input format; Look is the rendered label.

Before the destination question, count **rows with distinct work**, not Run
plus Look checks. A mixed row counts once. A recommendation involving an
executable check needs an actual `run`, not merely a nonempty verification
array. Follow the remaining clean-tree, collision, context and capability
conditions in `destination-question.md`; count alone does not pick a destination.

For explicit review, set the top-level `reviewEachIncrement:true` in the
assembler input. Keep `split` as the user's local execution choice: true for
ordered local rows, otherwise the complete prompt still carries the ordered
review protocol. For a requested local run by increments, `split:true` expresses
that already-supplied choice without another destination question. Preserve
`task`, `agent` or `clipboard` as selected and inherit the model settings.

Use the returned prompt and rows without re-splitting them by check. The
[review protocol](increment-review.md) owns presentation, answer handling and
notes; preparation must not pre-record acceptance, start work merely by copying,
or claim that generated text proves an actual wait.
