# Deliver: Copy prompt to clipboard, or a prompt file

Read this with [delivery.md](delivery.md): its shared rules and its host rule
still apply.

Write the returned `prompt` to a UTF-8 temp file first — never pass it as an
inline shell string: a large prompt breaks shell quoting and the copy silently
fails. When the user chose the clipboard, pipe the file's content into the
clipboard command: `Get-Content -LiteralPath <file> -Raw -Encoding utf8 | Set-Clipboard`
on Windows, `pbcopy < <file>` on macOS, `xclip -selection clipboard < <file>`
(or `wl-copy < <file>`) on Linux. A prompt-file-only request skips the
clipboard. Mention the file path too, and claim "copied" only after the copy
succeeded. If no clipboard command works, deliver the file path; a fenced
`xml` block in chat is the last fallback, only when no usable file can be
delivered. Include the schema artifact too for a structured-output handoff.

Any checkpoint protocol a multi-row prompt needs already rides inside
`prompt`'s own `task_rules` — craft-handoff baked it in; nothing more to do
here. A prompt carries its crafting host's plugin paths: to run it in the
other host, craft it again there. In Codex, follow the builder's relocation
line when the installed plugin has moved, and keep an explicitly reviewed run's embedded
`increment_review` block intact even for one row; without a human or
coordinator channel the pasted worker leaves the result pending and stops.
