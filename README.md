# AI Config

Ansible-managed multi-agent AI development environment for Claude Code. One command installs 60+ specialized agents, 25+ skills, MCP servers, RAG infrastructure (Qdrant), design tools (OpenPencil), task management (Beads), and multi-agent orchestration (Gastown) -- globally available in any project.

## What This Does

```
~/.claude/ -> symlink to this repo's .claude/
```

After installation, every `claude` session on your machine has access to:

- **60+ agents** -- from team-lead orchestrator to specialized frontend/backend/devops/security engineers
- **25+ skills** -- `/teamlead`, `/implement`, `/debug`, `/test`, `/pr-review`, `/research`, and more
- **MCP servers** -- Qdrant (RAG), code-index-mcp (semantic search), Context7 (live docs), Mem0 (agent memory), OpenPencil (design)
- **Hooks** -- auto-lint on write, TTS on completion, OS notifications, safety guards
- **Statusline** -- real-time usage tracking via ccusage

## Quick Start

### Fresh install (one command)

```bash
bash <(curl -fsSL https://raw.githubusercontent.com/ZeiZel/ai-config/master/install.sh)
```

### From cloned repo

```bash
git clone https://github.com/ZeiZel/ai-config.git ~/.ai-config
cd ~/.ai-config
./install.sh
```

### RAG infrastructure only

```bash
./setup-ai.sh
```

## What Gets Installed

### `install.sh` -- Full Setup

Runs two Ansible roles sequentially:

| Role | What it does |
|------|-------------|
| `roles/claude/` | Installs Claude Code binary, creates `~/.claude` symlink to this repo |
| `roles/ai/` | Docker + Qdrant, MCP servers (qdrant-mcp, code-index-mcp, context7, mem0), OpenPencil, ccusage statusline |

### `setup-ai.sh` -- RAG Only

Runs `ansible-playbook all.yml --tags ai` -- skips Claude binary install, only sets up the AI infrastructure.

## Architecture

```
ai-config/
|
+-- install.sh                  # Bootstrap: git + ansible + playbook
+-- setup-ai.sh                 # RAG-only installer
+-- all.yml                     # Main playbook (roles: claude, ai)
+-- ansible.cfg                 # Ansible config
+-- inventory/hosts.ini         # localhost
+-- group_vars/all.yml          # Shared variables
+-- requirements.yml            # Ansible Galaxy collections
|
+-- roles/
|   +-- claude/                 # Role: Claude Code binary + config symlink
|   |   +-- tasks/main.yml      # Install/update binary, symlink ~/.claude
|   |   +-- defaults/main.yml
|   |
|   +-- ai/                     # Role: RAG + MCP infrastructure
|       +-- tasks/
|       |   +-- main.yml        # Orchestrates sub-tasks
|       |   +-- prerequisites.yml   # Docker, uv, data dirs
|       |   +-- qdrant.yml      # Qdrant container + collection
|       |   +-- mcp-servers.yml # Pre-cache MCP packages
|       |   +-- open-pencil.yml # OpenPencil CLI + MCP
|       |   +-- configure.yml   # Register MCP servers via `claude mcp add`
|       |   +-- ccusage.yml     # Statusline usage tracker
|       |   +-- verify.yml      # Health check report
|       +-- defaults/main.yml   # All configurable variables
|       +-- templates/
|           +-- qdrant-collection.json.j2   # Collection schema (384-dim, cosine, BM25)
|           +-- statusline-usage.sh.j2      # ccusage wrapper
|
+-- .claude/                    # Claude Code configuration (symlinked to ~/.claude)
|   +-- agents/                 # 60+ agent specifications
|   |   +-- team-lead.md        # Main orchestrator
|   |   +-- spec-agents/        # Spec-driven pipeline (8 agents)
|   |   +-- frontend/           # React, Vue, Angular, architecture, standards
|   |   +-- backend/            # Senior backend architect
|   |   +-- devops/             # DevOps architect, troubleshooter, deployment
|   |   +-- security/           # Security architect, compliance
|   |   +-- data/               # Database architect, data engineer
|   |   +-- documentation/      # Technical writer, API docs, changelog
|   |   +-- research/           # Web researcher, trend watcher, competitor analyst
|   |   +-- orchestration/      # Agile master, release manager, preflight
|   |   +-- dev-tools/          # Regex, SQL, git, migrations, dependencies
|   |   +-- everyday/           # Email, meetings, decisions, learning, priorities
|   |   +-- domain/             # Payments, search, realtime
|   |   +-- ui-ux/              # UI/UX master, OpenPencil designer
|   |   +-- mobile/             # React Native
|   |   +-- ai/                 # ML engineer
|   |   +-- product/            # Product manager, growth engineer
|   |   +-- quality/            # Performance engineer
|   |   +-- architecture/       # API designer
|   |   +-- analysis/           # Data analyst
|   |   +-- utility/            # Code reviewer, refactorer
|   |
|   +-- skills/                 # 25+ reusable skill definitions
|   |   +-- teamlead/           # Multi-agent orchestration
|   |   +-- project-setup/      # Project onboarding wizard
|   |   +-- agent-creator/      # Agent creation wizard
|   |   +-- agent-workflow/     # Automated pipeline
|   |   +-- beads-tasks/        # bd CLI integration
|   |   +-- gastown-orchestrate/ # gt CLI integration
|   |   +-- rag-context/        # Qdrant + code-index search
|   |   +-- repomix-snapshot/   # Codebase snapshots
|   |   +-- code-search/        # Multi-layer search
|   |   +-- team-comms/         # Agent communication protocol
|   |   +-- ...                 # research, docs, devops, etc.
|   |
|   +-- commands/               # Slash commands (/commit, /test, /debug, etc.)
|   +-- hooks/                  # Event hooks (stop, post_tool_use, notification)
|   +-- context/                # Environment context for agents
|   +-- settings.json           # Permissions, hooks, statusline, env vars
|   +-- templates/              # .mcp.json template for new projects
|   +-- docs/                   # Internal documentation (agents catalog, skills catalog)
|
+-- docs/                       # Project documentation
|   +-- Constitution.md         # Mandatory rules for ALL agents
|   +-- project.yaml            # Project configuration
|   +-- ai-optimization-plan.md # Improvement roadmap
|   +-- architecture/           # Architecture specs
|   +-- reports/                # Research reports
|   +-- research/               # Research findings
|
+-- CLAUDE.md                   # Project instructions for Claude Code
```

