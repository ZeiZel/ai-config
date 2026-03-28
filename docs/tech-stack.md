# Tech Stack

## Core Technologies

### Provisioning: Ansible

| Component | Details |
|-----------|---------|
| **Version** | core >= 2.15 |
| **Playbook** | `all.yml` -- 2 roles (claude, ai) |
| **Inventory** | `localhost` with `ansible_connection=local` |
| **Collections** | `community.general >= 12.0.0` |
| **Config** | `ansible.cfg` -- no host key checking, auto Python interpreter |

**Why Ansible**: Idempotent, declarative, cross-platform (macOS/Linux), no agent required for local provisioning. Single `ansible-playbook` command handles install, update, and verification.

### Container Runtime: Docker

| Component | Details |
|-----------|---------|
| **Purpose** | Qdrant vector database |
| **Container** | `qdrant/qdrant:v1.13.2` |
| **Binding** | `127.0.0.1:6333` (REST), `127.0.0.1:6334` (gRPC) |
| **Memory** | 1 GB limit |
| **Restart** | `unless-stopped` |
| **Volumes** | `~/.local/share/qdrant/storage`, `~/.local/share/qdrant/snapshots` |

### Python Tooling: uv

| Component | Details |
|-----------|---------|
| **Purpose** | Run MCP servers via `uvx`, manage Python dependencies for hooks |
| **Install** | `curl -LsSf https://astral.sh/uv/install.sh \| sh` |
| **Path** | `~/.local/bin/uv`, `~/.local/bin/uvx` |
| **Used by** | qdrant-mcp, code-index-mcp, mem0, hooks (stop.py, post_tool_use.py) |

## RAG Infrastructure

### Qdrant Vector Database

| Component | Details |
|-----------|---------|
| **Version** | v1.13.2 (pinned) |
| **Collection** | `codebase` |
| **Dense vectors** | 384 dimensions, cosine distance |
| **Sparse vectors** | BM25 with IDF modifier (hybrid search) |
| **Quantization** | int8, quantile 0.99, always in RAM |
| **HNSW** | m=16, ef_construct=100, on-disk |
| **Storage** | mmap on disk, payload on disk |
| **Thresholds** | memmap: 20k points, indexing: 20k points |

**Why Qdrant**: Native hybrid search (dense + BM25 sparse), Docker-friendly, low memory footprint with int8 quantization, REST/gRPC APIs, MCP server available.

### Embedding Model

| Component | Details |
|-----------|---------|
| **Model** | `sentence-transformers/paraphrase-multilingual-MiniLM-L12-v2` |
| **Dimensions** | 384 |
| **Languages** | 50+ (including Russian and English) |
| **Backend** | FastEmbed (ONNX runtime, no PyTorch needed) |
| **Alternative** | `all-MiniLM-L6-v2` (EN-only, same 384 dims) |
| **Future upgrade** | `nomic-embed-text-v1.5` (768 dims, requires collection recreation) |

**Why this model**: Multilingual support (RU/EN), same 384 dimensions as the EN-only model (drop-in replacement), good quality-to-speed ratio, supported by both sentence-transformers and fastembed.

## MCP Servers

### qdrant-mcp

| Component | Details |
|-----------|---------|
| **Package** | `mcp-server-qdrant` |
| **Transport** | stdio (via uvx) |
| **Tools** | `qdrant-find`, `qdrant-store` |
| **Config** | `QDRANT_URL`, `COLLECTION_NAME`, `EMBEDDING_MODEL` env vars |
| **Purpose** | Semantic search over codebase, knowledge storage/retrieval |

### code-index-mcp

| Component | Details |
|-----------|---------|
| **Package** | `code-index-mcp` |
| **Transport** | stdio (via uvx) |
| **Tools** | `search_code_advanced`, `get_file_summary`, `build_deep_index`, `set_project_path` |
| **Purpose** | Deep code indexing, structural search, file summaries |

### context7

