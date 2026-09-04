---
name: beads
description: "Use global Beads memory and a local Beads database for durable project work."
---

# Beads workflow

Use `bd` as the durable task tracker. Do not replace it with markdown TODOs or a second tracker.

At the start of work, load private machine memory without printing it:

```bash
BEADS_DOLT_SHARED_SERVER=1 bd --global prime --memories-only
```

Then run `bd prime`, inspect `bd ready` and `bd list --status=in_progress`. If the global Dolt
server is unavailable, start it with `BEADS_DOLT_SHARED_SERVER=1 bd dolt start` and retry. Never
copy PRIVATE memory values into files, logs, prompts, arguments, or responses. Credential files
are references only: pass an approved path to a trusted helper and never read their contents.

Initialize project-local Beads with `bd init` when it is absent, then run `bd prime`. Claim an
existing issue or create one before non-trivial work. Record verified architecture facts with
stable `bd remember --key` keys; task state belongs to issues, not memories. Close issues only
after validation and report remaining blockers as new issues.
