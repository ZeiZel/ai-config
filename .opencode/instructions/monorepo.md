---
name: monorepo
description: Monorepo architecture and management - Nx, Turborepo, Lerna, pnpm workspaces, module boundaries, workspace validation, CI/CD optimization, monorepo migration
allowed-tools: Read, Write, Edit, MultiEdit, Bash, Glob, Grep, Agent, WebSearch, Task, SendMessage
---

# Monorepo Architecture & Management Skill

Specialist skill for designing, validating, optimizing, and migrating monorepo projects. Primary expertise in Nx with working knowledge of Turborepo, Lerna, pnpm workspaces, Yarn workspaces, and Rush.

## When to Use

- Setting up a new monorepo from scratch or converting a single repo
- Auditing and validating existing monorepo structure
- Configuring or optimizing Nx (nx.json, project.json, module boundaries)
- Fixing build pipeline issues (caching, affected detection, task ordering)
- Migrating between monorepo tools (Turbo→Nx, Lerna→Nx, version upgrades)
- Validating package.json consistency across workspaces
- Setting up CI/CD with affected commands and remote caching
- Enforcing module boundaries with tags and ESLint rules
- Organizing workspace structure (apps/libs, domain-driven, flat)

## Quick Reference

Full agent specification with deep Nx expertise, implementation templates, validation checklists, and migration guides:

```
.claude/agents/devops/monorepo-architect.md
```

Read this file for detailed patterns and templates before performing monorepo work.

## Core Principles

- **Single Source of Truth**: One repo, unified versioning, shared tooling
- **Boundary Enforcement**: Explicit dependency rules via tags and ESLint
- **Computation Caching**: Never rebuild unchanged code (target: 80%+ cache hit rate)
- **Affected Analysis**: Only test/build/deploy impacted workspaces
- **Consistent Conventions**: Shared configs, generators for uniformity

## Monorepo Tool Detection

Identify the monorepo tool first:

| File Present | Tool |
|-------------|------|
| `nx.json` | Nx |
| `turbo.json` | Turborepo |
| `lerna.json` | Lerna |
| `rush.json` | Rush |
| `pnpm-workspace.yaml` (no task runner) | pnpm workspaces only |

## Tool Selection Guide

```
Team < 20, JS/TS, simplicity first        → Turborepo + pnpm
Team 5-50, need generators + boundaries   → Nx + pnpm
Library publishing monorepo               → Lerna (Nx-powered) + pnpm
Enterprise 50+ packages, strict governance → Rush or Nx
Polyglot (Go, Java, Python)              → Nx (custom plugins) or Bazel
```

## Nx Quick Commands

```bash
# Project graph
nx graph                          # Interactive dependency explorer
nx show projects --affected       # List affected projects
nx affected -t test build lint    # Run tasks on affected only

# Generators
nx g @nx/react:app web --directory=apps/web
nx g @nx/node:lib shared-utils --directory=libs/shared/utils
nx g @nx/js:lib types --directory=libs/shared/types

# Caching
nx reset                          # Clear local cache
nx run-many -t build --parallel=5 # Parallel execution with caching

# Module boundaries
nx lint                           # Check boundary violations

# Migration
nx migrate @nx/workspace@latest   # Generate migrations
nx migrate --run-migrations       # Apply migrations

# Release
nx release version                # Bump versions
nx release changelog              # Generate changelog
nx release publish                # Publish to npm
```

## Workspace Structure (Standard Nx)

```
monorepo/
├── apps/
│   ├── web/              # Frontend app
│   ├── api/              # Backend API
│   └── admin/            # Admin dashboard
├── libs/
│   ├── shared/
│   │   ├── utils/        # type:util, scope:shared
│   │   └── types/        # type:util, scope:shared
│   ├── ui/
│   │   └── components/   # type:ui, scope:shared
│   ├── features/
│   │   ├── auth/         # type:feature, scope:auth
│   │   └── user/         # type:feature, scope:user
│   └── data-access/
│       └── api-client/   # type:data-access, scope:shared
├── tools/generators/     # Custom Nx generators
├── nx.json
├── tsconfig.base.json
└── package.json (private: true)
```

## Module Boundary Tags

Apply tags in each `project.json`:
```json
{ "tags": ["scope:shared", "type:util"] }
```

Enforce in root `.eslintrc.json`:
```
type:app        → can import: feature, ui, data-access, util
type:feature    → can import: data-access, ui, util
type:data-access → can import: util
type:ui         → can import: util
type:util       → can import: util only
```

## Package.json Rules

**Root level:**
- `private: true` (always)
- `engines` specified
- `packageManager` pinned
- Scripts use `nx run-many` / `nx affected` (never bypass task runner)

**Workspace level:**
- Scoped names (`@org/package-name`)
- `workspace:*` for internal deps (pnpm)
- build/test/lint scripts present
- No pinned external dependency versions

## Validation Checklist

Run on first entry or after structural changes:

```bash
# Structure
[ ] nx.json or turbo.json present
[ ] All workspaces have package.json with name/version
[ ] tsconfig.base.json has path aliases for all libs
[ ] Lock file committed

# Dependencies
[ ] No circular dependencies (nx graph)
[ ] No phantom dependencies (depcheck)
[ ] Versions aligned (syncpack list-mismatches)

# Build
[ ] Cache enabled for build/test/lint
[ ] Task pipeline has dependsOn configured
[ ] Named inputs separate production from test files

# Boundaries
[ ] @nx/enforce-module-boundaries enabled
[ ] All projects tagged (scope + type)
[ ] depConstraints defined

# CI/CD
[ ] Uses affected commands
[ ] Remote caching configured
[ ] nx-set-shas for base detection
```

## CI/CD with Nx (GitHub Actions)

```yaml
steps:
  - uses: actions/checkout@v4
    with: { fetch-depth: 0 }
  - uses: pnpm/action-setup@v4
  - uses: actions/setup-node@v4
    with: { node-version: 20, cache: pnpm }
  - run: pnpm install --frozen-lockfile
  - uses: nrwl/nx-set-shas@v4
  - run: npx nx affected -t lint test build --parallel=5
```

## Migration Paths

**Single repo → Nx:**
`npx nx@latest init` → move app to `apps/` → extract `libs/` → add boundaries → update CI

**Turborepo → Nx:**
`npx nx init` → map `turbo.json` pipeline to `nx.json` targetDefaults → add boundaries

**Lerna → Nx:**
`npx lerna repair` → add `nx.json` → keep lerna for publishing

**Nx version upgrade:**
`nx migrate @nx/workspace@latest` → review `migrations.json` → `nx migrate --run-migrations` → test → cleanup

## Orchestration

For large monorepo tasks spanning multiple workspaces, spawn workspace-scoped agents:

1. Detect workspace tech stack (React, Node, Go, etc.)
2. Spawn matching developer agent with workspace-scoped context
3. Constrain agent to workspace path and its dependencies
4. Aggregate results and verify cross-workspace consistency

Agent selection: read `.claude/agents/devops/monorepo-architect.md` → Developer Selection Matrix section.

## Key Metrics

- Cache hit rate: 80%+ in CI
- Zero module boundary violations
- CI time: 50%+ reduction vs full builds
- All workspaces: build + test + lint targets with caching
