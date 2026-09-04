# Migration to managed ai-config files

The v2 installer does not replace `~/.claude`, `~/.codex`, `~/.gemini`,
`~/.opencode`, or `~/.agents`. It publishes only files listed in the generated
manifest and records their hashes in `.ai-config/state.json` under a project
target root. State schema v3 records exact provider/profile selection and external source
attribution. Global installation uses the separate
`~/.local/state/ai-config/state.json` manifest.

## Safety contract

- Existing unknown files and runtime data remain in place.
- Existing files that are not in the state manifest are conflicts, not overwrite
  targets.
- A managed file changed after installation is preserved by repair and uninstall; repair is
  state-scoped and fail-closed and cannot reconstruct a missing or locally modified file.
- Uninstall removes only files whose current SHA-256 matches the installed state.
- Staging paths, destination paths, and existing ancestors are validated. Symlink
  ancestors are rejected.
- A legacy whole-provider-home symlink is reported for manual review and is
  never traversed or used as an installation target.
- Publication uses same-directory temporary files and rename. If publication
  fails, files changed by the current transaction are restored.
- The state and audit results contain hashes and redacted metadata, never
  environment values or file contents.

Migration is inventory/adoption-safe: it reports legacy files, links, and conflicts for review and
does not perform broad rollback or replace provider roots.

## Recommended sequence

Keep the old provider directories intact while reviewing the first dry run:

```bash
./bin/ai-config install \
  --target "$HOME" \
  --dry-run
```

Resolve every `existing-unmanaged-file` or `locally-modified-managed-file`
conflict deliberately. Do not move an entire provider home into the repository
and do not replace it with a symlink.

If doctor or migration inventory reports `legacy-root-link-review`, inspect the
link target yourself, create a real provider directory, and rerun the dry run.
The migration code deliberately does not unlink or rewrite that root link.

After review, install and verify:

```bash
./bin/ai-config install --target "$HOME"
./bin/ai-config doctor --global --target "$HOME"
```

Project `repair` requires an explicit target, is state-scoped and fail-closed, and preserves local edits:

```bash
./bin/ai-config repair --target /path/to/project
```

For a global installation, repeat `install` with the reviewed provider/profile selection; it uses
the global state manifest and only restores files it still manages.

Preview managed-only removal before applying it:

```bash
./bin/ai-config uninstall-managed --global --target "$HOME" --dry-run
./bin/ai-config uninstall-managed --global --target "$HOME"
```

## Project initialization

Project initialization runs GitHub Spec Kit v1.0.4, resolved to commit
`cb610277fdea781fcfa83d20522c2db37c94068d`, in an isolated staging
directory and passes its output through the same managed-file conflict checks.
The integration is always explicit:

```bash
./bin/ai-config init \
  --providers claude,codex,opencode,gemini \
  --profiles base \
  --mcp-profiles default \
  --target /path/to/project
```

Supported keys are `claude`, `codex`, `gemini`, and `opencode`. `--mcp-profiles`
accepts centrally reviewed MCP profile IDs; `--approve-mcp <server-ids>` enables
high-risk MCP servers; external sources that require an explicit approval use
`--approve-external <source-ids>` (for example `unity-curated`). Beads is
initialized by default, but is never reconfigured when `.beads/` already
exists. Use `--no-beads` only for a deliberate opt-out. Child processes receive
a small environment allowlist rather than `process.env` wholesale. `--dry-run`
does not invoke Spec Kit, Beads, a package manager, or any other external
process; it reports the pinned Spec Kit action that a real run would stage.

The package-level `ai-config` command is the functional dispatcher. Global
`install` requires an explicit `--target <HOME>` (or `HOME`); project `init`,
`repair`, and non-global `uninstall-managed` require an explicit
`--target <project>`. Read-only `doctor` may inspect the current working
directory by default and accepts `--target <project>`; mutating lifecycle
commands refuse uid 0.
Dry runs validate and plan only: they do not invoke Spec Kit, Beads, the skills CLI, or
network fetches. Global bootstrap may download only immutable, SHA-verified
archives and records their selected skill paths, review, license evidence, and
hashes in its provenance file.

Beads initialization checks the shared Dolt server with output suppressed using
`BEADS_DOLT_SHARED_SERVER=1 bd dolt status`; it starts Dolt only when status reports it unavailable,
retries status, then primes global and local context. Other prime failures propagate. A process
death or rollback failure leaves `.ai-config-lifecycle-recovery.json`; inspect
the managed-files marker and remove it manually after review before retrying. The dependency
installer has a separate `.ai-config-node-modules.recovery` marker; rerun it to restore its
deterministic backup when `node_modules` is absent, or stop for manual review if both trees exist.

Install, repair, and init read the package's verified `generated/manifest.json`
by default. `--source /reviewed/generated` explicitly selects another verified
render tree. Init filters that manifest to the requested integration so it does
not install unrelated provider directories.
