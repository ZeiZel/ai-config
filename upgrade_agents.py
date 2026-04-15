#!/usr/bin/env python3
"""
Upgrade all .opencode/agent/*.md files to be fully OpenCode-native:
1. Strip any remaining Claude-specific patterns
2. Replace Claude Code Agent tool spawn syntax with OpenCode @mention syntax
3. Add superpowers skill references where appropriate
4. Add figma tools for design agents
5. Fix model names (no legacy references)
6. Add permissions block for agents that need bash
"""

import re
import os
from pathlib import Path

REPO = Path("/home/user/workspace/ai-config")
AGENTS_DIR = REPO / ".opencode" / "agent"

# ─── Model map ──────────────────────────────────────────────────────────────

MODEL_MAP = {
    "claude-opus-4": "anthropic/claude-opus-4-5",
    "claude-sonnet-4": "anthropic/claude-sonnet-4-5",
    "claude-haiku-4": "anthropic/claude-haiku-4-5",
    "claude-3-opus": "anthropic/claude-opus-4-5",
    "claude-3-sonnet": "anthropic/claude-sonnet-4-5",
    "claude-3-haiku": "anthropic/claude-haiku-4-5",
    "opus": "anthropic/claude-opus-4-5",
    "sonnet": "anthropic/claude-sonnet-4-5",
    "haiku": "anthropic/claude-haiku-4-5",
}

OPUS_AGENTS = {
    "spec-architect", "spec-reviewer", "security-architect",
    "senior-backend-architect", "senior-frontend-architect", "senior-devops-architect",
    "spec-analyst", "spec-planner", "agile-master",
}
HAIKU_AGENTS = {
    "changelog-keeper", "boilerplate-generator", "regex-helper", "readme-generator",
}

# ─── Design agents that need figma ──────────────────────────────────────────

DESIGN_AGENTS = {"open-pencil-designer", "ui-ux-master", "senior-frontend-architect"}

# ─── Subagent-capable agents ────────────────────────────────────────────────
# These agents need to dispatch subagents via OpenCode @mention syntax

SUBAGENT_ORCHESTRATORS = {
    "team-lead", "spec-orchestrator", "agile-master",
    "senior-frontend-architect", "senior-backend-architect", "senior-devops-architect",
    "security-architect",
}

# ─── Superpowers skill mapping ───────────────────────────────────────────────
# Which superpowers skills each agent type should use

SUPERPOWERS_SKILLS = {
    "team-lead": [
        "superpowers:subagent-driven-development",
        "superpowers:dispatching-parallel-agents",
        "superpowers:writing-plans",
        "superpowers:brainstorming",
    ],
    "spec-orchestrator": [
        "superpowers:subagent-driven-development",
        "superpowers:dispatching-parallel-agents",
        "superpowers:writing-plans",
    ],
    "spec-developer": [
        "superpowers:test-driven-development",
        "superpowers:verification-before-completion",
        "superpowers:systematic-debugging",
        "superpowers:receiving-code-review",
    ],
    "spec-analyst": [
        "superpowers:brainstorming",
        "superpowers:writing-plans",
    ],
    "spec-architect": [
        "superpowers:brainstorming",
        "superpowers:writing-plans",
    ],
    "spec-planner": [
        "superpowers:writing-plans",
        "superpowers:brainstorming",
    ],
    "agile-master": [
        "superpowers:writing-plans",
        "superpowers:dispatching-parallel-agents",
    ],
    "spec-reviewer": [
        "superpowers:requesting-code-review",
        "superpowers:verification-before-completion",
    ],
    "spec-tester": [
        "superpowers:test-driven-development",
        "superpowers:verification-before-completion",
        "superpowers:systematic-debugging",
    ],
    "spec-validator": [
        "superpowers:verification-before-completion",
    ],
    "senior-frontend-architect": [
        "superpowers:subagent-driven-development",
        "superpowers:dispatching-parallel-agents",
        "superpowers:brainstorming",
    ],
    "senior-backend-architect": [
        "superpowers:subagent-driven-development",
        "superpowers:dispatching-parallel-agents",
        "superpowers:brainstorming",
    ],
    "senior-devops-architect": [
        "superpowers:subagent-driven-development",
        "superpowers:dispatching-parallel-agents",
    ],
    "security-architect": [
        "superpowers:subagent-driven-development",
        "superpowers:systematic-debugging",
    ],
    "react-developer": [
        "superpowers:test-driven-development",
        "superpowers:verification-before-completion",
    ],
    "code-reviewer": [
        "superpowers:requesting-code-review",
        "superpowers:receiving-code-review",
        "superpowers:verification-before-completion",
    ],
    "open-pencil-designer": [
        "superpowers:brainstorming",
    ],
    "ui-ux-master": [
        "superpowers:brainstorming",
    ],
    "refactor-agent": [
        "superpowers:test-driven-development",
        "superpowers:verification-before-completion",
    ],
    "deployment-engineer": [
        "superpowers:verification-before-completion",
        "superpowers:systematic-debugging",
    ],
}

# ─── OpenCode subagent dispatch note ────────────────────────────────────────

