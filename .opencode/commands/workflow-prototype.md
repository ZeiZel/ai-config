---
name: workflow-prototype
description: Rapid exploration pipeline with relaxed quality for prototyping
allowed-tools: Read, Write, Edit, Bash, Glob, Grep, task, todowrite
agent: team-lead
---

# Prototype Workflow

Rapid exploration with relaxed quality.

**Phases**: architect -> developer
**Quality target**: 75%

## When to Use

- Exploring new ideas or technologies
- Building proof-of-concept implementations
- Validating architectural assumptions
- Rapid prototyping before committing to full development

**Do NOT use for**: production features — promote to `/workflow-feature` when ready.

## Steps

1. **Architect phase** — spawn `spec-architect` agent:
   - Quick architecture sketch (no formal spec required)
   - Identify key technical risks and unknowns
   - Define success criteria for the prototype
2. **Development phase** — spawn `spec-developer` agent:
   - Implement proof of concept
   - Focus on learning, not production quality
   - Skip review and validation phases
   - Document findings and trade-offs
3. Close task via `bd close`

## Quality Gate

- **Pass**: Prototype demonstrates the concept works (or doesn't)
- No formal quality gate — this is exploration
- Document what was learned and what should change for production

## Promotion

When the prototype proves viable, promote to `/workflow-feature`:
1. Create a feature specification from prototype findings
2. Archive or discard prototype code
3. Start fresh feature workflow with learned constraints

## Arguments

$ARGUMENTS