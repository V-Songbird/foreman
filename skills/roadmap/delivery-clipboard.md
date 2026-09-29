# Deliver: Copy prompt to clipboard, or a prompt file

Read this with [delivery.md](delivery.md): its shared rules and its host rule
still apply.

Write the returned `prompt` to a UTF-8 file first — never pass it as an
inline shell string: a large prompt breaks shell quoting and the copy silently
fails. Write the file in the project's `tmp/` directory under a unique name,
never in the project root or outside the project: a leftover file can dirty the
tree for `safe-commit.js`. When the user chose the clipboard, pipe the file's content into the
clipboard command: `Get-Content -LiteralPath <file> -Raw -Encoding utf8 | Set-Clipboard`
on Windows, `pbcopy < <file>` on macOS, `xclip -selection clipboard < <file>`
(or `wl-copy < <file>`) on Linux, and delete the file once the copy succeeded.
A prompt-file-only request skips the clipboard. Claim "copied" only after the
copy succeeded. If no clipboard command works, or the user asked for a prompt
file only, the file is the deliverable: keep it, give its path, and say it must
be moved out or deleted before a task runs in this project, because it dirties
the tree. A fenced `xml` block in chat is the last fallback, only when no
usable file can be delivered. Include the schema artifact too for a structured-output handoff.

Any checkpoint protocol a multi-row prompt needs already rides inside
`prompt`'s own `task_rules` — craft-handoff baked it in; nothing more to do
here. A prompt carries its crafting host's plugin paths: to run it in the
other host, craft it again there. In Codex, follow the builder's relocation
line when the installed plugin has moved, and keep an explicitly reviewed run's embedded
`increment_review` block intact even for one row; without a human or
coordinator channel the pasted worker leaves the result pending and stops.
