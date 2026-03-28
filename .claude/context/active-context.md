# Active Context

Current state of the ai-config project. Updated by memory-bank-synchronizer or manually.

## Current Focus

- Multi-agent system with 64 agents across 20 categories
- Ansible-based provisioning (macOS/Linux)
- RAG infrastructure: Qdrant + MCP servers

## Recent Changes

<!-- Updated after each workflow completion -->
- Added 5 new developer agents (svelte, golang, nodejs, php, dotnet)
- Added Developer Selection Matrix to senior-frontend-architect and senior-backend-architect
- Evolved /update-ai with agent maintenance capabilities
- Fixed MCP packages: mem0-mcp-server, sequential-thinking, open-pencil

## Active Decisions

<!-- Decisions that affect current work -->
- Model routing: opus for planning (team-lead, analyst, architect, planner, agile-master), sonnet for execution
- Context strategy: auto (repomix <=700k tokens, rag >700k)
- Embedding model: paraphrase-multilingual-MiniLM-L12-v2 (384 dims, RU/EN)

## Known Issues

<!-- Issues to be aware of during development -->
- Qdrant client v1.17.1 warns about incompatibility with server v1.13.2 (minor version diff >1)
- mem0-mcp-server requires MEM0_API_KEY (cloud API, not fully local)
- open-pencil MCP requires bunx (npx can't find executable)

## Blocked Items

<!-- Items waiting on external dependencies -->
- None currently
