#!/usr/bin/env python3
"""git_context.py - gather everything needed to draft a commit message.

One call collects the working-tree state, the diff (staged first, then
unstaged), the list of untracked files, and a sample of recent commits so the
draft can match the repository's existing style. Nothing here writes to the
repo - it only reads.

    git_context.py changes                 # full context, human readable
    git_context.py changes --json          # ... as JSON
    git_context.py changes --staged-only   # ignore unstaged / untracked
    git_context.py changes --max-diff-lines 400   # cap the diff (default 800)
    git_context.py log-style --count 15    # just the recent-commits sample

Exit codes: 0 ok, 2 not a git repo, 3 nothing to commit.
"""

from __future__ import annotations

import argparse
import json
import subprocess
import sys


def git(*args: str) -> str:
    result = subprocess.run(
        ["git", *args],
        capture_output=True,
        text=True,
    )
    if result.returncode != 0:
        stderr = result.stderr.strip()
        if "not a git repository" in stderr.lower():
            print("not a git repository", file=sys.stderr)
            sys.exit(2)
        # Some commands (e.g. diff) use exit code 1 to signal "differences".
        if result.returncode == 1 and not stderr:
            return result.stdout
        print(f"git {' '.join(args)} failed: {stderr}", file=sys.stderr)
        sys.exit(1)
    return result.stdout


def _truncate(text: str, max_lines: int) -> tuple[str, bool]:
    lines = text.splitlines()
    if len(lines) <= max_lines:
        return text, False
    kept = "\n".join(lines[:max_lines])
    return kept + f"\n... [truncated {len(lines) - max_lines} more lines]", True


def collect_changes(staged_only: bool, max_diff_lines: int) -> dict:
    branch = git("rev-parse", "--abbrev-ref", "HEAD").strip()

    upstream = ""
    ahead_behind = ""
    try:
        upstream = git(
            "rev-parse", "--abbrev-ref", "--symbolic-full-name", "@{upstream}"
        ).strip()
        counts = git("rev-list", "--left-right", "--count", "HEAD...@{upstream}").split()
        if len(counts) == 2:
            ahead_behind = f"ahead {counts[0]}, behind {counts[1]}"
    except SystemExit:
        upstream = ""

    porcelain = git("status", "--porcelain=v1", "--untracked-files=all")
    staged_files, unstaged_files, untracked_files = [], [], []
    for line in porcelain.splitlines():
        if not line:
            continue
        x, y, path = line[0], line[1], line[3:]
        if x == "?" and y == "?":
            untracked_files.append(path)
            continue
        if x not in (" ", "?"):
            staged_files.append(f"{x} {path}")
        if y not in (" ", "?"):
            unstaged_files.append(f"{y} {path}")

    staged_stat = git("diff", "--cached", "--stat")
    staged_diff_raw = git("diff", "--cached")
    staged_diff, staged_diff_truncated = _truncate(staged_diff_raw, max_diff_lines)

    unstaged_stat = unstaged_diff = ""
    unstaged_diff_truncated = False
    if not staged_only:
        unstaged_stat = git("diff", "--stat")
        unstaged_diff_raw = git("diff")
        unstaged_diff, unstaged_diff_truncated = _truncate(
            unstaged_diff_raw, max_diff_lines
        )

    has_staged = bool(staged_diff_raw.strip())
    has_unstaged = bool(unstaged_diff.strip()) if not staged_only else False
    has_untracked = bool(untracked_files) and not staged_only
    if not (has_staged or has_unstaged or has_untracked):
        print("nothing to commit - working tree clean", file=sys.stderr)
        sys.exit(3)

    return {
        "branch": branch,
        "upstream": upstream,
        "ahead_behind": ahead_behind,
        "staged_files": staged_files,
        "unstaged_files": unstaged_files,
        "untracked_files": untracked_files,
        "staged_stat": staged_stat.strip(),
        "staged_diff": staged_diff,
        "staged_diff_truncated": staged_diff_truncated,
        "unstaged_stat": unstaged_stat.strip(),
        "unstaged_diff": unstaged_diff,
        "unstaged_diff_truncated": unstaged_diff_truncated,
        "diff_scope": "staged only" if has_staged else "unstaged (nothing staged)",
    }


def collect_log_style(count: int) -> list[dict]:
    raw = git(
        "log",
        f"-n{count}",
        "--no-merges",
        "--pretty=format:%H%x1f%an%x1f%s%x1f%b%x1e",
    )
    entries = []
    for chunk in raw.split("\x1e"):
        chunk = chunk.strip("\n")
        if not chunk:
            continue
        parts = chunk.split("\x1f")
        if len(parts) < 4:
            continue
        entries.append(
            {
                "hash": parts[0][:12],
                "author": parts[1],
                "subject": parts[2],
                "body": parts[3].strip(),
            }
        )
    return entries


def print_changes(ctx: dict, style: list[dict]) -> None:
    print(f"# Branch: {ctx['branch']}")
    if ctx["upstream"]:
        print(f"# Upstream: {ctx['upstream']} ({ctx['ahead_behind'] or 'in sync'})")
    print(f"# Diff scope for the draft: {ctx['diff_scope']}")
    print()

    if ctx["staged_files"]:
        print("## Staged files")
        for f in ctx["staged_files"]:
            print(f"  {f}")
        print()
    if ctx["unstaged_files"]:
        print("## Unstaged (tracked) changes - NOT in the commit unless staged")
        for f in ctx["unstaged_files"]:
            print(f"  {f}")
        print()
    if ctx["untracked_files"]:
        print("## Untracked files - NOT in the commit unless added")
        for f in ctx["untracked_files"]:
            print(f"  {f}")
        print()

    stat = ctx["staged_stat"] or ctx["unstaged_stat"]
    if stat:
        print("## Diffstat")
        print(stat)
        print()

    diff = ctx["staged_diff"] or ctx["unstaged_diff"]
    if diff:
        label = "staged diff" if ctx["staged_diff"] else "unstaged diff"
        print(f"## Full {label}")
        print(diff)
        print()

    if style:
        print("## Recent commits (match this style)")
        for e in style:
            print(f"  {e['hash']}  {e['subject']}")
            if e["body"]:
                first = e["body"].splitlines()[0]
                print(f"            body: {first[:100]}")
        print()


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    sub = parser.add_subparsers(dest="command", required=True)

    p_changes = sub.add_parser("changes", help="full commit-drafting context")
    p_changes.add_argument("--json", action="store_true")
    p_changes.add_argument("--staged-only", action="store_true")
    p_changes.add_argument("--max-diff-lines", type=int, default=800)
    p_changes.add_argument("--log-count", type=int, default=10)

    p_log = sub.add_parser("log-style", help="recent commits sample only")
    p_log.add_argument("--count", type=int, default=10)
    p_log.add_argument("--json", action="store_true")

    args = parser.parse_args()

    if args.command == "changes":
        ctx = collect_changes(args.staged_only, args.max_diff_lines)
        style = collect_log_style(args.log_count)
        if args.json:
            print(json.dumps({"changes": ctx, "recent_commits": style}, indent=2))
        else:
            print_changes(ctx, style)
    elif args.command == "log-style":
        style = collect_log_style(args.count)
        if args.json:
            print(json.dumps(style, indent=2))
        else:
            for e in style:
                print(f"{e['hash']}  {e['subject']}")
                if e["body"]:
                    for bl in e["body"].splitlines():
                        print(f"    {bl}")


if __name__ == "__main__":
    main()