SUBAGENT_DISPATCH_NOTE = """
## OpenCode Subagent Dispatch

In OpenCode, subagents are dispatched using the `@mention` syntax in your message.
**Use the `skill` tool** to access superpowers skills.

To spawn a subagent:
```
@agent-name Your task description here. Provide all necessary context inline.
```

Key rules for OpenCode subagent dispatch:
- Each `@mention` creates a fresh subagent with isolated context — never share session history
- Craft the task description to be completely self-contained
- Use `todowrite` tool to track tasks before dispatching
- Use `superpowers:dispatching-parallel-agents` skill for concurrent tasks
- Use `superpowers:subagent-driven-development` for plan execution

Subagent response statuses:
- **DONE** — proceed to next step
- **DONE_WITH_CONCERNS** — review concerns before continuing
- **NEEDS_CONTEXT** — provide missing info, re-dispatch
- **BLOCKED** — assess: more context → re-dispatch, too large → split task, plan wrong → escalate
"""

FIGMA_NOTE = """
## Figma MCP Integration

You have access to the `figma` MCP server (enabled per-agent in `opencode.json`).

Available tools (when `FIGMA_ACCESS_TOKEN` is set):
- `mcp__figma__get_file` — fetch full Figma file
- `mcp__figma__get_file_components` — list all components
- `mcp__figma__get_file_styles` — extract design tokens (colors, typography)
- `mcp__figma__get_node` — fetch specific node by ID
- `mcp__figma__get_image` — render node as image

Workflow:
1. Get file → extract components/styles
2. Map design tokens to CSS/Tailwind variables
3. Implement components matching Figma specs pixel-perfect
"""


def get_model(agent_name: str) -> str:
    if agent_name in OPUS_AGENTS:
        return "anthropic/claude-opus-4-5"
    if agent_name in HAIKU_AGENTS:
        return "anthropic/claude-haiku-4-5"
    return "anthropic/claude-sonnet-4-5"


def parse_frontmatter(content: str):
    """Returns (fm_dict_raw_str, body) or (None, content)."""
    m = re.match(r"^---\n(.*?)\n---\n(.*)", content, re.DOTALL)
    if not m:
        return None, content
    return m.group(1), m.group(2)


def extract_fm_field(fm_raw: str, key: str) -> str | None:
    m = re.search(rf"^{key}:\s*(.+)", fm_raw, re.MULTILINE)
    return m.group(1).strip() if m else None


def extract_tools(fm_raw: str) -> list[str]:
    """Extract tools from frontmatter — supports both list and object formats."""
    # Object format: tools:\n  read: true
    obj_match = re.search(r"^tools:\n((?:  \w+: (?:true|false)\n?)+)", fm_raw, re.MULTILINE)
    if obj_match:
        tools = []
        for line in obj_match.group(1).strip().split("\n"):
            m = re.match(r"\s+(\w+): (true|false)", line)
            if m and m.group(2) == "true":
                tools.append(m.group(1))
        return tools

    # Inline list format: tools: Read, Write, Bash
    inline_match = re.search(r"^tools:\s*(.+)", fm_raw, re.MULTILINE)
    if inline_match:
        val = inline_match.group(1).strip().strip("[]")
        return [t.strip() for t in val.split(",") if t.strip()]
    return []


TOOL_MAP = {
    "Read": "read", "Write": "write", "Edit": "edit", "MultiEdit": "edit",
    "Bash": "bash", "Glob": "glob", "Grep": "grep", "WebFetch": "webfetch",
    "WebSearch": "websearch", "Agent": "agent", "Task": "task",
    "TodoWrite": "todowrite", "SendMessage": "sendmessage",
}


def tools_to_yaml(tools: list[str], agent_name: str, is_design: bool = False) -> str:
    seen = set()
    lines = []

    for tool in tools:
        # Skip MCP-specific tools from old format
        if tool.startswith("mcp__"):
            continue
        mapped = TOOL_MAP.get(tool, tool.lower())
        if mapped not in seen:
            seen.add(mapped)
            lines.append(f"  {mapped}: true")

    # Design agents get figma
    if is_design:
        if "webfetch" not in seen:
            lines.append("  webfetch: true")

    return "\n".join(lines) if lines else "  read: true"


def build_permissions(tools: list[str]) -> str | None:
    """Add permissions block if agent uses bash."""
    has_bash = any(t.lower() in ("bash", "bash") for t in tools)
    if has_bash:
        return "permissions:\n  bash: allow\n  edit: allow"
    return None


