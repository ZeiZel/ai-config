import { lstat } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { readInstallState } from '../install/state.js'
import { assertNoSymlinkAncestors, safeRelativePath, sha256 } from '../security-guard/index.js'

async function fileStatus(root, path, record) {
  const target = safeRelativePath(root, path).target
  try {
    await assertNoSymlinkAncestors(root, path)
    const stat = await lstat(target)
    if (stat.isSymbolicLink()) return { id: `file:${path}`, status: 'error', message: 'managed target is a symlink' }
    if (!stat.isFile()) return { id: `file:${path}`, status: 'error', message: 'managed target is not a regular file' }
    const { readFile } = await import('node:fs/promises')
    const actual = sha256(await readFile(target))
    const mode = stat.mode & 0o777
    if (actual !== record.sha256) return { id: `file:${path}`, status: 'warning', repairable: false, message: 'locally modified; exact managed content is unavailable to doctor' }
    if (mode !== record.mode) return { id: `file:${path}`, status: 'warning', repairable: false, message: `mode differs from state (${mode.toString(8)} != ${record.mode.toString(8)})` }
    return { id: `file:${path}`, status: 'ok', repairable: true, message: 'hash and mode match state' }
  } catch (error) {
    if (error.code === 'ENOENT') return { id: `file:${path}`, status: 'error', repairable: false, message: 'managed file is missing; exact content is unavailable to doctor' }
    throw error
  }
}

async function providerHomeStatus(root, directory) {
  const target = join(root, directory)
  try {
    const stat = await lstat(target)
    if (stat.isSymbolicLink()) return { id: `provider-home:${directory}`, status: 'warning', message: 'legacy whole-home symlink should be migrated before managed install' }
    return stat.isDirectory()
      ? { id: `provider-home:${directory}`, status: 'ok', message: 'provider home is a real directory' }
      : { id: `provider-home:${directory}`, status: 'error', message: 'provider home is not a directory' }
  } catch (error) {
    if (error.code === 'ENOENT') return { id: `provider-home:${directory}`, status: 'ok', message: 'provider home does not exist yet' }
    throw error
  }
}

export async function doctorInstallation({ targetRoot, statePath, providerHomes = ['.agents', '.claude', '.codex', '.gemini', '.opencode'] } = {}) {
  const root = resolve(targetRoot)
  const checks = []
  let state
  try {
    state = await readInstallState(root, statePath)
    checks.push({ id: 'state', status: Object.keys(state.files).length ? 'ok' : 'warning', message: Object.keys(state.files).length ? 'state manifest is valid' : 'no managed files are recorded' })
  } catch (error) {
    return { healthy: false, repairable: false, checks: [{ id: 'state', status: 'error', message: error.message }] }
  }
  checks.push(...await Promise.all(Object.entries(state.files).map(([path, record]) => fileStatus(root, path, record))))
  checks.push(...await Promise.all(providerHomes.map(directory => providerHomeStatus(root, directory))))
  return {
    healthy: checks.every(check => check.status === 'ok'),
    repairable: checks.every(check => check.repairable !== false && check.status !== 'error'),
    checks
  }
}
