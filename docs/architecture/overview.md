# Architecture Overview

## System Purpose

AI Config is an Ansible-managed provisioning system that deploys a complete multi-agent AI development environment. It transforms any machine into an AI-assisted development workstation by installing Claude Code agents, MCP servers, RAG infrastructure, and supporting tools -- all globally available via a `~/.claude` symlink.

## High-Level Architecture

```
+-----------------------------------------------------------------------+
|                          User's Machine                                |
|                                                                        |
|  +------------------+    symlink    +-----------------------------+    |
|  |   ~/.claude/     | -----------> |  ai-config/.claude/         |    |
|  |   (global config)|              |  (this repository)          |    |
|  +------------------+              +-----------------------------+    |
|         |                          | agents/ skills/ hooks/      |    |
|         |                          | commands/ settings.json     |    |
|         v                          +-----------------------------+    |
|  +------------------+                                                  |
|  | Claude Code CLI  |  reads ~/.claude on every session start         |
|  | (~/.local/bin/   |                                                  |
|  |  claude)         |                                                  |
|  +--------+---------+                                                  |
|           |                                                            |
|           | spawns agents, calls MCP tools                             |
|           v                                                            |
|  +------------------+  +------------------+  +-------------------+    |
|  | MCP Servers      |  | External Tools   |  | Docker            |    |
|  | (user scope)     |  |                  |  |                   |    |
|  | - qdrant-mcp     |  | - bd (Beads)     |  | - Qdrant v1.13.2  |    |
|  | - code-index-mcp |  | - gt (Gastown)   |  |   port 6333/6334  |    |
|  | - context7       |  | - repomix        |  |   1GB memory      |    |
|  | - mem0           |  | - aider          |  +-------------------+    |
|  | - open-pencil    |  +------------------+                           |
|  +------------------+                                                  |
+-----------------------------------------------------------------------+
```

## Component Architecture

### 1. Ansible Provisioning Layer

```
all.yml (playbook)
  |
  +-- roles/claude/           # Claude Code binary management
  |   +-- Install/update native binary
  |   +-- Cleanup npm/bun package leftovers
  |   +-- Create ~/.claude -> ai-config/.claude symlink
  |
  +-- roles/ai/               # RAG + MCP infrastructure
      +-- prerequisites.yml   # Docker check, uv install, data dirs
      +-- qdrant.yml          # Pull image, create container, init collection
      +-- mcp-servers.yml     # Pre-cache uvx packages, download embedding model
      +-- open-pencil.yml     # Install CLI + pre-cache MCP
      +-- configure.yml       # Register all MCP servers via `claude mcp add`
      +-- ccusage.yml         # Deploy statusline wrapper
      +-- verify.yml          # Health check and status report
```

**Key design decisions:**
- MCP servers registered at **user scope** (not per-project) for global availability
- Qdrant pinned to specific version (`v1.13.2`) for deterministic builds
- Embedding model pre-downloaded during install to avoid runtime delays
- Container binds to `127.0.0.1` only (no external access)

### 2. Agent Hierarchy

```
team-lead (orchestrator, opus)
  |
  +-- PLANNING LAYER (sequential, opus — deep reasoning)
  |   +-- spec-analyst (opus) --> requirements.md, user-stories.md, Beads tasks
  |   +-- spec-architect (opus) -> architecture.md, tech decisions, REQUIRED AGENTS LIST
  |   +-- agile-master (opus) --> phased execution plan, workflow template selection
  |   +-- spec-planner (opus) --> tasks.md, implementation-plan.md, test-plan.md
  |
  +-- SUB-ORCHESTRATION LAYER (domain routing, sonnet — execution focus)
  |   +-- senior-frontend-architect (sonnet)
  |   |   manages: react-developer, vue-frontend-engineer,
  |   |            angular-frontend-engineer, open-pencil-designer
  |   |
  |   +-- senior-backend-architect (sonnet)
  |   |   manages: database-architect, api-designer,
  |   |            realtime-specialist, search-specialist, payments-specialist
  |   |
  |   +-- senior-devops-architect (sonnet)
  |   |   manages: deployment-engineer, devops-troubleshooter
  |   |
  |   +-- security-architect (sonnet)
  |       manages: compliance-officer
  |
  +-- EXECUTION LAYER (parallel, max 4 per sub-orchestrator)
  |   +-- spec-developer, domain specialists (sonnet)
  |   +-- Claim tasks via `bd update --claim`
  |   +-- Self-service context via RAG tools
  |
  +-- QUALITY LAYER (parallel then sequential)
  |   +-- Phase 1 (parallel): spec-reviewer + spec-tester
  |   +-- Phase 2 (sequential): spec-validator (reads both reports)
  |
  +-- DOCUMENTATION LAYER
      +-- architecture-keeper updates living docs
```

**Spawn limits:**
- team-lead: max 10 concurrent agents
- Sub-orchestrators: max 4 concurrent agents each
- Max nesting depth: 3 levels (team-lead -> sub-orchestrator -> agent)
- Agents spawned by sub-orchestrators CANNOT spawn further agents

### 3. MCP Server Architecture

