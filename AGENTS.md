# ai-config v2

This repository is the source of truth for a small, reproducible AI-agent bootstrap. It does not
contain a zoo of personas. Author provider-neutral instructions, skills, security policies, MCP
profiles, and external pins only under `ai-specs/`; generated provider files are build artefacts.

## How it works

`ai-specs/skills/<id>/{meta.yaml,body.md}` describes internal skills. `ai-specs/external/catalog.yaml`
and `lock.yaml` describe immutable upstream skills. Profiles select the base, frontend, backend,
systems, or Unity set. The generator validates the normalized model, renders Claude, Codex,
OpenCode, and Gemini outputs, and fails on unsupported fields, collisions, stale files, or unlocked
dependencies. Never edit `generated/` or provider output by hand.

The installer stages files, verifies hashes, and atomically publishes only paths listed in its
managed manifest. It must never replace a provider's entire home directory or touch auth,
history, sessions, OAuth stores, credentials, or unknown user files. Host application happens only
when explicitly requested; editing this repository is not host application.

## Start and commands

```bash
bun --version                 # exactly 1.4.0
bun install --frozen-lockfile --ignore-scripts
bun run render
bun run check
./bin/ai-config doctor
./bin/ai-config init --providers claude,codex,opencode,gemini --profiles base --target . --dry-run
```

`bun.lock` is the dependency authority. `bunfig.toml` disables implicit environment-file loading,
lifecycle scripts, telemetry, and automatic dependency installation. Use the repository's explicit
Bun flags/config for every command; do not substitute another runtime/package manager, an implicit
package runner, or an ambient global `skills` executable. The version-pinned skills CLI is installed and invoked from the isolated
checkout through Bun by the lifecycle code.

Use `ai-config init` (or the generated `project-init` skill) to prepare another repository with
explicit Spec Kit integrations, local Beads, selected profiles, and project-safe MCP. Claude,
OpenCode, and Gemini can expose `/project-init`; Codex invokes `$project-init`. Do not shadow a
provider's native `/init` command.

The normal project command is the safe launcher; `bin/ai-config-lifecycle.mjs` is internal-only:

```bash
./bin/ai-config init \
  --providers claude,codex,opencode,gemini \
  --profiles base --mcp-profiles default --target <project>
```

Add `--approve-mcp <ids>` for write-capable or high-risk MCP profiles and
`--approve-external unity-curated` for the Unity Companion License source. `--no-mcp` reconciles
only ai-config-owned MCP entries. `--dry-run` plans the operation without invoking network tools,
Spec Kit, Beads, or the skills CLI. Pass an explicit `--target <project>` to `init`, `repair`, and non-global
`uninstall-managed`; use `--global --target <HOME>` with `doctor` or `uninstall-managed` for the
host manifest. Mutating lifecycle commands refuse uid 0.

## Beads and memory

At the start of work run output-free `BEADS_DOLT_SHARED_SERVER=1 bd dolt status`; if it reports
the shared server unavailable, run `BEADS_DOLT_SHARED_SERVER=1 bd dolt start` and retry status.
Then run `BEADS_DOLT_SHARED_SERVER=1 bd --global prime --memories-only`, followed by `bd prime`. Arbitrary prime failures
propagate and must not trigger an unsolicited restart. Initialize local Beads with `bd init` when
absent. Beads is the only task tracker. Never expose PRIVATE global memory or read
credential-file contents; pass approved credential paths only to trusted helpers. Record verified
repository facts with stable `bd remember --key` keys, never task status.

## Security and MCP

Security hooks are heuristic defense in depth, not an OS sandbox. Secrets, `.env*`, private keys, complete environments, raw
Vault output, and full MCP payloads must not enter model context or logs. MCP profiles are least
privilege and read-only by default. Chrome uses an isolated profile; Obsidian, YouTrack writes,
Docker, CuaDriver, and destructive tools require explicit profiles and approval. CuaDriver
and Docker are unavailable until their verified runtime prerequisites are provided. Obsidian requires
the official CLI >=1.12.7, an exact selector, and an exact canonical `OBSIDIAN_VAULT_ROOT`.
Corporate/internal CLI targets must use `x5-no-proxy`. A managed-file process-death or rollback
failure leaves `.ai-config-lifecycle-recovery.json`; inspect it and remove it manually after review.
The dependency installer uses the separate `.ai-config-node-modules.recovery` marker and restores
its deterministic backup on the next run only when the live tree is absent; otherwise it fails closed.

The project initializer projects native hook files for Claude, Codex, Gemini, and stable OpenCode
V1. Codex project hooks require the project to be trusted before `/hooks` can enable them. Raw Vault
MCP is not installed; use the trusted host helper. MCP server commands and dynamic URLs are
provider-specific, so `doctor` must be run after selecting a profile and credentials are always
provided by the host environment.

External domain packs are lazy and are not Git submodules. The locked registry currently provides
Superpowers v6.3.0, Archify v2.16.0, Vercel React/composition skills, a pinned backend skill, and
Unity's pinned skills. Each source has an immutable commit, archive SHA-256, license metadata,
review record, and selected skill paths; only sources needing a published artifact (currently Unity)
carry `licenseEvidence`. Update by reviewing `ai-specs/external/lock.yaml`, updating
the matching catalog entry and generated provenance, then rerunning init; never install an entire
upstream repository by default.

## Change discipline

Preserve dirty files. Do not commit, push, rewrite history, or apply host changes without explicit
authority. Run `bun run check`, relevant provider smoke tests, and `git diff --check` before handoff.
Operational install/init/doctor actions should use `./bin/ai-config` or installed `ai-config`; `bun run`
is for trusted development tasks.

## Dotfiles integration

The `dotfiles` repository owns host provisioning and should install this repository from a pinned
release or commit under `~/.local/share/ai-config`, require Bun 1.4.0, run
`bun install --frozen-lockfile --ignore-scripts`, and invoke its local `install.sh`. It must not use
a floating `curl | bash` pipeline or an unpinned runtime bootstrap. This
repository owns provider skill/config paths and its state manifest; dotfiles owns surrounding host
packages and symlink policy.
