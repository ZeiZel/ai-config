---
name: workflow-feature
description: Full feature development pipeline with quality gates
allowed-tools: Read, Write, Edit, Bash, Glob, Grep, task, todowrite
agent: team-lead
---

# Feature Workflow

Full-pipeline feature development with quality gates.

**Phases**: analyst -> architect -> agile-master -> developer -> reviewer + tester -> validator
**Quality target**: 95%

## When to Use

- New feature development requiring full specification
- Features with cross-cutting concerns or architectural impact
- Production-ready features that need comprehensive testing
- Any feature where requirements need formal analysis first

## Steps

1. Read `docs/project.yaml` and `docs/Constitution.md`
2. **Analyst phase** — spawn `spec-analyst` agent:
   - Analyze requirements, create user stories
   - Produce requirement documents
   - Create Beads tasks via `bd create`
3. **Architect phase** — spawn `spec-architect` agent:
   - Design system architecture
   - Make technical decisions
   - Produce architecture docs and API specs
4. **Planning phase** — spawn `agile-master` agent:
   - Divide work into execution phases
   - Set priorities and identify parallel execution groups
   - Select this workflow template
5. **Development phase** — spawn `spec-developer` agent:
   - Implement features based on specs and architecture
   - Claim tasks via `bd update --claim`
   - Follow project coding standards
6. **Review phase** — spawn `spec-reviewer` agent:
   - Code review for quality, security, and best practices
   - Score against 95% quality gate
7. **Testing phase** — spawn `spec-tester` agent:
   - Generate comprehensive test suite
   - Run all tests and report coverage
8. **Validation phase** — spawn `spec-validator` agent:
   - Final quality check
   - If score < 95%, loop back to analyst with feedback (max 3 iterations)
   - If score >= 95%, close tasks via `bd close`

## Quality Gate

- **Pass**: Quality score >= 95% → proceed to completion
- **Fail**: Quality score < 95% → loop back with feedback (max 3 iterations)
- **Escalate**: After 3 failed iterations, escalate to user

## Arguments

$ARGUMENTS