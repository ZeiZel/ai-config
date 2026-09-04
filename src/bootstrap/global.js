import { access, constants as fsConstants, lstat } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { loadGeneratedFiles } from '../install/source.js'
import { installManagedFiles, planManagedInstall, readInstallState } from '../install/index.js'
import {
  SKILLS_CLI_INTEGRITY, SKILLS_CLI_TREE_SHA256, SKILLS_CLI_VERSION,
  loadExternalSources, stageExternalSkills
} from '../install/external.js'
import { loadProjectProfiles } from '../init/profiles.js'
import { spawnCommand } from '../init/index.js'
import { assertBunRuntime, bunArgs, sanitizeBunEnv } from '../runtime/bun.js'

export const GLOBAL_STATE_PATH = '.local/state/ai-config/state.json'
export const GLOBAL_WRAPPER_PATH = '.local/bin/ai-config'
export const SUPPORTED_GLOBAL_PROVIDERS = Object.freeze(['claude', 'codex', 'opencode', 'gemini'])
const GLOBAL_MANAGED_PREFIXES = Object.freeze([
  '.claude/skills/', '.agents/skills/', '.opencode/skills/', '.gemini/skills/'
])
const PROJECT_LICENSE_PREFIX = '.ai-config/licenses/'
const GLOBAL_LICENSE_PREFIX = '.local/state/ai-config/licenses/'

function list(value, fallback) {
  const values = String(value || fallback || '').split(',').map(item => item.trim()).filter(Boolean)
  return [...new Set(values)]
}

function shellQuote(value) {
  return `'${String(value).replaceAll("'", "'\\''")}'`
}

// Proxy values can contain credentials and private topology. They must not be
// copied into env(1)'s argv at this pre-runtime boundary.
const SAFE_GLOBAL_ENV = Object.freeze(['PATH', 'HOME', 'TMPDIR', 'LANG', 'LC_ALL', 'LC_CTYPE', 'XDG_CONFIG_HOME', 'XDG_CACHE_HOME', 'SSL_CERT_FILE', 'NODE_EXTRA_CA_CERTS', 'YOUTRACK_BASE_URL', 'OBSIDIAN_VAULT', 'OBSIDIAN_CLI', 'PLAYWRIGHT_BROWSERS_PATH'])

function safeEnvAssignments(names) {
  return [...new Set(names)].filter(name => /^[A-Za-z_][A-Za-z0-9_]*$/.test(name)).map(name => `${name}="$${name}"`).join(' ')
}

function wrapper(sourceRoot, runtime) {
  const entry = join(resolve(sourceRoot), 'bin', 'ai-config-lifecycle.mjs')
  const args = bunArgs({ sourceRoot, script: entry }).map(shellQuote).join(' ')
  // Bun reads environment/configuration before JavaScript can sanitize it.
  // Keep this boundary deliberately shell-only and remove every supported
  // preload/configuration injection variable before starting the runtime.
  const environment = safeEnvAssignments(SAFE_GLOBAL_ENV)
  return `#!/bin/sh\nexec /usr/bin/env -i ${environment} ${shellQuote(runtime)} ${args} "$@"\n`
}

function globalLicenseArtifactPath(path) {
  return path.startsWith(PROJECT_LICENSE_PREFIX)
    ? `${GLOBAL_LICENSE_PREFIX}${path.slice(PROJECT_LICENSE_PREFIX.length)}`
    : path
}

export function mapGlobalExternalFiles(files) {
  return files.map(file => ({ ...file, path: globalLicenseArtifactPath(file.path) }))
}

function isGlobalManagedPath(path) {
  return path === GLOBAL_WRAPPER_PATH
    || path === '.local/state/ai-config/external-lock.json'
    || path.startsWith(GLOBAL_LICENSE_PREFIX)
    // Clean up only a legacy global installer artifact that our own state recorded.
    || path.startsWith(PROJECT_LICENSE_PREFIX)
    || GLOBAL_MANAGED_PREFIXES.some(prefix => path.startsWith(prefix))
}

function reconcileGlobalSelection(files, state) {
  const desired = new Set(files.map(file => file.path))
  const stale = Object.keys(state.files)
    .filter(path => isGlobalManagedPath(path) && !desired.has(path))
    .map(path => ({ path, remove: true }))
  return [...files, ...stale]
}

async function assertGlobalTarget(targetRoot, sourceRoot) {
  if (typeof process.getuid === 'function' && process.getuid() === 0) throw new Error('global install refuses to run as uid 0')
  if (typeof targetRoot !== 'string' || !targetRoot) throw new Error('global install requires an explicit HOME target')
  const root = resolve(targetRoot)
  if (root === resolve('/')) throw new Error('global install refuses filesystem root')
  const stat = await lstat(root)
  if (stat.isSymbolicLink() || !stat.isDirectory()) throw new Error('global install target must be a real directory')
  const checkout = resolve(sourceRoot)
  if (root === checkout) throw new Error('global install target cannot be the ai-config source checkout')
  const legacy = join(root, '.ai-config')
  try {
    const legacyStat = await lstat(legacy)
    if (legacyStat.isDirectory()) {
      try {
        await access(join(legacy, 'package.json'), fsConstants.F_OK)
        await access(join(legacy, 'generated', 'manifest.json'), fsConstants.F_OK)
        throw new Error('legacy ~/.ai-config checkout detected; move it to ~/.local/share/ai-config before installing')
      } catch (error) {
        if (error.message.startsWith('legacy ~/.ai-config')) throw error
        if (error.code !== 'ENOENT') throw error
      }
    }
  } catch (error) {
    if (error.code !== 'ENOENT') throw error
  }
  return root
}

