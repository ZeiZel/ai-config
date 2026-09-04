import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, mkdir, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import {
  installManagedFiles, inventoryLegacyProviderHome, loadGeneratedFiles, readInstallState,
  repairManagedFiles, uninstallManagedFiles
} from '../src/install/index.js'
import { buildSpecKitCommand, initializeProject, selectManagedFilesForIntegration, SPEC_KIT_COMMIT, SPEC_KIT_SOURCE, SPEC_KIT_VERSION } from '../src/init/index.js'
import { doctorInstallation } from '../src/doctor/index.js'

const temp = () => mkdtemp(join(tmpdir(), 'ai-config-install-test-'))
const desired = content => [{ path: '.agents/skills/example/SKILL.md', content }]

test('managed installation is idempotent and records only generated files', async () => {
  const root = await temp()
  await mkdir(join(root, '.git'))
  await writeFile(join(root, 'unknown.txt'), 'preserve me')
  const first = await installManagedFiles({ targetRoot: root, files: desired('v1\n') })
  const second = await installManagedFiles({ targetRoot: root, files: desired('v1\n') })
  assert.equal(first.changes[0].action, 'create')
  assert.equal(second.changes[0].action, 'unchanged')
  assert.equal(await readFile(join(root, 'unknown.txt'), 'utf8'), 'preserve me')
  const state = await readInstallState(root)
  assert.deepEqual(Object.keys(state.files), ['.agents/skills/example/SKILL.md'])
})

test('dry-run exposes hashes and sizes but never desired file contents', async () => {
  const root = await temp()
  const result = await installManagedFiles({ targetRoot: root, files: desired('sensitive-placeholder\n'), dryRun: true })
  assert.equal(JSON.stringify(result).includes('sensitive-placeholder'), false)
  assert.equal(result.changes[0].diff.afterBytes, Buffer.byteLength('sensitive-placeholder\n'))
})

test('Spec Kit timestamp-only changes remain semantically idempotent', async () => {
  const root = await temp(); const path = '.specify/manifest.json'
  await installManagedFiles({ targetRoot: root, files: [{ path, content: '{"installedAt":"2026-09-03T10:00:00+00:00","version":1}\n', semantic: 'spec-kit' }] })
  const second = await installManagedFiles({ targetRoot: root, files: [{ path, content: '{"installedAt":"2026-09-03T11:00:00+00:00","version":1}\n', semantic: 'spec-kit' }] })
  assert.equal(second.changes[0].action, 'unchanged')
  assert.equal(second.changes[0].reason, 'semantic-content-matches')
  assert.match(await readFile(join(root, path), 'utf8'), /10:00:00\+00:00/)
})

test('repair and uninstall preserve locally modified managed files', async () => {
  const root = await temp(); const path = join(root, '.agents/skills/example/SKILL.md')
  await installManagedFiles({ targetRoot: root, files: desired('v1\n') })
  await writeFile(path, 'local edit\n')
  const repair = await repairManagedFiles({ targetRoot: root, files: desired('v2\n') })
  assert.equal(repair.conflicts[0].reason, 'locally-modified-managed-file')
  assert.equal(await readFile(path, 'utf8'), 'local edit\n')
  const uninstall = await uninstallManagedFiles({ targetRoot: root })
  assert.equal(uninstall.changes[0].action, 'preserve')
  assert.equal(await readFile(path, 'utf8'), 'local edit\n')
})

test('uninstall removes only a hash-matched managed file', async () => {
  const root = await temp(); const path = join(root, '.agents/skills/example/SKILL.md')
  await installManagedFiles({ targetRoot: root, files: desired('v1\n') })
  const result = await uninstallManagedFiles({ targetRoot: root })
  assert.equal(result.changes[0].action, 'remove')
  await assert.rejects(() => readFile(path), error => error.code === 'ENOENT')
})

