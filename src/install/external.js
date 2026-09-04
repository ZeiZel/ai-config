import { createHash, randomUUID } from 'node:crypto'
import { chmod, lstat, mkdir, mkdtemp, open, readFile, readdir, realpath, rename, rm, writeFile } from 'node:fs/promises'
import { delimiter, join, posix, resolve } from 'node:path'
import { tmpdir } from 'node:os'
import { fileURLToPath } from 'node:url'
import { parse } from 'yaml'
import { t as listTar, x as extractTar } from 'tar'
import { buildAllowlistedEnv, sha256 } from '../security-guard/index.js'
import { assertBunRuntime, bunArgs, sanitizeBunEnv } from '../runtime/bun.js'

export const SKILLS_CLI_VERSION = '1.5.23'
export const SKILLS_CLI_INTEGRITY = 'sha512-+hMNBSi35yfX0sKD+ZcRm9y5or7u313OdkcvrRvJAsAzGCaA8wRTu2OmVdN0KRbk9ybqKby5dijkn6OVvNTUmw=='
export const SKILLS_CLI_TREE_SHA256 = '93bc9c35e4b44ac4157fca34fc116d39e7607dbbd983add5db07ec1e35200116'
const PROVIDER_AGENTS = { claude: 'claude-code', codex: 'codex', opencode: 'opencode', gemini: 'gemini-cli' }
const PROVIDER_PREFIXES = { claude: '.claude/skills', codex: '.agents/skills', opencode: '.agents/skills', gemini: '.agents/skills' }
const CHILD_ENV_ALLOWLIST = ['PATH', 'HOME', 'TMPDIR', 'XDG_CACHE_HOME', 'XDG_CONFIG_HOME', 'XDG_DATA_HOME', 'HTTPS_PROXY', 'HTTP_PROXY', 'NO_PROXY', 'SSL_CERT_FILE']
const PACKAGE_ROOT = fileURLToPath(new URL('../../', import.meta.url))
const MAX_ARCHIVE_BYTES = 64 * 1024 * 1024
const MAX_ARCHIVE_ENTRIES = 10_000
const MAX_EXPANDED_BYTES = 128 * 1024 * 1024

export function parseBunLock(text) {
  if (!globalThis.Bun?.JSONC?.parse) throw new Error('Bun JSONC parser is required for bun.lock')
  try { return globalThis.Bun.JSONC.parse(text) } catch { throw new Error('invalid bun.lock') }
}

function safeArchiveRelativePath(path, sourceId, field) {
  if (typeof path !== 'string' || !path || path.includes('\\') || /[\u0000-\u001f\u007f]/.test(path) || posix.isAbsolute(path) || posix.normalize(path) !== path || path.split('/').some(part => !part || part === '.' || part === '..')) throw new Error(`external ${field} is unsafe: ${sourceId}`)
  return path
}

