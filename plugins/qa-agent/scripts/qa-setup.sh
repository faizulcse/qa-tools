#!/usr/bin/env bash
# qa-setup.sh - prepare a workspace for browser test execution (macOS/Linux).
# qa-setup.mjs does the same job on any OS, including Windows.
#
#   bash "$CLAUDE_PLUGIN_ROOT/scripts/qa-setup.sh" [workspace-dir]
#
# Installs playwright-cli (the browser CLI the qa-test-ui skill drives), its
# official skill files, the Playwright test runner for promoted specs, and
# downloads Chromium. Safe to re-run; skips work that is already done.

set -euo pipefail

WS="${1:-./qa-workspace}"

if ! command -v node >/dev/null 2>&1; then
  echo "ERROR: node is not installed. Install Node.js 18+ from https://nodejs.org and re-run." >&2
  exit 1
fi

NODE_MAJOR="$(node -p 'process.versions.node.split(".")[0]')"
if [ "$NODE_MAJOR" -lt 18 ]; then
  echo "ERROR: Node 18+ required (found $(node -v))." >&2
  exit 1
fi

mkdir -p "$WS/tests" "$WS/qa-results"
cd "$WS"

if [ ! -f package.json ]; then
  cat > package.json <<'JSON'
{
  "name": "qa-workspace",
  "private": true,
  "type": "module"
}
JSON
fi

# --- playwright-cli: the tool qa-test-ui drives -----------------------------
CLI="playwright-cli"
if ! command -v playwright-cli >/dev/null 2>&1; then
  echo "Installing playwright-cli..."
  if ! npm install -g @playwright/cli@latest >/dev/null 2>&1; then
    echo "Global install unavailable (permissions?) - installing into the workspace."
    npm install -D @playwright/cli@latest
    CLI="npx playwright-cli"
  fi
fi

echo "Installing the official playwright-cli skills..."
$CLI install --skills || echo "Skill install failed. Run '$CLI install --skills' manually."

# --- test runner, for cases promoted to spec files --------------------------
if [ ! -d node_modules/@playwright/test ]; then
  echo "Installing the Playwright test runner..."
  npm install -D @playwright/test@latest dotenv@latest
fi

if [ -z "${PLAYWRIGHT_BROWSERS_PATH:-}" ]; then
  echo "Downloading Chromium (first run only, ~150MB)..."
  npx --yes playwright install chromium || \
    echo "Browser download failed. Behind a proxy, set HTTPS_PROXY and re-run."
else
  echo "Using pre-installed browsers at $PLAYWRIGHT_BROWSERS_PATH"
fi

if [ ! -f .env.example ]; then
  cat > .env.example <<'ENV'
# Copy to .env and fill in. Never commit .env.
QA_BASE_URL=https://staging.example.com
QA_OUT_DIR=./qa-results

# Test accounts, one per role under test
QA_ADMIN_USER=
QA_ADMIN_PASS=
QA_USER_USER=
QA_USER_PASS=

# API testing (qa-test-api)
QA_API_URL=
QA_TOKEN=

# Jira (qa-jira) - or connect the Atlassian connector instead
JIRA_BASE_URL=
JIRA_EMAIL=
JIRA_API_TOKEN=
ENV
fi

# Create .env from the template on first run; never overwrite filled-in values.
if [ ! -f .env ]; then
  cp .env.example .env
  echo "Created $(pwd)/.env from .env.example - fill in the URL and accounts."
else
  echo ".env already exists - leaving it unchanged."
fi

if [ ! -f .gitignore ]; then
  printf 'node_modules/\nqa-results/\n.env\n' > .gitignore
fi

cat <<EOF

Workspace ready: $(pwd)
  tests/       spec files for cases promoted to automation
  qa-results/  screenshots, logs, result.json per case
  .env         fill in the environment URL and accounts (template: .env.example)

Check the CLI:      $CLI --help
Drive a page:       $CLI -s=qa open https://example.com
Run promoted specs: npx playwright test
EOF