test('repair restores the recorded file mode', async () => {
  const root = await temp(); const path = '.agents/skills/example/SKILL.md'
  await installManagedFiles({ targetRoot: root, files: [{ path, content: 'private\n', mode: 0o600 }] })
  await import('node:fs/promises').then(({ unlink }) => unlink(join(root, path)))
  await repairManagedFiles({ targetRoot: root, files: [{ path, content: 'private\n' }] })
  const stat = await import('node:fs/promises').then(({ stat }) => stat(join(root, path)))
  assert.equal(stat.mode & 0o777, 0o600)
})

test('an identical unmanaged file is never adopted or removed', async () => {
  const root = await temp(); const file = desired('user-owned\n')[0]
  await mkdir(dirname(join(root, file.path)), { recursive: true }); await writeFile(join(root, file.path), file.content)
  const install = await installManagedFiles({ targetRoot: root, files: [file] })
  assert.equal(install.changes[0].reason, 'existing-unmanaged-content-matches')
  assert.deepEqual(install.state.files, {})
  await uninstallManagedFiles({ targetRoot: root })
  assert.equal(await readFile(join(root, file.path), 'utf8'), 'user-owned\n')
})

test('a live lifecycle lock fails closed without publishing changes', async () => {
  const root = await temp(); const lock = join(root, '.ai-config-lifecycle.lock')
  await mkdir(lock); await writeFile(join(lock, 'owner.json'), `${JSON.stringify({ pid: process.pid })}\n`)
  await assert.rejects(() => installManagedFiles({ targetRoot: root, files: desired('blocked\n') }), error => error.code === 'MANAGED_INSTALL_LOCKED')
  await assert.rejects(() => readFile(join(root, '.agents/skills/example/SKILL.md')), error => error.code === 'ENOENT')
})

test('managed installation rejects traversal and symlink ancestors', async t => {
  const root = await temp()
  await assert.rejects(() => installManagedFiles({ targetRoot: root, files: [{ path: '../escape', content: 'x' }] }), /escapes its root/)
  await assert.rejects(() => installManagedFiles({ targetRoot: root, files: [{ path: '.claude', content: 'x' }] }), /provider home cannot be a managed file/)
  if (process.platform === 'win32') return t.skip('symlink creation requires platform-specific privileges')
  const { symlink } = await import('node:fs/promises')
  await mkdir(join(root, 'real')); await symlink(join(root, 'real'), join(root, '.agents'))
  await assert.rejects(() => installManagedFiles({ targetRoot: root, files: desired('x') }), /symlink ancestor/)
})

test('managed installation never writes through a symlinked provider root', async t => {
  if (process.platform === 'win32') return t.skip('symlink creation requires platform-specific privileges')
  const parent = await temp(); const real = join(parent, 'real'); const linked = join(parent, 'linked')
  await mkdir(real)
  const { symlink } = await import('node:fs/promises'); await symlink(real, linked)
  await assert.rejects(() => installManagedFiles({ targetRoot: linked, files: desired('x') }), /target root must not be a symlink/)
  assert.deepEqual(await import('node:fs/promises').then(({ readdir }) => readdir(real)), [])
})

test('state manifest cannot be read through a symlink', async t => {
  if (process.platform === 'win32') return t.skip('symlink creation requires platform-specific privileges')
  const root = await temp(); const outside = await temp()
  await writeFile(join(outside, 'state.json'), `${JSON.stringify({ schemaVersion: 1, files: {} })}\n`)
  const { symlink } = await import('node:fs/promises'); await symlink(outside, join(root, '.ai-config'))
  await assert.rejects(() => readInstallState(root), /contains a symlink/)
})

test('doctor reports missing and locally modified state without mutating it', async () => {
  const root = await temp(); const path = join(root, '.agents/skills/example/SKILL.md')
  await installManagedFiles({ targetRoot: root, files: desired('v1\n') })
  await writeFile(path, 'changed\n')
  const result = await doctorInstallation({ targetRoot: root, providerHomes: [] })
  assert.equal(result.healthy, false)
  // Doctor has no exact source payload, so a locally modified file is not
  // independently repairable; init/repair must be rerun with the exact
  // selected generated sources.
  assert.equal(result.repairable, false)
  assert.equal(result.checks.find(check => check.id.includes('SKILL.md')).status, 'warning')
})

