# AI Config

Multi-platform AI development environment: OpenCode agents, MCP servers, RAG infrastructure.
Compatible with: **OpenCode** (primary), **Claude Code**, **Gemini CLI**, **Codex**.

## Quick Reference

- **Constitution**: `docs/Constitution.md` — mandatory rules for ALL agents
- **Architecture**: `docs/architecture/overview.md` — system architecture spec
- **Requirements**: `docs/requirements.md` — functional & non-functional requirements
- **Tech Stack**: `docs/tech-stack.md` — technology documentation
- **Quality Gates**: `docs/quality-gates.yaml` — workflow quality thresholds
- **Optimization Plan**: `docs/ai-optimization-plan.md` — current improvement roadmap
- **Project Config**: `docs/project.yaml` — full project configuration
- **Agents (OpenCode)**: `.opencode/agent/` — 65 agent specifications
- **Skills (OpenCode)**: `.opencode/skills/` — Superpowers skills (TDD, subagent-driven dev, etc.)
- **Commands**: `.opencode/commands/` — slash-commands
- **Instructions**: `.opencode/instructions/` — global context loaded per session
- **Agents (Claude Code)**: `.claude/agents/` — backward-compatible copies
- **AI Infrastructure**: `roles/ai/` — Ansible role for Qdrant, MCP servers

## Platform Tool Mapping

| Claude Code tool | OpenCode equivalent |
|------------------|---------------------|
| `Skill` tool | `skill` tool (native) |
| `Agent(subagent_type: "x")` | `@x task description` (@mention syntax) |
| `Task` tool | `@mention` subagent dispatch |
| `TodoWrite` | `todowrite` tool |
| `Read`, `Write`, `Edit`, `Bash` | native tools |
| `SendMessage` | `sendmessage` tool |

## Subagent Dispatch (OpenCode)

Spawn subagents using `@mention` syntax. Always provide self-contained context:

```
@spec-developer Implement the auth middleware in src/middleware/auth.ts.
Requirements: JWT validation, role-based access, refresh token rotation.
Files to create: src/middleware/auth.ts, src/middleware/auth.test.ts
Architecture: see docs/artifacts/auth/01-architecture.md
```

For parallel tasks — use `superpowers:dispatching-parallel-agents` skill.
For plan execution — use `superpowers:subagent-driven-development` skill.

## Installation

```bash
# Fresh install (clones repo + runs Ansible)
bash <(curl -fsSL https://raw.githubusercontent.com/ZeiZel/ai-config/master/install.sh)

# From cloned repo
./install.sh

# RAG infrastructure only (Qdrant + MCP)
./setup-ai.sh
```

## Key Commands

```bash
# Task management
bd ready          # Available tasks
bd list           # All tasks
bd create         # New task
bd update --claim # Claim task

# Context
repomix --output docs/context/codebase-snapshot.txt  # Refresh snapshot

# RAG health
curl -s http://localhost:6333/healthz               # Qdrant status
docker start qdrant                                  # Start if stopped
```

## Context Strategy

- **auto** (default): Check snapshot size, use repomix if <=700k tokens, RAG if larger
- **repomix**: Read snapshot, extract relevant sections per agent
- **rag**: Query Qdrant + code-index-mcp for targeted context

## Workflow Templates

| Template | Phases | Quality | Use When |
|----------|--------|---------|----------|
| feature | full pipeline | 95% | New features |
| bugfix | dev -> review -> test | 90% | Bug fixes |
| hotfix | dev -> test | 85% | Critical fixes |
| refactor | arch -> dev -> review -> test | 95% | Refactoring |
| docs | writer -> arch-keeper | review | Documentation |
| prototype | arch -> dev | 75% | Exploration |

## Agent Model Routing

- **anthropic/claude-opus-4-5**: spec-analyst, spec-architect, spec-planner, spec-reviewer, agile-master, senior-frontend/backend/devops-architect, security-architect
- **anthropic/claude-sonnet-4-5**: team-lead, spec-developer, spec-tester, spec-validator + all other implementation agents
- **anthropic/claude-haiku-4-5**: changelog-keeper, boilerplate-generator, regex-helper, readme-generator (mechanical tasks)

## MCP Servers

| Server | Purpose | Enabled |
|--------|---------|---------|
| `context7` | Library documentation lookup | global |
| `docfork` | MIT library docs, no rate limits | global |
| `sequential-thinking` | Complex multi-step reasoning | global |
| `github` | PRs, issues, repos | spec-developer only |
| `figma` | Design files, components, tokens | design agents only |

**Figma setup**: set `FIGMA_ACCESS_TOKEN` env var and set `"enabled": true` for the figma MCP in `opencode.json`.

## Superpowers Skills

Skills from [obra/superpowers](https://github.com/obra/superpowers) are installed in `.opencode/skills/`.
Plugin is auto-loaded via `opencode.json`:

```json
{ "plugin": ["superpowers@git+https://github.com/obra/superpowers.git"] }
```

Key skills and their triggers:
- `superpowers:brainstorming` — before any feature design or creative work
- `superpowers:writing-plans` — when you have a spec and need an implementation plan
- `superpowers:subagent-driven-development` — executing plans with independent tasks
- `superpowers:dispatching-parallel-agents` — 2+ independent tasks in parallel
- `superpowers:test-driven-development` — implementing any feature or fix
- `superpowers:systematic-debugging` — any bug or unexpected behavior
- `superpowers:verification-before-completion` — before claiming work is done
- `superpowers:requesting-code-review` — after completing major feature
- `superpowers:finishing-a-development-branch` — when implementation is complete

## Compaction Rules

When context is compacted, ALWAYS preserve:
- List of modified files and their purpose
- Architectural decisions made during the session
- Test commands and their results
- Open blockers and unresolved questions
- Current task IDs (bd-XXX) and their status
- Workflow template being used (feature/bugfix/hotfix/etc)

## User Preferences

- Language: Russian for communication
- Approach: thorough analysis before implementation
- Shell: zsh with eza, bat, fd, rg, lazygit
