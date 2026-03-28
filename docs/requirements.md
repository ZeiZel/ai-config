# System Requirements

## 1. Purpose

AI Config provides a one-command installation of a complete multi-agent AI development environment. The system must deploy Claude Code agents, MCP servers, RAG infrastructure, and supporting tools globally on the user's machine, making them available in any project directory.

## 2. Functional Requirements

### 2.1 Installation (install.sh)

| ID | Requirement | Priority |
|----|------------|----------|
| FR-001 | Auto-detect OS family (macOS, Debian, RedHat, Arch) | Critical |
| FR-002 | Install git if missing, using appropriate package manager | Critical |
| FR-003 | Clone repository to `~/.ai-config` if not running from repo | Critical |
| FR-004 | Install Ansible if missing | Critical |
| FR-005 | Install Ansible Galaxy collections from `requirements.yml` | High |
| FR-006 | Run Ansible playbook with correct inventory | Critical |
| FR-007 | Refuse to run as root | Critical |
| FR-008 | Support running from cloned repo or via curl one-liner | High |

### 2.2 Claude Code Role (roles/claude/)

| ID | Requirement | Priority |
|----|------------|----------|
| FR-010 | Install Claude Code native binary to `~/.local/bin/claude` | Critical |
| FR-011 | Update existing binary if present | High |
| FR-012 | Bootstrap install via npm if native binary not found | High |
| FR-013 | Clean up npm/bun package leftovers after native install | Medium |
| FR-014 | Create `~/.claude` symlink to repo's `.claude/` directory | Critical |
| FR-015 | Merge existing `~/.claude` contents before replacing | Critical |
| FR-016 | Handle incorrect symlinks (re-create) | High |

### 2.3 AI Infrastructure Role (roles/ai/)

| ID | Requirement | Priority |
|----|------------|----------|
| FR-020 | Check Docker is running, fail with clear message if not | Critical |
| FR-021 | Install uv if missing | High |
| FR-022 | Create data directories for Qdrant | High |
| FR-023 | Pull Qdrant Docker image (pinned version) | Critical |
| FR-024 | Create Qdrant container with resource limits and restart policy | Critical |
| FR-025 | Bind Qdrant to localhost only (127.0.0.1) | Critical |
| FR-026 | Create Qdrant collection with 384-dim cosine vectors | Critical |
| FR-027 | Enable BM25 hybrid search on collection | High |
| FR-028 | Configure int8 quantization for memory efficiency | Medium |
| FR-029 | Wait for Qdrant REST API before proceeding | High |
| FR-030 | Pre-cache MCP server packages via uvx | High |
| FR-031 | Pre-download FastEmbed model | High |
| FR-032 | Register MCP servers at user scope via `claude mcp add` | Critical |
| FR-033 | Install OpenPencil CLI and MCP server | Medium |
| FR-034 | Deploy ccusage statusline wrapper | Medium |
| FR-035 | Run verification checks and print status report | High |
| FR-036 | Remove and re-add MCP servers idempotently | High |

### 2.4 Agent System

| ID | Requirement | Priority |
|----|------------|----------|
| FR-040 | Provide 60+ specialized agent specifications | Critical |
| FR-041 | Enforce agent role boundaries via Constitution.md | Critical |
| FR-042 | Support hierarchical orchestration (team-lead -> sub-orchestrators -> agents) | Critical |
| FR-043 | Route agents to appropriate model tiers (opus/sonnet/haiku) | High |
| FR-044 | Support structured communication protocol (PROGRESS/QUESTION/BLOCKER/DONE/SUGGESTION) | Critical |
| FR-045 | Enforce spawn limits (max 10 concurrent, max 3 depth) | High |
| FR-046 | Support 6 workflow templates (feature/bugfix/hotfix/refactor/docs/prototype) | High |
| FR-047 | Integrate with Beads task management (bd CLI) | High |
| FR-048 | Integrate with Gastown orchestration (gt CLI) for large projects | Medium |

### 2.5 Skills System

| ID | Requirement | Priority |
|----|------------|----------|
| FR-050 | Provide 25+ reusable skills as slash commands | Critical |
| FR-051 | Skills must be invocable from any project directory | Critical |
| FR-052 | Support skill discovery via `/find-skills` | Medium |
| FR-053 | Support custom skill creation via `/agent-creator` | Medium |

### 2.6 Hooks System

