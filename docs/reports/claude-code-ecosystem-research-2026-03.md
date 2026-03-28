# Research Report: Claude Code Multi-Agent Ecosystem

**Date**: 2026-03-28
**Sources consulted**: 30+

## Executive Summary

The ecosystem around Claude Code multi-agent configurations has exploded since mid-2025. There are now dozens of repositories providing ready-made agent specs, skills, workflows, and orchestration frameworks. Our `ai-config` repository is **more architecturally sophisticated** than nearly every public alternative. The key differentiators are the Constitution.md with formal role boundaries, the sub-orchestrator hierarchy, the Ansible-based deployment, and the integrated RAG infrastructure.

However, we are missing some capabilities that the broader ecosystem now offers: token optimization strategies, persistent memory bank patterns, Claude Code Agent Teams integration, and CI/CD automation.

---

## Key Repositories

### Tier 1: Large Collections

| Repository | Stars | Agents | What it offers |
|-----------|-------|--------|---------------|
| [davila7/claude-code-templates](https://github.com/davila7/claude-code-templates) | 23.7k | 600+ | Web dashboard, 55+ MCP configs, 200+ commands |
| [wshobson/agents](https://github.com/wshobson/agents) | — | 112 | 72 plugins, evaluation system, 16 orchestrators |
| [rohitg00/awesome-claude-code-toolkit](https://github.com/rohitg00/awesome-claude-code-toolkit) | — | 135 | Auto-config by project type, quality scoring |
| [VoltAgent/awesome-claude-code-subagents](https://github.com/VoltAgent/awesome-claude-code-subagents) | — | 100+ | Domain-specific, interactive install |

### Tier 2: Spec-Driven Pipelines (closest to our system)

| Repository | Similarity | Key difference |
|-----------|-----------|----------------|
| [zhsama/claude-sub-agent](https://github.com/zhsama/claude-sub-agent) | **~80%** | Same spec-agent naming. Lacks Constitution, sub-orchestrators, RAG |
| [Pimzino/claude-code-spec-workflow](https://github.com/Pimzino/claude-code-spec-workflow) | ~50% | 4 agents, 60-80% token reduction via caching |
| [aaddrick/claude-pipeline](https://github.com/aaddrick/claude-pipeline) | ~40% | "Fix first, improve later" discipline |
| [github/spec-kit](https://github.com/github/spec-kit) | Complementary | Official GitHub SDD toolkit, 28k stars |

### Tier 3: Orchestration Platforms

| Repository | What it does |
|-----------|-------------|
| [ruvnet/ruflo](https://github.com/ruvnet/ruflo) | Full orchestration platform, 313 MCP tools, consensus protocols |
| [catlog22/Claude-Code-Workflow](https://github.com/catlog22/Claude-Code-Workflow) | JSON-driven workflow engine, dashboard, wisdom accumulation |
| Claude Code Agent Teams (native) | Built-in multi-agent coordination, shared tasks, file locking |

### Tier 4: Reference Configurations

| Repository | Key innovation |
|-----------|---------------|
| [erik-opg/claude-setup](https://github.com/erik-opg/claude-setup) | 94% token savings via on-demand loading |
| [centminmod/my-claude-code-setup](https://github.com/centminmod/my-claude-code-setup) | 6-file memory bank system with synchronizer agent |
| [ChrisWiles/claude-code-showcase](https://github.com/ChrisWiles/claude-code-showcase) | GitHub Actions CI/CD, LSP integration, ticket commands |
| [feiskyer/claude-code-settings](https://github.com/feiskyer/claude-code-settings) | Multi-provider settings, autonomous-skill pattern |

---

## Competitive Position: ai-config vs. Ecosystem

### Where we LEAD

- **Governance formality**: Constitution.md with role boundaries, blocker resolution, spawn limits, circular detection
- **Sub-orchestrator hierarchy**: 4 domain sub-orchestrators with spawn budgets
- **Infrastructure as Code**: Ansible roles for Qdrant, MCP, design tools
- **Project.yaml schema**: Full declarative config (no equivalent elsewhere)
- **Model routing**: Explicit 3-tier opus/sonnet/haiku per agent
- **Agent breadth**: 64 agents across 20 categories with selection matrices

### Where we LAG

- **Token optimization**: No on-demand loading (erik-opg saves 94%)
- **Memory persistence**: Single CLAUDE.md (vs centminmod's 6-file memory bank)
- **Agent Teams**: Not leveraging native Claude Code Agent Teams
- **CI/CD**: No GitHub Actions automation (ChrisWiles does scheduled reviews)
- **Plugin format**: Not packaged as installable plugin
- **Wisdom accumulation**: No cross-session learning persistence

---

## Top 10 Recommendations (Priority Order)

### 1. Memory Bank Pattern (from centminmod)
Split context into focused files: `CLAUDE-activeContext.md`, `CLAUDE-patterns.md`, `CLAUDE-decisions.md`. Add synchronizer agent.

### 2. Token Optimization via Progressive Disclosure (from erik-opg)
On-demand document loading with `@` notation. Move reference docs out of always-loaded context. 90%+ token savings.

### 3. Claude Code Agent Teams Integration
Adapt Constitution.md and team-lead to work with native Agent Teams: shared task list, peer-to-peer messaging, file locking.

### 4. Add Slash Commands for Workflows
Create `/workflow:feature`, `/workflow:bugfix`, `/workflow:hotfix` commands. Model after Pimzino's approach.

### 5. GitHub Actions CI/CD Integration
Scheduled: monthly doc sync, weekly code reviews, bi-weekly dependency audits running Claude Code in CI.

### 6. Package as Claude Code Plugin
Convert `.claude/` to `.claude-plugin` format for distribution via marketplace.

### 7. Wisdom Accumulation (from catlog22)
Persist learnings, decisions, conventions from completed workflows for future sessions.

### 8. Spec-Kit Compatibility
Bridge to GitHub's spec-kit for interoperability with the emerging standard.

### 9. RAG Upgrade
Evaluate `claude-context` (AST-aware chunking, Merkle tree incremental indexing) or `qdrant-rag-mcp` (95% token reduction).

### 10. Plugin Evaluation System (from wshobson)
Score/certify/compare system for agent quality with CI gate support.

---

## Sources

Full source list: 30+ repositories, official docs, educational resources. See detailed report for URLs.