function provenanceFiles(sources) {
  if (!sources.length) return []
  const document = {
    schemaVersion: 1,
    updateStrategy: 'edit-ai-specs-external-lock-then-repeat-install',
    skillsCli: {
      version: SKILLS_CLI_VERSION,
      integrity: SKILLS_CLI_INTEGRITY,
      installedTreeSha256: SKILLS_CLI_TREE_SHA256
    },
    sources: sources.map(source => ({
      id: source.id, repository: source.repository, ref: source.ref,
      resolvedCommit: source.resolvedCommit, archive: source.archive,
      sha256: source.sha256, license: source.license,
      licenseEvidence: source.licenseEvidence && {
        ...source.licenseEvidence,
        ...(source.licenseEvidence.artifactPath
          ? { artifactPath: globalLicenseArtifactPath(source.licenseEvidence.artifactPath) }
          : {})
      },
      review: source.review ?? source.reviewedAt,
      selectedSkills: source.selectedSkills?.length ? source.selectedSkills : ['*'],
      selectedSkillSha256: source.selectedSkillSha256 || {},
      risk: source.risk || 'low',
      approvalRequired: source.approvalRequired === true,
      skillPath: source.skillPath
    })).sort((a, b) => a.id.localeCompare(b.id))
  }
  return [{ path: '.local/state/ai-config/external-lock.json', content: `${JSON.stringify(document, null, 2)}\n` }]
}

export function selectGlobalProviders(value) {
  const providers = list(value, SUPPORTED_GLOBAL_PROVIDERS)
  if (!providers.length || providers.some(provider => !SUPPORTED_GLOBAL_PROVIDERS.includes(provider))) {
    throw new Error(`unsupported global provider (choose: ${SUPPORTED_GLOBAL_PROVIDERS.join(', ')})`)
  }
  return providers
}

export async function installGlobal({ targetRoot, sourceRoot, specsDir, generatedRoot, providers, profileIds = ['base'], approvedSourceIds = [], includeExternal = true, dryRun = false, runner, fetchImpl, externalCacheRoot, statePath = GLOBAL_STATE_PATH } = {}) {
  const root = await assertGlobalTarget(targetRoot, sourceRoot)
  const bun = await assertBunRuntime({ sourceRoot })
  const selectedProviders = selectGlobalProviders(providers)
  const profiles = await loadProjectProfiles({ specsDir, profileIds: list(profileIds, 'base') })
  const generated = await loadGeneratedFiles(generatedRoot)
  const internal = generated.filter(file => {
    if (!selectedProviders.some(provider => file.path.startsWith({ claude: '.claude/', codex: '.agents/', opencode: '.opencode/', gemini: '.gemini/' }[provider]))) return false
    const skill = file.path.split('/')[2]
    return profiles.skills.includes(skill)
  })
  const externalSources = includeExternal ? await loadExternalSources({ specsDir, selectedIds: profiles.external, approvedSourceIds }) : []
  let external = { files: [], cache: [], commands: [] }
  if (externalSources.length && !dryRun) {
    external = await stageExternalSkills({
      sources: externalSources, providers: selectedProviders, runtimeEnv: sanitizeBunEnv(process.env),
      runner: runner || spawnCommand, fetchImpl, cacheRoot: externalCacheRoot, approvedSourceIds
    })
  }
  const state = await readInstallState(root, statePath)
  const provenancePath = '.local/state/ai-config/external-lock.json'
  const provenance = externalSources.length
    ? provenanceFiles(externalSources)
    : (state.files[provenancePath] ? [{ path: provenancePath, remove: true }] : [])
  const files = reconcileGlobalSelection([
    ...internal, ...mapGlobalExternalFiles(external.files), ...provenance,
    { path: GLOBAL_WRAPPER_PATH, content: wrapper(sourceRoot, bun.executable), mode: 0o755 }
  ], state)
  const plan = await planManagedInstall({ targetRoot: root, files, statePath })
  if (dryRun) return {
    operation: 'global-install', dryRun: true, providers: selectedProviders, profiles: profiles.ids,
    external: {
      sourceIds: externalSources.map(source => source.id),
      status: externalSources.length ? 'not-yet-materialized-in-dry-run' : 'not-selected'
    },
    plan
  }
  const install = await installManagedFiles({
    targetRoot: root, files, statePath, scope: 'global',
    selection: {
      providers: selectedProviders, profiles: profiles.ids, mcpProfiles: [],
      externalSourceIds: externalSources.map(source => source.id), flags: { includeSpecKit: false, includeExternal, includeMcp: false }
    }
  })
  return { operation: 'global-install', dryRun: false, providers: selectedProviders, profiles: profiles.ids, external: { sourceIds: externalSources.map(source => source.id), commands: external.commands, cache: external.cache }, install }
}

export async function uninstallGlobal({ targetRoot, dryRun = false, statePath = GLOBAL_STATE_PATH } = {}) {
  const { uninstallManagedFiles } = await import('../install/index.js')
  return uninstallManagedFiles({ targetRoot, dryRun, statePath })
}

export async function readGlobalState(targetRoot) {
  return readInstallState(targetRoot, GLOBAL_STATE_PATH)
}