function validateSource(source) {
  if (!source || !/^[a-z0-9][a-z0-9-]{0,63}$/.test(source.id || '')) throw new Error('external source has an invalid id')
  if (!/^[a-f0-9]{40}$/.test(source.resolvedCommit || '') || !/^[a-f0-9]{64}$/.test(source.sha256 || '')) throw new Error(`external source is not immutably locked: ${source.id}`)
  const archiveUrl = new URL(source.archive)
  if (archiveUrl.protocol !== 'https:' || archiveUrl.username || archiveUrl.password) throw new Error(`external archive URL is unsafe: ${source.id}`)
  const skillPath = source.skillPath || ''
  if (skillPath) safeArchiveRelativePath(skillPath, source.id, 'skill path')
  if (source.selectedSkills !== undefined && (!Array.isArray(source.selectedSkills) || !source.selectedSkills.length || new Set(source.selectedSkills).size !== source.selectedSkills.length || source.selectedSkills.some(id => !/^[a-z0-9][a-z0-9-]*$/.test(id)))) throw new Error(`external source has invalid selectedSkills: ${source.id}`)
  const archiveLayout = source.archiveLayout || 'subtree'
  if (!['flat', 'subtree'].includes(archiveLayout)) throw new Error(`external source has invalid archiveLayout: ${source.id}`)
  if (archiveLayout === 'flat' && (skillPath || source.selectedSkills?.length !== 1)) throw new Error(`flat external archive must contain exactly one selected skill: ${source.id}`)
  if (typeof source.license !== 'string' || !source.license.trim()) throw new Error(`external source has no license: ${source.id}`)
  if (typeof source.review !== 'string' || !source.review.trim()) throw new Error(`external source has no review evidence: ${source.id}`)
  let licenseEvidence
  if (source.licenseEvidence !== undefined) {
    const evidence = source.licenseEvidence
    if (!evidence || typeof evidence !== 'object' || Array.isArray(evidence) || !/^[a-f0-9]{64}$/.test(evidence.sha256 || '') || typeof evidence.provenance !== 'string') throw new Error(`external license evidence is invalid: ${source.id}`)
    const provenance = new URL(evidence.provenance)
    if (provenance.protocol !== 'https:' || provenance.username || provenance.password) throw new Error(`external license provenance is unsafe: ${source.id}`)
    licenseEvidence = {
      path: safeArchiveRelativePath(evidence.path, source.id, 'license evidence path'), sha256: evidence.sha256,
      provenance: evidence.provenance,
      ...(evidence.artifactPath ? { artifactPath: safeArchiveRelativePath(evidence.artifactPath, source.id, 'license artifact path') } : {})
    }
  }
  return { ...source, skillPath, archiveLayout, ...(licenseEvidence ? { licenseEvidence } : {}) }
}

export async function loadExternalSources({ specsDir, selectedIds = [], approvedSourceIds = [] } = {}) {
  const root = resolve(specsDir, 'external')
  const [catalog, lock] = await Promise.all([
    readFile(join(root, 'catalog.yaml'), 'utf8').then(parse), readFile(join(root, 'lock.yaml'), 'utf8').then(parse)
  ])
  if (catalog?.schemaVersion !== 1 || lock?.schemaVersion !== 1 || lock.generated !== true) throw new Error('invalid external catalog or lock')
  if (!Array.isArray(catalog.sources) || !Array.isArray(lock.entries)) throw new Error('invalid external catalog or lock entries')
  const sources = new Map((catalog.sources || []).map(item => [item.id, item]))
  const locks = new Map((lock.entries || []).map(item => [item.id, item]))
  if (sources.size !== catalog.sources.length || locks.size !== lock.entries.length || sources.size !== locks.size || [...sources.keys()].some(id => !locks.has(id))) throw new Error('external catalog and lock do not contain the same unique source ids')
  return selectedIds.map(id => {
    const source = sources.get(id); const locked = locks.get(id)
    if (!source) throw new Error(`unknown external source: ${id}`)
    if (!source.enabled) throw new Error(`external source is gated and disabled: ${id}`)
    if ((source.approvalRequired || source.risk === 'high' || source.risk === 'critical') && !approvedSourceIds.includes(id)) throw new Error(`external source requires explicit approval: ${id}`)
    if (!locked || !/^[a-f0-9]{40}$/.test(locked.resolvedCommit || '') || !/^[a-f0-9]{64}$/.test(locked.sha256 || '')) throw new Error(`external source has no immutable lock: ${id}`)
    for (const field of ['repository', 'ref', 'resolvedCommit', 'archive', 'sha256', 'license', 'review', 'selectedSkills', 'skillPath', 'archiveLayout', 'licenseEvidence', 'approvalRequired', 'risk']) {
      if (String(source[field]) !== String(locked[field])) throw new Error(`external catalog/lock mismatch for ${id}: ${field}`)
    }
    for (const field of ['selectedSkills', 'licenseEvidence']) if (JSON.stringify(source[field]) !== JSON.stringify(locked[field])) throw new Error(`external catalog/lock mismatch for ${id}: ${field}`)
    return validateSource({ ...source, ...locked })
  })
}

