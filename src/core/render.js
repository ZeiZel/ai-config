import { mkdir, writeFile, readFile, readdir, lstat, unlink, rename, rmdir, chmod } from 'node:fs/promises'
import { dirname, join, relative } from 'node:path'
import { loadSpecs } from './loader.js'
import { safeOutput, assertSafeAncestors, assertSafeTarget } from './paths.js'
import { fail } from './errors.js'
import { getAdapter } from '../adapters/index.js'

const frontmatter = meta => `---\nname: ${meta.id}\ndescription: ${JSON.stringify(meta.description)}\n---\n`

export function renderSkill(spec, provider) {
  if (!spec.meta.providers.includes(provider)) return null
  return `${frontmatter(spec.meta)}\n${spec.body.trimEnd()}\n`
}

export async function render({ specsDir = 'ai-specs', outDir = 'generated', check = false, clean = false, faultAfter = 0 } = {}) {
  let faultCount = 0
  const fault = () => { if (faultAfter > 0 && ++faultCount >= faultAfter) throw new Error('injected generator failure') }
  const { skills, providers, catalog } = await loadSpecs(specsDir)
  // Do not read a manifest through a symlinked root or manifest path.
  await assertSafeTarget(outDir, join(outDir, 'manifest.json'))
  const previous = await readManifest(outDir)
  if (clean) {
    const snapshot = await snapshotPaths(outDir, [...(previous.files || []).map(entry => entry.path), 'manifest.json'])
    try {
      await pruneManaged(outDir, previous, new Set(), fault)
      const manifestPath = join(outDir, 'manifest.json')
      await assertSafeTarget(outDir, manifestPath)
      try { await unlink(manifestPath) } catch (error) { if (error.code !== 'ENOENT') throw error }
      fault()
      await pruneEmptyDirs(outDir)
    } catch (error) { await restoreSnapshot(snapshot); throw error }
    return { files: [] }
  }
  const files = []
  const projections = []
  for (const provider of providers) for (const spec of skills) {
    const adapter = getAdapter(provider)
    const content = adapter.renderSkill(spec)
    if (!content) { projections.push({ provider, id: spec.id, status: 'unsupported' }); continue }
    projections.push({ provider, id: spec.id, status: 'native' })
    const rel = join(catalog.providers[provider].skillDir, spec.id, catalog.providers[provider].skillFile || 'SKILL.md')
    const target = safeOutput(outDir, rel); if (files.some(x => x.path === rel)) fail(`output collision: ${rel}`)
    files.push({ path: rel, sha256: await digest(content), content, target })
  }
  files.sort((a, b) => a.path.localeCompare(b.path))
  const manifest = { schemaVersion: 1, files: files.map(({ path, sha256 }) => ({ path, sha256 })) }
  const manifestBytes = `${JSON.stringify(manifest, null, 2)}\n`
  // Preflight every destination before mkdir/prune/write can mutate anything.
  for (const file of files) await assertSafeTarget(outDir, file.target)
  if (check) {
    for (const file of files) {
      let actual
      try { actual = await readFile(file.target, 'utf8') } catch (error) { if (error.code === 'ENOENT') fail(`missing generated file: ${file.path}`); throw error }
      if (actual !== file.content) fail(`stale generated file: ${file.path}`)
    }
    let actualManifest
    try { actualManifest = await readFile(join(outDir, 'manifest.json'), 'utf8') } catch (error) { if (error.code === 'ENOENT') fail('missing generated manifest'); throw error }
    if (actualManifest !== manifestBytes) fail('stale generated manifest')
    const expected = new Set(files.map(file => file.path));
    for (const path of await generatedFiles(outDir)) if (!expected.has(path)) fail(`orphan generated file: ${path}`)
    return { files, projections }
  }
  await assertWriteOwnership(outDir, files, previous)
  const snapshot = await snapshotPaths(outDir, [...(previous.files || []).map(entry => entry.path), ...files.map(file => file.path), 'manifest.json'])
  try {
    await mkdir(outDir, { recursive: true })
    await pruneManaged(outDir, previous, new Set(files.map(file => file.path)), fault)
    for (const file of files) { await mkdir(dirname(file.target), { recursive: true }); await assertSafeTarget(outDir, file.target); await atomicWrite(file.target, file.content); fault() }
    const manifestPath = join(outDir, 'manifest.json'); await assertSafeTarget(outDir, manifestPath); await atomicWrite(manifestPath, manifestBytes)
  } catch (error) { await restoreSnapshot(snapshot); throw error }
  return { files, projections }
}

