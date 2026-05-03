# OpenCode Tool Mapping

Skills use Claude Code tool names. When you encounter these in a skill, use your OpenCode equivalent:

| Skill references | OpenCode equivalent |
|-----------------|---------------------|
| `Read` (file reading) | `read` |
| `Write` (file creation) | `write` |
| `Edit` (file editing) | `edit` |
| `Bash` (run commands) | `bash` |
| `Grep` (search file content) | `grep` |
| `Glob` (search files by name) | `glob` |
| `Skill` tool (invoke a skill) | `skill` |
| `WebFetch` | `webfetch` |
| `Task` tool (dispatch subagent) | `@agent-name task description` (see [Subagent Dispatch](#subagent-dispatch)) |
| Multiple `Task` calls (parallel) | Multiple `@agent-name` mentions in a single message |
| Task status/output | `background_output(task_id="...")` |
| `TodoWrite` (task tracking) | `todowrite` |
| `WebSearch` | `websearch_web_search_exa` |
| `EnterPlanMode` / `ExitPlanMode` | No equivalent — use `todowrite` for planning |

## Subagent Dispatch

OpenCode uses `@mention` syntax for subagent dispatch:

```
# Single agent
@spec-developer Implement the auth middleware in src/middleware/auth.ts

# Parallel agents (in same message)
@spec-developer Implement auth middleware
@spec-tester Write tests for auth middleware
@spec-reviewer Review auth implementation
```

### Background Execution

Use `run_in_background: true` for parallel tasks:

```typescript
task(
  subagent_type="explore",
  load_skills=[],
  description="Find auth patterns",
  prompt="Search for auth patterns in src/",
  run_in_background=true
)
```

### Agent Types

OpenCode supports multiple agent dispatch mechanisms:

| Claude Code agent | OpenCode equivalent |
|-------------------|---------------------|
| `general-purpose` | `task(category="...", ...)` |
| `Explore` | `task(subagent_type="explore", ...)` |
| `Librarian` | `task(subagent_type="librarian", ...)` |
| `Oracle` | `task(subagent_type="oracle", ...)` |
| Named plugin agents (e.g. `superpowers:code-reviewer`) | Use spec- agents: `spec-reviewer`, `spec-developer`, etc. |

### Agent Categories (OpenCode-specific)

| Category | Use for |
|----------|---------|
| `visual-engineering` | Frontend, UI/UX, design, styling, animation |
| `ultrabrain` | Hard logic, architecture decisions, algorithms |
| `deep` | Autonomous research + end-to-end implementation |
| `quick` | Trivial tasks - single file changes, typo fixes |
| `unspecified-low` | Tasks that don't fit other categories, low effort |
| `unspecified-high` | Tasks that don't fit other categories, high effort |
| `writing` | Documentation, prose, technical writing |

## OpenCode-Specific Tools

| Tool | Purpose |
|------|---------|
| `todowrite` | Create and manage structured task lists |
| `skill` | Load a skill or execute a slash command |
| `background_output` | Get output from background task |
| `background_cancel` | Cancel running background task |
| `lsp_diagnostics` | Get errors/warnings from language server |
| `lsp_goto_definition` | Jump to symbol definition |
| `lsp_find_references` | Find ALL usages of a symbol |
| `ast_grep_search` | Search code patterns with AST-aware matching |
| `ast_grep_replace` | Replace code patterns with AST-aware rewriting |
| `playwright_browser_*` | Browser automation tools (navigate, click, screenshot, etc.) |

## Platform Detection

To detect if running in OpenCode:
- Check for `opencode.json` in workspace root
- Check for `.opencode/` directory structure (agent/, commands/, instructions/, skills/)
- The environment variable `OPENCODE_SESSION` may be present

## Common Patterns

### Before (Claude Code):
```typescript
Task(
  subagent_type: "spec-developer",
  name: "dev-auth-api",
  model: "anthropic/claude-sonnet-4-5",
  // Note: OpenCode does not use mode/bypassPermissions — included here for reference only
  mode: "bypassPermissions",     // ← Claude Code only, not applicable to OpenCode
  prompt: "Implement auth middleware"
)
```

### After (OpenCode):
```
@spec-developer Implement auth middleware.
Context: JWT validation, role-based access, refresh token rotation.
```

### Before (Claude Code - parallel):
```typescript
Task("Fix agent-tool-abort.test.ts failures")
Task("Fix batch-completion-behavior.test.ts failures")
```

### After (OpenCode - parallel):
```
@spec-developer Fix agent-tool-abort.test.ts failures. Replace timeouts with event-based waiting.
@spec-tester Fix batch-completion-behavior.test.ts failures. Fix event structure bug.
```
