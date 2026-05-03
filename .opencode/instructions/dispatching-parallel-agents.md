---
name: dispatching-parallel-agents
description: OpenCode-native parallel agent dispatch. Use when facing 2+ independent tasks.
allowed-tools: Read, Write, Edit, Bash, task, todowrite
---

# Parallel Agent Dispatch (OpenCode)

Use when facing 2+ independent tasks that can be worked on without shared state or sequential dependencies.

## OpenCode Dispatch Pattern

**Single agent:**
```
@spec-developer Implement auth middleware. Requirements: JWT validation, role-based access.
```

**Parallel agents (in same message):**
```
@spec-developer Implement auth middleware in src/middleware/auth.ts
@spec-tester Write tests for auth middleware in src/middleware/auth.test.ts
@spec-reviewer Review auth implementation
```

**Programmatic parallel (task function):**
```typescript
task(category="deep", load_skills=[], description="Implement auth", prompt="...", run_in_background=true)
task(category="deep", load_skills=[], description="Write tests", prompt="...", run_in_background=true)
task(category="deep", load_skills=[], description="Review code", prompt="...", run_in_background=true)
```

## When to Use

- 3+ independent tasks (different subsystems)
- Each task can be understood without context from others
- No shared state between tasks
- "Fan-out/fan-in" pattern: parallel work, then merge results

## When NOT to Use

- Tasks are related (fixing one might fix others)
- Need full system context
- Tasks edit same files (will conflict)
- Sequential dependency chain exists

## Agent Prompt Structure

Good agent prompts are:
1. **Focused** — One clear task with specific scope
2. **Self-contained** — All context needed inline
3. **Specific about output** — What should the agent return?

```
@spec-developer Fix the 3 failing tests in src/agents/agent-tool-abort.test.ts.
These are timing/race condition issues. Replace arbitrary timeouts with event-based waiting.
Return: Summary of root cause and changes made.
```

## Verification After Parallel Dispatch

When agents return:
1. Review each summary
2. Check for file conflicts (`git diff`)
3. Run full test suite
4. Verify all fixes work together

## Tool Mapping

| Superpowers Skill (Claude Code) | OpenCode Equivalent |
|-------------------------------|---------------------|
| `Task("Fix test failures")` | `@spec-developer Fix test failures` |
| Multiple `Task()` calls | Multiple `@agent-name` in one message |
| `Task` with `run_in_background: true` | `task(..., run_in_background=true)` |

For full tool mapping, see: `.opencode/skills/using-superpowers/references/opencode-tools.md`
