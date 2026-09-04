# ai-config v2

Reproducible, provider-neutral configuration for Claude Code, Codex, OpenCode, and Gemini. The
project installs a small base of safe skills and lazily injects reviewed, pinned domain skills into
projects. It requires Bun 1.4.0, which is also the runtime for the locked skills CLI. It is designed to work
with `dotfiles`, but can also be cloned and run independently.

## Quick start

```bash
git clone https://github.com/ZeiZel/ai-config.git ~/.local/share/ai-config
cd ~/.local/share/ai-config
bun --version
bun install --frozen-lockfile --ignore-scripts
bun run check
./install.sh --providers claude,codex,opencode,gemini --profiles base --dry-run
```

The `bun` executable resolved from `PATH` must be the trusted Bun 1.4.0 runtime before running
package scripts or the installer; the bootstrap verifies this requirement before changing files.

`--dry-run` never installs dependencies or changes `node_modules`; it requires an existing dependency
tree whose metadata matches `package.json` and `bun.lock`. It trusts that existing local tree, while
normal bootstrap installation creates a clean locked tree. Run the bootstrap without `--dry-run` once
on a new checkout, then use dry-run for repeatable installation previews.

Run `ai-config init --providers codex --profiles base --target /path/to/project` to initialize
Spec Kit, local Beads, selected provider skills, managed instructions, and project-safe MCP config
at the explicit target Git root. Use `--dry-run` first for non-empty repositories. Providers and profiles
are comma-separated. `base`, `systems`, `frontend`, and `backend` are enabled; `unity` is an
explicit high-risk profile and requires `--approve-external unity-curated`. The `systems` profile
contains Archify and Context7; Docker is unavailable until its verified runtime prerequisites are
provided. High-risk MCP servers require
`--approve-mcp <ids>`, and `--no-mcp` suppresses MCP projection while reconciling only entries
previously managed by ai-config.

## Source model

`ai-specs/` contains all authored specifications. Internal skills use `meta.yaml` and `body.md`.
External dependencies are pinned in `ai-specs/external/catalog.yaml` and become installable only
after `lock.yaml` has immutable commits, hashes, license metadata, and review metadata. Sources
that require a published license artifact (currently Unity) additionally carry `licenseEvidence`.
Profiles
are lazy; domain packs are not cloned as Git submodules. The installer caches exact revisions and
injects only selected skills.

Host installation defaults to all four providers and the `base` profile. It uses
`~/.local/state/ai-config/state.json` and installs a managed wrapper at `~/.local/bin/ai-config`;
it never replaces provider homes. A legacy checkout at `~/.ai-config` is rejected so source and
state cannot collide. The global state records the exact archive, selected skills, source-review
and license-evidence references used for each installed external skill. Projects record selected
external provenance in managed `.ai-config/external-lock.json`. Updates
are made by reviewing and changing `ai-specs/external/lock.yaml`, regenerating if needed, and
running project init again. The staging-only `skills-lock.json` is not the update authority and is
not published into projects.

The installer intentionally does not forward proxy values or other credential-bearing network
settings into its isolated Bun process. Public network access must be provided by a trusted host
wrapper. If an interrupted dependency swap leaves `.ai-config-node-modules.recovery`, rerun the
installer: it restores the deterministic backup when the live tree is absent, and otherwise fails
closed for manual review. A leftover `.ai-config-install.lock` is also fail-closed: after confirming
no installer is running, remove that exact checkout-local lock directory and rerun; never remove a
live lock.

Only the SHA-verified archive's selected skill subtree is extracted. Traversal, duplicate entries,
links inside that subtree, oversized archives, and symlinked CLI output roots are rejected. Links
outside the selected subtree are validated as unselected and never materialized.

The base includes Beads, project initialization, security, and guarded Vault guidance. Superpowers
v6.3.0 is imported as its portable skill set; its native provider plugin is an optional separate
integration. Archify v2.16.0 is available through the systems profile and must run with an
output-path restriction. Frontend uses Vercel's locked React and composition skills; backend uses
the locked `backend-engineering` skill. Unity skills are distributed under the Unity Companion
License 1.4 and stay approval-gated.