| Component | Details |
|-----------|---------|
| **URL** | `https://mcp.context7.com/mcp` |
| **Transport** | HTTP |
| **Tools** | `resolve-library-id`, `get-library-docs` |
| **Purpose** | Live library documentation -- eliminates hallucinated APIs |

### mem0

| Component | Details |
|-----------|---------|
| **Package** | `mem0-mcp` (via uvx from `mem0ai`) |
| **Transport** | stdio |
| **Tools** | `add-memory`, `search-memory`, `get-memories` |
| **Data** | `~/.local/share/mem0` |
| **Purpose** | Structured agent memory (episodic, semantic, procedural) |

### open-pencil

| Component | Details |
|-----------|---------|
| **CLI** | `@open-pencil/cli` (bun global) |
| **MCP** | `@open-pencil/mcp` (npx) |
| **Transport** | stdio |
| **Purpose** | Open-source design tool with AI MCP integration |

## External Tools

### Beads (bd)

| Component | Details |
|-----------|---------|
| **Purpose** | Task management with DAG dependencies |
| **Key commands** | `bd init`, `bd ready`, `bd list`, `bd create`, `bd update --claim`, `bd close`, `bd dep add`, `bd prime` |
| **Integration** | SessionStart hook (`bd prime`), PreCompact hook (`bd prime`) |
| **Used by** | spec-analyst (creates tasks), execution agents (claim/close), team-lead (tracks) |

### Gastown (gt)

| Component | Details |
|-----------|---------|
| **Purpose** | Multi-agent orchestration for large projects (>50 files) |
| **Key commands** | `gt install .`, `gt rig add`, `gt sling`, `gt convoy create`, `gt feed` |
| **When** | Project has >50 source files or is a monorepo |

### Repomix

| Component | Details |
|-----------|---------|
| **Purpose** | Compressed codebase snapshots for agent context |
| **Output** | `docs/context/codebase-snapshot.txt` |
| **Threshold** | <=700k tokens: use as primary context; >700k: switch to RAG |

### ccusage

| Component | Details |
|-----------|---------|
| **Purpose** | Real-time Claude Code usage tracking in statusline |
| **Wrapper** | `~/.claude/scripts/statusline-usage.sh` |
| **Data** | `~/.claude/session-usage.json` |
| **Displays** | 5h/7d usage %, cost USD, context %, model name |

## Claude Code Configuration

### settings.json

| Section | Details |
|---------|---------|
| **env** | `CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS=1`, `CLAUDE_CODE_MAX_TURNS_AGENT=30`, `MCP_TIMEOUT=30000` |
| **permissions.allow** | git, docker, npm/bun/yarn, python/go/cargo, file utils, testing frameworks |
| **permissions.deny** | `rm -rf` to /dev/sda, `mkfs`, `dd if=/dev/zero` |
| **defaultMode** | `acceptEdits` |
| **hooks** | Notification, PostToolUse, PreCompact, PreToolUse, SessionStart, Stop |
| **statusLine** | ccusage via bash script |
| **effortLevel** | `high` |

### Hooks Architecture

| Hook | Event | Script/Command |
|------|-------|----------------|
| **PostToolUse (Write)** | After file write | eslint --fix (JS/TS), ruff check+format (Python) |
| **PreToolUse (Bash)** | Before shell command | Block rm -rf, force-push to main/master |
| **Notification** | Agent notification | osascript (macOS) / notify-send (Linux) |
| **SessionStart** | Session begins | `bd prime` |
| **PreCompact** | Before compaction | `bd prime` |
| **Stop** | Session ends | `hooks/stop.py` (TTS + logging) |

## File Format Decisions

| Choice | Rationale |
|--------|-----------|
| Ansible YAML | Standard for provisioning, no custom DSL |
| Markdown agents | Human-readable, versionable, no runtime dependency |
| JSON settings | Required by Claude Code |
| YAML project config | Human-friendly, supports complex nesting |
| Jinja2 templates | Ansible-native, variable substitution |
| Python hooks | uv inline scripts, rich stdlib, cross-platform |
