import { isAbsolute, relative, resolve, sep, dirname } from 'node:path'
import { lstat, realpath } from 'node:fs/promises'
import { fail } from './errors.js'

export function safeOutput(root, candidate) {
  if (isAbsolute(candidate)) fail(`absolute output path is forbidden: ${candidate}`)
  const base = resolve(root); const target = resolve(base, candidate)
  const rel = relative(base, target)
  if (!rel || rel === '..' || rel.startsWith(`..${sep}`) || isAbsolute(rel)) fail(`path traversal in output path: ${candidate}`)
  return target
}

export async function assertSafeAncestors(root, target) {
  const base = resolve(root)
  let baseStat
  try { baseStat = await lstat(base) } catch (error) { if (error.code !== 'ENOENT') throw error }
  if (baseStat?.isSymbolicLink()) fail(`output root is a symlink: ${base}`)
  await assertNoUnsafeLexicalSymlinks(base, 'output')
  const targetParent = resolve(dirname(target))
  let nearest = base
  while (true) {
    try {
      const stat = await lstat(nearest)
      if (stat.isSymbolicLink()) fail(`symlink ancestor in output path: ${nearest}`)
      break
    } catch (error) {
      if (error.code === 'ENOENT') { const parent = dirname(nearest); if (parent === nearest) break; nearest = parent; continue }
      throw error
    }
  }
  // The nearest existing directory may itself be reached through a symlink
  // hidden above a missing subtree; inspect that complete lexical chain.
  let ancestor = base
  const stop = dirname(nearest)
  while (!baseStat && ancestor !== stop && ancestor !== dirname(ancestor)) {
    ancestor = dirname(ancestor)
    try { const stat = await lstat(ancestor); if (stat.isSymbolicLink()) fail(`symlink ancestor in output path: ${ancestor}`) }
    catch (error) { if (error.code !== 'ENOENT') throw error }
  }
  const canonicalBase = baseStat ? await realpath(base) : await realpath(nearest)
  const relTarget = relative(nearest, targetParent).split(sep).filter(Boolean)
  let cursor = nearest
  for (const component of relTarget) {
    cursor = `${cursor}${sep}${component}`
    try {
      const stat = await lstat(cursor)
      if (stat.isSymbolicLink()) fail(`symlink ancestor in output path: ${cursor}`)
      const canonical = await realpath(cursor)
      const rel = relative(canonicalBase, canonical)
      if (rel === '..' || rel.startsWith(`..${sep}`) || isAbsolute(rel)) fail(`output ancestor escapes root: ${cursor}`)
    } catch (error) { if (error.code !== 'ENOENT') throw error }
  }
}

// macOS exposes /tmp and /var as stable OS aliases. User-controlled aliases
// anywhere below (or beside) the operation root are never trusted.
function isStableSystemAlias(path) { return path === '/tmp' || path === '/var' }

async function assertNoUnsafeLexicalSymlinks(start, kind) {
  let cursor = resolve(start)
  while (true) {
    try {
      const stat = await lstat(cursor)
      if (stat.isSymbolicLink() && !isStableSystemAlias(cursor)) fail(`symlink ancestor in ${kind} path: ${cursor}`)
    } catch (error) { if (error.code !== 'ENOENT') throw error }
    const parent = dirname(cursor); if (parent === cursor) break; cursor = parent
  }
}

export async function assertSafeInput(root, target) {
  const base = resolve(root); const candidate = resolve(target)
  const rel = relative(base, candidate)
  if (rel === '..' || rel.startsWith(`..${sep}`) || isAbsolute(rel)) fail(`input path escapes spec root: ${target}`)
  let cursor = candidate
  const canonicalBase = await realpath(base)
  await assertNoUnsafeLexicalSymlinks(base, 'spec input')
  while (cursor !== dirname(cursor)) {
    try {
      const stat = await lstat(cursor)
      if (stat.isSymbolicLink()) fail(`symlink in spec input: ${cursor}`)
      const canonical = await realpath(cursor)
      const canonicalRel = relative(canonicalBase, canonical)
      if (canonicalRel === '..' || canonicalRel.startsWith(`..${sep}`) || isAbsolute(canonicalRel)) fail(`spec input escapes root: ${cursor}`)
      if (cursor === base) return
      cursor = dirname(cursor)
    } catch (error) {
      if (error.code === 'ENOENT') { cursor = dirname(cursor); continue }
      throw error
    }
  }
  fail(`missing spec input: ${target}`)
}

export async function assertSafeTarget(root, target) {
  await assertSafeAncestors(root, target)
  try {
    const stat = await lstat(target)
    if (stat.isSymbolicLink()) fail(`symlink output target: ${target}`)
  } catch (error) {
    if (error.code !== 'ENOENT') throw error
  }
}
