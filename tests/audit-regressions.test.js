import test from 'node:test'
import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { chmod, cp, mkdir, mkdtemp, readFile, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { c as createTar } from 'tar'
import { doctorInstallation } from '../src/doctor/index.js'
import { initializeProject, spawnCommand } from '../src/init/index.js'
import { loadProjectProfiles } from '../src/init/profiles.js'
import { buildManagedProjectFiles } from '../src/init/project-files.js'
import { loadExternalSources, stageExternalSkills, uninstallManagedFiles } from '../src/install/index.js'
import { parseBunLock } from '../src/install/external.js'
import { sha256 } from '../src/security-guard/index.js'

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')

test('bun.lock parsing uses Bun JSONC and preserves strings while rejecting malformed input', () => {
  const parsed = parseBunLock('{\n // comment\n "value": "a,b,]",\n "nested": [1,],\n}')
  assert.equal(parsed.value, 'a,b,]')
  assert.deepEqual(parsed.nested, [1])
  assert.throws(() => parseBunLock('{ "unterminated": '), /invalid bun\.lock/)
})
const specsDir = join(repoRoot, 'ai-specs')
const cli = join(repoRoot, 'bin/ai-config-lifecycle.mjs')
const temp = () => mkdtemp(join(tmpdir(), 'ai-config-audit-'))

function streamResponse(bytes) {
  return { ok: true, body: new ReadableStream({ start(controller) { controller.enqueue(bytes); controller.close() } }) }
}

function run(command, args, { cwd = repoRoot, env = process.env } = {}) {
  return new Promise((resolvePromise, reject) => {
    const child = spawn(command, args, { cwd, env, shell: false, stdio: ['ignore', 'pipe', 'pipe'] })
    const stdout = []; const stderr = []
    child.stdout.on('data', chunk => stdout.push(chunk)); child.stderr.on('data', chunk => stderr.push(chunk))
    child.once('error', reject)
    child.once('close', code => resolvePromise({ code, stdout: Buffer.concat(stdout).toString(), stderr: Buffer.concat(stderr).toString() }))
  })
}

async function archiveFixture({ symlinkEntry = false } = {}) {
  const root = await temp(); const top = join(root, 'fixture-main'); const skill = join(top, 'skills/fixture')
  await mkdir(skill, { recursive: true })
  await writeFile(join(skill, 'SKILL.md'), '---\nname: fixture\ndescription: local verified fixture\n---\n\n# Fixture\n')
  if (symlinkEntry) await symlink('/outside-content-must-not-be-read', join(skill, 'outside'))
  const file = join(root, 'fixture.tar.gz')
  await createTar({ gzip: true, file, cwd: root }, ['fixture-main'])
  return readFile(file)
}

test('verified local archive drives one offline skills command for the shared agents target', async () => {
  const archive = await archiveFixture()
  const source = { id: 'fixture', repository: 'https://example.test/source', resolvedCommit: 'a'.repeat(40), archive: 'https://example.test/source.tar.gz', sha256: sha256(archive), license: 'MIT', review: 'fixture-review', skillPath: 'skills' }
  const commands = []
  const runner = async (command, args, options) => {
    commands.push({ command, args })
    const result = await run(command, args, options)
    if (result.code) throw new Error(result.stderr)
    return result
  }
  const result = await stageExternalSkills({
    sources: [source], providers: ['codex', 'opencode', 'gemini'], runtimeEnv: { PATH: process.env.PATH, HOME: await temp() },
    cacheRoot: await temp(), runner, fetchImpl: async () => streamResponse(archive)
  })
  assert.equal(commands.length, 2)
  assert.match(commands[0].command, /bun$/)
  assert.deepEqual(commands[0].args.slice(-3), ['install', '--frozen-lockfile', '--ignore-scripts'])
  assert.deepEqual(commands[1].args.slice(0, 2), ['--no-env-file', '--no-install'])
  assert.match(commands[1].args[3], /node_modules\/skills\/bin\/cli\.mjs$/)
  assert.equal(commands[1].args[4], 'add')
  assert.equal(commands[1].args.some(value => value.startsWith('https://')), false)
  assert.deepEqual(result.files.map(file => file.path), ['.agents/skills/fixture/SKILL.md'])
})

test('archive links are rejected before the skills runner can observe external content', async () => {
  const archive = await archiveFixture({ symlinkEntry: true }); const cacheRoot = await temp(); let calls = 0
  const source = { id: 'fixture', repository: 'https://example.test/source', resolvedCommit: 'a'.repeat(40), archive: 'https://example.test/source.tar.gz', sha256: sha256(archive), license: 'MIT', review: 'fixture-review', skillPath: 'skills' }
  await assert.rejects(() => stageExternalSkills({
    sources: [source], providers: ['codex'], runtimeEnv: { PATH: process.env.PATH }, cacheRoot,
    runner: async (_command, args, { cwd }) => { if (args.includes('install')) { await cp(join(repoRoot, 'node_modules'), join(cwd, 'node_modules'), { recursive: true, verbatimSymlinks: true }); return { code: 0, stdout: '' } }; calls += 1 }, fetchImpl: async () => streamResponse(archive)
  }), /subtree contains a forbidden SymbolicLink entry/)
  assert.equal(calls, 0)
})

test('skills output root symlinks are rejected before collected content is read', async () => {
  const archive = await archiveFixture(); const outside = await temp(); const cacheRoot = await temp()
  await mkdir(join(outside, 'fixture')); await writeFile(join(outside, 'fixture/SKILL.md'), 'outside sentinel\n')
  await chmod(outside, 0o000)
  const source = { id: 'fixture', repository: 'https://example.test/source', resolvedCommit: 'a'.repeat(40), archive: 'https://example.test/source.tar.gz', sha256: sha256(archive), license: 'MIT', review: 'fixture-review', skillPath: 'skills' }
  await assert.rejects(() => stageExternalSkills({
    sources: [source], providers: ['codex'], runtimeEnv: { PATH: process.env.PATH }, cacheRoot,
    runner: async (_command, args, { cwd }) => {
      if (args.includes('install')) { await cp(join(repoRoot, 'node_modules'), join(cwd, 'node_modules'), { recursive: true, verbatimSymlinks: true }); return { code: 0, stdout: '' } }
      await mkdir(join(cwd, '.agents')); await symlink(outside, join(cwd, '.agents/skills'))
      return { code: 0, stdout: '' }
    }, fetchImpl: async () => streamResponse(archive)
  }), /output root is not a real directory/)
  await chmod(outside, 0o700)
  assert.equal(await readFile(join(outside, 'fixture/SKILL.md'), 'utf8'), 'outside sentinel\n')
})

test('provider merge and doctor reject symlinked ancestors without reading outside files', async () => {
  const root = await temp(); const outside = await temp(); await mkdir(join(root, '.git'))
  await writeFile(join(outside, 'config.toml'), 'outside sentinel\n')
  await symlink(outside, join(root, '.codex'))
  await chmod(outside, 0o000)
  await assert.rejects(() => initializeProject({
    projectRoot: root, providers: ['codex'], specsDir, includeSpecKit: false, initializeBeads: false,
    includeExternal: false, includeMcp: true, runtimeEnv: { PATH: process.env.PATH }, executableFinder: async () => true
  }), error => error.code === 'SYMLINK_ANCESTOR')
  await chmod(outside, 0o700)
  await mkdir(join(root, '.ai-config'))
  await writeFile(join(root, '.ai-config/state.json'), `${JSON.stringify({ schemaVersion: 1, files: { '.codex/config.toml': { sha256: 'a'.repeat(64) } } })}\n`)
  await chmod(outside, 0o000)
  await assert.rejects(() => doctorInstallation({ targetRoot: root, providerHomes: [] }), error => error.code === 'SYMLINK_ANCESTOR')
  await chmod(outside, 0o700)
  assert.equal(await readFile(join(outside, 'config.toml'), 'utf8'), 'outside sentinel\n')
})

test('no-mcp and uninstall reconcile only owned fragments and preserve user content', async () => {
  const root = await temp(); await mkdir(join(root, '.git')); await mkdir(join(root, '.codex'))
  await writeFile(join(root, 'CLAUDE.md'), '# User Claude rules\n')
  await writeFile(join(root, 'AGENTS.md'), '# User agent rules\n')
  await writeFile(join(root, '.mcp.json'), `${JSON.stringify({ mcpServers: { user: { type: 'http', url: 'https://example.test/mcp' } } }, null, 2)}\n`)
  await writeFile(join(root, '.codex/config.toml'), 'model = "user-model"\n')
  const options = {
    projectRoot: root, providers: ['claude', 'codex'], specsDir, includeSpecKit: false,
    initializeBeads: false, includeExternal: false, runtimeEnv: { PATH: process.env.PATH }, executableFinder: async () => true
  }
  await initializeProject(options)
  const parsed = await run('bun', ['-e', 'Bun.TOML.parse(await Bun.file(Bun.env.TEST_TOML).text())'], { env: { PATH: process.env.PATH, TEST_TOML: join(root, '.codex/config.toml') } })
  assert.equal(parsed.code, 0, parsed.stderr)
  assert.match(await readFile(join(root, '.codex/config.toml'), 'utf8'), /^model = "user-model"[\s\S]*# BEGIN AI-CONFIG MANAGED MCP/)

  await initializeProject({ ...options, includeMcp: false })
  const disabled = JSON.parse(await readFile(join(root, '.mcp.json'), 'utf8'))
  assert.deepEqual(Object.keys(disabled.mcpServers), ['user'])
  assert.doesNotMatch(await readFile(join(root, '.codex/config.toml'), 'utf8'), /AI-CONFIG MANAGED MCP/)

  await initializeProject(options)
  await writeFile(join(root, 'CLAUDE.md'), `${await readFile(join(root, 'CLAUDE.md'), 'utf8')}# User addition after init\n`)
  await writeFile(join(root, 'AGENTS.md'), `${await readFile(join(root, 'AGENTS.md'), 'utf8')}# Agent addition after init\n`)
  const changedMcp = JSON.parse(await readFile(join(root, '.mcp.json'), 'utf8'))
  changedMcp.mcpServers['user-after'] = { type: 'http', url: 'https://example.test/after' }
  await writeFile(join(root, '.mcp.json'), `${JSON.stringify(changedMcp, null, 2)}\n`)
  await writeFile(join(root, '.codex/config.toml'), `${await readFile(join(root, '.codex/config.toml'), 'utf8')}approval_policy = "never"\n`)
  await uninstallManagedFiles({ targetRoot: root })
  assert.match(await readFile(join(root, 'CLAUDE.md'), 'utf8'), /^# User Claude rules[\s\S]*# User addition after init/)
  assert.match(await readFile(join(root, 'AGENTS.md'), 'utf8'), /^# User agent rules[\s\S]*# Agent addition after init/)
  assert.deepEqual(Object.keys(JSON.parse(await readFile(join(root, '.mcp.json'), 'utf8')).mcpServers), ['user', 'user-after'])
  assert.match(await readFile(join(root, '.codex/config.toml'), 'utf8'), /^model = "user-model"[\s\S]*approval_policy = "never"/)
})

test('OpenCode projection declares and validates the current official config schema', async () => {
  const root = await temp(); await mkdir(join(root, '.git'))
  await initializeProject({
    projectRoot: root, providers: ['opencode'], specsDir, includeSpecKit: false, initializeBeads: false,
    includeExternal: false, runtimeEnv: { PATH: process.env.PATH }, executableFinder: async () => true
  })
  const config = JSON.parse(await readFile(join(root, 'opencode.json'), 'utf8'))
  assert.equal(config.$schema, 'https://opencode.ai/config.json')
  assert.deepEqual(config.mcp['ai-config-context7'], { type: 'remote', url: 'https://mcp.context7.com/mcp', enabled: true, timeout: 30_000 })

  const localRoot = await temp()
  const [localConfig] = (await buildManagedProjectFiles({
    projectRoot: localRoot, providers: ['opencode'], profiles: ['base'],
    mcpServers: [{ id: 'playwright', transport: 'stdio', envReferences: ['PATH'], timeouts: { toolSeconds: 30 } }]
  })).filter(file => file.path === 'opencode.json')
  const local = JSON.parse(localConfig.content).mcp['ai-config-playwright']
  assert.equal(local.type, 'local')
  assert.deepEqual(local.command.slice(0, 2), ['/bin/sh', '-c'])
  assert.match(local.command[2], /\/usr\/bin\/env -i PATH=/)
  assert.match(local.command[2], /\/bin\/bun|\/bun(?:['" ]|$)/)
  assert.match(local.command[2], /--no-env-file.*--no-install.*--config=/)
  assert.match(local.command[2], /ai-config-lifecycle\.mjs.*mcp-run.*--server.*playwright/)
  assert.doesNotMatch(local.command[2], /BUN_OPTIONS|NODE_OPTIONS|BUN_CONFIG_\*|npm_config_/)
  assert.deepEqual(local.environment, { PATH: '{env:PATH}' })
  assert.equal(local.enabled, true)
  assert.equal(local.timeout, 30_000)
})

test('systems profile resolves only immutable base and Archify sources', async () => {
  const profile = await loadProjectProfiles({ specsDir, profileIds: ['systems'] })
  assert.deepEqual(profile.external, ['superpowers-core', 'archify'])
  const sources = await loadExternalSources({ specsDir, selectedIds: profile.external })
  assert.deepEqual(sources.map(source => source.id), ['superpowers-core', 'archify'])
})

test('child failures never retain or expose credential-like output', async () => {
  await assert.rejects(() => spawnCommand(process.execPath, ['-e', 'console.error("GH_TOKEN=do-not-print Authorization: Bearer also-not-safe"); process.exit(7)'], { cwd: repoRoot, env: {} }), error => {
    assert.equal(error.code, 'COMMAND_FAILED')
    assert.equal(error.child, 'child-process')
    assert.doesNotMatch(error.message, /TOKEN|Authorization|do-not-print|also-not-safe/)
    assert.equal(Object.hasOwn(error, 'diagnostic'), false)
    return true
  })
})

test('child output is drained without retention and runtime is bounded', async () => {
  const result = await spawnCommand(process.execPath, ['-e', 'process.stdout.write("x".repeat(1024 * 1024)); console.error("GH_TOKEN=not-retained")'], { cwd: repoRoot, env: {}, timeoutMs: 2_000 })
  assert.equal(result.stdout, '')
  await assert.rejects(() => spawnCommand(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], { cwd: repoRoot, env: {}, timeoutMs: 25 }), error => error.code === 'COMMAND_TIMEOUT')
})

test('a post-Beads target race reports only bounded persistent side-effect names', async () => {
  const root = await temp(); await mkdir(join(root, '.git'))
  const runner = async (command, args, { cwd }) => {
    if (command === 'bd' && args[0] === 'init') {
      await mkdir(join(cwd, '.beads')); await writeFile(join(cwd, 'AGENTS.md'), '# Beads race\n')
    }
    return { code: 0, stdout: '' }
  }
  await assert.rejects(() => initializeProject({
    projectRoot: root, providers: ['codex'], specsDir, includeSpecKit: false, includeExternal: false,
    includeMcp: false, runtimeEnv: { PATH: process.env.PATH }, executableFinder: async () => true, runner
  }), error => error.code === 'MANAGED_FILE_CONFLICT' && error.beadsPersistentSideEffects.includes('.beads/'))
})

test('CLI exposes basic help', async () => {
  const result = await run(process.execPath, [cli, '--help'])
  assert.equal(result.code, 0)
  assert.match(result.stdout, /Usage: ai-config/)
  assert.match(result.stdout, /uninstall-managed/)
})
