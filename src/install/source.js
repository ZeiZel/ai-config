import { lstat, readFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { safeRelativePath, sha256 } from '../security-guard/index.js'

export async function loadGeneratedFiles(sourceRoot, manifestPath = 'manifest.json') {
  const root = resolve(sourceRoot)
  const rootStat = await lstat(root)
  if (rootStat.isSymbolicLink() || !rootStat.isDirectory()) throw new Error('generated source root must be a real directory')
  const manifestTarget = safeRelativePath(root, manifestPath).target
  await assertRegularSource(root, manifestPath)
  const manifest = JSON.parse(await readFile(manifestTarget, 'utf8'))
  if (!manifest || manifest.schemaVersion !== 1 || !Array.isArray(manifest.files)) throw new Error('invalid generated manifest')
  const files = []
  const seen = new Set()
  for (const record of manifest.files) {
    if (!record || typeof record.path !== 'string' || typeof record.sha256 !== 'string' || seen.has(record.path)) throw new Error('invalid generated manifest record')
    seen.add(record.path)
    await assertRegularSource(root, record.path)
    const content = await readFile(safeRelativePath(root, record.path).target)
    if (sha256(content) !== record.sha256) throw new Error(`generated source hash mismatch: ${record.path}`)
    files.push({ path: record.path, content })
  }
  return files
}


async function assertRegularSource(root, candidate) {
  const { relativePath, target } = safeRelativePath(root, candidate)
  let current = root
  for (const segment of relativePath.split('/')) {
    current = join(current, segment)
    const stat = await lstat(current)
    if (stat.isSymbolicLink()) throw new Error(`generated source contains a symlink: ${relativePath}`)
  }
  if (!(await lstat(target)).isFile()) throw new Error(`generated source is not a regular file: ${relativePath}`)
}
