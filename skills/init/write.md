# Write phase

Steps 1 and 5 each write one trial-log line. A valid call records nothing
unless the project set `trialLog`, so it needs no check first; a malformed
one fails in every project. Either way it never blocks the flow.

Respect any branch restriction the user gave. Never switch, merge or commit
on a protected branch (one the user said not to modify, or one the host or
repository marks as protected); when a writable branch is needed, create a
descriptive branch first (`codex/<descriptive-name>` in Codex).

1. If replacing an existing roadmap: snapshot it into git before clearing
   it, so the discarded history is recoverable —
   `git commit -m "chore: snapshot roadmap before foreman re-init" -- ROADMAP.jsonl`.
   Use that pathspec form: unrelated staged work is likely in an
   established project, and a commit without the pathspec would sweep it
   into a commit titled "snapshot roadmap". A roadmap already committed
   with no changes counts as snapshotted once you verify its bytes match
   `HEAD:ROADMAP.jsonl` and name that revision. A private roadmap (step 4's
   check prints `ROADMAP.jsonl`) has no copy in git to snapshot: take the
   timestamped backup below instead, without asking.

   **If the snapshot fails, stop before clearing anything.** Whether the old
   roadmap stays recoverable is the user's call, not a line in the
   report-back. Ask one question — "Snapshotting the existing roadmap
   failed: <exit reason>. How do you want to proceed?" — with exactly these
   four options (`AskUserQuestion` in Claude Code; in Codex, the picker in
   [questions.md](../foreman/questions.md), or one plain-text question when
   the picker cannot show all four):
   - `Retry the snapshot` — the user fixes git (commits or stashes the
     unrelated work, repairs the hook), then run the same command again.
     Fails again → ask again.
   - `Save a timestamped backup instead` — copy `ROADMAP.jsonl` to
     `ROADMAP.jsonl.backup-YYYYMMDD-HHMMSS` and, if `.foreman/config.json`
     exists, that file to `.foreman/config.json.backup-YYYYMMDD-HHMMSS`,
     with the actual current stamp. Bash:
     `cp ROADMAP.jsonl "ROADMAP.jsonl.backup-$(date +%Y%m%d-%H%M%S)"` and
     `cp .foreman/config.json ".foreman/config.json.backup-$(date +%Y%m%d-%H%M%S)"`.
     PowerShell:
     `Copy-Item -LiteralPath ROADMAP.jsonl -Destination "ROADMAP.jsonl.backup-$(Get-Date -Format yyyyMMdd-HHmmss)"` and
     `Copy-Item -LiteralPath .foreman/config.json -Destination ".foreman/config.json.backup-$(Get-Date -Format yyyyMMdd-HHmmss)"`.
     Those exact destinations — never invent a folder or another name.
     Before clearing, verify both copies. The backups stay untracked, since
     init commits only the files it writes; say where they landed and that
     they are temporary — the user deletes them once satisfied with the new
     roadmap. If a copy fails, ask again instead of clearing.
   - `Continue without a snapshot — the old roadmap is lost` — proceed
     only when the user picks this option explicitly. Never infer it from
     an earlier answer or from the failure looking expected.
   - `Cancel` — stop here, change nothing, and say the roadmap is
     untouched.

   <!-- [Foreman: 209] -->
   **Trial log** — once the four-option question above reaches a definite
   outcome, one line, one event per resolution rather than per retry:
   ```
   node ${CLAUDE_PLUGIN_ROOT}/scripts/trial-log.js recovery_attempted '{"kind":"reinit-snapshot","success":<true|false>}'
   ```
   `true` for a retry that exited 0 or a backup that copied; `false` for
   `Continue without a snapshot` and for `Cancel`.

   Clear the file only after a verified snapshot, a verified backup, or that
   explicit continue — and before clearing, record the old highest id,
   including archive history: `Foreman: <id>` commit trailers and
   `[Foreman: <id>]` anchors from the old generation persist in git
   history, so the new file must not reuse those ids. Then empty the file
   (truncate or delete it) and pass that highest id as
   `"ids_after":"<old max>"` on the FIRST `add` call in step 2 below;
   numbering continues past it and every later add follows on from there.
2. For each drafted task, call `add` with its fields as JSON over stdin,
   through a quoted heredoc so an apostrophe in user-written text keeps its
   quoting ([the shared runtime](../foreman/runtime.md) describes the
   PowerShell and payload-file forms):
   ```
   node ${CLAUDE_PLUGIN_ROOT}/scripts/roadmap.js add <<'EOF'
   {"title":"...","why":"...","what":"...","source":"user","depends_on":[],"planned_touches":[]}
   EOF
   ```
   `source` is `"user"` only for work the user stated. Work you proposed,
   including goals drafted from the repository, takes the host's value:
   `"claude-suggested"` in Claude Code, `"codex-suggested"` in Codex,
   `"antigravity-suggested"` in Antigravity.
   The script computes the id, sets `status:"planned"`, stamps
   `created_at`/`updated_at`, and validates the file after every write —
   no manual parsing, no hand-computed ids. A drafted task may only
   `depends_on` a task drafted above it: entries are written in this
   order, and `add` rejects an id that doesn't exist yet. If any call
   returns `warnings`, mention them once at the end rather than per entry.
   If a later `add` fails, preserve every successful partial add and report
   which tasks were written.
3. Write `.foreman/config.json` as `{}` only if missing — an empty object,
   per the defaults section of [SKILL.md](SKILL.md).
   **If the file already exists, leave it exactly as it is.** There is
   nothing for init to put in it, and everything already in it is either a
   deliberate hand edit or the recorded answer to a first-relevant ask
   (`checkpoints`) that a re-init
   must not throw away. If the file exists but won't parse, say so in the
   report-back and change nothing.
4. Commit only the files this flow wrote, by pathspec, so unrelated staged
   work stays out of the commit. First ask git which of them the project
   ignores:
   `git check-ignore -- ROADMAP.jsonl .foreman/config.json`
   It prints each ignored path, and exits 1 with no output when none is.
   A printed file belongs to a private roadmap (see
   [the schema](../../roadmap-schema.md#private-roadmap--git-ignored-files)):
   leave it written and unstaged, never force it with `git add -f`, and drop
   it from both halves of the command below. When no file is left, skip the
   command. Otherwise:
   `git add -- ROADMAP.jsonl .foreman/config.json && git commit -m "chore: init foreman roadmap" -- ROADMAP.jsonl .foreman/config.json`
   Drop `.foreman/config.json` from both halves when step 3 left an existing
   config in place: never stage or commit an existing config this flow did
   not change, and never a broader `git add`. If the commit is blocked,
   report the written files and the reason; never claim setup was committed
   or completed when it was not.

<!-- [Foreman: 209] -->
5. **Trial log** — after step 4's commit lands, or after the write when
   step 4 left nothing to commit, one line:
   ```
   node ${CLAUDE_PLUGIN_ROOT}/scripts/trial-log.js init_completed '{"tasks":<how many add calls succeeded>}'
   ```
   `tasks` is how many `add` calls actually succeeded, never how many were
   drafted. Record it only once every file this flow wrote is committed, or
   written and git-ignored: an init that never reached that point did not
   complete.

Report back: task count, each file written but not committed because git
ignores it (step 4), one line that everything optional is off and gets
asked about when it first matters, and point the user at the first pick —
`/foreman:roadmap` in Claude Code, the roadmap skill in Codex, `/roadmap` in
Antigravity.