async function generatedFiles(root, current = '') {
  const result = []
  let entries
  try { entries = await readdir(join(root, current), { withFileTypes: true }) } catch (error) { if (error.code === 'ENOENT') return result; throw error }
  for (const entry of entries) {
    const rel = join(current, entry.name)
    if (entry.isDirectory()) result.push(...await generatedFiles(root, rel))
    else if (entry.name !== 'manifest.json') result.push(rel)
  }
  return result
}

async function digest(value) { const { createHash } = await import('node:crypto'); return createHash('sha256').update(value).digest('hex') }

async function readManifest(root) {
  const path = join(root, 'manifest.json')
  try {
    await assertSafeTarget(root, path)
    const value = JSON.parse(await readFile(path, 'utf8'))
    if (value?.schemaVersion !== 1 || !Array.isArray(value.files) || Object.keys(value).some(key => !['schemaVersion', 'files'].includes(key))) fail('invalid generated manifest')
    const seen = new Set(); const resolved = new Set()
    for (const entry of value.files) {
      if (!entry || typeof entry.path !== 'string' || !/^[^/][^\0]*$/.test(entry.path) || entry.path.includes('\\') || entry.path.split('/').some(segment => !segment || segment === '.' || segment === '..') || typeof entry.sha256 !== 'string' || !/^[a-f0-9]{64}$/.test(entry.sha256) || Object.keys(entry).some(key => !['path', 'sha256'].includes(key))) fail('invalid generated manifest entry')
      if (seen.has(entry.path)) fail(`duplicate generated manifest path: ${entry.path}`)
      seen.add(entry.path); const target = safeOutput(root, entry.path); if (resolved.has(target)) fail(`duplicate generated manifest target: ${entry.path}`); resolved.add(target)
    }
    return value
  }
  catch (error) { if (error.code === 'ENOENT') return { schemaVersion: 1, files: [] }; if (error instanceof SyntaxError) fail('invalid generated manifest JSON'); throw error }
}

async function assertWriteOwnership(root, files, previous) {
  const managed = new Map((previous.files || []).map(entry => [entry.path, entry]))
  for (const file of files) {
    let stat
    try { stat = await lstat(file.target) } catch (error) { if (error.code === 'ENOENT') continue; throw error }
    if (!stat.isFile()) fail(`managed output conflict: ${file.path}`)
    const old = managed.get(file.path)
    if (!old) fail(`unmanaged output conflict: ${file.path}`)
    if (await digest(await readFile(file.target)) !== old.sha256) fail(`locally modified generated file: ${file.path}`)
  }
}

async function pruneManaged(root, manifest, keep = new Set(), fault = () => {}) {
  for (const entry of manifest.files || []) {
    if (keep.has(entry.path)) continue
    const target = safeOutput(root, entry.path)
    try {
      await assertSafeTarget(root, target)
      const stat = await lstat(target)
      if (!stat.isFile() || await digest(await readFile(target)) !== entry.sha256) continue
      await unlink(target)
      fault()
    } catch (error) { if (error.code !== 'ENOENT') throw error }
  }
}

async function atomicWrite(target, content) {
  const temp = `${target}.tmp-${process.pid}-${Math.random().toString(16).slice(2)}`
  try {
    await writeFile(temp, content, { flag: 'wx', mode: 0o600 })
    await rename(temp, target)
  } catch (error) {
    try { await unlink(temp) } catch (cleanup) { if (cleanup.code !== 'ENOENT') throw cleanup }
    throw error
  }
}

async function snapshotPaths(root, paths) {
  const snapshot = []
  for (const rel of paths) {
    const target = safeOutput(root, rel)
    try { await assertSafeTarget(root, target); const stat = await lstat(target); if (stat.isSymbolicLink()) fail(`symlink output target: ${target}`); if (stat.isFile()) snapshot.push({ target, content: await readFile(target), mode: stat.mode, exists: true }) }
    catch (error) { if (error.code !== 'ENOENT') throw error; snapshot.push({ target, exists: false }) }
  }
  return snapshot
}

async function restoreSnapshot(snapshot) {
  for (const entry of snapshot) {
    if (entry.exists) { await mkdir(dirname(entry.target), { recursive: true }); await atomicWrite(entry.target, entry.content); await chmod(entry.target, entry.mode) }
    else { try { await unlink(entry.target) } catch (error) { if (error.code !== 'ENOENT') throw error } }
  }
}

async function pruneEmptyDirs(root) {
  let entries
  try { entries = await readdir(root, { withFileTypes: true }) } catch (error) { if (error.code === 'ENOENT') return; throw error }
  for (const entry of entries) {
    if (!entry.isDirectory()) continue
    const path = join(root, entry.name)
    await pruneEmptyDirs(path)
    try { const remaining = await readdir(path); if (remaining.length === 0) await rmdir(path) } catch (error) { if (error.code !== 'ENOENT' && error.code !== 'ENOTEMPTY') throw error }
  }
}
