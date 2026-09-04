import { spawn } from 'node:child_process'
import { access, lstat, mkdir, mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises'
import { constants as fsConstants } from 'node:fs'
import { delimiter, dirname, join, resolve } from 'node:path'
import { tmpdir } from 'node:os'
import { installManagedFiles, planManagedInstall, readInstallState } from '../install/index.js'
import { loadExternalSources, SKILLS_CLI_INTEGRITY, SKILLS_CLI_TREE_SHA256, SKILLS_CLI_VERSION, stageExternalSkills } from '../install/external.js'
import { loadMcpCatalog, projectMcpProfile, projectMcpServers } from '../mcp/index.js'
import { buildAllowlistedEnv, safeRelativePath } from '../security-guard/index.js'
import { loadProjectProfiles } from './profiles.js'
import { buildManagedProjectFiles } from './project-files.js'
import { loadAndValidatePolicies } from './policies.js'
import { sanitizeBunEnv } from '../runtime/bun.js'
import { assertBunRuntime } from '../runtime/bun.js'

export const SPEC_KIT_VERSION = 'v1.0.4'
export const SPEC_KIT_COMMIT = 'cb610277fdea781fcfa83d20522c2db37c94068d'
export const SPEC_KIT_SOURCE = `git+https://github.com/github/spec-kit.git@${SPEC_KIT_COMMIT}`
export const SUPPORTED_INTEGRATIONS = Object.freeze(['claude', 'codex', 'gemini', 'opencode'])
const INTEGRATION_PREFIXES = Object.freeze({ claude: '.claude/', codex: '.agents/', gemini: '.gemini/', opencode: '.opencode/' })
const CHILD_ENV_ALLOWLIST = ['PATH', 'HOME', 'TMPDIR', 'XDG_CACHE_HOME', 'XDG_CONFIG_HOME', 'XDG_DATA_HOME', 'HTTPS_PROXY', 'HTTP_PROXY', 'NO_PROXY', 'SSL_CERT_FILE']

export function selectProjectInitEnvironment(source = {}) {
  return buildAllowlistedEnv({ source, allowlist: CHILD_ENV_ALLOWLIST, required: ['PATH'] })
}

const CHILD_TIMEOUT_MS = Object.freeze({ beads: 120_000, 'spec-kit': 300_000, 'external-skills': 300_000, 'child-process': 30_000 })

function safeChildId(command, explicitId) {
  if (explicitId) return explicitId
  if (command === 'uvx') return 'spec-kit'
  if (command === 'bd') return 'beads'
  return 'child-process'
}

export function spawnCommand(command, args, { cwd, env, timeoutMs = CHILD_TIMEOUT_MS, id, purpose } = {}) {
  return new Promise((resolvePromise, reject) => {
    const detached = process.platform !== 'win32'
    const childId = safeChildId(command, id)
    const policyTimeout = CHILD_TIMEOUT_MS[childId] || CHILD_TIMEOUT_MS['child-process']
    const timeoutLimit = Number.isInteger(timeoutMs) && timeoutMs > 0 ? Math.min(timeoutMs, policyTimeout) : policyTimeout
    let child
    try { child = spawn(command, args, { cwd, env, shell: false, detached, stdio: ['ignore', 'pipe', 'pipe'] }) }
    catch { reject(Object.assign(new Error(`${childId} failed`), { code: 'COMMAND_FAILED', child: childId, purpose })); return }
    let timedOut = false; let killTimer
    // Drain, but never retain child output. Tool output can contain arbitrary
    // credentials (notably `bd prime` private memory), so redaction is not a
    // sufficient boundary.
    child.stdout.on('data', () => {})
    child.stderr.on('data', () => {})
    const terminate = () => {
      timedOut = true
      try { if (detached) process.kill(-child.pid, 'SIGTERM'); else child.kill('SIGTERM') } catch {}
      killTimer = setTimeout(() => { try { if (detached) process.kill(-child.pid, 'SIGKILL'); else child.kill('SIGKILL') } catch {} }, 500)
    }
    const timeout = setTimeout(terminate, timeoutLimit)
    child.once('error', error => { clearTimeout(timeout); if (killTimer) clearTimeout(killTimer); reject(Object.assign(new Error(`${childId} failed`), { code: 'COMMAND_FAILED', child: childId, purpose })) })
    child.once('close', code => {
      clearTimeout(timeout); if (!timedOut && killTimer) clearTimeout(killTimer)
      if (timedOut) return reject(Object.assign(new Error(`${childId} timed out`), { code: 'COMMAND_TIMEOUT', child: childId, purpose }))
      if (code === 0) return resolvePromise({ code, stdout: '' })
      return reject(Object.assign(new Error(`${childId} failed`), { code: 'COMMAND_FAILED', exitCode: code, child: childId, purpose }))
    })
  })
}

async function collectRegularFiles(root, current = '', result = []) {
  for (const entry of await readdir(join(root, current), { withFileTypes: true })) {
    const path = join(current, entry.name)
    if (path === '.git' || path.startsWith('.git/')) continue
    const stat = await lstat(join(root, path))
    if (stat.isSymbolicLink()) throw new Error(`Spec Kit staging produced a symlink: ${path}`)
    if (stat.isDirectory()) await collectRegularFiles(root, path, result)
    else if (stat.isFile()) result.push({ path: path.replaceAll('\\', '/'), content: await readFile(join(root, path)), mode: stat.mode & 0o777, semantic: 'spec-kit' })
  }
  return result
}

export function buildSpecKitCommand(integration) {
  if (!SUPPORTED_INTEGRATIONS.includes(integration)) throw new Error(`unsupported Spec Kit integration: ${integration}`)
  return {
    command: 'uvx',
    args: ['--from', SPEC_KIT_SOURCE, 'specify', 'init', '--here', '--integration', integration, '--non-interactive', '--ignore-agent-tools']
  }
}

/**
 * Build the pinned Spec Kit command used to add an integration after the
 * project has been initialized.  `integration install` is intentionally run
 * with `--force`: Spec Kit's multi-install safety gate is conservative for
 * provider combinations, while this staging directory is disposable and the
 * complete result is published atomically by our managed installer.
 */
export function buildSpecKitIntegrationCommand(integration) {
  if (!SUPPORTED_INTEGRATIONS.includes(integration)) throw new Error(`unsupported Spec Kit integration: ${integration}`)
  return {
    command: 'uvx',
    args: ['--from', SPEC_KIT_SOURCE, 'specify', 'integration', 'install', integration, '--force']
  }
}

export function selectManagedFilesForIntegration(files, integration) {
  if (!SUPPORTED_INTEGRATIONS.includes(integration)) throw new Error(`unsupported integration: ${integration}`)
  const prefix = INTEGRATION_PREFIXES[integration]
  return files
    .filter(file => typeof file?.path === 'string' && file.path.replaceAll('\\', '/').startsWith(prefix))
    .map(file => ({ ...file, internalSkillId: file.path.replaceAll('\\', '/').split('/')[2] }))
}

export function selectManagedFilesForProfiles(files, skillIds = []) {
  const selected = new Set(skillIds)
  return files.filter(file => {
    // Only the generated-provider selection marks an item as internal. Other
    // caller-managed files can share the same path shape and must not be
    // reclassified or discarded by profile filtering.
    return file?.internalSkillId === undefined || selected.has(file.internalSkillId)
  })
}

export async function stageSpecKit({ integration, runtimeEnv = {}, runner = spawnCommand, stagingParent = tmpdir() } = {}) {
  return stageSpecKitIntegrations({ integrations: [integration], runtimeEnv, runner, stagingParent })
}

export async function stageSpecKitIntegrations({ integrations, runtimeEnv = {}, runner = spawnCommand, stagingParent = tmpdir() } = {}) {
  const stageRoot = await mkdtemp(join(stagingParent, 'ai-config-speckit-'))
  const isolation = await mkdtemp(join(tmpdir(), 'ai-config-child-home-'))
  const home = join(isolation, 'home'); const cache = join(isolation, 'cache'); const config = join(isolation, 'config'); const data = join(isolation, 'data')
  await Promise.all([home, cache, config, data].map(path => mkdir(path, { recursive: true, mode: 0o700 })))
  const base = sanitizeBunEnv(buildAllowlistedEnv({ source: runtimeEnv, allowlist: CHILD_ENV_ALLOWLIST.filter(name => !['HOME', 'XDG_CACHE_HOME', 'XDG_CONFIG_HOME', 'XDG_DATA_HOME'].includes(name)), required: ['PATH'] }))
  const environment = { ...base, HOME: home, XDG_CACHE_HOME: cache, XDG_CONFIG_HOME: config, XDG_DATA_HOME: data }
  try {
    const commands = []
    const selected = [...new Set(integrations)]
    if (!selected.length) throw new Error('at least one Spec Kit integration is required')
    for (const [index, integration] of selected.entries()) {
      const specKit = index === 0 ? buildSpecKitCommand(integration) : buildSpecKitIntegrationCommand(integration)
      commands.push(specKit)
      await runner(specKit.command, specKit.args, { cwd: stageRoot, env: environment })
    }
    return { stageRoot, files: await collectRegularFiles(stageRoot), commands }
  } catch (error) {
    await rm(stageRoot, { recursive: true, force: true })
    throw error
  } finally {
    await rm(isolation, { recursive: true, force: true })
  }
}

export async function findGitRoot(start = '.') {
  let current = resolve(start)
  for (;;) {
    try {
      const stat = await lstat(join(current, '.git'))
      if (stat.isDirectory() || stat.isFile()) return current
    } catch (error) { if (error.code !== 'ENOENT') throw error }
    const parent = dirname(current)
    if (parent === current) throw new Error(`no Git root found from ${resolve(start)}`)
    current = parent
  }
}

export async function executableAvailable(name, runtimeEnv = {}) {
  const extensions = process.platform === 'win32' ? (runtimeEnv.PATHEXT || '.EXE;.CMD;.BAT').split(';') : ['']
  for (const directory of String(runtimeEnv.PATH || '').split(delimiter).filter(Boolean)) for (const extension of extensions) {
    try { await access(join(directory, `${name}${extension}`), fsConstants.X_OK); return true } catch (error) { if (error.code !== 'ENOENT' && error.code !== 'EACCES') throw error }
  }
  return false
}

async function preflightExecutables(names, runtimeEnv, finder) {
  const missing = []
  for (const name of [...new Set(names)]) if (!await finder(name, runtimeEnv)) missing.push(name)
  if (missing.length) throw new Error(`required executables are missing: ${missing.join(', ')}`)
}

async function runBeadsLifecycle({ root, present, runtimeEnv, runner }) {
  const environment = { ...selectProjectInitEnvironment(runtimeEnv), BEADS_DOLT_SHARED_SERVER: '1', BD_NON_INTERACTIVE: '1' }
  let initialized = false
  let initAttempted = false
  try {
    try {
      await runner('bd', ['dolt', 'status'], { cwd: root, env: environment })
    } catch (error) {
      await runner('bd', ['dolt', 'start'], { cwd: root, env: environment })
    }
    // Prime failures after a healthy status are not assumed to be a Dolt
    // outage and are propagated without attempting an unsolicited restart.
    await runner('bd', ['--global', 'prime', '--memories-only'], { cwd: root, env: environment })
    if (!present) {
      initAttempted = true
      await runner('bd', ['init', '--init-if-missing', '--non-interactive', '--skip-agents', '--skip-hooks', '--setup-exclude'], { cwd: root, env: environment })
      initialized = true
    }
    await runner('bd', ['prime'], { cwd: root, env: environment })
  } catch (error) {
    error.beadsPersistentSideEffects = initAttempted
      ? ['possible partial .beads/', 'possible .git/info/exclude update', 'possible .gitignore update']
      : []
    throw error
  }
  return {
    status: initialized ? 'initialized-and-primed' : 'existing-primed',
    persistentSideEffects: initialized ? ['.beads/', '.git/info/exclude', 'possible .gitignore update'] : []
  }
}

function mergeDesiredFiles(groups) {
  const result = new Map()
  for (const file of groups.flat()) {
    const path = file.path.replaceAll('\\', '/')
    if (result.has(path)) {
      const previous = result.get(path)
      if (!Buffer.from(previous.content).equals(Buffer.from(file.content))) throw new Error(`staged file collision: ${path}`)
      continue
    }
    result.set(path, { ...file, path })
  }
  return [...result.values()]
}

function isProjectSelectionManagedPath(path) {
  return path === 'AGENTS.md' || path === 'CLAUDE.md' || path === 'GEMINI.md'
    || path === 'opencode.json'
    || path === '.mcp.json'
    || path.startsWith('.claude/')
    || path.startsWith('.codex/')
    || path.startsWith('.gemini/')
    || path.startsWith('.opencode/')
    || path.startsWith('.agents/skills/')
    || path.startsWith('.specify/')
    || path === '.ai-config/external-lock.json'
    || path.startsWith('.ai-config/licenses/')
    || path.startsWith('.ai-config/hooks/')
}

function reconcileProjectSelection(files, state) {
  const desired = new Set(files.map(file => file.path))
  const stale = Object.entries(state.files)
    .filter(([path, record]) => (record.origin ? ['internal', 'external', 'external-provenance', 'project', 'spec-kit'].includes(record.origin) : isProjectSelectionManagedPath(path)) && !desired.has(path))
    .map(([path, record]) => ({ path, remove: true, ...(record.mergeStrategy ? { mergeStrategy: record.mergeStrategy } : {}) }))
  return [...files, ...stale]
}

export function buildExternalProvenanceFiles(sources) {
  if (!sources.length) return []
  const document = {
    schemaVersion: 1,
    updateStrategy: 'edit-ai-specs-external-lock-then-repeat-init',
    skillsCli: { version: SKILLS_CLI_VERSION, integrity: SKILLS_CLI_INTEGRITY, installedTreeSha256: SKILLS_CLI_TREE_SHA256 },
    sources: sources.map(source => ({
      id: source.id, repository: source.repository, ref: source.ref,
      resolvedCommit: source.resolvedCommit, archive: source.archive,
      sha256: source.sha256, license: source.license, skillPath: source.skillPath,
      selectedSkills: source.selectedSkills, archiveLayout: source.archiveLayout,
      licenseEvidence: source.licenseEvidence, approvalRequired: source.approvalRequired,
      risk: source.risk, review: source.review, capabilities: source.capabilities
    })).sort((a, b) => a.id.localeCompare(b.id))
  }
  return [{ path: '.ai-config/external-lock.json', content: `${JSON.stringify(document, null, 2)}\n` }]
}

async function pathKind(path) {
  try {
    const stat = await lstat(path)
    if (stat.isSymbolicLink()) return 'symlink'
    if (stat.isDirectory()) return 'directory'
    if (stat.isFile()) return 'file'
    return 'other'
  } catch (error) { if (error.code === 'ENOENT') return 'missing'; throw error }
}

export async function inspectBeads(projectRoot) {
  const root = resolve(projectRoot)
  const kind = await pathKind(join(root, '.beads'))
  return { present: kind === 'directory', safe: kind === 'missing' || kind === 'directory', kind }
}

export async function initializeProject({
  projectRoot,
  integration,
  providers = integration ? [integration] : [],
  profileIds = ['base'],
  specsDir,
  managedFiles = [],
  includeSpecKit = true,
  initializeBeads = true,
  includeExternal = true,
  includeMcp = true,
  mcpProfileIds = [],
  approvedMcpServerIds = [],
  approvedSourceIds = [],
  runtimeEnv = {},
  dryRun = false,
  runner = spawnCommand,
  executableFinder = executableAvailable,
  fetchImpl = globalThis.fetch,
  externalCacheRoot,
  statePath
} = {}) {
  if (!providers.length || providers.some(provider => !SUPPORTED_INTEGRATIONS.includes(provider))) throw new Error('at least one supported provider is required')
  if (!specsDir) throw new Error('specsDir is required')
  const root = await findGitRoot(projectRoot)
  const beads = await inspectBeads(root)
  if (!beads.safe) throw new Error(`refusing to replace existing .beads ${beads.kind}`)
  const policies = await loadAndValidatePolicies({
    specsDir, specKitVersion: SPEC_KIT_VERSION, specKitCommit: SPEC_KIT_COMMIT,
    skillsCliVersion: SKILLS_CLI_VERSION, skillsCliIntegrity: SKILLS_CLI_INTEGRITY,
    skillsCliTreeSha256: SKILLS_CLI_TREE_SHA256
  })
  const profiles = await loadProjectProfiles({ specsDir, profileIds })
  const externalSources = includeExternal ? await loadExternalSources({ specsDir, selectedIds: profiles.external, approvedSourceIds }) : []
  const mcpCatalog = includeMcp ? await loadMcpCatalog({ specsDir }) : undefined
  if (!Array.isArray(mcpProfileIds) || mcpProfileIds.some(id => typeof id !== 'string')) throw new Error('mcpProfileIds must be an array of profile IDs')
  const selectedMcpProfiles = [...new Set(mcpProfileIds)]
  const profileServers = includeMcp
    ? selectedMcpProfiles.flatMap(id => projectMcpProfile(mcpCatalog, id, { approvedServerIds: approvedMcpServerIds }).servers.map(server => server.id))
    : []
  const mcpServers = includeMcp ? projectMcpServers(mcpCatalog, [...new Set([...profiles.mcp, ...profileServers])], { approvedServerIds: approvedMcpServerIds }) : []
  const priorState = await readInstallState(root, statePath)
  const requiredExecutables = []
  if (includeSpecKit) requiredExecutables.push('uvx')
  if (initializeBeads) requiredExecutables.push('bd')
  await preflightExecutables(requiredExecutables, runtimeEnv, executableFinder)
  if (externalSources.length) await assertBunRuntime()
  let specKitStage
  let beadsResult = initializeBeads ? (beads.present ? 'would-prime-existing' : 'would-initialize-and-prime') : 'disabled'
  let beadsSideEffects = []
  try {
    const specKitFiles = []
    let specKit = includeSpecKit ? 'would-stage-pinned-template' : 'disabled'
    if (includeSpecKit && !dryRun) {
      specKitStage = await stageSpecKitIntegrations({ integrations: providers, runtimeEnv, runner })
      specKitFiles.push(...specKitStage.files)
      specKit = 'staged-pinned-template'
    }
    let external = { files: [], cache: [], commands: [] }
    if (externalSources.length && !dryRun) {
      external = await stageExternalSkills({
        sources: externalSources, providers, runtimeEnv: selectProjectInitEnvironment(runtimeEnv),
        runner, fetchImpl, cacheRoot: externalCacheRoot, approvedSourceIds
      })
    }
    const projectFiles = await buildManagedProjectFiles({
      projectRoot: root, providers, profiles: [...profiles.ids, ...selectedMcpProfiles], mcpServers, includeMcp,
      ownedRecords: new Map(Object.entries(priorState.files))
    })
    const tagged = (files, origin) => files.map(file => ({ ...file, origin, owners: origin === 'project' ? providers : undefined }))
    const desired = reconcileProjectSelection(
      mergeDesiredFiles([
        tagged(specKitFiles, 'spec-kit'), tagged(external.files, 'external'), tagged(buildExternalProvenanceFiles(externalSources), 'external-provenance'),
        tagged(selectManagedFilesForProfiles(managedFiles, profiles.skills), 'internal'), tagged(projectFiles, 'project')
      ]),
      priorState
    )
    const predictablePlan = await planManagedInstall({ targetRoot: root, files: desired, statePath })
    const predictableConflicts = predictablePlan.changes.filter(change => change.action === 'conflict')
    if (predictableConflicts.length) {
      const error = new Error(`managed install has conflicts: ${predictableConflicts.map(item => item.path).join(', ')}`)
      error.code = 'MANAGED_FILE_CONFLICT'; error.conflicts = predictableConflicts; error.beadsPersistentSideEffects = []
      throw error
    }
    if (initializeBeads && !dryRun) {
      const lifecycle = await runBeadsLifecycle({ root, present: beads.present, runtimeEnv, runner })
      beadsResult = lifecycle.status; beadsSideEffects = lifecycle.persistentSideEffects
    }
    let install
    try {
      install = await installManagedFiles({
        targetRoot: root, files: desired, statePath, dryRun, scope: 'project',
        selection: {
          providers: [...providers], profiles: [...profiles.ids], mcpProfiles: [...selectedMcpProfiles],
          externalSourceIds: externalSources.map(source => source.id),
          flags: { includeSpecKit, includeExternal, includeMcp }
        }
      })
    }
    catch (error) {
      error.beadsPersistentSideEffects = beadsSideEffects
      throw error
    }
    return {
      projectRoot: root, providers, profiles: profiles.ids, mcpProfiles: selectedMcpProfiles,
      policySchemaVersion: policies.projectInit.schemaVersion,
      specKitVersion: SPEC_KIT_VERSION, specKitCommit: SPEC_KIT_COMMIT, specKit,
      external: { sourceIds: externalSources.map(source => source.id), status: dryRun ? 'would-verify-cache-stage-and-inject' : 'verified-cache-staged-and-injected' },
      mcp: includeMcp ? mcpServers.map(server => ({ id: server.id, risk: server.risk, runtimeIntegrity: server.runtimeIntegrity })) : [],
      beads: beadsResult, beadsPersistentSideEffects: beadsSideEffects, install
    }
  } finally {
    if (specKitStage) await rm(specKitStage.stageRoot, { recursive: true, force: true })
  }
}

export function managedProjectFile(projectRoot, candidate) {
  return safeRelativePath(projectRoot, candidate).target
}