async function ensureArchive(source, cacheRoot, fetchImpl) {
  source = validateSource(source)
  await assertSafeCacheRoot(cacheRoot)
  const target = join(cacheRoot, `${source.id}-${source.resolvedCommit}.tar.gz`)
  try {
    const existing = await lstat(target)
    if (existing.isSymbolicLink() || !existing.isFile()) throw new Error(`external cache entry is unsafe: ${source.id}`)
    if (existing.size > MAX_ARCHIVE_BYTES) throw new Error(`external cache entry exceeds download limit: ${source.id}`)
    if (sha256(await readFile(target)) === source.sha256) return target
    await rm(target, { force: true })
  } catch (error) { if (error.code !== 'ENOENT') throw error }
  const controller = new AbortController()
  const fetchTimeout = setTimeout(() => controller.abort(), 120_000)
  let response
  try { response = await fetchImpl(source.archive, { signal: controller.signal }) }
  catch (error) { clearTimeout(fetchTimeout); throw error }
  if (!response.ok) { clearTimeout(fetchTimeout); throw new Error(`external archive download failed: ${source.id}/${response.status}`) }
  const length = Number(response.headers?.get?.('content-length'))
  if (Number.isFinite(length) && length > MAX_ARCHIVE_BYTES) { clearTimeout(fetchTimeout); throw new Error(`external archive exceeds download limit: ${source.id}`) }
  const temporary = `${target}.${randomUUID()}.tmp`
  if (!response.body?.getReader) { clearTimeout(fetchTimeout); throw new Error(`external archive response is not safely streamable: ${source.id}`) }
  const handle = await open(temporary, 'wx', 0o600)
  const digest = createHash('sha256'); let bytes = 0
  try {
    const reader = response.body.getReader()
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      const chunk = Buffer.from(value)
      bytes += chunk.length
      if (bytes > MAX_ARCHIVE_BYTES) { await reader.cancel(); throw new Error(`external archive exceeds download limit: ${source.id}`) }
      digest.update(chunk); await handle.write(chunk)
    }
    await handle.sync()
  } catch (error) {
    await handle.close(); await rm(temporary, { force: true }); throw error
  }
  clearTimeout(fetchTimeout)
  await handle.close()
  if (digest.digest('hex') !== source.sha256) { await rm(temporary, { force: true }); throw new Error(`external archive hash mismatch: ${source.id}`) }
  await rename(temporary, target)
  return target
}

async function assertSafeCacheRoot(cacheRoot) {
  const root = resolve(cacheRoot)
  for (let current = root; ; current = resolve(current, '..')) {
    try {
      const stat = await lstat(current)
      // macOS exposes /var and /tmp as OS-provided aliases. Every caller
      // controlled component below those aliases must still be a real 0700
      // directory; do not reject the platform alias itself.
      if (stat.isSymbolicLink() && !['/var', '/tmp', '/private'].includes(current)) throw new Error('external cache root has a symlink ancestor')
      if (!stat.isSymbolicLink() && !stat.isDirectory()) throw new Error('external cache root ancestor is not a directory')
    } catch (error) { if (error.code !== 'ENOENT') throw error }
    const parent = resolve(current, '..')
    if (parent === current) break
  }
  await mkdir(root, { recursive: true, mode: 0o700 })
  const stat = await lstat(root)
  if (stat.isSymbolicLink() || !stat.isDirectory() || (stat.mode & 0o077)) throw new Error('external cache root must be a private real directory')
  await chmod(root, 0o700)
}

function validateArchivePath(path, sourceId) {
  if (typeof path !== 'string' || !path || /[\u0000-\u001f\u007f]/.test(path) || path.includes('\\') || posix.isAbsolute(path)) throw new Error(`external archive path is unsafe: ${sourceId}`)
  if (path.includes('//')) throw new Error(`external archive path is ambiguous: ${sourceId}`)
  const parts = path.split('/').filter(Boolean)
  if (!parts.length || parts.some(part => part === '.' || part === '..')) throw new Error(`external archive path traverses its root: ${sourceId}`)
  return parts
}

