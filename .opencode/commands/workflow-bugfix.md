---
name: workflow-bugfix
description: Shortened bug fix pipeline with targeted quality
allowed-tools: Read, Write, Edit, Bash, Glob, Grep, task, todowrite
agent: team-lead
---

# Bugfix Workflow

Lightweight bug fix with targeted quality.

**Phases**: developer -> reviewer -> tester
**Quality target**: 90%

## When to Use

- Non-critical bug fixes
- Regression fixes
- Issues with clear reproduction steps
- Fixes that don't require architectural changes

## Steps

1. Read `docs/project.yaml` and `docs/Constitution.md`
2. **Development phase** — spawn `spec-developer` agent:
   - Analyze the bug: reproduce, isolate root cause
   - Implement fix with minimal changes
   - Add regression test
   - Claim task via `bd update --claim`
3. **Review phase** — spawn `spec-reviewer` agent:
   - Review fix for correctness and side effects
   - Verify minimal change scope
   - Score against 90% quality gate
4. **Testing phase** — spawn `spec-tester` agent:
   - Run existing tests to confirm no regression
   - Verify the specific bug is fixed
   - Validate the regression test passes
5. Close task via `bd close`

## Quality Gate

- **Pass**: Quality score >= 90% → proceed to completion
- **Fail**: Quality score < 90% → loop back with feedback (max 2 iterations)
- Skip architect/planner phases — focus on root cause analysis and minimal fix

## Arguments

$ARGUMENTS