---
name: agent-creator
description: Create a new agent with interactive wizard - collects specs, researches best practices, generates agent file
allowed-tools: Read, Write, Edit, Bash, Glob, Grep, websearch_web_search_exa, webfetch, task, todowrite
agent: team-lead
---

Create a new agent using the agent-creator skill.

**Arguments**: $ARGUMENTS

## Instructions

Follow the agent-creator skill workflow in `.opencode/skills/agent-creator/SKILL.md`:

1. **Phase 1: Discovery**
   - If arguments provided, use them as the agent name
   - Gather remaining specifications:
     - Category (devops/frontend/backend/spec-agents/analysis/ui-ux/utility)
     - Experience persona and domain expertise
     - Core capabilities (3-5)
     - Activation keywords and conditions
     - Required tools

2. **Phase 2: Research**
   - Use web search to find best practices for the agent's domain
   - Search for: architecture patterns, code conventions, performance tips, security checklists
   - Synthesize findings into actionable principles and code patterns

3. **Phase 3: Generation**
   - Generate the agent file at `.opencode/agents/{category}/{agent-name}.md`
   - Use the full agent template from the skill
   - Include researched best practices, code examples, and checklists
   - Ensure integration with spec-orchestrator workflow

4. **Phase 4: Validation**
   - Verify all frontmatter fields are present and valid
   - Check content quality (code examples, checklists, integration points)
   - Confirm the agent file follows existing patterns

## Output

After creating the agent:
1. Show the file path created
2. Display the frontmatter summary
3. List the core capabilities
4. Confirm integration points with spec-agents