async function validateAndExtractArchive(source, archive, destination) {
  let entries = 0; let expandedBytes = 0; let violation
  const roots = new Set(); const selectedEntries = new Set(); const archiveEntries = new Set(); const discoveredSkills = new Set(); const flatSkillDocuments = new Set()
  const selectedRoots = source.selectedSkills?.map(id => source.skillPath ? `${source.skillPath}/${id}` : id) || [source.skillPath]
  await listTar({
    file: archive,
    strict: true,
    onentry(entry) {
      let parts
      try { parts = validateArchivePath(entry.path, source.id) }
      catch (error) { violation ||= error.message; return }
      if (archiveEntries.has(entry.path)) violation ||= `external archive contains a duplicate path: ${source.id}`
      archiveEntries.add(entry.path)
      roots.add(parts[0]); entries += 1; expandedBytes += Number(entry.size || 0)
      const relativeEntry = source.archiveLayout === 'flat' ? parts.join('/') : parts.slice(1).join('/')
      const selected = source.archiveLayout === 'flat' || selectedRoots.some(root => !root || relativeEntry === root || relativeEntry.startsWith(`${root}/`) || root.startsWith(`${relativeEntry}/`)) || relativeEntry === source.licenseEvidence?.path || source.licenseEvidence?.path?.startsWith(`${relativeEntry}/`)
      if (entries > MAX_ARCHIVE_ENTRIES || expandedBytes > MAX_EXPANDED_BYTES) throw new Error(`external archive exceeds limits: ${source.id}`)
      if (selected) {
        selectedEntries.add(entry.path)
        if (!['File', 'Directory'].includes(entry.type)) violation ||= `external skill subtree contains a forbidden ${entry.type} entry: ${source.id}`
        if (entry.linkpath) violation ||= `external skill subtree contains a link: ${source.id}`
      }
      if (source.archiveLayout === 'flat' && relativeEntry.endsWith('SKILL.md')) flatSkillDocuments.add(relativeEntry)
      for (const root of selectedRoots) if (relativeEntry === (source.archiveLayout === 'flat' ? 'SKILL.md' : `${root}/SKILL.md`)) discoveredSkills.add(root)
      if (!source.selectedSkills && source.archiveLayout === 'subtree' && relativeEntry.endsWith('/SKILL.md')) {
        // A source may point directly at one skill root (for example
        // `archify/` in the archify repository), where SKILL.md is an
        // immediate child of skillPath rather than a child of a named skill
        // below it. In that layout the skill id is the skillPath basename.
        const directSkill = source.skillPath && relativeEntry === `${source.skillPath}/SKILL.md`
          ? posix.basename(source.skillPath)
          : null
        const relative = source.skillPath && relativeEntry.startsWith(`${source.skillPath}/`)
          ? relativeEntry.slice(source.skillPath.length + 1)
          : source.skillPath ? '' : relativeEntry
        const skill = directSkill || relative.split('/')[0]
        if (skill) discoveredSkills.add(skill)
      }
    }
  })
  if (violation) throw new Error(violation)
  if (source.archiveLayout === 'subtree' && roots.size !== 1) throw new Error(`external archive must contain one top-level directory: ${source.id}`)
  if (source.archiveLayout === 'flat' && (flatSkillDocuments.size !== 1 || !flatSkillDocuments.has('SKILL.md'))) throw new Error(`flat external archive must contain one root SKILL.md: ${source.id}`)
  if (source.selectedSkills && selectedRoots.some(root => !discoveredSkills.has(root))) throw new Error(`external archive is missing a selected skill: ${source.id}`)
  if (sha256(await readFile(archive)) !== source.sha256) throw new Error(`external archive changed after verification: ${source.id}`)
  await mkdir(destination, { recursive: true })
  const root = source.archiveLayout === 'flat' ? '' : [...roots][0]
  const flatRoot = join(destination, 'flat')
  if (source.archiveLayout === 'flat') {
    await mkdir(flatRoot, { recursive: true })
    await extractTar({ file: archive, cwd: flatRoot, strict: true, preservePaths: false, noMtime: true, filter: path => selectedEntries.has(path) })
  } else await extractTar({ file: archive, cwd: destination, strict: true, preservePaths: false, noMtime: true, filter: path => selectedEntries.has(path) })
  const subtree = source.archiveLayout === 'flat' ? flatRoot : resolve(destination, root, source.skillPath)
  const expected = source.archiveLayout === 'flat' ? flatRoot : resolve(destination, root)
  if (subtree !== expected && !subtree.startsWith(`${expected}/`)) throw new Error(`external skill subtree escapes extraction root: ${source.id}`)
  const stat = await lstat(subtree)
  if (stat.isSymbolicLink() || !stat.isDirectory()) throw new Error(`external skill subtree is not a real directory: ${source.id}`)
  let licenseFile
  if (source.licenseEvidence?.artifactPath) {
    licenseFile = source.archiveLayout === 'flat' ? join(flatRoot, source.licenseEvidence.path) : join(destination, root, source.licenseEvidence.path)
    const licenseStat = await lstat(licenseFile)
    if (licenseStat.isSymbolicLink() || !licenseStat.isFile() || sha256(await readFile(licenseFile)) !== source.licenseEvidence.sha256) throw new Error(`external license evidence failed verification: ${source.id}`)
  }
  const expectedSkills = source.selectedSkills || [...discoveredSkills].sort()
  if (!expectedSkills.length) throw new Error(`external archive contains no reviewed skills: ${source.id}`)
  return { localSource: subtree, licenseFile, expectedSkills }
}

