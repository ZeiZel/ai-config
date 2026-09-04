---
name: project-init
description: "Prepare a repository with spec-kit, Beads, selected skills, MCP profiles, and managed instructions."
---

# Project initialization

Start by loading global Beads memory with `BEADS_DOLT_SHARED_SERVER=1 bd --global prime
--memories-only`, then run `bd prime`. Initialize local Beads with `bd init` when the target
repository has no `.beads/`, and run `bd prime` afterward. Keep work in Beads issues; never copy
PRIVATE memory values or credential-file contents into project files, prompts, logs, or responses.

Invoke the repository's `ai-config init --target <project>` entrypoint. Claude, OpenCode, and Gemini may expose the
skill as `/project-init`; Codex uses `$project-init`. A provider's native `/init` must not be
shadowed. The command is idempotent and should show a plan before changing a non-empty repository.

1. Detect the Git root from the current or selected nested directory, validate providers/profiles, inspect managed state, and preflight every required executable without invoking it.
2. Validate selected external catalog entries against the immutable lock. On a real run, copy the pinned `package.json`, `bun.lock`, and `bunfig.toml` into isolated staging, run Bun's frozen install with scripts disabled, verify the direct `skills@1.5.23` package tuple, then invoke the verified absolute skills CLI through Bun with `--no-env-file --no-install`.
3. Run each pinned Spec Kit integration in staging. Volatile timestamps are compared semantically so a second init stays stable.
4. Check the shared Dolt server with output suppressed using `BEADS_DOLT_SHARED_SERVER=1 bd dolt status`; start it only when status reports it unavailable, retry status, then load global Beads memory with `BEADS_DOLT_SHARED_SERVER=1 bd --global prime --memories-only` and run local `bd prime`. Arbitrary prime failures propagate. If local Beads is absent, run non-interactive `bd init` with agent/provider generation and hooks disabled. Spec Kit and Bun use isolated temporary HOME/XDG/cache environments; no package-manager configuration is created or inherited.
5. Only after all external steps succeed, publish base skills and the selected profile through the hash-managed installer.
6. Add only explicitly selected project-safe MCP profiles. Browser, YouTrack, Obsidian, and desktop profiles are opt-in; Obsidian requires the official CLI (>=1.12.7), an exact selector, and an exact canonical `OBSIDIAN_VAULT_ROOT`. CuaDriver and Docker remain unavailable until their separately verified runtime prerequisites are approved. Raw Vault MCP is quarantined; use the trusted host helper.
7. Create or update only the managed section of the selected providers' instruction files; preserve all user-authored instructions.
8. Write `.ai-config/state.json` with content hashes and managed paths.
9. Run `ai-config doctor --target <project>`, generation checks, MCP smoke tests, and a second dry-run. Close the Beads issue only after all checks pass.

Use `--dry-run`, `--providers`, `--profiles`, `--mcp-profiles`, `--approve-mcp`, `--approve-external`, `--no-mcp`, `--no-spec-kit`, and
`--no-beads` to make init intent explicit. Repair and managed uninstall are separate commands:
`ai-config repair` and `ai-config uninstall-managed`. The CLI does not create/claim/close a project
issue because issue naming and ownership require an agent or human decision; follow the local Beads
workflow after initialization. The lifecycle starts Dolt only after status reports it unavailable;
it does not restart the service for arbitrary prime failures.

`--target` is mandatory for project initialization, including `--dry-run`. `--no-mcp` is a reconciliation operation for selected providers: it removes only ai-config's
namespaced MCP entries or managed TOML section from a previously managed config and preserves
unrelated user entries. It does not disable or delete user-owned MCP servers.

External update provenance is published as managed `.ai-config/external-lock.json`. Update the
reviewed source in `ai-specs/external/lock.yaml` and repeat init; do not treat the temporary
skills CLI `skills-lock.json` as a project update source.

Beads initialization intentionally persists `.beads/`, a local `.git/info/exclude` update, and
possibly a root `.gitignore` change. It disables Beads' provider/AGENTS generation so it cannot
overwrite ai-config managed skills. These Beads-owned effects are reported but are not claimed as
rollback-safe cleanup; any later managed-file failure rolls back only ai-config publications and
preserves the preexisting managed state. A process death or rollback failure leaves
`.ai-config-lifecycle-recovery.json`; inspect and remove it manually before retrying.
