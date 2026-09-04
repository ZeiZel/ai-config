# Guarded Vault workflow

Before any operation, load global Beads memory with
`BEADS_DOLT_SHARED_SERVER=1 bd --global prime --memories-only`, then run `bd prime`. If local
Beads is absent, run `bd init` and `bd prime`; record task state in Beads issues. PRIVATE memory
values and credential-file contents must never enter prompts, logs, files, or responses.

Use the repository's trusted Vault helper for KV v2 operations. First inspect metadata and the
requested path; require an explicit confirmation before writes. Pass the approved credential-file
path directly to the helper. Do not open, parse, decode, interpolate, echo, or store credential
file contents. Do not put Vault values in model context, Beads, logs, generated config, shell
arguments, or commits.

Use least-privilege paths and read-only access by default. Writes must be two-phase (preview,
confirmation, apply), validate the target namespace, and report only the path and operation result.
Deletes, policy changes, token creation, and mount changes are outside this skill and must be
handled manually. If the helper is unavailable, stop and ask for a safe integration; never fall
back to raw `vault kv get` output.