| ID | Requirement | Priority |
|----|------------|----------|
| FR-060 | Auto-lint files on write (eslint for JS/TS, ruff for Python) | High |
| FR-061 | Block dangerous commands (rm -rf, force-push to main) | Critical |
| FR-062 | Send OS notifications on agent completion | Medium |
| FR-063 | TTS announcement on session stop (ElevenLabs/OpenAI/pyttsx3) | Low |
| FR-064 | Load Beads state on session start and before compaction | High |
| FR-065 | Log session data on stop | Medium |

### 2.7 Context Strategy

| ID | Requirement | Priority |
|----|------------|----------|
| FR-070 | Support auto/repomix/rag context strategies | High |
| FR-071 | Auto-select strategy based on token count threshold (700k) | High |
| FR-072 | Repomix: read snapshot, extract relevant sections | High |
| FR-073 | RAG: query Qdrant + code-index-mcp with hybrid search | High |
| FR-074 | Target <60k tokens of injected context per agent | Medium |

## 3. Non-Functional Requirements

### 3.1 Performance

| ID | Requirement | Target |
|----|------------|--------|
| NFR-001 | Full install completes (excluding Docker pull) | < 5 minutes |
| NFR-002 | RAG-only install completes | < 3 minutes |
| NFR-003 | Qdrant container memory usage | <= 1 GB |
| NFR-004 | MCP server startup time | < 5 seconds |
| NFR-005 | Embedding model inference | < 100ms per chunk |

### 3.2 Reliability

| ID | Requirement | Target |
|----|------------|--------|
| NFR-010 | Ansible playbook idempotent | Re-run produces same state |
| NFR-011 | Qdrant auto-restart on failure | `unless-stopped` policy |
| NFR-012 | MCP server crash recovery | uvx re-spawns on next call |
| NFR-013 | Graceful degradation without Docker | Skip RAG, use repomix |

### 3.3 Security

| ID | Requirement | Target |
|----|------------|--------|
| NFR-020 | No secrets committed to repository | Zero secrets |
| NFR-021 | Qdrant binds to localhost only | No external access |
| NFR-022 | Pre-approved tools whitelist | Explicit allow-list |
| NFR-023 | Dangerous command blocking | rm -rf, force-push blocked |

### 3.4 Compatibility

| ID | Requirement | Target |
|----|------------|--------|
| NFR-030 | macOS (Apple Silicon + Intel) | Primary platform |
| NFR-031 | Ubuntu/Debian | Supported |
| NFR-032 | Fedora/RHEL/Rocky | Supported |
| NFR-033 | Arch/Manjaro | Supported |
| NFR-034 | Python >= 3.11 (for hooks) | Required |
| NFR-035 | Docker Engine/Desktop | Required for RAG |

## 4. System Dependencies

### Required (install.sh handles)

| Dependency | Installed by | Version |
|-----------|-------------|---------|
| git | OS package manager | any |
| Ansible | OS package manager | core >= 2.15 |
| Docker | Pre-existing | any |

### Required (roles/ai/ handles)

| Dependency | Installed by | Version |
|-----------|-------------|---------|
| uv | curl installer | latest |
| Qdrant | Docker pull | v1.13.2 |
| FastEmbed model | Python download | paraphrase-multilingual-MiniLM-L12-v2 |

### Optional (user installs separately)

| Dependency | Purpose | Install |
|-----------|---------|---------|
| Beads (bd) | Task management | `brew install beads` |
| Gastown (gt) | Multi-agent orchestration | `brew install gastown` |
| Repomix | Context snapshots | `npm install -g repomix` |
| Aider | Pair programming | `pip install aider-chat` |
| bun | Fast JS runtime | `curl -fsSL https://bun.sh/install \| bash` |

## 5. Data Model

### Qdrant Collection: "codebase"

```yaml
vectors:
  dense:
    size: 384
    distance: cosine
    quantization: int8 (q=0.99, always_ram)
  sparse:
    bm25:
      modifier: idf

storage:
  on_disk: true  # vectors and payload
  hnsw:
    on_disk: true
    m: 16
    ef_construct: 100
  memmap_threshold: 20000
  indexing_threshold: 20000
```

### Agent Metadata Schema (Qdrant points)

```yaml
type: "pattern|decision|gotcha|quality-rule|context-pack|post-mortem"
domain: "auth|user|payment|frontend|backend|infra"
agent: "spec-developer|spec-reviewer|..."
project: "project-name"
confidence: 0.0-1.0
created: "ISO-8601 timestamp"
git_hash: "abc123"  # for context-pack invalidation
```