test('Spec Kit command is immutable and project init stages before managed publication', async () => {
  assert.equal(SPEC_KIT_VERSION, 'v1.0.4')
  assert.equal(SPEC_KIT_COMMIT, 'cb610277fdea781fcfa83d20522c2db37c94068d')
  assert.equal(SPEC_KIT_SOURCE.endsWith(`@${SPEC_KIT_COMMIT}`), true)
  assert.deepEqual(buildSpecKitCommand('codex').args.slice(0, 3), ['--from', SPEC_KIT_SOURCE, 'specify'])
  const root = await temp()
  await mkdir(join(root, '.git'))
  await writeFile(join(root, 'unknown.txt'), 'preserve')
  const fakeRunner = async (command, args, { cwd, env }) => {
    assert.equal(Object.hasOwn(env, 'UNEXPECTED_TOKEN'), false)
    if (command === 'uvx') for (const name of ['HOME', 'XDG_CACHE_HOME', 'XDG_CONFIG_HOME', 'XDG_DATA_HOME']) assert.match(env[name], /ai-config-child-home|ai-config-external/)
    if (command === 'uvx') {
      await mkdir(join(cwd, '.specify'), { recursive: true }); await writeFile(join(cwd, '.specify/template.md'), 'pinned template\n')
    } else if (command === 'bd') {
      if (args[0] === 'init') await mkdir(join(cwd, '.beads'))
      else if (args[0] === 'dolt') assert.equal(args[1], 'status')
      else assert.equal(args.includes('prime'), true)
    } else assert.fail(`unexpected command: ${command}`)
    return { code: 0, stdout: '' }
  }
  const options = {
    projectRoot: root, providers: ['codex'], specsDir: resolve('ai-specs'), includeExternal: false,
    runtimeEnv: { PATH: '/bin', UNEXPECTED_TOKEN: 'secret' }, runner: fakeRunner,
    executableFinder: async () => true
  }
  const first = await initializeProject(options)
  const second = await initializeProject(options)
  assert.equal(first.install.changes[0].action, 'create')
  assert.equal(second.install.changes[0].action, 'unchanged')
  assert.equal(first.beads, 'initialized-and-primed')
  assert.equal(second.beads, 'existing-primed')
  assert.equal(await readFile(join(root, 'unknown.txt'), 'utf8'), 'preserve')
})

test('project init dry-run invokes no external process and reports default Beads plan', async () => {
  const root = await temp(); let calls = 0
  await mkdir(join(root, '.git'))
  const result = await initializeProject({
    projectRoot: root, providers: ['codex'], specsDir: resolve('ai-specs'), includeExternal: false,
    runtimeEnv: { PATH: '/bin' }, dryRun: true, executableFinder: async () => true,
    runner: async () => { calls += 1; throw new Error('runner must not be called') }
  })
  assert.equal(calls, 0)
  assert.equal(result.specKit, 'would-stage-pinned-template')
  assert.equal(result.beads, 'would-initialize-and-prime')
})

