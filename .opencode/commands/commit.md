---
name: commit
description: Create well-formatted commits with conventional commit messages
allowed-tools: Read, Bash, Glob, Grep, task, todowrite
agent: spec-developer
---

# Commit Command

Create well-formatted commits with conventional commit messages and emoji.

## Usage

```
/commit
/commit --no-verify
```

## What This Command Does

1. Checks which files are staged with `git status`
2. If 0 files are staged, automatically adds all modified and new files with `git add`
3. Performs a `git diff` to understand what changes are being committed
4. Analyzes the diff to determine if multiple distinct logical changes are present
5. If multiple distinct changes are detected, suggests breaking the commit into multiple smaller commits
6. For each commit, creates a message using emoji conventional commit format

## Best Practices for Commits

- **Verify before committing**: Ensure code is linted, builds correctly, and documentation is updated
- **Atomic commits**: Each commit should contain related changes that serve a single purpose
- **Split large changes**: If changes touch multiple concerns, split them into separate commits
- **Conventional commit format**: Use the format `<type>: <description>` where type is one of:
  - `feat`: A new feature
  - `fix`: A bug fix
  - `docs`: Documentation changes
  - `style`: Code style changes (formatting, etc)
  - `refactor`: Code changes that neither fix bugs nor add features
  - `perf`: Performance improvements
  - `test`: Adding or fixing tests
  - `chore`: Changes to the build process, tools, etc.
- **Present tense, imperative mood**: Write commit messages as commands (e.g., "add feature" not "added feature")
- **Concise first line**: Keep the first line under 72 characters

## Emoji Reference

| Emoji | Type | Description |
|-------|------|-------------|
| ✨ | feat | New feature |
| 🐛 | fix | Bug fix |
| 📝 | docs | Documentation |
| 💄 | style | Formatting/style |
| ♻️ | refactor | Code refactoring |
| ⚡️ | perf | Performance improvements |
| ✅ | test | Tests |
| 🔧 | chore | Tooling, configuration |
| 🚀 | ci | CI/CD improvements |
| 🗑️ | revert | Reverting changes |
| 🚨 | fix | Fix compiler/linter warnings |
| 🔒️ | fix | Fix security issues |
| 🏗️ | refactor | Architectural changes |
| 🚚 | refactor | Move or rename resources |
| 🏷️ | feat | Add or update types |
| 🩹 | fix | Simple non-critical fix |
| 🦺 | feat | Add validation code |
| 🔥 | fix | Remove code or files |
| 🎨 | style | Improve structure/format |

## Guidelines for Splitting Commits

When analyzing the diff, consider splitting commits based on:

1. **Different concerns**: Changes to unrelated parts of the codebase
2. **Different types of changes**: Mixing features, fixes, refactoring, etc.
3. **File patterns**: Changes to different types of files (source code vs documentation)
4. **Logical grouping**: Changes that would be easier to understand or review separately
5. **Size**: Very large changes that would be clearer if broken down

## Arguments

$ARGUMENTS