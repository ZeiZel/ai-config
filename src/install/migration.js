import { lstat, readdir } from 'node:fs/promises'
import { join, relative, resolve } from 'node:path'
import { installManagedFiles } from './index.js'

const DEFAULT_RUNTIME_SEGMENTS = new Set([
  'cache', 'caches', 'debug', 'history', 'logs', 'projects', 'sessions', 'shell-snapshots',
  'statsig', 'telemetry', 'tasks', 'todos', 'tmp', 'workspaceStorage'
])

async function walkWithoutFollowingSymlinks(root, current = '', result = []) {
  let entries
  try { entries = await readdir(join(root, current), { withFileTypes: true }) } catch (error) { if (error.code === 'ENOENT') return result; throw error }
  for (const entry of entries) {
    const path = join(current, entry.name)
    const stat = await lstat(join(root, path))
    if (stat.isSymbolicLink()) result.push({ path, kind: 'symlink' })
    else if (stat.isDirectory()) await walkWithoutFollowingSymlinks(root, path, result)
    else if (stat.isFile()) result.push({ path, kind: 'file' })
    else result.push({ path, kind: 'other' })
  }
  return result
}

export async function inventoryLegacyProviderHome({ legacyRoot, knownManagedPaths = [], runtimeSegments = DEFAULT_RUNTIME_SEGMENTS } = {}) {
  const root = resolve(legacyRoot)
  const rootStat = await lstat(root)
  if (rootStat.isSymbolicLink()) {
    return [{ path: '.', kind: 'symlink-root', classification: 'legacy-root-link-review' }]
  }
  if (!rootStat.isDirectory()) throw new Error('legacy provider home must be a directory or symlink')
  const known = new Set(knownManagedPaths.map(path => path.replaceAll('\\', '/')))
  const entries = await walkWithoutFollowingSymlinks(root)
  return entries.map(entry => {
    const path = relative(root, join(root, entry.path)).replaceAll('\\', '/')
    const segments = path.split('/')
    let classification = 'unknown-preserve'
    if (segments.some(segment => runtimeSegments.has(segment))) classification = 'runtime-preserve'
    else if (known.has(path)) classification = 'known-managed-review'
    return { path, kind: entry.kind, classification }
  }).sort((a, b) => a.path.localeCompare(b.path))
}

export async function migrateLegacyProviderHome({ legacyRoot, targetRoot = legacyRoot, knownManagedPaths = [], desiredFiles, statePath, dryRun = true } = {}) {
  const inventory = await inventoryLegacyProviderHome({ legacyRoot, knownManagedPaths })
  const installation = await installManagedFiles({ targetRoot, files: desiredFiles, statePath, dryRun })
  return {
    dryRun,
    inventory,
    preserved: inventory.filter(item => item.classification !== 'known-managed-review'),
    managedCandidates: inventory.filter(item => item.classification === 'known-managed-review'),
    installation
  }
}