```
Claude Code Process
  |
  +-- stdio -----> qdrant-mcp (uvx mcp-server-qdrant)
  |                  |
  |                  +-- HTTP --> Qdrant REST API (localhost:6333)
  |                  |            Collection: "codebase"
  |                  |            Dense: 384-dim cosine + int8 quantization
  |                  |            Sparse: BM25 IDF (hybrid search)
  |                  |
  |                  +-- FastEmbed --> paraphrase-multilingual-MiniLM-L12-v2
  |                                   (384 dims, 50+ languages)
  |
  +-- stdio -----> code-index-mcp (uvx code-index-mcp)
  |                  Local code indexing, AST-aware search
  |
  +-- HTTP ------> context7 (https://mcp.context7.com/mcp)
  |                  Live library documentation lookup
  |
  +-- stdio -----> mem0 (uvx mem0-mcp)
  |                  Structured agent memory (episodic/semantic/procedural)
  |
  +-- stdio -----> open-pencil (npx @open-pencil/mcp)
                     Design tool with AI integration
```

### 4. Data Flow: Agent Workflow

```
User Request
  |
  v
team-lead
  |
  +--[1]--> preflight-checker (verify RAG, MCP, tools)
  |
  +--[2]--> Load context (repomix snapshot OR RAG query)
  |
  +--[3]--> spec-analyst --> requirements.md + Beads tasks (bd create)
  |
  +--[4]--> spec-architect --> architecture.md + REQUIRED AGENTS LIST
  |
  +--[5]--> agile-master --> phased plan + workflow template
  |
  +--[6]--> spec-planner --> implementation-plan.md
  |
  +--[7]--> EXECUTION (parallel via sub-orchestrators)
  |         Each agent:
  |           1. Claims task (bd update --claim)
  |           2. Gets context pack from team-lead
  |           3. Self-service RAG for additional context
  |           4. Sends PROGRESS updates
  |           5. Sends DONE with files, decisions, confidence
  |           6. Closes task (bd close)
  |
  +--[8]--> QUALITY (parallel: reviewer + tester, then validator)
  |         If score < 95%: iterate (max 3 cycles)
  |
  +--[9]--> architecture-keeper updates docs
  |
  v
User receives result
```

### 5. Context Strategy

```
Project Size Assessment
  |
  +-- repomix --output snapshot.txt
  |
  +-- Count tokens (size / 4)
  |
  +-- Decision:
      |
      +-- <= 700k tokens --> strategy: "repomix"
      |   Read snapshot, extract relevant sections per agent
      |
      +-- > 700k tokens --> strategy: "rag"
          Query Qdrant (semantic) + code-index-mcp (structural)
          Hybrid search: dense (0.6) + BM25 sparse (0.4)
```

**Context layers per agent:**
1. **Always** (~5k tokens): Project overview, architecture summary, coding standards
2. **Task-specific** (~20-40k tokens): Relevant module code, tests, API specs
3. **On-demand** (lazy): Full file reads via RAG self-service tools

**Context budget rules:**
- Target: <60k tokens of injected context per agent
- At 70% context fill: precision drops, be selective
- At 85%: hallucinations increase, compact aggressively
- At 90%+: responses become erratic, clear mandatory

### 6. Hooks Architecture

```
Claude Code Event System
  |
  +-- SessionStart -----> bd prime (load Beads state)
  +-- PreCompact -------> bd prime (preserve task state before compaction)
  +-- PreToolUse(Bash) -> Safety guard (block rm -rf, force-push)
  +-- PostToolUse(Write) -> Auto-lint (eslint for JS/TS, ruff for Python)
  +-- Notification ------> OS notification (osascript/notify-send)
  +-- Stop --------------> TTS announcement + session logging
```

**Hook scripts:**
- `hooks/stop.py` -- TTS via ElevenLabs/OpenAI/pyttsx3, LLM-generated messages
- `hooks/post_tool_use.py` -- Tool usage logging
- `hooks/notification.py` -- Custom notification handling
- `hooks/subagent_stop.py` -- Subagent completion tracking

### 7. Security Model

**Permission boundaries:**
- Pre-approved: git, docker, npm/bun/yarn, language runtimes, file utilities, testing
- Blocked: `rm -rf`, `mkfs`, `dd if=/dev/zero`, force-push to main/master
- Default mode: `acceptEdits` (auto-approve file edits, prompt for everything else)

**Agent role boundaries (Constitution.md):**
- team-lead: NEVER writes code, only orchestrates
- Planning agents: NO Edit tool, work with docs only
- Execution agents: Must claim tasks before working
- Sub-orchestrators: Cannot spawn outside their domain
- Max 3 nesting levels, max 10 concurrent agents per team-lead

**Infrastructure security:**
- Qdrant binds to `127.0.0.1` only (no external access)
- No secrets in repo (GITHUB_TOKEN via env var)
- .gitignore excludes all runtime/cache directories

## Cross-Platform Support

```
install.sh
  |
  +-- detect_os()
      |
      +-- darwin ----> Homebrew (git, ansible)
      +-- debian ----> apt (git, ansible via PPA)
      +-- redhat ----> dnf (git, ansible via EPEL)
      +-- arch ------> pacman (git, ansible)
```

All Ansible tasks use platform-agnostic modules where possible, with OS-specific fallbacks for package installation.