## Agent System

### Hierarchy

```
User
  |
  +-- team-lead (opus) -- pure orchestrator, never writes code
      |
      +-- Planning (opus -- deep reasoning for specs/architecture)
      |   +-- spec-analyst (opus) -- requirements, user stories, creates tasks
      |   +-- spec-architect (opus) -- system design, tech decisions
      |   +-- agile-master (opus) -- phases, priorities, workflow selection
      |   +-- spec-planner (opus) -- task breakdown, implementation plan
      |
      +-- Sub-Orchestrators (sonnet -- code-level execution)
      |   +-- senior-frontend-architect (sonnet) -- manages React/Vue/Angular devs
      |   +-- senior-backend-architect (sonnet) -- manages DB/API/realtime specialists
      |   +-- senior-devops-architect (sonnet) -- manages deployment/troubleshooting
      |   +-- security-architect (sonnet) -- manages compliance
      |
      +-- Execution (parallel, via sub-orchestrators)
      |   +-- spec-developer (sonnet) -- implementation
      |   +-- [domain agents] (sonnet) -- specialized work
      |
      +-- Quality (parallel)
      |   +-- spec-reviewer (opus) -- code review
      |   +-- spec-tester (sonnet) -- tests
      |   +-- spec-validator (sonnet) -- final check
      |
      +-- Documentation
          +-- architecture-keeper (sonnet) -- living docs
```

### Model Routing

| Model | Agents | Use case |
|-------|--------|----------|
| **opus** | team-lead, spec-analyst, spec-architect, spec-planner, agile-master | Planning, specs, architecture |
| **sonnet** | developers, testers, reviewers, senior-*-architects, security | Code writing, execution, reviews |
| **haiku** | changelog, boilerplate, regex, readme | Mechanical, template-based |

### Communication Protocol

All agents use `SendMessage` with structured message types:

| Type | When | Format |
|------|------|--------|
| PROGRESS | Long tasks | `PROGRESS: {%} on {task}. Done: {list}` |
| QUESTION | Ambiguity | `QUESTION: {q}. Affects: {impact}` |
| BLOCKER | Cannot proceed | `BLOCKER: {reason}. Tried: {list}. Need: {ask}` |
| DONE | Complete | `DONE: {summary}. Files: {list}. Confidence: {0-1}` |
| SUGGESTION | Insight | `SUGGESTION: {observation}. Recommendation: {action}` |

### Workflow Templates

| Template | Phases | Quality Gate |
|----------|--------|-------------|
| **feature** | analyst -> architect -> agile-master -> dev -> review -> test -> validate | 95% |
| **bugfix** | dev -> review -> test | 90% |
| **hotfix** | dev -> test | 85% |
| **refactor** | architect -> dev -> review -> test | 95% |
| **docs** | writer -> architecture-keeper | review |
| **prototype** | architect -> dev | 75% |

## MCP Servers

Installed at **user scope** (available in all projects):

| Server | Purpose | Backend |
|--------|---------|---------|
| **qdrant-mcp** | Vector search, knowledge storage | Qdrant (Docker) |
| **code-index-mcp** | Deep code indexing, semantic search | Local index |
| **context7** | Live library documentation | HTTP API |
| **mem0** | Structured agent memory | Local SQLite |
| **open-pencil** | AI-driven design tool | npx |

