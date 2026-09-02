# qa-tools

A Claude Code / Cowork plugin marketplace containing **qa-agent** — an agentic
QA assistant for manual testing.

## Install

```bash
/plugin marketplace add faizulcse/qa-agent-marketplace
/plugin install qa-agent@qa-tools
```

Replace `faizulcse` with your GitHub username if the repo lives elsewhere. Works
with private repos too — Claude Code uses your existing git credentials.

From a terminal instead of a session:

```bash
claude plugin marketplace add faizulcse/qa-agent-marketplace
claude plugin install qa-agent@qa-tools
```

## What qa-agent does

| Skill | Say | Produces |
| --- | --- | --- |
| `qa-analyze` | "analyze PROJ-1234", "what should I test" | Test plan, traceability matrix, open questions |
| `qa-test-ui` | "run these on staging", "reproduce this bug" | playwright-cli run + page snapshots, screenshots, console, network |
| `qa-test-api` | "test this endpoint" | Recorded request/response evidence per check |
| `qa-bug` | "file a bug", "what severity is this" | Structured bug report, filed to Jira on approval |
| `qa-report` | "write the test report" | Self-contained HTML or Markdown report |
| `qa-jira` | "pull up PROJ-1234", "file it" | Ticket reads, bug creation, comments, attachments |

You never invoke skills by name — describe the testing and the right one loads.

Full documentation: [`plugins/qa-agent/README.md`](plugins/qa-agent/README.md).

## Requirements

No MCP servers and no connectors.

- **Python 3.8+** — requirements analysis, API testing, reporting, Jira. No packages.
- **Node 18+ and playwright-cli** — only for browser execution:

  ```bash
  npm install -g @playwright/cli@latest
  playwright-cli install --skills
  playwright-cli install-browser chromium
  ```

  Or let the plugin do it: `bash plugins/qa-agent/scripts/qa-setup.sh ./qa-workspace`
  (macOS/Linux) or `node plugins/qa-agent/scripts/qa-setup.mjs ./qa-workspace` (any OS).

- **Jira (optional)** — a `.env` in your working folder with `JIRA_BASE_URL`,
  `JIRA_EMAIL`, and an API token. Verify with
  `python3 plugins/qa-agent/scripts/jira_client.py check`.

Never commit `.env` — it is already in `.gitignore`.

## Releasing an update

1. Edit files under `plugins/qa-agent/`.
2. Bump `version` in **both** `plugins/qa-agent/.claude-plugin/plugin.json` and
   the matching entry in `.claude-plugin/marketplace.json`. Installed copies
   only update when the marketplace entry's version changes.
3. Commit and push.

Users pick it up automatically (auto-update is the default), or on demand:

```bash
/plugin marketplace update
/plugin update qa-agent@qa-tools
```

Tag releases if you want people to pin one: `/plugin marketplace add owner/repo@v0.4.0`.

## Version

qa-agent 0.4.0. Changelog in [`plugins/qa-agent/CHANGELOG.md`](plugins/qa-agent/CHANGELOG.md).

## License

MIT — see [LICENSE](LICENSE).
