# Architectural Decisions Log

Key decisions made during development. Agents should respect these.

## ADR-001: Model Routing Strategy (2026-03-28)

**Decision**: Opus for planning/architecture, Sonnet for code/execution, Haiku for mechanical tasks.

**Context**: Need to balance quality with token economy. Planning agents (spec-analyst, spec-architect, spec-planner, agile-master) need deep reasoning. Code-writing agents need speed and volume.

**Opus agents**: team-lead, spec-analyst, spec-architect, spec-planner, agile-master
**Sonnet agents**: All developers, reviewers, testers, architects (senior-*), validators
**Haiku agents**: changelog-keeper, boilerplate-generator, regex-helper, readme-generator

## ADR-002: Embedding Model Choice (2026-03-22)

**Decision**: `paraphrase-multilingual-MiniLM-L12-v2` (384 dims)

**Context**: Previous model `all-MiniLM-L6-v2` was EN-only, scored 0 on Russian queries. New model supports 50+ languages, same 384 dimensions (no collection recreation needed). RU search: 0 -> 0.65-0.77 score.

**Future**: If quality insufficient, upgrade to `nomic-embed-text-v1.5` (768 dims, requires new collection).

## ADR-003: MCP Server Scope (2026-03-28)

**Decision**: RAG/code servers at user scope, project-specific servers in .mcp.json

**User scope** (global, all projects): qdrant-mcp, code-index-mcp, context7, mem0, open-pencil
**Project scope** (.mcp.json): sequential-thinking, github, project-specific servers

**Rationale**: RAG infrastructure is shared across projects. Project MCP servers (GitHub, Playwright) need per-project config.

## ADR-004: Sub-Orchestrator Architecture (2026-03-28)

**Decision**: 4 domain sub-orchestrators with spawn budgets

**Context**: Flat team-lead -> agent pattern doesn't scale. Sub-orchestrators make domain decisions, resolve domain blockers, aggregate results.

- senior-frontend-architect: React/Vue/Angular/Svelte devs + designer (max 4)
- senior-backend-architect: Go/Node/PHP/.NET devs + domain specialists (max 4)
- senior-devops-architect: deployment + troubleshooting (max 2)
- security-architect: compliance (max 2)

**Constraint**: Max 3 nesting depth (team-lead -> sub-orch -> agent). Agents at depth 3 CANNOT spawn.

## ADR-005: Developer Selection by Framework Detection (2026-03-28)

**Decision**: Architects detect project framework from files and spawn matching developer.

**Frontend**: package.json -> react/vue/angular/svelte -> matching developer
**Backend**: go.mod/package.json/composer.json/*.csproj -> go/node/php/dotnet developer

**Fallback**: React for frontend, Node.js for backend if detection fails.

## ADR-006: Memory Bank Pattern (2026-03-28)

**Decision**: Split context into focused files instead of monolithic CLAUDE.md

**Files**:
- `active-context.md` — current state, recent changes, known issues
- `patterns.md` — established conventions and patterns
- `decisions.md` — architectural decision records
- `environment.md` — user's dev environment and available tools

**Rationale**: Smaller, focused files are more reliably followed by agents. Each file stays under context budget. Updated independently.

## ADR-007: Ansible Over Manual Setup (2026-03-21)

**Decision**: Use Ansible for all provisioning, no manual install instructions.

**Rationale**: Idempotent, cross-platform (macOS/Linux), declarative, versionable. Single `./install.sh` handles fresh install and updates. Roles separate concerns (claude binary vs AI infrastructure).