def replace_agent_tool_references(body: str, agent_name: str) -> str:
    """
    Replace Claude Code Agent() spawn calls with OpenCode @mention guidance.
    Also replaces references to 'Agent tool' with OpenCode subagent syntax.
    """
    # Replace Agent tool call examples in code blocks
    # Pattern: Agent( or Agent tool with subagent_type
    body = re.sub(
        r"Agent\(\s*\n\s+subagent_type:\s*[\"']([^\"']+)[\"']",
        lambda m: f"<!-- OpenCode: @{m.group(1)} [task description] -->",
        body
    )

    # Replace "use the Agent tool" → "use @mention subagent dispatch"
    body = re.sub(
        r'\bAgent tool\b',
        'subagent dispatch (`@agent-name` syntax)',
        body, flags=re.IGNORECASE
    )

    # Replace "Task tool" references
    body = re.sub(
        r'\bTask\b tool\b',
        'subagent dispatch',
        body
    )

    # Replace "Skill tool" → OpenCode's native skill tool
    body = re.sub(
        r'\bSkill tool\b',
        '`skill` tool',
        body, flags=re.IGNORECASE
    )

    # Fix any model references in body text
    for old, new in MODEL_MAP.items():
        body = body.replace(f'model: {old}', f'model: {new}')
        body = body.replace(f'"{old}"', f'"{new}"')

    return body


def inject_superpowers_section(body: str, agent_name: str) -> str:
    """Inject superpowers skills section if not already present."""
    skills = SUPERPOWERS_SKILLS.get(agent_name, [])
    if not skills:
        return body

    if "superpowers" in body.lower():
        return body  # already has superpowers content

    skills_list = "\n".join(f"- `{s}`" for s in skills)
    section = f"""
## Superpowers Skills

Use the `skill` tool to load these skills when the situation calls for them:

{skills_list}

"""
    # Inject after first h2 or at start of body
    h2_match = re.search(r'\n## ', body)
    if h2_match:
        pos = h2_match.start()
        body = body[:pos] + section + body[pos:]
    else:
        body = section + body

    return body


def inject_subagent_note(body: str, agent_name: str) -> str:
    """Inject OpenCode subagent dispatch note for orchestrators."""
    if agent_name not in SUBAGENT_ORCHESTRATORS:
        return body
    if "opencode subagent" in body.lower() or "@mention" in body.lower():
        return body  # already patched

    # Inject before first ## section
    h2_match = re.search(r'\n## ', body)
    if h2_match:
        pos = h2_match.start()
        body = body[:pos] + SUBAGENT_DISPATCH_NOTE + body[pos:]
    else:
        body = SUBAGENT_DISPATCH_NOTE + body
    return body


def inject_figma_note(body: str) -> str:
    """Inject Figma MCP section for design agents."""
    if "figma" in body.lower() and "mcp__figma" in body.lower():
        return body  # already has full figma content
    # Replace old figma tool references with new MCP syntax
    body = body.replace(
        "mcp__figma__get_file",
        "mcp__figma__get_file"
    )
    if "figma" not in body.lower():
        return body

    # Inject figma section
    h2_match = re.search(r'\n## ', body)
    if h2_match:
        pos = h2_match.start()
        body = body[:pos] + FIGMA_NOTE + body[pos:]
    return body


def upgrade_agent(path: Path):
    agent_name = path.stem
    content = path.read_text(encoding="utf-8")
    is_design = agent_name in DESIGN_AGENTS

    fm_raw, body = parse_frontmatter(content)

    # Extract fields
    description = ""
    if fm_raw:
        desc_m = re.search(
            r"^description:\s*(.+?)(?=\n\w|\Z)", fm_raw, re.MULTILINE | re.DOTALL
        )
        if desc_m:
            description = desc_m.group(1).strip().split("\n")[0].strip()

        # Extract tools from existing fm
        old_tools = extract_tools(fm_raw)
    else:
        old_tools = []
        body = content

    # Get correct model
    model = get_model(agent_name)

    # Build new tools block
    tools_yaml = tools_to_yaml(old_tools, agent_name, is_design)

    # Permissions
    permissions = build_permissions(old_tools)

    # Build new frontmatter
    fm_lines = []
    if description:
        if ":" in description and not description.startswith('"'):
            description = f'"{description}"'
        fm_lines.append(f"description: {description}")
    fm_lines.append(f"model: {model}")
    fm_lines.append("tools:")
    fm_lines.append(tools_yaml)
    if permissions:
        fm_lines.append(permissions)

    new_fm = "\n".join(fm_lines)

    # Transform body
    body = replace_agent_tool_references(body, agent_name)
    body = inject_superpowers_section(body, agent_name)
    if agent_name in SUBAGENT_ORCHESTRATORS:
        body = inject_subagent_note(body, agent_name)
    if is_design:
        body = inject_figma_note(body)

    path.write_text(f"---\n{new_fm}\n---\n{body}", encoding="utf-8")


def main():
    files = sorted(AGENTS_DIR.glob("*.md"))
    print(f"Upgrading {len(files)} agents...")
    for f in files:
        upgrade_agent(f)
        agent = f.stem
        extras = []
        if agent in SUBAGENT_ORCHESTRATORS:
            extras.append("subagent-dispatch")
        if agent in DESIGN_AGENTS:
            extras.append("figma-mcp")
        if agent in SUPERPOWERS_SKILLS:
            extras.append(f"superpowers({len(SUPERPOWERS_SKILLS[agent])})")
        tag = f" [{', '.join(extras)}]" if extras else ""
        print(f"  ✓ {agent}{tag}")

    print(f"\nDone. All agents upgraded.")


if __name__ == "__main__":
    main()
