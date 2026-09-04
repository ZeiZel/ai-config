import test from 'node:test'
import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { cp, mkdtemp, mkdir, readFile, readdir, realpath, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { c as createTar } from 'tar'
import { sha256 } from '../src/security-guard/index.js'
import { installManagedFiles, loadExternalSources, readInstallState, stageExternalSkills } from '../src/install/index.js'
import { findGitRoot, initializeProject } from '../src/init/index.js'
import { loadMcpCatalog, projectMcpServers } from '../src/mcp/index.js'

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const specsDir = join(repoRoot, 'ai-specs')
const cli = join(repoRoot, 'bin/ai-config-lifecycle.mjs')
const temp = () => mkdtemp(join(tmpdir(), 'ai-config-forward-'))

function streamResponse(bytes) {
  return { ok: true, body: new ReadableStream({ start(controller) { controller.enqueue(bytes); controller.close() } }) }
}

function run(command, args, { cwd = repoRoot, env = process.env } = {}) {
  return new Promise((resolvePromise, reject) => {
    const child = spawn(command, args, { cwd, env, shell: false, stdio: ['ignore', 'pipe', 'pipe'] })
    const stdout = []; const stderr = []
    child.stdout.on('data', chunk => stdout.push(chunk)); child.stderr.on('data', chunk => stderr.push(chunk))
    child.once('error', reject)
    child.once('close', code => resolvePromise({ code, stdout: Buffer.concat(stdout).toString('utf8'), stderr: Buffer.concat(stderr).toString('utf8') }))
  })
}

test('legacy bootstrap contains no network, git update, Ansible, or provider-home replacement path', async () => {
  const script = await readFile(join(repoRoot, 'install.sh'), 'utf8')
  for (const forbidden of ['curl ', 'git clone', 'git pull', 'ansible-playbook', 'ln -s', 'brew install']) assert.equal(script.includes(forbidden), false, forbidden)
  assert.match(script, /\.ai-config-node-modules\.recovery/)
  assert.match(script, /atomic-rename\.mjs/)
  assert.match(script, /\.ai-config-install\.lock/)
  assert.equal(/(?:HTTP|HTTPS|ALL_PROXY|NO_PROXY)=/.test(script), false)
  const home = await temp()
  const result = await run(join(repoRoot, 'install.sh'), ['--dry-run'], { env: { ...process.env, PATH: `${dirname(process.execPath)}:${process.env.PATH}`, HOME: home } })
  assert.equal(result.code, 0, result.stderr)
  assert.equal((await readdir(home)).length, 0)
  const withoutHome = { ...process.env }; delete withoutHome.HOME
  const missingHome = await run(join(repoRoot, 'install.sh'), ['--dry-run'], { env: withoutHome })
  assert.notEqual(missingHome.code, 0)
  assert.match(missingHome.stderr, /HOME must be set/)
  const attacker = await temp(); const fake = join(attacker, 'install.sh')
  await symlink(join(repoRoot, 'install.sh'), fake)
  const linked = await run(fake, ['--dry-run'], { env: { ...process.env, PATH: `${dirname(process.execPath)}:${process.env.PATH}`, HOME: await temp() } })
  assert.equal(linked.code, 0, linked.stderr)
})

test('CLI is strict, resolves package specs outside its cwd, detects nested Git root, and honors no-mcp', async () => {
  const root = await temp(); const nested = join(root, 'a/b'); await mkdir(join(root, '.git')); await mkdir(nested, { recursive: true })
  assert.equal(await findGitRoot(nested), root)
  const unknown = await run(process.execPath, [cli, 'init', '--providers', 'codex', '--wat', 'x'], { cwd: nested })
  assert.notEqual(unknown.code, 0); assert.match(unknown.stderr, /unknown option/)
  const dry = await run(process.execPath, [cli, 'init', '--target', root, '--providers', 'codex', '--profiles', 'base', '--no-mcp', '--no-spec-kit', '--no-beads', '--dry-run'], { cwd: nested })
  assert.equal(dry.code, 0, dry.stderr)
  const output = JSON.parse(dry.stdout)
  assert.equal(await realpath(output.projectRoot), await realpath(root))
  assert.deepEqual(output.mcp, [])
  assert.equal(output.install.changes.some(change => change.path === 'AGENTS.md'), true)
  assert.equal((await readdir(nested)).length, 0)
})

test('doctor uses a useful nonzero status for an unhealthy installation', async () => {
  const root = await temp()
  const result = await run(process.execPath, [cli, 'doctor', '--target', root])
  assert.equal(result.code, 2)
  assert.equal(JSON.parse(result.stdout).healthy, false)
})

test('selected MCP profile is projected into native config and managed instructions preserve user text', async () => {
  const root = await temp(); await mkdir(join(root, '.git')); await writeFile(join(root, 'CLAUDE.md'), '# User rules\n\nKeep this.\n')
  const generated = [{ path: '.claude/skills/security/SKILL.md', content: 'safe\n' }]
  const options = {
    projectRoot: root, providers: ['claude'], profileIds: ['base'], specsDir, managedFiles: generated,
    includeSpecKit: false, initializeBeads: false, includeExternal: false, includeMcp: true,
    runtimeEnv: { PATH: process.env.PATH }, executableFinder: async () => true
  }
  const first = await initializeProject(options); const second = await initializeProject(options)
  assert.equal(first.install.changes.some(change => change.path === '.mcp.json' && change.action === 'create'), true)
  assert.equal(second.install.changes.every(change => change.action === 'unchanged'), true)
  assert.match(await readFile(join(root, 'CLAUDE.md'), 'utf8'), /Keep this\.[\s\S]*BEGIN AI-CONFIG MANAGED/)
  const mcp = JSON.parse(await readFile(join(root, '.mcp.json'), 'utf8'))
  assert.equal(mcp.mcpServers['ai-config-context7'].url, 'https://mcp.context7.com/mcp')
})

test('predictable managed conflicts occur before Beads and preserve prior state', async () => {
  const root = await temp(); await mkdir(join(root, '.git'))
  await installManagedFiles({ targetRoot: root, files: [{ path: 'keep.txt', content: 'keep\n' }] })
  const stateBefore = await readFile(join(root, '.ai-config/state.json'), 'utf8')
  await mkdir(join(root, '.agents/skills/security'), { recursive: true }); await writeFile(join(root, '.agents/skills/security/SKILL.md'), 'unmanaged collision\n')
  let runnerCalls = 0
  const runner = async (command, args, { cwd }) => {
    runnerCalls += 1
    if (command !== 'bd') throw new Error('unexpected command')
    if (args[0] === 'init') await mkdir(join(cwd, '.beads'))
    return { code: 0, stdout: '' }
  }
  await assert.rejects(() => initializeProject({
    projectRoot: root, providers: ['codex'], profileIds: ['base'], specsDir,
    managedFiles: [{ path: '.agents/skills/security/SKILL.md', content: 'managed\n' }],
    includeSpecKit: false, includeExternal: false, includeMcp: false,
    runtimeEnv: { PATH: '/bin' }, runner, executableFinder: async () => true
  }), error => error.code === 'MANAGED_FILE_CONFLICT' && error.beadsPersistentSideEffects.length === 0)
  assert.equal(runnerCalls, 0)
  assert.equal(await readFile(join(root, '.ai-config/state.json'), 'utf8'), stateBefore)
  assert.equal(await readFile(join(root, 'keep.txt'), 'utf8'), 'keep\n')
  await assert.rejects(() => readFile(join(root, 'AGENTS.md')), error => error.code === 'ENOENT')
})

test('Spec Kit and Beads failures publish no ai-config files', async () => {
  for (const failure of ['spec-kit', 'beads']) {
    const root = await temp(); await mkdir(join(root, '.git'))
    await installManagedFiles({ targetRoot: root, files: [{ path: 'keep.txt', content: 'keep\n' }] })
    const stateBefore = await readFile(join(root, '.ai-config/state.json'), 'utf8')
    const runner = async (command) => {
      if (failure === 'spec-kit' && command === 'uvx') throw new Error('spec staging failed')
      if (failure === 'beads' && command === 'bd') throw new Error('beads preflight failed')
      return { code: 0, stdout: '' }
    }
    await assert.rejects(() => initializeProject({
      projectRoot: root, providers: ['codex'], profileIds: ['base'], specsDir,
      managedFiles: [{ path: '.agents/skills/security/SKILL.md', content: 'managed\n' }],
      includeSpecKit: failure === 'spec-kit', includeExternal: false, includeMcp: false,
      runtimeEnv: { PATH: '/bin' }, runner, executableFinder: async () => true
    }), new RegExp(failure === 'spec-kit' ? 'spec staging failed' : 'beads preflight failed'))
    assert.equal(await readFile(join(root, '.ai-config/state.json'), 'utf8'), stateBefore)
    await assert.rejects(() => readFile(join(root, '.agents/skills/security/SKILL.md')), error => error.code === 'ENOENT')
    await assert.rejects(() => readFile(join(root, 'AGENTS.md')), error => error.code === 'ENOENT')
  }
})

test('external profiles consume catalog+lock and pinned skills CLI stages verified content', async () => {
  const locked = await loadExternalSources({ specsDir, selectedIds: ['superpowers-core'] })
  assert.equal(locked[0].resolvedCommit, 'b36e0829c6d0140e93cfef2ca599b1b07d4a7797')
  await assert.rejects(() => loadExternalSources({ specsDir, selectedIds: ['frontend-curated'] }), /unknown external source/)

  const archiveFixture = await temp()
  await mkdir(join(archiveFixture, 'fixture-main/skills/fixture'), { recursive: true })
  await writeFile(join(archiveFixture, 'fixture-main/skills/fixture/SKILL.md'), '# source fixture\n')
  const archivePath = join(archiveFixture, 'fixture.tar.gz')
  await createTar({ gzip: true, file: archivePath, cwd: archiveFixture }, ['fixture-main'])
  const archive = await readFile(archivePath)
  const source = { id: 'fixture', repository: 'https://github.com/example/skills', resolvedCommit: 'a'.repeat(40), archive: 'https://example.test/archive.tar.gz', sha256: sha256(archive), license: 'MIT', review: 'fixture-review', skillPath: 'skills' }
  const cacheRoot = await temp(); const commands = []
  const runner = async (command, args, { cwd, env }) => {
    commands.push({ command, args, env })
    if (args.includes('install')) await cp(join(repoRoot, 'node_modules'), join(cwd, 'node_modules'), { recursive: true, verbatimSymlinks: true })
    if (args.includes('add')) {
      await mkdir(join(cwd, '.agents/skills/fixture'), { recursive: true })
      await writeFile(join(cwd, '.agents/skills/fixture/SKILL.md'), '# fixture\n')
    }
    return { code: 0, stdout: '' }
  }
  const staged = await stageExternalSkills({
    sources: [source], providers: ['codex'], runtimeEnv: { PATH: '/bin', HOME: '/tmp', UNEXPECTED_TOKEN: 'secret' }, runner, cacheRoot,
    fetchImpl: async () => streamResponse(archive)
  })
  assert.equal(commands.length, 2)
  assert.match(commands[0].command, /bun$/)
  assert.deepEqual(commands[0].args.slice(-3), ['install', '--frozen-lockfile', '--ignore-scripts'])
  assert.match(commands[1].command, /bun$/)
  assert.deepEqual(commands[1].args.slice(0, 2), ['--no-env-file', '--no-install'])
  assert.match(commands[1].args[3], /node_modules\/skills\/bin\/cli\.mjs$/)
  assert.equal(commands[1].args[4], 'add')
  assert.equal(commands[1].args.some(arg => arg.startsWith('https://')), false)
  assert.equal(commands[1].args.some(arg => arg.includes('/sources/fixture/fixture-main/skills')), true)
  assert.equal(commands[1].env.DO_NOT_TRACK, '1')
  assert.equal(Object.hasOwn(commands[1].env, 'UNEXPECTED_TOKEN'), false)
  assert.deepEqual(staged.files.map(file => file.path), ['.agents/skills/fixture/SKILL.md'])
  assert.equal(sha256(await readFile(staged.cache[0])), source.sha256)
})

test('MCP catalog reports direct-package content verification without claiming immutable closure hashes', async () => {
  const catalog = await loadMcpCatalog({ specsDir })
  const servers = projectMcpServers(catalog, ['playwright'], { approvedServerIds: ['playwright'] })
  assert.equal(servers[0].runtimeIntegrity.status, 'lockfile-install-direct-package-content-verified')
  assert.equal(servers[0].runtimeIntegrity.immutable, false)
})
