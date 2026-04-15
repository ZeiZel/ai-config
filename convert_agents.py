#!/usr/bin/env python3
"""
Convert Claude Code agent files to OpenCode format.
- Strips unsupported frontmatter fields
- Converts tools list to OpenCode object format
- Converts model names to provider/model-id format
- Preserves the full markdown body
"""

import os
import re
import shutil
from pathlib import Path

REPO = Path("/home/user/workspace/ai-config")
SRC_AGENTS = REPO / ".claude" / "agents"
DST_AGENTS = REPO / ".opencode" / "agent"

# Model name mapping: claude → anthropic/model-id
MODEL_MAP = {
    "claude-opus-4": "anthropic/claude-opus-4-5",
    "claude-sonnet-4": "anthropic/claude-sonnet-4-5",
    "claude-haiku-4": "anthropic/claude-haiku-4-5",
    "opus": "anthropic/claude-opus-4-5",
    "sonnet": "anthropic/claude-sonnet-4-5",
    "haiku": "anthropic/claude-haiku-4-5",
    "claude-opus-4-5": "anthropic/claude-opus-4-5",
    "claude-sonnet-4-5": "anthropic/claude-sonnet-4-5",
    "claude-haiku-4-5": "anthropic/claude-haiku-4-5",
}

# Model routing by agent name (from AGENTS.md)
OPUS_AGENTS = {
    "spec-architect", "spec-reviewer", "security-architect",
    "senior-backend-architect", "senior-frontend-architect", "senior-devops-architect",
    "spec-analyst", "spec-planner", "agile-master",
}
HAIKU_AGENTS = {
    "changelog-keeper", "boilerplate-generator", "regex-helper", "readme-generator",
}

# Tools that are valid in OpenCode (subset mapping)
TOOL_MAP = {
    "Read": "read",
    "Write": "write",
    "Edit": "edit",
    "MultiEdit": "edit",
    "Bash": "bash",
    "Glob": "glob",
    "Grep": "grep",
    "WebFetch": "webfetch",
    "WebSearch": "websearch",
    "Agent": "agent",
    "Task": "task",
    "TodoWrite": "todowrite",
    "SendMessage": "sendmessage",
    # MCP tools — include as-is
}

# OpenCode-supported frontmatter keys
OPENCODE_KEYS = {"description", "model", "tools", "permissions", "mode"}

# Fields to remove from frontmatter (Claude-specific)
STRIP_KEYS = {
    "name", "category", "capabilities", "skills", "auto_activate", "coordinates",
    "coordinates_with", "orchestrates", "collaborates_with", "reports_to",
    "complexity", "specialization",
}


def get_model_for_agent(agent_name: str) -> str:
    name = agent_name.lower()
    if name in OPUS_AGENTS:
        return "anthropic/claude-opus-4-5"
    if name in HAIKU_AGENTS:
        return "anthropic/claude-haiku-4-5"
    return "anthropic/claude-sonnet-4-5"


def parse_tools_string(tools_str: str) -> list[str]:
    """Parse comma-separated tools string or YAML list into a list."""
    tools_str = tools_str.strip()
    # Handle inline YAML list [A, B, C]
    if tools_str.startswith("["):
        tools_str = tools_str.strip("[]")
    return [t.strip() for t in tools_str.split(",") if t.strip()]


def tools_to_opencode_yaml(tools_list: list[str]) -> str:
    """Convert tools list to OpenCode YAML object format."""
    lines = []
    seen = set()
    for tool in tools_list:
        tool = tool.strip()
        if tool.startswith("mcp__"):
            # MCP tools not in tools: block in frontmatter, skip
            continue
        mapped = TOOL_MAP.get(tool)
        if mapped and mapped not in seen:
            seen.add(mapped)
            lines.append(f"  {mapped}: true")
    return "\n".join(lines) if lines else "  read: true"


def convert_frontmatter(content: str, agent_name: str) -> str:
    """
    Parse frontmatter from markdown, convert to OpenCode format,
    return the full new markdown.
    """
    fm_match = re.match(r"^---\n(.*?)\n---\n(.*)", content, re.DOTALL)
    if not fm_match:
        # No frontmatter — add minimal one
        model = get_model_for_agent(agent_name)
        return f"---\ndescription: {agent_name} agent\nmodel: {model}\n---\n\n{content}"

    fm_raw = fm_match.group(1)
    body = fm_match.group(2)

    # Extract fields we care about
    desc_match = re.search(r"^description:\s*(.+?)(?=\n\w|\Z)", fm_raw, re.MULTILINE | re.DOTALL)
    model_match = re.search(r"^model:\s*(.+)", fm_raw, re.MULTILINE)
    tools_match = re.search(r"^tools:\s*(.+)", fm_raw, re.MULTILINE)

    description = ""
    if desc_match:
        desc_val = desc_match.group(1).strip()
        # Trim multiline descriptions to first sentence/line
        first_line = desc_val.split("\n")[0].strip().rstrip(".")
        # Remove any trailing YAML-like content
        description = first_line

    # Model
    if model_match:
        raw_model = model_match.group(1).strip()
        model = MODEL_MAP.get(raw_model, raw_model)
        # If it already has provider prefix, keep it
        if "/" not in model:
            model = get_model_for_agent(agent_name)
    else:
        model = get_model_for_agent(agent_name)

    # Tools
    tools_yaml = ""
    if tools_match:
        tools_list = parse_tools_string(tools_match.group(1))
        tools_yaml = tools_to_opencode_yaml(tools_list)

    # Build new frontmatter
    new_fm_lines = []
    if description:
        # Escape description if it contains colons
        if ":" in description and not description.startswith('"'):
            description = f'"{description}"'
        new_fm_lines.append(f"description: {description}")
    new_fm_lines.append(f"model: {model}")
    if tools_yaml:
        new_fm_lines.append("tools:")
        new_fm_lines.append(tools_yaml)

    new_fm = "\n".join(new_fm_lines)
    return f"---\n{new_fm}\n---\n{body}"


def get_flat_name(filepath: Path, base: Path) -> str:
    """
    Convert nested path like agents/frontend/react-developer.md
    to flat name react-developer.md
    (preserving original filename)
    """
    return filepath.name


def convert_all_agents():
    DST_AGENTS.mkdir(parents=True, exist_ok=True)

    agent_files = list(SRC_AGENTS.rglob("*.md"))
    print(f"Found {len(agent_files)} agent files")

    converted = 0
    for src_path in sorted(agent_files):
        agent_name = src_path.stem
        dst_path = DST_AGENTS / src_path.name

        # Handle name collisions (different categories with same filename)
        # Prefer to keep category as prefix if collision
        if dst_path.exists():
            # Use category/filename pattern
            rel = src_path.relative_to(SRC_AGENTS)
            parts = rel.parts
            if len(parts) > 1:
                category = parts[-2]
                dst_path = DST_AGENTS / f"{category}-{src_path.name}"
                agent_name = f"{category}-{src_path.stem}"

        content = src_path.read_text(encoding="utf-8")
        new_content = convert_frontmatter(content, agent_name)
        dst_path.write_text(new_content, encoding="utf-8")
        print(f"  ✓ {src_path.relative_to(SRC_AGENTS)} → {dst_path.name}")
        converted += 1

    print(f"\nConverted {converted} agents to {DST_AGENTS}")


if __name__ == "__main__":
    convert_all_agents()