## Provider outputs

The generator produces native skills for Claude (`.claude/skills`), Codex
(`.agents/skills`), OpenCode (`.opencode/skills`), and Gemini (`.gemini/skills`). Outputs carry
content manifests and are never hand-edited. Project initialization adds a bounded managed section
to the provider instruction file while preserving surrounding user text. Run `bun run render` to
regenerate and `bun run check` to detect drift.

OpenCode project MCP output targets stable V1 (`opencode` 1.18.13), using the `opencode.json`
schema published at
<https://opencode.ai/config.json>: local servers use `type`, command arrays, and `environment`;
remote servers use `type` and `url`. The generator validates this subset and does not mix it with
Claude's MCP JSON format or beta V2's nested `mcp.servers` layout. Environment references use
V1's `{env:NAME}` interpolation.

## MCP and safety

MCP is catalogued centrally and enabled by profile. The `default` profile provides minimal public
Context7 access. Playwright, Chrome DevTools, CuaDriver, YouTrack writes, the read-only Obsidian
wrapper, and Docker gateway require explicit opt-in and least-privilege configuration. CuaDriver
and Docker remain unavailable until their verified runtime prerequisites are supplied. Obsidian
requires the official CLI >=1.12.7, an exact selector, and `OBSIDIAN_VAULT_ROOT` equal to the
canonical vault root. Raw Vault MCP is quarantined because a
generic secret-read tool would return secret values to the agent; Vault operations use a trusted
host helper with write-only results. Credentials are supplied by the host/helper, never committed
or interpolated into config. Hooks redact sensitive payloads and reject unsafe targets.
Project-specific internal-network wrappers must enforce their own no-proxy policy; the base
distribution declares no internal commands.

## Beads

Every authored/base skill and every generated managed `AGENTS.md` knows the Beads protocol (unmodified
upstream skills are not rewritten). Check the shared Dolt server with output suppressed using
`BEADS_DOLT_SHARED_SERVER=1 bd dolt status`; start it only when status reports it unavailable,
retry status with the same environment, then load global memory and run `bd prime`; run `bd init`
for a project without local Beads. Beads is the task source of truth,
while Spec Kit files are planning artifacts. PRIVATE memories and credential contents must never be
copied into prompts, logs, files, or commits.

## Development

```bash
bun run render
bun run check
./bin/ai-config doctor --target .
./bin/ai-config init --providers claude --profiles base --target . --dry-run
bun run test
```

The local `install.sh` consumes the checked-out package and `bun.lock`. Global installation may fetch
only catalog entries whose archive URL, commit, SHA-256, license metadata, and review metadata are
locked (plus any required `licenseEvidence` artifact); it then runs the exact lock-installed skills
CLI from isolated staging through Bun. It does not clone,
pull, run Ansible, install a package manager, or replace a provider home. Dotfiles integration
should use a pinned release or commit and execute that local installer; it must not execute a
floating `curl | bash` pipeline.

`install` is deliberately the global operation and requires `--target <HOME>` (or an explicit
`HOME`). `init`, `repair`, and non-global `uninstall-managed` require `--target <project>` and
operate on that project's `.ai-config/state.json`; read-only `doctor` may inspect the current
working directory by default, with `--target <project>` available for clarity. Use
`--global --target <HOME>` to inspect or remove the host installation and its separate
`.local/state/ai-config/state.json` manifest.
Mutating lifecycle commands refuse uid 0. `--mcp-profiles`, `--approve-mcp`, and `--approve-external` accept comma-separated IDs;
`--dry-run` performs validation and planning but does not invoke Spec Kit, Beads, the skills CLI, or network
fetches. Provider/profile selection is reconciled exactly on a subsequent run, and `--no-mcp`
removes only ai-config-owned MCP entries.
