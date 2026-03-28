# Wisdom Accumulation

Learnings, conventions, and insights captured from completed workflows. Updated by agents after task completion.

## How It Works

After each workflow completion, team-lead instructs agents to capture insights:
1. **spec-reviewer** stores quality patterns found
2. **spec-developer** stores implementation patterns and library gotchas
3. **architecture-keeper** stores architecture decisions
4. **team-lead** stores orchestration learnings

Insights are stored both here (for quick reference) and in Qdrant (for semantic search).

## Captured Insights

### Infrastructure

- **mem0-mcp-server** is the correct PyPI package name (not `mem0-mcp`). Requires `MEM0_API_KEY` cloud API key. (2026-03-28)
- **open-pencil** MCP binary is `openpencil-mcp`, must use `bunx` not `npx` (npx can't determine executable). (2026-03-28)
- **sequential-thinking** correct package: `@modelcontextprotocol/server-sequential-thinking` (not `@anthropic/...`). (2026-03-28)
- **FastEmbed** model cache can break (ONNX file missing). Fix: move broken cache, re-download via `TextEmbedding(model_name=...)`. (2026-03-28)
- **Qdrant client** v1.17.1 warns about server v1.13.2 incompatibility but works. Consider upgrading Qdrant image. (2026-03-28)

### Ansible

- `when:` conditionals with string-in-string checks must use parentheses: `('value' in var.stdout)` not `"'value' in var.stdout"`. Ansible 2.20+ enforces boolean results. (2026-03-28)

### Agent Design

- Sub-orchestrators MUST have Developer Selection Matrix documenting how they choose which developer to spawn. Without it, selection is implicit and unreliable. (2026-03-28)
- Agent specs under 100 lines lack sufficient code examples. Target 700-900 lines for implementation agents with real-world patterns. (2026-03-28)

### Workflow

- Hook `PreToolUse(Bash)` blocks `rm -rf` — use `mv` to temp instead. Also blocks `git push` to main/master. (2026-03-28)
- `bd prime` runs on SessionStart and PreCompact to preserve task state across compactions. (2026-03-28)

---

*Add new insights below this line. Include date and category.*
