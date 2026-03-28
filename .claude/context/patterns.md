# Patterns & Conventions

Established patterns in the ai-config project. Agents should follow these.

## Agent Spec Structure

Every agent `.md` file MUST contain:
1. YAML frontmatter: name, category, description, tools, skills, auto_activate, reports_to, collaborates_with
2. Constitution Reference section
3. Documentation-First section (with llms.txt URLs)
4. Context Protocol section (repomix/rag)
5. Team Communication Protocol section (SendMessage types)
6. Core Engineering Philosophy
7. Code examples with anti-patterns
8. Quality Checklist

## Sub-Orchestrator Pattern

Architects (senior-frontend-architect, senior-backend-architect) are sub-orchestrators:
- Have `orchestrates:` field listing managed agents
- Have `Task` tool for spawning sub-agents
- Include Developer Selection Matrix for choosing which dev to spawn
- Detect framework from project files (package.json, go.mod, composer.json, etc.)
- Send ONE aggregate DONE to team-lead

## MCP Server Registration

- User scope via `claude mcp add-json --scope user`
- uvx for Python packages (qdrant-mcp, code-index-mcp, mem0)
- npx/bunx for Node packages (context7, open-pencil, sequential-thinking)
- HTTP transport for cloud services (context7 alternative)

## Ansible Role Pattern

- Each feature in separate task file (qdrant.yml, mcp-servers.yml, etc.)
- `defaults/main.yml` for all configurable variables
- Templates in `templates/` with Jinja2
- Idempotent operations (check before create)
- Pre-cache packages during install (not at runtime)

## Hook Pattern

- Python hooks use `uv run --script` with inline dependencies
- JSON input via stdin, exit 0 always (never break Claude)
- Safety guards in PreToolUse (bash command filtering)
- Auto-lint in PostToolUse (eslint for JS/TS, ruff for Python)

## Communication Protocol

All agents use SendMessage with structured types:
- PROGRESS: `{%} on {task}. Done: {list}. Remaining: {list}`
- QUESTION: `{q}. Affects: {impact}`
- BLOCKER: `{reason}. Tried: {list}. Need: {ask}. resolution_hint: {code}`
- DONE: `{summary}. Files: {list}. Decisions: {list}. Confidence: {0-1}`
- SUGGESTION: `{observation}. Recommendation: {action}`

## Workflow Templates

| Template | Quality | When |
|----------|---------|------|
| feature | 95% | New features (full pipeline) |
| bugfix | 90% | Bug fixes (dev->review->test) |
| hotfix | 85% | Critical fixes (dev->test) |
| refactor | 95% | Refactoring (arch->dev->review->test) |
| docs | review | Documentation only |
| prototype | 75% | Exploration |
