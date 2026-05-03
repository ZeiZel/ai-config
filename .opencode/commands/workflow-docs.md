---
name: workflow-docs
description: Documentation workflow with writer and architecture-keeper review
allowed-tools: Read, Write, Edit, Bash, Glob, Grep, task, todowrite
agent: team-lead
---

# Docs Workflow

Documentation creation and maintenance with review by architecture-keeper.

**Phases**: technical-writer -> architecture-keeper (review)
**Quality target**: review only (no automated quality gate)

## When to Use

- Creating new documentation (guides, tutorials, API docs)
- Updating existing documentation for accuracy
- Writing architecture decision records (ADRs)
- Documenting processes, runbooks, or onboarding guides
- Updating README or project documentation

## Steps

1. Read `docs/project.yaml` and `docs/Constitution.md` for project context
2. **Writer phase** — spawn `technical-writer` agent:
   - Gather source material from code, specs, and existing docs
   - Draft documentation following project style guide
   - Ensure accuracy by cross-referencing code and specs
   - Include code examples, diagrams (Mermaid), and cross-references
3. **Review phase** — spawn `architecture-keeper` agent:
   - Review for technical accuracy
   - Verify code examples compile/run correctly
   - Check consistency with architecture docs
   - Ensure documentation follows project conventions
4. Finalize documentation and commit

## Quality Standards

- All code examples must be verified against the current codebase
- Architecture diagrams must match actual system structure
- No orphaned references or broken links
- Documentation must follow the project's style guide

## Arguments

$ARGUMENTS