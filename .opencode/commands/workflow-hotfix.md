---
agent: team-lead
subtask: true
---

# Hotfix Workflow

Critical fix with minimal overhead.

**Phases**: developer -> tester
**Quality target**: 85%

## Steps

1. Identify the critical issue
2. Implement the minimum viable fix
3. Run critical path tests only
4. Skip code review (post-deploy review later)

For production-critical issues only. Use `/workflow-bugfix` for non-critical bugs.

## Arguments

$ARGUMENTS
