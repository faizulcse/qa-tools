# qa-tools

A Claude Code / Cowork plugin marketplace with two plugins:

- **qa-agent**: an agentic QA assistant for manual testing. It turns tickets
  into test plans, runs them in a browser or against an API, files bugs, and
  writes reports.
- **git-agent**: drafts a commit message (title + description) from your
  current changes, in the repo's existing style.

You don't need MCP servers or connectors. Everything runs on small bundled
scripts.

## Quick start

### Step 1: Check the prerequisites

| You need | For | Check with |
| --- | --- | --- |
| [Claude Code](https://claude.com/claude-code) | everything | `claude --version` |
| Python 3.8+ | both plugins (standard library only, no `pip install`) | `python3 --version` |
| git | git-agent | `git --version` |
| Node 18+ | browser testing only (optional) | `node --version` |

### Step 2: Install the plugins

Inside a Claude Code session:

```
/plugin marketplace add faizulcse/qa-tools
/plugin install qa-agent@qa-tools
/plugin install git-agent@qa-tools
```

Or from a terminal:

```bash
claude plugin marketplace add faizulcse/qa-tools
claude plugin install qa-agent@qa-tools
claude plugin install git-agent@qa-tools
```

Install only the plugin you need if you don't want both. Restart Claude Code
after installing so the skills load.

**That's all you need for** requirements analysis, API testing, bug reports,
test reports, and commit drafting. Steps 3 and 4 are optional.

### Step 3 (optional): Set up browser testing

You need this only if you want qa-agent to click through a web app in a real
browser. Pick **one** of these options.

**A. Let Claude do it.** Open Claude Code in the folder where you want to
work and say:

> set up the qa-agent workspace for browser testing

Claude runs the plugin's setup script (option B) for you.

**B. Run the setup script yourself.** It creates the `qa-workspace` folder,
installs playwright-cli and its skill files, downloads Chromium, and writes a
`.env.example` and a `.gitignore`. It's safe to re-run.

```bash
# macOS / Linux
bash ~/.claude/plugins/marketplaces/qa-tools/plugins/qa-agent/scripts/qa-setup.sh ./qa-workspace

# Any OS (on Windows, replace ~ with %USERPROFILE%)
node ~/.claude/plugins/marketplaces/qa-tools/plugins/qa-agent/scripts/qa-setup.mjs ./qa-workspace
```

**C. Install manually.**

```bash
npm install -g @playwright/cli@latest
playwright-cli install --skills
playwright-cli install-browser chromium
```

### Step 4 (optional): Connect Jira

Create a `.env` file in the folder you run Claude from. If you ran the setup
script, copy `qa-workspace/.env.example` to `.env` and fill it in.

```bash
# Jira Cloud
JIRA_BASE_URL=https://your-org.atlassian.net
JIRA_EMAIL=you@example.com
JIRA_API_TOKEN=your-token

# Jira Data Center / Server: use a personal access token instead
# JIRA_PAT=your-token
```

Create a Cloud token at
[id.atlassian.com → Security → API tokens](https://id.atlassian.com/manage-profile/security/api-tokens).
Then check the connection from the same folder:

```bash
python3 ~/.claude/plugins/marketplaces/qa-tools/plugins/qa-agent/scripts/jira_client.py check
```

> **Never commit `.env`.** It holds your token. The setup script's
> `.gitignore` already excludes it.

### Step 5: Try it

Start Claude Code (`claude`) in your working folder and ask in plain English.
You never have to name a skill:

```
analyze TICKET-123 and tell me what to test
run the login test cases on https://staging.example.com
test the POST /orders endpoint against this spec
file a bug for the failing checkout case
write the test report
draft a commit message for my changes
```

## What qa-agent does

| Skill | Say | Produces |
| --- | --- | --- |
| `qa-analyze` | "analyze TICKET-123", "what should I test" | Test plan, traceability matrix, open questions |
| `qa-test-ui` | "run these on staging", "reproduce this bug" | playwright-cli run + page snapshots, screenshots, console, network |
| `qa-test-api` | "test this endpoint" | Recorded request/response evidence per check |
| `qa-bug` | "file a bug", "what severity is this" | Structured bug report, filed to Jira on approval |
| `qa-report` | "write the test report" | Self-contained HTML or Markdown report |
| `qa-jira` | "pull up TICKET-123", "file it" | Ticket reads, bug creation, comments, attachments |

A typical cycle is **analyze → test (UI or API) → file bugs → report**.

Full documentation: [`plugins/qa-agent/README.md`](plugins/qa-agent/README.md).

## What git-agent does

| Skill | Say | Produces |
| --- | --- | --- |
| `commit-draft` | "draft a commit", "write a commit message for these changes" | A draft commit title + description in the repo's style, a note on what is / isn't staged, and a split recommendation if the changes are unrelated |

It reads the working-tree diff and recent commit history, then matches the
project's convention (Conventional Commits or plain, scope tags, trailers).
It stops at the draft: nothing is staged, committed, or pushed until you
explicitly say so. Run it from inside a git repository.

Full documentation: [`plugins/git-agent/README.md`](plugins/git-agent/README.md).

## Updating

Updates install automatically by default. To update now:

```
/plugin marketplace update
/plugin update qa-agent@qa-tools
/plugin update git-agent@qa-tools
```

## Troubleshooting

| Problem | Fix |
| --- | --- |
| Skills don't trigger | Restart Claude Code after installing. Check with `/plugin` that the plugins are enabled. |
| `qa-setup.sh: No such file or directory` | Install the plugin first (Step 2). The script lives in `~/.claude/plugins/marketplaces/qa-tools/...`, not in your project. |
| `node is not installed` / `Node 18+ required` | Install Node.js 18+ from [nodejs.org](https://nodejs.org), then re-run the setup. |
| Global npm install fails (permissions) | The setup script falls back to installing playwright-cli inside the workspace. Use `npx playwright-cli`. |
| Chromium download fails behind a proxy | Set `HTTPS_PROXY` and re-run the setup script. |
| `JIRA_BASE_URL is not set` | Run from the folder that contains your `.env`, or export the variables in your shell. |
| Private fork of this repo | Replace `faizulcse` with your GitHub username. Claude Code uses your existing git credentials. |

## For maintainers: releasing an update

1. Edit files under `plugins/<plugin>/`.
2. Bump `version` in **both** `plugins/<plugin>/.claude-plugin/plugin.json` and
   the matching entry in `.claude-plugin/marketplace.json`. Installed copies
   only update when the marketplace entry's version changes.
3. Commit and push.

Tag releases if you want people to pin one: `/plugin marketplace add owner/repo@v0.3.0`.

## Versions

Marketplace (`qa-tools`): **0.3.0**

| Plugin | Version | Changelog |
| --- | --- | --- |
| qa-agent | 0.5.0 | [`plugins/qa-agent/CHANGELOG.md`](plugins/qa-agent/CHANGELOG.md) |
| git-agent | 0.1.0 | [`plugins/git-agent/CHANGELOG.md`](plugins/git-agent/CHANGELOG.md) |

## License

MIT. See [LICENSE](LICENSE).
