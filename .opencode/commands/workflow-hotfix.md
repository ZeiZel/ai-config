---
name: workflow-hotfix
description: Critical fix pipeline with minimal overhead
allowed-tools: Read, Write, Edit, Bash, Glob, Grep, task, todowrite
agent: team-lead
---

# Hotfix Workflow

Critical fix with minimal overhead.

**Phases**: developer -> tester
**Quality target**: 85%

## When to Use

- Production-critical issues requiring immediate fix
- Security vulnerabilities needing urgent patch
- System outages or data loss risks
- Any issue where speed outweighs thoroughness

**Do NOT use for**: non-critical bugs — use `/workflow-bugfix` instead.

## Steps

1. Identify the critical issue and its scope
2. **Development phase** — spawn `spec-developer` agent:
   - Implement the minimum viable fix
   - Focus on stopping the bleeding, not perfection
   - Claim task via `bd update --claim`
3. **Testing phase** — spawn `spec-tester` agent:
   - Run critical path tests only
   - Verify the fix resolves the immediate issue
   - Confirm no obvious regressions
4. Close task via `bd close`
5. Schedule post-deploy review for a follow-up bugfix workflow

## Quality Gate

- **Pass**: Critical issue resolved, no regressions on critical paths
- Skip code review (schedule post-deploy review later)
- Skip full test suite (run critical path tests only)

## Arguments

$ARGUMENTS