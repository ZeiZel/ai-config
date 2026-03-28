---
name: update-ai
description: Audit and optimize AI agent system - update specs, find improvements, research new approaches, benchmark agent performance, and evolve the multi-agent architecture.
allowed-tools: Read, Write, Edit, Bash, Glob, Grep, WebSearch, WebFetch, mcp__qdrant-mcp__qdrant-find, mcp__qdrant-mcp__qdrant-store, mcp__code-index-mcp__search_code_advanced, mcp__code-index-mcp__get_file_summary
user_invocable: true
---

# Update AI System

Comprehensive audit and optimization skill for the multi-agent AI development system. Analyzes current agent specs, skills, infrastructure, and workflows to find improvements and implement progressive approaches.

## When to Use

- Periodic AI system health checks (recommended: weekly)
- After adding new agents or skills
- When agent performance degrades or tasks take too long
- When new Claude Code features or MCP servers become available
- When switching to a new project or tech stack
- User asks to improve AI workflows

## Usage

```bash
/update-ai                    # Full audit: specs + tools + suggestions
/update-ai --specs            # Audit agent specifications only
/update-ai --tools            # Check tools and MCP servers
/update-ai --research         # Find new approaches and tools
/update-ai --benchmark        # Analyze agent performance
/update-ai --apply            # Apply recommended improvements
```

## Audit Pipeline

### Phase 1: System Health Check

```bash
# 1. Verify infrastructure
docker ps --filter name=qdrant --format "{{.Status}}"
curl -s http://localhost:6333/healthz
curl -s http://localhost:6333/collections/codebase | jq '.result.points_count'

# 2. Check MCP server availability
# Verify qdrant-mcp, code-index-mcp are responding

# 3. Check tool versions
claude --version 2>/dev/null
repomix --version 2>/dev/null
command -v bd && bd --version 2>/dev/null
command -v gt && gt --version 2>/dev/null
command -v aider && aider --version 2>/dev/null
```

### Phase 2: Agent Spec Audit

Analyze each agent specification for:

**Completeness checklist:**
- [ ] Clear role description with domain expertise
- [ ] Tools list matches Constitution constraints
- [ ] Skills frontmatter references relevant skills
- [ ] Integrated Skills section with usage instructions
- [ ] Context Protocol section (repomix/rag)
- [ ] Team Communication Protocol section
- [ ] Code examples relevant to agent's domain
- [ ] Anti-patterns or common mistakes section

**Consistency checks:**
- [ ] Planning agents have NO Edit tool
- [ ] Execution agents have SendMessage + RAG tools
- [ ] Frontend agents have docs-first mandate
- [ ] All agents reference Constitution
- [ ] Named agent pattern used correctly
- [ ] Beads task management integrated

**Optimization opportunities:**
- Agent prompts too long (>500 lines = likely bloated)
- Redundant instructions across agents (extract to shared skill)
- Missing domain-specific examples
- Outdated code patterns or library references
- Missing error handling guidance

### Phase 3: Skills Audit

For each skill in `.claude/skills/`:

```bash
# List all skills
ls -la .claude/skills/*/SKILL.md

# Check skill references in agents
for skill in $(ls .claude/skills/); do
  echo "=== $skill ==="
  grep -rl "$skill" .claude/agents/ | head -5
done
```

**Check for:**
- Skills not referenced by any agent
- Agents referencing non-existent skills
- Duplicate functionality between skills
- Skills with outdated tool references
- Missing skills for common workflows

### Phase 4: Context Pipeline Audit

```bash
# Check Qdrant collection health
curl -s http://localhost:6333/collections/codebase | jq '{
  points: .result.points_count,
  vectors: .result.vectors_count,
  segments: .result.segments_count,
  status: .result.status
}'

# Check embedding model
# sentence-transformers/all-MiniLM-L6-v2 = 384 dims
# Consider upgrade to: all-mpnet-base-v2 (768 dims) for better quality

# Check repomix snapshot freshness
if [ -f docs/context/codebase-snapshot.txt ]; then
  SIZE=$(wc -c < docs/context/codebase-snapshot.txt)
  TOKENS=$((SIZE / 4))
  AGE=$(( ($(date +%s) - $(stat -f %m docs/context/codebase-snapshot.txt)) / 60 ))
  echo "Snapshot: ${TOKENS} tokens, ${AGE} minutes old"
fi
```

### Phase 5: Research New Approaches

