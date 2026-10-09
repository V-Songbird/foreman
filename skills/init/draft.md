# Draft phase (no question)

From the Call 1 answers, draft 3–8 initial `ROADMAP.jsonl` lines following
the schema exactly, fewer when the user's scope calls for fewer:
- `status: "planned"`, `depends_on` filled in only where one task is
  obviously sequential to another (don't invent dependencies that aren't
  there).
- `planned_touches` as a best-guess area hint per task, or `[]` if genuinely
  unknown (a brand-new project has no files to point at yet — that's fine).
  It is a prediction; what the work actually reaches gets recorded separately
  at close, so a wrong guess costs nothing and `correct` can replace it.
- A task that settles an open question rather than building something is a
  decision task: say so in the draft and add `"kind":"decision"` to its
  payload.
- ids `"001"` through `"00N"` (or continuing past the old highest id, when
  appending or replacing per the pre-check).

Present the draft as readable text, one task per line — `title` plus `why`
— not a raw JSON dump. The user should be able to skim it in a few seconds.