async function verifySkillsCli(packageRoot = PACKAGE_ROOT) {
  const [manifest, lock, installed] = await Promise.all([
    readFile(join(packageRoot, 'package.json'), 'utf8').then(JSON.parse),
    readFile(join(packageRoot, 'bun.lock'), 'utf8').then(parseBunLock),
    readFile(join(packageRoot, 'node_modules/skills/package.json'), 'utf8').then(JSON.parse)
  ])
  const workspace = lock.workspaces?.['']
  const locked = lock.packages?.skills
  const tuple = Array.isArray(locked) ? locked : []
  const tupleVersion = String(tuple[0] || '').split('@').at(-1)
  const tupleIntegrity = tuple[3]
  if (manifest.dependencies?.skills !== SKILLS_CLI_VERSION || workspace?.dependencies?.skills !== SKILLS_CLI_VERSION || tupleVersion !== SKILLS_CLI_VERSION || tupleIntegrity !== SKILLS_CLI_INTEGRITY || installed.version !== SKILLS_CLI_VERSION) {
    throw new Error('installed skills CLI does not match the exact Bun lock and integrity policy')
  }
  const binary = join(packageRoot, 'node_modules/.bin/skills')
  const expectedBinary = join(packageRoot, 'node_modules/skills/bin/cli.mjs')
  const resolvedBinary = await realpath(expectedBinary)
  if (await realpath(binary) !== resolvedBinary || !(await lstat(expectedBinary)).isFile()) throw new Error('installed skills CLI binary is not the locked package binary')
  if (await hashInstalledTree(join(packageRoot, 'node_modules/skills')) !== SKILLS_CLI_TREE_SHA256) throw new Error('installed skills CLI package tree does not match its reviewed hash')
  return { binary: resolvedBinary, binaryDirectory: join(packageRoot, 'node_modules/.bin'), integrity: tupleIntegrity }
}

async function hashInstalledTree(root) {
  const files = []
  async function walk(current = '') {
    for (const entry of await readdir(join(root, current), { withFileTypes: true })) {
      const path = join(current, entry.name).replaceAll('\\', '/')
      const stat = await lstat(join(root, path))
      if (stat.isSymbolicLink()) throw new Error('installed skills CLI package contains a symlink')
      if (stat.isDirectory()) await walk(path)
      else if (stat.isFile()) files.push(path)
      else throw new Error('installed skills CLI package contains a non-file entry')
    }
  }
  await walk(); files.sort()
  const tree = createHash('sha256')
  for (const path of files) {
    tree.update(path); tree.update('\0'); tree.update(sha256(await readFile(join(root, path)))); tree.update('\n')
  }
  return tree.digest('hex')
}