Search for improvements in these categories:

**1. Claude Code ecosystem:**
```
WebSearch("Claude Code new features 2026")
WebSearch("Claude Code MCP servers new")
WebSearch("Claude Code agent teams best practices")
```

**2. Prompt engineering advances:**
```
WebSearch("AI agent prompt optimization techniques 2026")
WebSearch("multi-agent system prompt engineering")
```

**3. RAG and context management:**
```
WebSearch("RAG optimization code search 2026")
WebSearch("code embedding models comparison 2026")
WebSearch("hybrid search keyword semantic code")
```

**4. New MCP servers:**
```
WebSearch("MCP server registry new servers")
WebSearch("Model Context Protocol servers development")
```

**5. Agent orchestration patterns:**
```
WebSearch("AI agent orchestration patterns 2026")
WebSearch("multi-agent communication protocols")
```

## Optimization Categories

### A. Context Efficiency

| Issue | Fix | Impact |
|-------|-----|--------|
| Agents get full snapshot | Smart section extraction per task | -60% tokens |
| Static context packs | Dynamic context based on task type | +30% relevance |
| No context caching | Cache processed packs in Qdrant | -50% prep time |
| One-size-fits-all RAG | Task-specific query templates | +40% recall |
| Stale snapshots | Auto-refresh on git changes | Always fresh |

**Implementation: Smart Context Injection**
```
Instead of:
  team-lead reads full snapshot -> extracts sections -> injects into prompt

Do:
  1. Classify task type (backend/frontend/infra/docs)
  2. Use task-specific file patterns (e.g., backend = services,models,controllers)
  3. Query code-index-mcp for semantically relevant files
  4. Compose minimal context pack (target: <50k tokens per agent)
  5. Include "Context Source" block for self-service RAG
```

### B. Agent Communication

| Issue | Fix | Impact |
|-------|-----|--------|
| Messages are fire-and-forget | Shared artifact files in docs/artifacts/ | Persistent |
| No progress visibility | PROGRESS message type (intermediate results) | Better tracking |
| Knowledge dies with session | Store learnings in Qdrant after each task | Persistent memory |
| No cross-agent context | Shared context file per workflow | Better coherence |

**Implementation: Artifact-Based Communication**
```
docs/artifacts/
  {workflow-id}/
    requirements.md      # spec-analyst output
    architecture.md      # spec-architect output
    task-plan.md         # spec-planner output
    implementation-notes/ # spec-developer notes
    review-report.md     # spec-reviewer output
    test-report.md       # spec-tester output
    validation-report.md # spec-validator output

Each agent reads previous artifacts + writes own output.
Team-lead passes artifact path, not full content.
```

### C. Agent Performance

| Issue | Fix | Impact |
|-------|-----|--------|
| All agents use same model | Use sonnet for simple tasks, opus for complex | -40% cost |
| Agents re-discover patterns each time | Pre-built knowledge base in Qdrant | -30% time |
| No self-check before DONE | Add self-review checklist to each agent | +20% quality |
| Sequential quality gates | Parallel review + test where possible | -40% time |

**Implementation: Model Selection Strategy**
```yaml
model_selection:
  opus:
    - spec-architect (complex design decisions)
    - spec-reviewer (nuanced code analysis)
    - security-architect (security implications)
    - team-lead (orchestration complexity)
  sonnet:
    - spec-developer (implementation)
    - spec-tester (test generation)
    - spec-planner (task breakdown)
    - spec-analyst (requirements)
    - architecture-keeper (docs updates)
  haiku:
    - changelog-keeper (mechanical tasks)
    - boilerplate-generator (template tasks)
    - regex-helper (simple utilities)
```

### D. Knowledge Persistence

| Issue | Fix | Impact |
|-------|-----|--------|
| Agents start from scratch each session | Qdrant knowledge base with past decisions | +50% speed |
| No learning from mistakes | Store post-mortem insights | -30% repeat errors |
| Architecture docs drift from code | Auto-sync after each dev cycle | Always accurate |
| No pattern library | Extract and store proven patterns | +25% consistency |

**Implementation: Knowledge Lifecycle**
```
After each workflow:
1. spec-reviewer stores quality patterns found
2. spec-developer stores implementation patterns
3. architecture-keeper updates architecture docs
4. team-lead stores orchestration learnings
5. All stored via mcp__qdrant-mcp__qdrant-store with metadata tags
```

### E. Workflow Optimization

