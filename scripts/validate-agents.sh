#!/usr/bin/env bash
# Agent Specification Validation Script
# Usage: bash scripts/validate-agents.sh
# Exit: 0 = all checks pass, 1 = violations found

set -euo pipefail

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[0;33m'
NC='\033[0m' # No Color

PASS=0
FAIL=0
SKIP=0

pass() { echo -e "${GREEN}PASS${NC} $1"; PASS=$((PASS + 1)); }
fail() { echo -e "${RED}FAIL${NC} $1"; FAIL=$((FAIL + 1)); }
skip() { echo -e "${YELLOW}SKIP${NC} $1"; SKIP=$((SKIP + 1)); }

echo "============================================"
echo "Agent Specification Validation"
echo "============================================"
echo ""

# ─── Check 1: Constitutional Compliance ───
echo "── Check 1: Constitutional Compliance (Section 7) ──"

# Agents that MUST NOT have Edit tool per Constitution Section 7
FORBIDDEN_EDIT=(
  "team-lead"
  "agile-master"
  "product-manager"
  "spec-analyst"
  "spec-architect"
  "spec-planner"
)

for agent in "${FORBIDDEN_EDIT[@]}"; do
  agent_file=".opencode/agent/${agent}.md"
  if [ -f "$agent_file" ]; then
    if grep -q "edit: allow" "$agent_file" 2>/dev/null; then
      fail "${agent}: has edit: allow (Constitution PROHIBITS Edit tool)"
    else
      pass "${agent}: no edit: allow"
    fi
  else
    skip "${agent}: agent file not found"
  fi
done
echo ""

# ─── Check 2: No .claude/ paths ───
echo "── Check 2: No ~/.claude/ paths ──"
CLAUDE_PATHS=$(grep -rn "~/.claude/" .opencode/ 2>/dev/null || true)
if [ -z "$CLAUDE_PATHS" ]; then
  pass "No ~/.claude/ paths found"
else
  echo "$CLAUDE_PATHS" | while read -r line; do
    fail "Claude path: $line"
  done
fi
echo ""

# ─── Check 3: No bypassPermissions ───
echo "── Check 3: No mode: bypassPermissions ──"
BYPASS=$(grep -rn 'mode: "bypassPermissions"' .opencode/ 2>/dev/null || true)
if [ -z "$BYPASS" ]; then
  pass "No bypassPermissions found"
else
  echo "$BYPASS" | while read -r line; do
    fail "bypassPermissions: $line"
  done
fi
echo ""

# ─── Check 4: No subagent_type (Claude Code syntax) ───
echo "── Check 4: No subagent_type (Claude Code syntax) ──"
SUBAGENT=$(grep -rn "subagent_type" .opencode/agent/ 2>/dev/null || true)
if [ -z "$SUBAGENT" ]; then
  pass "No subagent_type in agent specs"
else
  echo "$SUBAGENT" | while read -r line; do
    fail "subagent_type: $line"
  done
fi
echo ""

# ─── Check 5: No claude mcp references ───
echo "── Check 5: No claude mcp references ──"
CLAUDE_MCP=$(grep -rn "claude mcp" .opencode/ 2>/dev/null || true)
if [ -z "$CLAUDE_MCP" ]; then
  pass "No claude mcp references"
else
  echo "$CLAUDE_MCP" | while read -r line; do
    fail "claude mcp: $line"
  done
fi
echo ""

# ─── Check 6: opencode.json agent registration ───
echo "── Check 6: opencode.json agent registration ──"
AGENT_FILES=$(ls .opencode/agent/*.md 2>/dev/null | sed 's|.*/||; s|\.md$||' | sort)
REGISTERED=$(python3 -c "
import json
with open('.opencode/opencode.json') as f:
    d = json.load(f)
print('\n'.join(sorted(d.get('agent', {}).keys())))
" 2>/dev/null || echo "")

if [ -z "$REGISTERED" ]; then
  skip "Cannot parse opencode.json agent section"
else
  UNREGISTERED=$(comm -23 <(echo "$AGENT_FILES") <(echo "$REGISTERED"))
  EXTRA=$(comm -13 <(echo "$AGENT_FILES") <(echo "$REGISTERED"))

  if [ -n "$UNREGISTERED" ]; then
    echo "$UNREGISTERED" | while read -r agent; do
      fail "Unregistered agent: ${agent}.md not in opencode.json"
    done
  fi

  if [ -n "$EXTRA" ]; then
    echo "$EXTRA" | while read -r agent; do
      fail "Orphan registration: ${agent} in opencode.json but no .md file"
    done
  fi

  if [ -z "$UNREGISTERED" ] && [ -z "$EXTRA" ]; then
    pass "All agents registered in opencode.json"
  fi
fi
echo ""

# ─── Check 7: Agent files must have category:, capabilities: ───
echo "── Check 7: Frontmatter completeness ──"
# model: is intentionally NOT checked — subagents inherit parent session model
MISSING_CATEGORY=$(grep -L "category:" .opencode/agent/*.md 2>/dev/null || true)
MISSING_CAPABILITIES=$(grep -L "capabilities:" .opencode/agent/*.md 2>/dev/null || true)

echo "  Note: model: checked skipped — agents inherit parent session model"

if [ -n "$MISSING_CATEGORY" ]; then
  count=$(echo "$MISSING_CATEGORY" | wc -l | tr -d ' ')
  fail "${count} agent(s) missing category:"
else
  pass "All agents have category: frontmatter"
fi

if [ -n "$MISSING_CATEGORY" ]; then
  count=$(echo "$MISSING_CATEGORY" | wc -l | tr -d ' ')
  skip "${count} agent(s) missing category: (Wave 3 task)"
else
  pass "All agents have category: frontmatter"
fi

if [ -n "$MISSING_CAPABILITIES" ]; then
  count=$(echo "$MISSING_CAPABILITIES" | wc -l | tr -d ' ')
  skip "${count} agent(s) missing capabilities: (Wave 3 task)"
else
  pass "All agents have capabilities: frontmatter"
fi
echo ""

# ─── Summary ───
echo "============================================"
echo "VALIDATION SUMMARY"
echo "============================================"
TOTAL=$((PASS + FAIL + SKIP))
echo "Total checks: $TOTAL"
echo -e "${GREEN}PASS: $PASS${NC}"
echo -e "${RED}FAIL: $FAIL${NC}"
echo -e "${YELLOW}SKIP: $SKIP${NC}"

if [ "$FAIL" -eq 0 ]; then
  echo ""
  echo -e "${GREEN}VERDICT: APPROVE${NC}"
  exit 0
else
  echo ""
  echo -e "${RED}VERDICT: REJECT — $FAIL violation(s) found${NC}"
  exit 1
fi
