---
name: workflow-refactor
description: Code refactoring pipeline with behavior preservation and quality gates
allowed-tools: Read, Write, Edit, Bash, Glob, Grep, task, todowrite
agent: team-lead
---

# Refactor Workflow

Code improvement with behavior preservation.

**Phases**: architect -> developer -> reviewer -> tester
**Quality target**: 95%

## When to Use

- Restructuring code without changing behavior
- Improving code maintainability and readability
- Extracting patterns, reducing duplication
- Migrating to new APIs or patterns
- Performance optimization that preserves semantics

## Steps

1. Read `docs/project.yaml` and `docs/Constitution.md`
2. **Architect phase** — spawn `spec-architect` agent:
   - Analyze current code structure
   - Design target architecture
   - Plan incremental refactoring steps
   - Identify risk areas and invariants to preserve
3. **Development phase** — spawn `spec-developer` agent:
   - Implement refactoring incrementally (one change at a time)
   - Run tests after each step
   - If tests fail, revert and try differently
   - Claim task via `bd update --claim`
4. **Review phase** — spawn `spec-reviewer` agent:
   - Verify behavior is preserved (no functional changes)
   - Check code quality and maintainability improvements
   - Score against 95% quality gate
5. **Testing phase** — spawn `spec-tester` agent:
   - Run full test suite — ensure zero behavioral changes
   - Verify type checker passes
   - Check for new linter warnings
6. Update architecture docs if structure changed
7. Close task via `bd close`

## Quality Gate

- **Pass**: Quality score >= 95%, all tests pass, zero behavioral changes
- **Fail**: Quality score < 95% or behavioral changes detected → loop back (max 3 iterations)
- **Critical invariant**: Behavior MUST be preserved. Any functional change = failed refactor.

## Arguments

$ARGUMENTS