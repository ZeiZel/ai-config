# Claude instructions

Read `AGENTS.md` first. `ai-specs/` is the only authored configuration source; generated Claude
skills and settings are managed outputs. Use the `beads` skill at the start of work, load global
memory without printing PRIVATE values, initialize local Beads when needed, and keep all task
state in Beads. Use the guarded Vault helper and security policy. Never read credential files or
log tool payloads. Run the repository checks before reporting completion.
