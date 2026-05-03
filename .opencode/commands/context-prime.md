---
name: context-prime
description: Load project context by reading key files and understanding the codebase structure
allowed-tools: Read, Bash, Glob, Grep, task, todowrite
agent: team-lead
---

Load project context for the current session.

## Steps

1. Read `README.md` for project overview
2. Read `docs/project.yaml` for project configuration
3. Read `docs/Constitution.md` for agent rules
4. Run `git ls-files` to understand the file structure
5. Read key configuration files (package.json, tsconfig, docker-compose, etc.)
6. Summarize the project context for the current session

Focus area: $ARGUMENTS