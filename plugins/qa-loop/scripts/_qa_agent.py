"""Locate and import qa-agent's jira_client.py so qa-loop reuses its auth,
transport and Markdown -> Jira conversion instead of copying them.

Search order:
  1. QA_AGENT_JIRA_CLIENT (path to jira_client.py)
  2. a sibling qa-agent plugin, in the source layout
     (<marketplace>/plugins/qa-agent/scripts/jira_client.py)
     and in the installed cache layout
     (<cache>/<marketplace>/qa-agent/<version>/scripts/jira_client.py, newest version)
"""
from __future__ import annotations

import importlib.util
import os
import re
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
PLUGIN_ROOT = HERE.parent


def _version_key(p: Path):
    parts = re.findall(r"\d+", p.parent.parent.name)
    return tuple(int(x) for x in parts) if parts else (0,)


def find_jira_client() -> Path:
    env = os.environ.get("QA_AGENT_JIRA_CLIENT")
    if env and Path(env).is_file():
        return Path(env)
    candidates = []
    # source layout: plugins/qa-loop -> plugins/qa-agent
    candidates.append(PLUGIN_ROOT.parent / "qa-agent" / "scripts" / "jira_client.py")
    # cache layout: <mkt>/qa-loop/<ver> -> <mkt>/qa-agent/<ver>
    cache_versions = sorted(
        (PLUGIN_ROOT.parent.parent / "qa-agent").glob("*/scripts/jira_client.py"),
        key=_version_key,
        reverse=True,
    )
    candidates.extend(cache_versions)
    for c in candidates:
        if c.is_file():
            return c
    print(
        "ERROR: qa-agent's jira_client.py was not found. Install the qa-agent plugin, "
        "or set QA_AGENT_JIRA_CLIENT=/path/to/jira_client.py.",
        file=sys.stderr,
    )
    sys.exit(2)


_jc = None


def jira():
    """Return the imported jira_client module (loaded once)."""
    global _jc
    if _jc is None:
        path = find_jira_client()
        spec = importlib.util.spec_from_file_location("qa_agent_jira_client", path)
        mod = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(mod)  # type: ignore[union-attr]
        mod.load_dotenv()
        _jc = mod
    return _jc


def jira_client_path() -> Path:
    return find_jira_client()