| Issue | Fix | Impact |
|-------|-----|--------|
| Fixed phase order | Adaptive phases based on task type | -20% overhead |
| Always full quality pipeline | Lightweight mode for small changes | -60% for hotfixes |
| No early failure detection | Pre-validate architecture before coding | -50% rework |
| Manual context strategy | Auto-detect from project.yaml + runtime | Seamless |

**Implementation: Adaptive Workflow Templates**
```yaml
workflow_templates:
  full:        # New feature: analyst -> architect -> planner -> dev -> review -> test -> validate
  lightweight:  # Bug fix: dev -> review -> test
  hotfix:       # Critical fix: dev -> test (skip review)
  refactor:     # Refactoring: architect -> dev -> review -> test
  docs-only:    # Documentation: technical-writer -> architecture-keeper
  prototype:    # Exploration: architect -> dev (relaxed quality)
```

## Report Format

After audit, produce report:

```markdown
# AI System Audit Report

## Date: {date}

## Health Status
- Infrastructure: {OK/WARN/FAIL}
- MCP Servers: {OK/WARN/FAIL}
- RAG Pipeline: {OK/WARN/FAIL}
- Tools: {OK/WARN/FAIL}

## Agent Specs
- Total agents: {count}
- Compliant: {count}
- Issues found: {count}
- {list of issues with severity}

## Skills
- Total skills: {count}
- Orphaned skills: {list}
- Missing skills: {recommendations}

## Context Pipeline
- Qdrant points: {count}
- Embedding model: {current} -> {recommended}
- Snapshot strategy: {current}

## Recommendations (Priority Order)
1. {Critical: immediate action}
2. {Important: next sprint}
3. {Nice-to-have: backlog}

## New Approaches Found
- {tool/technique}: {description}, {applicability}
```

## Auto-Apply Mode

With `--apply` flag, automatically implement safe improvements:

1. Fix agent spec inconsistencies (missing sections, wrong tools)
2. Add missing skill references
3. Update outdated code examples
4. Create missing project.yaml
5. Refresh Qdrant index
6. Update Constitution with new rules

**Never auto-apply:**
- Agent deletion or major restructuring
- Quality gate threshold changes
- Infrastructure changes
- New MCP server installation

## Phase 6: Agent Evolution & Maintenance

### Framework Version Tracking

Check for new major versions of frameworks that agents support. When new versions are detected, propose agent spec updates.

```bash
# Check latest versions of key frameworks
echo "=== Frontend Frameworks ==="
npm view react version 2>/dev/null
npm view next version 2>/dev/null
npm view vue version 2>/dev/null
npm view @angular/core version 2>/dev/null
npm view svelte version 2>/dev/null
npm view @sveltejs/kit version 2>/dev/null
npm view astro version 2>/dev/null

echo "=== Backend Frameworks ==="
# Go: check go.dev for latest
curl -sL "https://go.dev/VERSION?m=text" 2>/dev/null | head -1
npm view @nestjs/core version 2>/dev/null
npm view fastify version 2>/dev/null
npm view hono version 2>/dev/null
npm view elysia version 2>/dev/null

echo "=== UI Libraries ==="
npm view @mui/material version 2>/dev/null
npm view antd version 2>/dev/null
npm view @mantine/core version 2>/dev/null
```

**For each outdated agent spec:**
1. Compare agent's documented patterns with latest framework docs
2. Identify deprecated APIs, new features, changed best practices
3. Propose specific edits to the agent spec
4. If `--apply`: apply safe updates automatically

### New Agent Detection

Scan project ecosystem for frameworks/tools that don't have a matching agent:

```bash
# Check if project uses a framework without a dedicated agent
for pkg in $(cat package.json 2>/dev/null | jq -r '.dependencies // {} | keys[]' 2>/dev/null); do
  case "$pkg" in
    svelte|@sveltejs/kit)
      [ -f .claude/agents/frontend/svelte-developer.md ] || echo "MISSING: svelte-developer agent"
      ;;
    remix|@remix-run/*)
      [ -f .claude/agents/frontend/remix-developer.md ] || echo "SUGGEST: remix-developer agent"
      ;;
    solid-js)
      [ -f .claude/agents/frontend/solidjs-developer.md ] || echo "SUGGEST: solidjs-developer agent"
      ;;
    @nestjs/*)
      [ -f .claude/agents/backend/nodejs-developer.md ] || echo "MISSING: nodejs-developer agent"
      ;;
    # Add more framework detection rules...
  esac
done
```

