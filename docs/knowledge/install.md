---
type: knowledge
summary: "How to install Foreman in Claude Code, Codex and Antigravity, check that it worked and update it to a new release."
related_files:
  - README.md
  - .claude-plugin/plugin.json
  - .codex-plugin/plugin.json
  - plugin.json
---

# Install and update Foreman

This page says how to install Foreman on each host, how to tell it worked and how to move to a new release. The short form is in the README, under [Install](../../README.md#install).

## Claude Code

You need Claude Code 2.1.323 or later, Node.js, and Git 2.25 or later. Foreman is tested with Node.js 22.

Inside Claude Code, run:

```text
/plugin marketplace add V-Songbird/foundry
/plugin install foreman@foundry
```

Then start a new session.

To check that it worked, run `claude plugin list` in a terminal. The list names `foreman`. Then run `/foreman:init` once in the project. Init creates `ROADMAP.jsonl` and `.foreman/config.json`.

## Codex

You need Codex with plugin support, Node.js, and Git 2.25 or later.

In a terminal, run:

```text
codex plugin marketplace add V-Songbird/foundry
codex plugin add foreman@foundry
```

Trust its hooks with `/hooks`; they do nothing until you do. Then start a new session.

To check that it worked, run `codex plugin list --marketplace foundry`. Then ask Foreman to initialize the project, or type `$foreman:init`.

## Antigravity

You need the Antigravity CLI, Node.js, and Git 2.25 or later. Antigravity has no marketplace for third-party plugins, so you install from a copy of the [Foundry repository](https://github.com/V-Songbird/foundry). Replace `<path-to-clone>` with a folder of your choice.

In a terminal, run:

```shell
git clone --recurse-submodules https://github.com/V-Songbird/foundry.git <path-to-clone>
agy plugin install <path-to-clone>/foreman
agy plugin list
```

Then start a new conversation. The list names `foreman` when it worked. Run `/init` once in the project.

## Update

### Claude Code

In Claude Code, run these. Then start a new session:

```text
/plugin marketplace update foundry
/plugin update foreman@foundry
```

### Codex

In Codex, run these. Then start a new session. A changed hook stays off until you trust it again in `/hooks`:

```text
codex plugin marketplace upgrade
codex plugin remove foreman@foundry
codex plugin add foreman@foundry
```

### Antigravity

In Antigravity, run these. Then start a new conversation:

```shell
git -C <path-to-clone> pull
git -C <path-to-clone> submodule update --init
agy plugin uninstall foreman
agy plugin install <path-to-clone>/foreman
```
