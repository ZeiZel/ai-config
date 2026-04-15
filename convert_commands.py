#!/usr/bin/env python3
"""
Convert Claude Code commands to OpenCode format.
- Adds agent: field where appropriate
- Adds subtask: true
- Preserves all content
"""

import re
from pathlib import Path

REPO = Path("/home/user/workspace/ai-config")
SRC_CMDS = REPO / ".claude" / "commands"
DST_CMDS = REPO / ".opencode" / "commands"

# Mapping of command name → best agent
AGENT_MAP = {
    "commit": "spec-developer",
    "implement": "spec-developer",
    "debug": "spec-developer",
    "refactor": "spec-developer",
    "test": "spec-tester",
    "pr-review": "spec-reviewer",
    "security-audit": "security-architect",
    "design": "open-pencil-designer",
    "context-prime": "team-lead",
    "onboard": "team-lead",
    "agent-workflow": "team-lead",
    "agent-creator": "team-lead",
    "workflow-feature": "team-lead",
    "workflow-bugfix": "team-lead",
    "workflow-hotfix": "team-lead",
    "workflow-refactor": "team-lead",
    "workflow-prototype": "team-lead",
}


def convert_command(src_path: Path, dst_path: Path):
    content = src_path.read_text(encoding="utf-8")
    cmd_name = src_path.stem

    fm_match = re.match(r"^---\n(.*?)\n---\n(.*)", content, re.DOTALL)

    agent = AGENT_MAP.get(cmd_name, "spec-developer")

    if fm_match:
        fm_raw = fm_match.group(1)
        body = fm_match.group(2)

        # Check if agent/subtask already present
        has_agent = re.search(r"^agent:", fm_raw, re.MULTILINE)
        has_subtask = re.search(r"^subtask:", fm_raw, re.MULTILINE)

        additions = []
        if not has_agent:
            additions.append(f"agent: {agent}")
        if not has_subtask:
            additions.append("subtask: true")

        if additions:
            new_fm = fm_raw.rstrip() + "\n" + "\n".join(additions)
        else:
            new_fm = fm_raw

        new_content = f"---\n{new_fm}\n---\n{body}"
    else:
        # No frontmatter
        new_content = f"---\nagent: {agent}\nsubtask: true\n---\n\n{content}"

    dst_path.write_text(new_content, encoding="utf-8")
    print(f"  ✓ {src_path.name} → {dst_path.name} (agent: {agent})")


def convert_all_commands():
    DST_CMDS.mkdir(parents=True, exist_ok=True)
    cmd_files = list(SRC_CMDS.glob("*.md"))
    print(f"Found {len(cmd_files)} command files")
    for src in sorted(cmd_files):
        dst = DST_CMDS / src.name
        convert_command(src, dst)
    print(f"\nConverted {len(cmd_files)} commands to {DST_CMDS}")


if __name__ == "__main__":
    convert_all_commands()