async function collectPrefix(root, prefix, current = prefix, result = []) {
  let entries
  try {
    const currentStat = await lstat(join(root, current))
    if (currentStat.isSymbolicLink() || !currentStat.isDirectory()) throw new Error(`skills CLI output root is not a real directory: ${prefix}`)
    entries = await readdir(join(root, current), { withFileTypes: true })
  } catch (error) { if (error.code === 'ENOENT') return result; throw error }
  for (const entry of entries) {
    const path = join(current, entry.name).replaceAll('\\', '/')
    const stat = await lstat(join(root, path))
    if (stat.isSymbolicLink()) throw new Error(`skills CLI staging produced a symlink: ${path}`)
    if (stat.isDirectory()) await collectPrefix(root, prefix, path, result)
    else if (stat.isFile()) result.push({ path, content: await readFile(join(root, path)), mode: stat.mode & 0o777 })
  }
  return result
}

function changedOutput(before, after) {
  const existing = new Map(before.map(file => [file.path, sha256(file.content)]))
  return after.filter(file => existing.get(file.path) !== sha256(file.content))
}

function verifySelectedOutput({ source, prefix, before, after, expectedSkills }) {
  const selectedSkills = source.selectedSkills || expectedSkills
  const changed = changedOutput(before, after)
  for (const skill of selectedSkills) {
    const root = `${prefix}/${skill}`
    if (!after.some(file => file.path === `${root}/SKILL.md`)) throw new Error(`skills CLI did not produce requested skill under ${prefix}: ${skill}`)
    if (!changed.some(file => file.path === `${root}/SKILL.md`)) throw new Error(`skills CLI did not attribute requested skill output under ${prefix}: ${skill}`)
  }
  const expectedRoots = selectedSkills.map(skill => `${prefix}/${skill}/`)
  if (changed.some(file => !expectedRoots.some(root => file.path.startsWith(root)))) throw new Error(`skills CLI produced unexpected attributed output for ${source.id} under ${prefix}`)
  return changed
}

