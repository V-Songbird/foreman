<div align="center">
  <img src="assets/banner-light.png#gh-light-mode-only" alt="Foreman" width="900" />
  <img src="assets/banner-dark.png#gh-dark-mode-only" alt="Foreman" width="900" />
  <h1>Foreman</h1>
  <p><strong>Your plan stays next to your code. The next task arrives with its context checked.</strong></p>
</div>

<p align="center"><strong>Available on</strong></p>
<table align="center">
  <tr>
    <td align="center"><a href="#install"><img src="assets/edition-claude.svg" alt="" width="80" height="80" /><br />Claude Code</a></td>
    <td align="center"><a href="docs/knowledge/install.md#codex"><img src="assets/edition-codex.svg" alt="" width="80" height="80" /><br />Codex</a></td>
    <td align="center"><a href="docs/knowledge/install.md#antigravity"><img src="assets/edition-antigravity.svg" alt="" width="80" height="80" /><br />Antigravity</a></td>
  </tr>
</table>

<p align="center"><a href="#install"><strong>Install</strong></a> · <a href="#how-to-use-it">How to use it</a> · <a href="#does-it-work">Does it work?</a> · <a href="#learn-more">Learn more</a></p>

## What does it do?

Foreman is an add-on for Claude Code, the AI assistant that writes code for you. It keeps your plan in a file beside your code.

Next session, which task comes first, and why? Foreman picks one, says why, and checks the details before you start.

<p align="center"><img src="assets/mascot.svg" alt="Papers labeled Task #1, Side Request and Issue 104 gather into a plan. Ember answers 'What's next? This one.' and a stamp presses the Foreman seal on it." width="700"></p>

*Ember is the mascot of the Foundry plugins. The scene is an illustration, not a measurement.*

**You ask:** "What's next?"

**You get:** ranked tasks, each with its reason, and one marked as recommended. This example is an illustration, not recorded output.

## Install

You need Claude Code 2.1.323 or later, Node.js 22 or later and Git 2.25 or later. Node.js is a free program that runs Foreman's helpers. Git tracks changes to your code.

1. Open Claude Code.
2. Type these two lines, one at a time:

   ```text
   /plugin marketplace add V-Songbird/foundry
   /plugin install foreman@foundry
   ```

3. Start a new session.

To check that it worked, run `claude plugin list` in a terminal. The list names `foreman`. Then type `/foreman:init` in your project to create your plan file, `ROADMAP.jsonl`.

Using Codex or Antigravity? Follow the [install guide](docs/knowledge/install.md).

To get a new version, follow [Update](docs/knowledge/install.md#update).

## How to use it

- **Say "add this to the roadmap"** and describe the work. Foreman records it with its reason.
- **Say "what's next?"** to get a recommended task and a prompt ready to run.
- **Say "where are we?"** to see what is open.
- **Say "check the plan against the code"** if it may be stale.

[Foreman settings](docs/knowledge/settings.md) lists every setting.

## Does it work?

On August 29, 2026, Claude Sonnet 5 and Claude Opus 5 did the same tasks twice: with Foreman, and with a written task paragraph. Both got every task right. The session count and Foreman version were not recorded. The current release has no separate measurement.

**Foreman cost more.** It added 8.3% on Sonnet 5 and 7.3% on Opus 5.

It ran in Claude Code. No Codex or Antigravity session has been measured yet. Results vary between runs.

[Foreman benchmarks](docs/knowledge/benchmarks.md) has every result, the method and every place Foreman loses.

## Good to know

- **It is for one developer.** Foreman is no team tracker. It needs no server or account.
- **Hand edits are only partly blocked.** A shell command can still change `ROADMAP.jsonl`.
- **A pick costs extra.** **Fast pick**, the default, adds roughly 10,000 to 16,000 tokens. **Reconcile and pick** reads your code first and costs more.
- **Hosts differ.** Some automatic help does not exist in every assistant.

[Foreman limits](docs/knowledge/limits.md) lists every limit in full.

### Ids a committed roadmap publishes

The session id stays in the roadmap on purpose. It resumes something only under the `CODEX_HOME` directory of the machine that ran it.

Still, when a project commits `ROADMAP.jsonl`, the commit publishes the id.

## Learn more

[How Foreman works](docs/knowledge/how-it-works.md) · [Install and update](docs/knowledge/install.md) · [Foreman settings](docs/knowledge/settings.md) · [Foreman limits](docs/knowledge/limits.md) · [Foreman benchmarks](docs/knowledge/benchmarks.md)

Release notes are on the [Foreman releases page](https://github.com/V-Songbird/foreman/releases). Report a bug on [Foreman's issue tracker](https://github.com/V-Songbird/foreman/issues), a vulnerability as [SECURITY.md](SECURITY.md) says. To change Foreman, read [CONTRIBUTING.md](CONTRIBUTING.md). [Foundry](https://github.com/V-Songbird/foundry) lists the whole family.

## License

MIT, see [LICENSE](LICENSE).