test('no-spec-kit reconciles only owned .specify files and preserves local modifications as conflicts', async () => {
  const optionsFor = root => ({
    projectRoot: root, providers: ['codex'], specsDir: resolve('ai-specs'), includeExternal: false, includeMcp: false,
    initializeBeads: false, runtimeEnv: { PATH: '/bin' }, executableFinder: async () => true,
    runner: async (command, _args, { cwd }) => { if (command === 'uvx') { await mkdir(join(cwd, '.specify'), { recursive: true }); await writeFile(join(cwd, '.specify/template.md'), 'managed\n') }; return { code: 0, stdout: '' } }
  })
  const clean = await temp(); await mkdir(join(clean, '.git'))
  await initializeProject(optionsFor(clean))
  await initializeProject({ ...optionsFor(clean), includeSpecKit: false })
  await assert.rejects(() => readFile(join(clean, '.specify/template.md')), error => error.code === 'ENOENT')

  const modified = await temp(); await mkdir(join(modified, '.git'))
  await initializeProject(optionsFor(modified)); await writeFile(join(modified, '.specify/template.md'), 'user edit\n')
  await assert.rejects(() => initializeProject({ ...optionsFor(modified), includeSpecKit: false }), error => error.code === 'MANAGED_FILE_CONFLICT' && error.conflicts.some(change => change.path === '.specify/template.md'))
  assert.equal(await readFile(join(modified, '.specify/template.md'), 'utf8'), 'user edit\n')
})

test('project init selects only the requested provider projection', () => {
  const files = [
    { path: '.agents/skills/x/SKILL.md' }, { path: '.claude/skills/x/SKILL.md' },
    { path: '.gemini/skills/x/SKILL.md' }, { path: '.opencode/skills/x/SKILL.md' }
  ]
  assert.deepEqual(selectManagedFilesForIntegration(files, 'codex').map(file => file.path), ['.agents/skills/x/SKILL.md'])
})

test('legacy inventory never follows symlinks and preserves runtime and unknown data', async t => {
  const root = await temp()
  await mkdir(join(root, 'skills/example'), { recursive: true }); await writeFile(join(root, 'skills/example/SKILL.md'), 'known')
  await mkdir(join(root, 'sessions'), { recursive: true }); await writeFile(join(root, 'sessions/runtime.json'), 'runtime')
  await writeFile(join(root, 'personal.json'), 'unknown')
  if (process.platform !== 'win32') {
    const { symlink } = await import('node:fs/promises'); await symlink('/tmp', join(root, 'external-link'))
  } else t.diagnostic('symlink assertion skipped on Windows')
  const inventory = await inventoryLegacyProviderHome({ legacyRoot: root, knownManagedPaths: ['skills/example/SKILL.md'] })
  assert.equal(inventory.find(item => item.path === 'skills/example/SKILL.md').classification, 'known-managed-review')
  assert.equal(inventory.find(item => item.path === 'sessions/runtime.json').classification, 'runtime-preserve')
  assert.equal(inventory.find(item => item.path === 'personal.json').classification, 'unknown-preserve')
  if (process.platform !== 'win32') assert.deepEqual(inventory.find(item => item.path === 'external-link'), { path: 'external-link', kind: 'symlink', classification: 'unknown-preserve' })
})

test('legacy inventory reports but never follows a whole-home symlink', async t => {
  if (process.platform === 'win32') return t.skip('symlink creation requires platform-specific privileges')
  const parent = await temp(); const real = join(parent, 'real'); const linked = join(parent, 'legacy-home')
  await mkdir(real); await writeFile(join(real, 'private-runtime.json'), 'preserve')
  const { symlink } = await import('node:fs/promises'); await symlink(real, linked)
  assert.deepEqual(await inventoryLegacyProviderHome({ legacyRoot: linked }), [
    { path: '.', kind: 'symlink-root', classification: 'legacy-root-link-review' }
  ])
})

test('generated source loader rejects symlinked manifest content', async t => {
  if (process.platform === 'win32') return t.skip('symlink creation requires platform-specific privileges')
  const root = await temp(); const external = join(await temp(), 'external.md')
  await writeFile(external, 'outside')
  const { createHash } = await import('node:crypto'); const hash = createHash('sha256').update('outside').digest('hex')
  await writeFile(join(root, 'manifest.json'), `${JSON.stringify({ schemaVersion: 1, files: [{ path: 'linked.md', sha256: hash }] })}\n`)
  const { symlink } = await import('node:fs/promises'); await symlink(external, join(root, 'linked.md'))
  await assert.rejects(() => loadGeneratedFiles(root), /contains a symlink/)
})
