import { lstat, readFile, realpath } from 'node:fs/promises'
import { join, resolve } from 'node:path'

const root = resolve(process.argv[2] || '.')
const expected = {
  '@playwright/mcp': '0.0.80',
  ajv: '8.20.0',
  'chrome-devtools-mcp': '1.7.0',
  'mcp-remote': '0.8.3',
  skills: '1.5.23',
  tar: '7.5.22',
  yaml: '2.9.0'
}

const lock = Bun.JSONC.parse(await readFile(join(root, 'bun.lock'), 'utf8'))
const workspace = lock.workspaces?.['']
const manifest = JSON.parse(await readFile(join(root, 'package.json'), 'utf8'))
for (const [name, version] of Object.entries(expected)) {
  if (manifest.dependencies?.[name] !== version) throw new Error(`package manifest dependency mismatch: ${name}`)
  if (workspace?.dependencies?.[name] !== version) throw new Error(`Bun workspace dependency mismatch: ${name}`)
  const tuple = lock.packages?.[name]
  if (!Array.isArray(tuple) || tuple[0] !== `${name}@${version}` || typeof tuple[3] !== 'string' || !tuple[3].startsWith('sha512-')) throw new Error(`Bun lock integrity is missing: ${name}`)
  const packagePath = join(root, 'node_modules', name, 'package.json')
  const stat = await lstat(packagePath)
  if (!stat.isFile() || stat.isSymbolicLink()) throw new Error(`installed dependency is not a regular file: ${name}`)
  const installed = JSON.parse(await readFile(packagePath, 'utf8'))
  if (installed.name !== name || installed.version !== version) throw new Error(`installed dependency mismatch: ${name}`)
}
const skillsBin = join(root, 'node_modules/.bin/skills')
const skillsStat = await lstat(skillsBin)
if (!skillsStat.isFile() && !skillsStat.isSymbolicLink()) throw new Error('skills executable is missing')
const skillsTarget = await realpath(skillsBin)
const expectedSkillsTarget = await realpath(join(root, 'node_modules/skills/bin/cli.mjs'))
if (skillsTarget !== expectedSkillsTarget) throw new Error('skills executable escapes its locked package')