export async function stageExternalSkills({ sources, providers, runtimeEnv, runner, fetchImpl = globalThis.fetch, cacheRoot, packageRoot = PACKAGE_ROOT, approvedSourceIds = [] } = {}) {
  if (!sources.length) return { files: [], cache: [], commands: [] }
  if (typeof fetchImpl !== 'function') throw new Error('fetch implementation is required for external archive verification')
  sources = sources.map(validateSource)
  for (const source of sources) if ((source.approvalRequired || source.risk === 'high' || source.risk === 'critical') && !approvedSourceIds.includes(source.id)) throw new Error(`external source requires explicit approval: ${source.id}`)
  if (!Array.isArray(providers) || !providers.length || providers.some(provider => !PROVIDER_AGENTS[provider])) throw new Error('external staging requires supported providers')
  const bun = await assertBunRuntime()
  const baseEnvironment = sanitizeBunEnv(buildAllowlistedEnv({ source: runtimeEnv || {}, allowlist: CHILD_ENV_ALLOWLIST.filter(name => name !== 'HOME' && name !== 'XDG_CACHE_HOME'), required: ['PATH'] }))
  const isolation = await mkdtemp(join(tmpdir(), 'ai-config-child-home-'))
  const isolatedHome = join(isolation, 'home'); const isolatedCache = join(isolation, 'cache'); const isolatedConfig = join(isolation, 'config'); const isolatedData = join(isolation, 'data'); const bunCache = join(isolation, 'bun-cache')
  await Promise.all([isolatedHome, isolatedCache, isolatedConfig, isolatedData, bunCache].map(path => mkdir(path, { recursive: true, mode: 0o700 })))
  const environment = { ...sanitizeBunEnv(baseEnvironment, { install: true, cacheDir: bunCache }), HOME: isolatedHome, XDG_CACHE_HOME: isolatedCache, XDG_CONFIG_HOME: isolatedConfig, XDG_DATA_HOME: isolatedData }
  const effectiveCache = cacheRoot || join(environment.HOME || tmpdir(), '.cache', 'ai-config-v2', 'external')
  const cache = []
  for (const source of sources) cache.push(await ensureArchive(source, effectiveCache, fetchImpl))
  const stageRoot = await mkdtemp(join(tmpdir(), 'ai-config-external-'))
  const commands = []
  const files = []
  const attributed = new Map()
  try {
    const configText = await readFile(join(packageRoot, 'bunfig.toml',), 'utf8')
    await Promise.all(['package.json', 'bun.lock'].map(async name => writeFile(join(stageRoot, name), await readFile(join(packageRoot, name), 'utf8'), { mode: 0o600 })))
    const stageConfig = join(stageRoot, 'bunfig.toml')
    await writeFile(stageConfig, configText, { mode: 0o600 })
    const configStat = await lstat(stageConfig)
    if (!configStat.isFile() || configStat.isSymbolicLink() || await readFile(stageConfig, 'utf8') !== configText) throw new Error('staged Bun configuration is not trusted')
    await runner(bun.executable, ['--no-env-file', `--config=${join(stageRoot, 'bunfig.toml')}`, 'install', '--frozen-lockfile', '--ignore-scripts'], {
      cwd: stageRoot, env: environment, id: 'external-skills-install', purpose: 'external-skills-install', timeoutMs: 300_000
    })
    const skillsCli = await verifySkillsCli(stageRoot)
    for (const [index, source] of sources.entries()) {
      const archive = await readFile(cache[index])
      if (archive.length > MAX_ARCHIVE_BYTES || sha256(archive) !== source.sha256) throw new Error(`external cached archive failed verification: ${source.id}`)
      const localArchive = join(stageRoot, `source-${source.id}.tar.gz`)
      await writeFile(localArchive, archive, { mode: 0o600 })
      const extracted = await validateAndExtractArchive(source, localArchive, join(stageRoot, 'sources', source.id))
      const providerGroups = new Map()
      for (const provider of providers) {
        const prefix = PROVIDER_PREFIXES[provider]
        const group = providerGroups.get(prefix) || []
        group.push(provider); providerGroups.set(prefix, group)
      }
      for (const [prefix, group] of providerGroups) {
        const agents = group.map(provider => PROVIDER_AGENTS[provider])
        const selectedArguments = source.selectedSkills ? ['--skill', ...source.selectedSkills] : []
        const before = await collectPrefix(stageRoot, prefix)
        const args = bunArgs({ sourceRoot: stageRoot, script: skillsCli.binary, args: ['add', extracted.localSource, '--agent', ...agents, ...selectedArguments, '--copy', '--yes', '--full-depth'] })
        commands.push({ command: bun.executable, args: [...args], sourceId: source.id, providers: [...group], targetPrefix: prefix, cliIntegrity: skillsCli.integrity, runtime: 'bun' })
        await runner(bun.executable, args, {
          cwd: stageRoot,
          env: {
            ...environment,
            PATH: `${skillsCli.binaryDirectory}${delimiter}${environment.PATH}`,
            DO_NOT_TRACK: '1', DISABLE_TELEMETRY: '1'
          }, id: 'external-skills', purpose: 'external-skills', timeoutMs: 300_000
        })
        const changed = verifySelectedOutput({ source, prefix, before, after: await collectPrefix(stageRoot, prefix), expectedSkills: extracted.expectedSkills })
        for (const file of changed) {
          if (attributed.has(file.path)) throw new Error(`external sources collide on staged output: ${file.path}`)
          attributed.set(file.path, source.id)
        }
      }
      if (extracted.licenseFile) files.push({ path: source.licenseEvidence.artifactPath, content: await readFile(extracted.licenseFile), mode: 0o644, externalSourceId: source.id })
    }
    for (const prefix of new Set(providers.map(provider => PROVIDER_PREFIXES[provider]))) {
      for (const file of await collectPrefix(stageRoot, prefix)) files.push({ ...file, externalSourceId: attributed.get(file.path) })
    }
    return { files, cache, commands }
  } finally {
    await rm(stageRoot, { recursive: true, force: true })
    await rm(isolation, { recursive: true, force: true })
  }
}
