---
name: subagent-driven-development
description: OpenCode-native plan execution with subagent dispatch. Use when executing implementation plans with independent tasks.
allowed-tools: Read, Write, Edit, Bash, task, todowrite
---

# Subagent-Driven Development (OpenCode)

Execute implementation plans by dispatching independent tasks to specialized subagents.

## OpenCode Dispatch

Use `@agent-name` mention syntax or `task()` function for subagent dispatch:

**Direct `@mention`:**
```
@spec-developer Implement Task 1: auth middleware. Files: src/middleware/auth.ts, src/middleware/auth.test.ts
```

**Programmatic `task()`:**
```typescript
task(
  category="deep",
  load_skills=["backend-dev"],
  description="Implement auth middleware",
  prompt="Task: Implement JWT authentication middleware...",
  run_in_background=true
)
```

## Plan Execution Pattern

1. Load the plan file
2. Identify independent tasks (no shared dependencies)
3. Dispatch each task to the appropriate agent
4. Collect results via `background_output(task_id="...")`
5. Merge and verify

## Prompts for Subagents

Each subagent prompt MUST be:
1. **Self-contained** — All context inline, no session history inheritance
2. **Specific** — Exact files, requirements, acceptance criteria
3. **Constrained** — Clear boundaries of what to change

```
@spec-developer Implement the auth middleware.

Requirements:
- JWT validation with RS256
- Role-based access control
- Refresh token rotation

Files to create:
- src/middleware/auth.ts
- src/middleware/auth.test.ts

Architecture: see docs/architecture/overview.md

Return: Summary of implemented functionality and file paths.
```

## Tool Mapping

| Superpowers Skill Prompt | OpenCode Equivalent |
|-------------------------|---------------------|
| `Task tool (general-purpose): implement task` | `@spec-developer implement task` |
| `Task tool (superpowers:code-reviewer): review code` | `@spec-reviewer review code` |
| Template: `implementer-prompt.md` | See pattern above |
| Template: `spec-reviewer-prompt.md` | `@spec-reviewer review [task name]. Check: security, performance, patterns.` |
| Template: `code-quality-reviewer-prompt.md` | `@spec-reviewer review code quality for [task]. Check: lint, patterns, error handling.` |

For full tool mapping, see: `.opencode/skills/using-superpowers/references/opencode-tools.md`
