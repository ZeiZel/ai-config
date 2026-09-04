# Security policy

At the start of work, load global Beads memory with
`BEADS_DOLT_SHARED_SERVER=1 bd --global prime --memories-only`, then run `bd prime`. If the
repository has no local `.beads/`, initialize it with `bd init` and run `bd prime` again. Keep
tasks in Beads issues, never in markdown TODOs, and never expose PRIVATE memory or credential-file
contents.

Treat hooks and provider permissions as defense in depth. Never read or print `~/.globals`,
`.env*`, private keys, OAuth/auth stores, or complete process environments. Do not use generic
`env` or `printenv` when an injected environment may contain secrets. Vault access goes through
the approved guarded helper and accepts only a credential-file path; never read that file into
agent context.

Use explicit allowlists for MCP environment variables, tools, filesystem roots, and network hosts.
Read-only profiles are the default. Keep Chrome and CuaDriver on isolated profiles and use bounded
capabilities. Require `x5-no-proxy` for corporate/internal CLI targets. Reject broad recursive
deletes, history rewrites, secret dumps, and destructive database operations unless the user has
explicitly authorized the exact target.

Hooks must parse structured provider input and shell tokens, fail closed on high-risk parse errors,
and log only a rule ID, decision, executable class, target class, and timestamp. Never log command
arguments, request bodies, file contents, tool output, tokens, or private memory.