### Per-Project MCP

Copy `.claude/templates/.mcp.json.template` to your project as `.mcp.json` for project-specific servers (GitHub, Playwright, etc.).

## Integrated Tools

| Tool | Command | Purpose |
|------|---------|---------|
| **Beads** | `bd` | Task management with DAG dependencies |
| **Gastown** | `gt` | Multi-agent orchestration for large projects |
| **Repomix** | `repomix` | Codebase context snapshots |
| **Aider** | `aider` | AI pair programming |
| **ccusage** | statusline | Real-time Claude Code usage tracking |

## Context Strategy

| Strategy | When | How |
|----------|------|-----|
| **auto** | Default | Check snapshot size, auto-select |
| **repomix** | <=700k tokens | Read snapshot, extract relevant sections |
| **rag** | >700k tokens | Query Qdrant + code-index-mcp |

Configured per-project in `docs/project.yaml` -> `context.strategy`.

## Hooks

| Hook | Trigger | Action |
|------|---------|--------|
| **PostToolUse (Write)** | After file write | Auto-lint (eslint/ruff) |
| **PreToolUse (Bash)** | Before shell commands | Block `rm -rf`, force-push to main |
| **Notification** | Agent completion | OS notification (macOS/Linux) |
| **Stop** | Session end | TTS announcement, log session |
| **SessionStart** | Session begins | Load Beads context (`bd prime`) |
| **PreCompact** | Before context compaction | Preserve task state (`bd prime`) |

## Settings

Key settings in `.claude/settings.json`:

- **Permissions**: Pre-approved tools (git, docker, npm, language runtimes, etc.)
- **Safety guards**: Blocks `rm -rf`, force-push to main/master
- **Environment**: Agent teams enabled, 30-turn agent limit, MCP 30s timeout
- **Default mode**: `acceptEdits` -- auto-approve file edits

## Skills Reference

### Development
`/teamlead` `/implement` `/debug` `/refactor` `/test` `/commit`

### Quality
`/pr-review` `/security-audit` `/audit` `/simplify`

### Research & Planning
`/research` `/design` `/decide` `/docs` `/learn`

### Project Management
`/project-setup` `/onboard` `/changelog` `/readme` `/migrate`

### Domain
`/backend-dev` `/devops` `/ai-product-dev` `/analytics` `/system-design`

### Agent System
`/agent-creator` `/agent-workflow` `/directives` `/update-ai` `/find-skills`

## Configuration

### Ansible Variables (`roles/ai/defaults/main.yml`)

| Variable | Default | Description |
|----------|---------|-------------|
| `qdrant_enabled` | `true` | Deploy Qdrant container |
| `qdrant_tag` | `v1.13.2` | Qdrant image version |
| `qdrant_memory_limit` | `1g` | Container memory limit |
| `qdrant_mcp_embedding_model` | `paraphrase-multilingual-MiniLM-L12-v2` | Embedding model (RU/EN) |
| `qdrant_hybrid_search_enabled` | `true` | BM25 sparse vectors |
| `code_index_mcp_enabled` | `true` | Code indexing MCP |
| `context7_mcp_enabled` | `true` | Library docs MCP |
| `mem0_enabled` | `true` | Agent memory MCP |
| `open_pencil_enabled` | `true` | Design tool |
| `ccusage_enabled` | `true` | Usage statusline |

### Qdrant Collection Schema

- **Dense vectors**: 384-dim, cosine distance, int8 quantization
- **Sparse vectors**: BM25 with IDF modifier (hybrid search)
- **Storage**: mmap on disk, quantized vectors in RAM
- **HNSW**: m=16, ef_construct=100

## Health Checks

```bash
# Qdrant
curl -s http://localhost:6333/healthz
docker start qdrant  # if stopped

# MCP servers
claude mcp list

# Beads
bd list

# Repomix
repomix --version
```

## Supported Platforms

| Platform | Package Manager | Status |
|----------|----------------|--------|
| macOS | Homebrew | Primary |
| Ubuntu/Debian | apt | Supported |
| Fedora/RHEL | dnf | Supported |
| Arch Linux | pacman | Supported |

## Key Documents

| Document | Path | Purpose |
|----------|------|---------|
| Constitution | `docs/Constitution.md` | Mandatory rules for ALL agents |
| Optimization Plan | `docs/ai-optimization-plan.md` | Improvement roadmap |
| Architecture | `docs/architecture/overview.md` | System architecture spec |
| Tech Stack | `docs/tech-stack.md` | Technology documentation |
| Requirements | `docs/requirements.md` | System requirements |
| Project Config | `docs/project.yaml` | Project-level configuration |
| Agent Catalog | `.claude/docs/agents/README.md` | All agents with descriptions |
| Skills Catalog | `.claude/docs/skills/README.md` | All skills with usage |

## License

Private repository.
