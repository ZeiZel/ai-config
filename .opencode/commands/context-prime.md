---
agent: team-lead
subtask: true
---

Read README.md, THEN run `git ls-files | grep -v -f (sed 's|^|^|; s|$|/|' .cursorignore | psub)` to understand the context of the project