**When a missing agent is detected:**
1. Report the gap with framework details
2. Suggest creating a new agent via `/agent-creator`
3. If `--apply`: offer to run `/agent-creator` automatically

### Agent Spec Quality Scoring

Score each agent spec on these criteria (0-100):

| Criterion | Weight | Check |
|-----------|--------|-------|
| Frontmatter complete | 15% | name, category, description, tools, skills, auto_activate, reports_to |
| Constitution reference | 10% | Links to Constitution.md, key rules listed |
| Documentation-first | 10% | Framework docs URLs, mandatory reading instructions |
| Context protocol | 10% | repomix/rag strategy sections |
| Communication protocol | 10% | SendMessage types documented |
| Code examples | 15% | Modern patterns, anti-patterns, real-world examples |
| Quality checklist | 10% | Pre-completion checklist present |
| Selection logic (architects) | 10% | Developer selection matrix (sub-orchestrators only) |
| Working methodology | 10% | Clear phases, collaboration patterns |

```bash
# Quick quality scan
for agent in .claude/agents/**/*.md; do
  echo "=== $(basename $agent) ==="
  score=0
  grep -q "^name:" "$agent" && score=$((score + 15))
  grep -q "Constitution" "$agent" && score=$((score + 10))
  grep -q "Documentation-First\|llms.txt\|llms-full.txt" "$agent" && score=$((score + 10))
  grep -q "Context Protocol" "$agent" && score=$((score + 10))
  grep -q "Communication Protocol\|SendMessage" "$agent" && score=$((score + 10))
  grep -c '```' "$agent" | awk '{if ($1 >= 4) print "code_examples: yes"}' && score=$((score + 15))
  grep -q "checklist\|Checklist" "$agent" && score=$((score + 10))
  grep -q "Selection Matrix\|selection" "$agent" && score=$((score + 10))
  grep -q "Methodology\|methodology\|Working" "$agent" && score=$((score + 10))
  echo "Score: $score/100"
done
```

### Ecosystem Monitoring

Research new tools, MCP servers, and agent patterns:

```
WebSearch("Claude Code new MCP servers {current_year}")
WebSearch("Claude Code agent patterns best practices {current_year}")
WebSearch("multi-agent AI development tools new {current_year}")
WebSearch("Claude Code plugins new releases")
```

**Evaluate each finding:**
- Does it solve a gap in our current system?
- Can it replace an existing tool more efficiently?
- Is it mature enough for production use?
- What's the integration effort?

### Constitution Compliance Check

Verify all agents follow Constitution.md rules:

```bash
# Check tool restrictions
for agent in .claude/agents/spec-agents/spec-analyst.md .claude/agents/spec-agents/spec-planner.md; do
  grep -q "Edit" "$agent" && echo "VIOLATION: $(basename $agent) has Edit tool (planning agent)"
done

# Check sub-orchestrators have Task tool
for agent in senior-frontend-architect senior-backend-architect senior-devops-architect security-architect; do
  grep -q "Task" ".claude/agents/*/$agent.md" 2>/dev/null || echo "VIOLATION: $agent missing Task tool"
done

# Check all execution agents have SendMessage
for agent in .claude/agents/frontend/*.md .claude/agents/backend/*.md; do
  grep -q "SendMessage" "$agent" || echo "VIOLATION: $(basename $agent) missing SendMessage"
done
```

### Update Report with Evolution Recommendations

After full audit, add evolution section to report:

```markdown
## Agent Evolution Recommendations

### New Agents Needed
- {framework}: {justification}, priority: {HIGH/MEDIUM/LOW}

### Agent Spec Updates
- {agent-name}: {what to update}, {why}

### Framework Version Updates
- {agent} references {old-version} patterns, current is {new-version}
- Breaking changes: {list}
- New features to document: {list}

### MCP Server Updates
- {server}: {new version available / new server to add}

### Architectural Improvements
- {improvement}: {description}, impact: {HIGH/MEDIUM/LOW}
```

## Integration with Other Skills

- **/directives**: Read/update project.yaml settings
- **/rag-context**: Audit and optimize RAG pipeline
- **/repomix-snapshot**: Check snapshot freshness and strategy
- **/code-search**: Verify search capabilities work
- **/team-comms**: Validate communication protocol compliance
- **/agent-creator**: Create new agents when gaps are detected
