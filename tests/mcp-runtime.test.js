import test from 'node:test'
import assert from 'node:assert/strict'
import { EventEmitter } from 'node:events'
import { chmod, lstat, mkdir, mkdtemp, readFile, readdir, realpath, symlink, writeFile } from 'node:fs/promises'
import { spawn, spawnSync } from 'node:child_process'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { createObsidianSafeServer, loadMcpCatalog, obsidianToolDefinitions, projectMcpServers, runMcpChild, runMcpServer, sanitizeObsidianCliOutput, validateCatalog, verifyRuntimePackage } from '../src/mcp/index.js'
import { buildManagedProjectFiles } from '../src/init/project-files.js'

const sourceRoot = resolve('.')
const temp = () => mkdtemp(join(tmpdir(), 'ai-config-mcp-runtime-'))

function fakeChild({ closeCode = 0, close = true } = {}) {
  const child = new EventEmitter()
  child.pid = undefined
  child.exitCode = null
  child.stderr = { resume () {} }
  child.kills = []
  child.kill = signal => { child.kills.push(signal); return true }
  queueMicrotask(() => {
    child.emit('spawn')
    if (close) queueMicrotask(() => child.emit('close', closeCode))
  })
  return child
}

function fakeProbeChild({ stdout = '', closeCode = 0 } = {}) {
  const child = new EventEmitter()
  child.stdout = new EventEmitter()
  child.stderr = { resume () {} }
  child.kills = []
  child.kill = signal => { child.kills.push(signal); return true }
  queueMicrotask(() => {
    if (stdout.length) child.stdout.emit('data', Buffer.isBuffer(stdout) ? stdout : Buffer.from(stdout))
    child.emit('close', closeCode)
  })
  return child
}

function obsidianFs({ cli, canonicalVault = '/approved/vault', reportedVault = canonicalVault, reportedCanonical = canonicalVault, aliasTarget } = {}) {
  return {
    realpath: async path => {
      if (path === cli || path === '/approved/vault') return path
      if (path === reportedVault) return reportedCanonical
      if (path === '/usr/local/bin/obsidian' && aliasTarget) return aliasTarget
      throw Object.assign(new Error('missing'), { code: 'ENOENT' })
    },
    lstat: async path => {
      if (path === cli) return { isFile: () => true, isDirectory: () => false }
      if (path === aliasTarget) return { isFile: () => true, isDirectory: () => false }
      if (path === canonicalVault) return { isFile: () => false, isDirectory: () => true }
      throw Object.assign(new Error('missing'), { code: 'ENOENT' })
    }
  }
}

function runWrapper(input) {
  return new Promise((resolvePromise, reject) => {
    const child = spawn(process.execPath, ['src/mcp/obsidian-safe-wrapper.js'], {
      cwd: sourceRoot, shell: false,
      env: { PATH: process.env.PATH, OBSIDIAN_VAULT: 'Work', OBSIDIAN_CLI: '/trusted/obsidian-cli' },
      stdio: ['pipe', 'pipe', 'pipe']
    })
    const stdout = []; const stderr = []
    child.stdout.on('data', chunk => stdout.push(chunk)); child.stderr.on('data', chunk => stderr.push(chunk))
    child.once('error', reject)
    child.once('close', code => resolvePromise({ code, stdout: Buffer.concat(stdout).toString('utf8'), stderr: Buffer.concat(stderr).toString('utf8') }))
    child.stdin.end(input)
  })
}

test('MCP runner uses absolute direct package entrypoints and a null-prototype allowlist', async () => {
  let observed
  await runMcpServer({
    serverId: 'playwright', sourceRoot,
    environment: { PATH: '/safe/path', HOME: '/safe/home', PLAYWRIGHT_BROWSERS_PATH: '/safe/browsers', HTTP_PROXY: 'https://user:password@proxy.internal:8443', SENTINEL_INHERITED: 'must-not-reach-child' },
    spawnImpl: (command, args, options) => {
      observed = { command, args, options }
      return fakeChild()
    },
    platform: 'win32', installSignalHandlers: false
  })
  assert.match(observed.command, /^\//)
  assert.match(observed.args.at(-3), /node_modules\/@playwright\/mcp\/cli\.js$/)
  assert.deepEqual(observed.args.slice(-2), ['--isolated', '--block-service-workers'])
  assert.equal(observed.options.shell, false)
  assert.equal(Object.getPrototypeOf(observed.options.env), null)
  assert.equal(observed.options.env.SENTINEL_INHERITED, undefined)
  assert.equal(observed.options.env.HTTP_PROXY, undefined)
  assert.equal(observed.options.env.PATH, '/safe/path')
  assert.equal(observed.command.startsWith('/safe/path'), false)

  await runMcpServer({
    serverId: 'chrome-devtools', sourceRoot, environment: { PATH: '/safe/path', HOME: '/safe/home' },
    spawnImpl: (command, args, options) => { observed = { command, args, options }; return fakeChild() },
    platform: 'win32', installSignalHandlers: false
  })
  assert.match(observed.args.at(-5), /node_modules\/chrome-devtools-mcp\/build\/src\/bin\/chrome-devtools-mcp\.js$/)
  assert.deepEqual(observed.args.slice(-4), ['--isolated', '--no-usage-statistics', '--no-performance-crux', '--redact-network-headers'])
})

test('MCP runner fails closed for missing environment, unknown/vault IDs, URL fragments, and runtime integrity mismatch', async () => {
  await assert.rejects(() => runMcpServer({ serverId: 'playwright', sourceRoot, environment: {}, installSignalHandlers: false }), /required environment variables are missing/)
  await assert.rejects(() => runMcpServer({ serverId: 'unknown', sourceRoot, environment: {}, installSignalHandlers: false }), /unknown MCP server/)
  await assert.rejects(() => runMcpServer({ serverId: 'vault', sourceRoot, environment: {}, installSignalHandlers: false }), /raw Vault MCP is unavailable/)
  await assert.rejects(() => runMcpServer({ serverId: 'youtrack-read', sourceRoot, environment: { YOUTRACK_BASE_URL: 'https://youtrack.example/#fragment' }, installSignalHandlers: false }), error => {
    assert.match(error.message, /unsafe/)
    assert.doesNotMatch(error.message, /youtrack\.example/)
    return true
  })
  const catalog = await loadMcpCatalog({ specsDir: 'ai-specs' })
  const runtime = { ...catalog.servers.get('playwright').runtime, integrity: 'sha512-not-the-locked-artifact' }
  await assert.rejects(() => verifyRuntimePackage({ sourceRoot, runtime }), /lock verification failed/)
  const versionMutatingFs = {
    realpath,
    lstat,
    readdir,
    readFile: async (path, encoding) => {
      const value = await readFile(path, encoding)
      return String(path).endsWith('node_modules/@playwright/mcp/package.json')
        ? String(value).replace('"version": "0.0.80"', '"version": "9.9.9"')
        : value
    }
  }
  await assert.rejects(() => verifyRuntimePackage({ sourceRoot, runtime: catalog.servers.get('playwright').runtime, fs: versionMutatingFs }), /installation verification failed/)
  const tamperedEntryFs = {
    realpath,
    lstat,
    readdir,
    readFile: async (path, encoding) => {
      const value = await readFile(path, encoding)
      return String(path).endsWith('node_modules/@playwright/mcp/cli.js')
        ? Buffer.concat([Buffer.from(value), Buffer.from('\n// tampered\n')])
        : value
    }
  }
  await assert.rejects(() => verifyRuntimePackage({ sourceRoot, runtime: catalog.servers.get('playwright').runtime, fs: tamperedEntryFs }), /content verification failed/)
  const directDependencyFs = {
    realpath,
    lstat,
    readdir,
    readFile: async (path, encoding) => {
      const value = await readFile(path, encoding)
      return String(path).endsWith('/package.json') && !String(path).includes('/node_modules/')
        ? String(value).replace('"@playwright/mcp": "0.0.80"', '"@playwright/mcp": "9.9.9"')
        : value
    }
  }
  await assert.rejects(() => verifyRuntimePackage({ sourceRoot, runtime: catalog.servers.get('playwright').runtime, fs: directDependencyFs }), /root dependency policy/)
})

test('YouTrack bridge is locked to HTTP transport and only permits loopback cleartext', async () => {
  let observed
  await runMcpServer({
    serverId: 'youtrack-read', sourceRoot,
    environment: { YOUTRACK_BASE_URL: 'http://localhost:3489' },
    spawnImpl: (command, args, options) => {
      observed = { command, args, options }
      return fakeChild()
    },
    platform: 'win32', installSignalHandlers: false
  })
  assert.match(observed.command, /^\//)
  assert.match(observed.args.find(value => /node_modules\/mcp-remote\/dist\/proxy\.js$/.test(value)), /node_modules\/mcp-remote\/dist\/proxy\.js$/)
  assert.equal(observed.args.includes('--transport'), true)
  assert.equal(observed.args[observed.args.indexOf('--transport') + 1], 'http-only')
  assert.equal(observed.args.includes('--silent'), true)
  assert.equal(observed.args.includes('--allow-http'), true)
  assert.equal(observed.args.some(value => value === '--debug' || value === '--header'), false)
  assert.equal(Object.getPrototypeOf(observed.options.env), null)
})

test('MCP child timeout terminates its complete process group after a short grace period', async () => {
  const child = fakeChild({ close: false })
  child.pid = 4242
  const signals = []
  const environment = Object.assign(Object.create(null), { PATH: '/safe/path' })
  await assert.rejects(() => runMcpChild({
    command: '/trusted/node', args: ['/trusted/entry.js'], env: environment, cwd: '/trusted',
    spawnImpl: () => child, platform: 'linux', startupTimeoutMs: 20, sessionTimeoutMs: 1, killGraceMs: 1, installSignalHandlers: false,
    killImpl: (pid, signal) => signals.push([pid, signal])
  }), /session timed out/)
  assert.deepEqual(signals, [[-4242, 'SIGTERM'], [-4242, 'SIGKILL']])
})

test('MCP child kills its original process group even when the direct leader closes after TERM', async () => {
  const child = fakeChild({ close: false })
  child.pid = 5252
  const signals = []
  const environment = Object.assign(Object.create(null), { PATH: '/safe/path' })
  await assert.rejects(() => runMcpChild({
    command: '/trusted/node', args: ['/trusted/entry.js'], env: environment, cwd: '/trusted',
    spawnImpl: () => child, platform: 'linux', startupTimeoutMs: 20, sessionTimeoutMs: 1, killGraceMs: 5, installSignalHandlers: false,
    killImpl: (pid, signal) => {
      signals.push([pid, signal])
      if (signal === 'SIGTERM') {
        child.exitCode = 0
        queueMicrotask(() => child.emit('close', 0))
      }
    }
  }), /session timed out/)
  assert.deepEqual(signals, [[-5252, 'SIGTERM'], [-5252, 'SIGKILL']])
})

test('MCP child cleans a detached process group after a successful leader close', async () => {
  const child = fakeChild()
  child.pid = 6262
  child.exitCode = 0
  const signals = []
  const environment = Object.assign(Object.create(null), { PATH: '/safe/path' })
  await runMcpChild({
    command: '/trusted/node', args: ['/trusted/entry.js'], env: environment, cwd: '/trusted',
    spawnImpl: () => child, platform: 'linux', startupTimeoutMs: 20, sessionTimeoutMs: 50, killGraceMs: 1, installSignalHandlers: false,
    killImpl: (pid, signal) => signals.push([pid, signal])
  })
  assert.deepEqual(signals, [[-6262, 'SIGTERM'], [-6262, 'SIGKILL']])
})

test('unavailable Cua/Docker profiles and untrusted catalog command fields fail before projection', async () => {
  const catalog = await loadMcpCatalog({ specsDir: 'ai-specs' })
  for (const [id, approval] of [['cua-driver', 'cua-driver'], ['docker-gateway', 'docker-gateway']]) {
    assert.throws(() => projectMcpServers(catalog, [id], { approvedServerIds: [approval] }), /unavailable pending verified runtime isolation/)
  }
  assert.throws(() => validateCatalog({
    schemaVersion: 1,
    servers: [{ id: 'bad-runtime', transport: 'stdio', command: '/tmp/attacker', args: [], risk: 'low', optIn: false, mutating: false, envAllowlist: [], requiredEnv: [], runtime: { wrapper: 'src/mcp/obsidian-safe-wrapper.js' } }]
  }), /unsupported field|direct MCP commands are forbidden/)
})

test('provider projections use the trusted runner/static IDs and native safe YouTrack forms', async () => {
  const root = await temp()
  const catalog = await loadMcpCatalog({ specsDir: 'ai-specs' })
  const servers = projectMcpServers(catalog, ['context7', 'playwright', 'youtrack-read'], { approvedServerIds: ['playwright', 'youtrack-read'] })
  const files = await buildManagedProjectFiles({ projectRoot: root, providers: ['claude', 'codex', 'gemini', 'opencode'], profiles: ['base', 'browser-isolated', 'youtrack-read'], mcpServers: servers })
  const byPath = new Map(files.map(file => [file.path, file.content]))
  const claude = JSON.parse(byPath.get('.mcp.json'))
  const codex = byPath.get('.codex/config.toml')
  const gemini = JSON.parse(byPath.get('.gemini/settings.json'))
  const opencode = JSON.parse(byPath.get('opencode.json'))
  const text = [...byPath.values()].join('\n')
  assert.doesNotMatch(text, /\bnpx\b|AI_CONFIG_ROOT/)
  assert.match(claude.mcpServers['ai-config-playwright'].command, /^\//)
  assert.equal(claude.mcpServers['ai-config-playwright'].command, '/bin/sh')
  assert.match(claude.mcpServers['ai-config-playwright'].args[1], /env -i PATH=/)
  assert.match(codex, /ai-config-youtrack-read[\s\S]*command = "\//)
  assert.match(codex, /ai-config-youtrack-read[\s\S]*args = \["-c",/)
  assert.match(codex, /enabled_tools = \["search_issues"/)
  assert.match(claude.mcpServers['ai-config-youtrack-read'].args[1], /mcp-run.*--server.*youtrack-read/)
  assert.match(claude.mcpServers['ai-config-youtrack-read'].command, /^\//)
  assert.equal(gemini.mcpServers['ai-config-youtrack-read'].trust, false)
  assert.equal(gemini.mcpServers['ai-config-youtrack-read'].includeTools.includes('search_issues'), true)
  assert.equal(gemini.mcpServers['ai-config-youtrack-read'].args[0], '-c')
  assert.equal(opencode.mcp['ai-config-youtrack-read'].command[0], '/bin/sh')
  assert.equal(opencode.mcp['ai-config-youtrack-read'].command[1], '-c')
  assert.equal(opencode.mcp['ai-config-youtrack-read'].enabled, true)
})

test('Obsidian stdio rejects oversized or malformed input without reflecting attacker data', async () => {
  const oversized = await runWrapper(`${JSON.stringify({ jsonrpc: '2.0', id: 'x'.repeat(2 * 1024 * 1024), method: 'initialize' })}\n`)
  assert.equal(oversized.code, 0, oversized.stderr)
  assert.ok(Buffer.byteLength(oversized.stdout) < 512)
  assert.match(oversized.stdout, /safe size limit/)
  assert.doesNotMatch(oversized.stdout, /x{100}/)

  const malformed = await runWrapper('{"jsonrpc":"2.0","id":\u0001}\n')
  assert.equal(malformed.code, 0, malformed.stderr)
  assert.match(malformed.stdout, /invalid JSON-RPC request/)

  const unknown = await runWrapper(`${JSON.stringify({ jsonrpc: '2.0', id: 'a'.repeat(1024), method: 'unknown-'.repeat(4000) })}\n`)
  assert.equal(unknown.code, 0, unknown.stderr)
  assert.ok(Buffer.byteLength(unknown.stdout) < 512)
  assert.match(unknown.stdout, /unsupported JSON-RPC method/)
  assert.doesNotMatch(unknown.stdout, /unknown-unknown-/)
})

test('Obsidian bridge rejects unsafe control output before MCP serialization', () => {
  assert.equal(sanitizeObsidianCliOutput(Buffer.from('safe\ntext\tvalue')), 'safe\ntext\tvalue')
  for (const value of ['result\x07', 'result\rnext', 'result\x1b]0;title\x07', 'result\0']) {
    assert.throws(() => sanitizeObsidianCliOutput(Buffer.from(value)), /unsafe control characters/)
  }
})

test('Obsidian per-tool runner cleans a descendant group after a successful CLI leader close', { skip: process.platform === 'win32' }, async () => {
  const root = await temp(); const cli = join(root, 'fake-obsidian-cli.mjs')
  await writeFile(cli, `#!/usr/bin/env bun
import { spawn } from 'node:child_process'
const child = spawn(process.execPath, ['-e', "process.on('SIGTERM', () => {}); setInterval(() => {}, 1000)"], { detached: false, stdio: 'ignore' })
child.unref()
process.stdout.write(String(child.pid))
`)
  await chmod(cli, 0o755)
  const server = createObsidianSafeServer({ vault: 'Work', command: cli, runtimeEnv: { PATH: process.env.PATH } })
  const childPid = Number(await server.callTool('obsidian_read', { path: 'roadmap.md' }))
  assert.equal(Number.isInteger(childPid) && childPid > 0, true)
  const deadline = Date.now() + 1000
  while (true) {
    const status = spawnSync('ps', ['-o', 'stat=', '-p', String(childPid)], { encoding: 'utf8' })
    assert.equal(status.error, undefined)
    const state = status.stdout.trim()
    if (!state || state.startsWith('Z')) {
      break
    }
    assert.ok(Date.now() < deadline, `descendant process group was not cleaned up (state: ${state})`)
    await new Promise(resolvePromise => setTimeout(resolvePromise, 10))
  }
})

test('Obsidian bridge requires a verified absolute CLI and preserves the official argument order', async () => {
  const calls = []
  assert.throws(() => createObsidianSafeServer({ vault: 'Work', command: 'obsidian' }), /verified absolute executable/)
  const server = createObsidianSafeServer({
    vault: 'Work', command: '/Applications/Obsidian.app/Contents/MacOS/obsidian-cli', runtimeEnv: { PATH: '/safe/path' },
    runner: async (command, args, options) => { calls.push({ command, args, options }); return 'result' }
  })
  assert.equal(await server.callTool('obsidian_read', { path: 'roadmap.md' }), 'result')
  assert.deepEqual(calls[0].args, ['vault=Work', 'read', 'path=roadmap.md'])
  assert.equal(calls[0].command.startsWith('/'), true)
  assert.equal(Object.getPrototypeOf(calls[0].options.environment), null)
  await assert.rejects(() => server.callTool('obsidian_search', { query: 'roadmap\nall' }), /unsupported Obsidian tool/)
  await assert.rejects(() => server.callTool('obsidian_read', { path: 'notes/../private.md' }), /inside the selected vault/)
  await assert.rejects(() => server.callTool('obsidian_read', { path: './note.md' }), /inside the selected vault/)
  await assert.rejects(() => server.callTool('obsidian_read', { path: 'notes//note.md' }), /inside the selected vault/)
  await assert.rejects(() => server.callTool('obsidian_read', { path: 'notes\tprivate.md' }), /invalid note path/)
  for (const path of ['.obsidian/plugins/demo/data.json', '.env', 'credentials.md', 'notes/data.json']) {
    await assert.rejects(() => server.callTool('obsidian_read', { path }), /inside the selected vault/, path)
  }
  assert.throws(() => createObsidianSafeServer({ vault: 'bad/path', command: '/Applications/Obsidian.app/Contents/MacOS/obsidian-cli' }), /must select one vault/)
})

test('Obsidian wrapper refuses vault symlink reads and never advertises search', async () => {
  const root = await temp(); const vault = join(root, 'vault'); const outside = join(root, 'outside')
  await mkdir(vault); await mkdir(outside); await writeFile(join(outside, 'private.md'), 'outside')
  await symlink(outside, join(vault, 'linked'))
  const calls = []
  const server = createObsidianSafeServer({
    vault: 'Work', vaultRoot: vault, command: '/trusted/obsidian-cli', runtimeEnv: { PATH: '/safe/path' },
    runner: async (...args) => { calls.push(args); return 'unexpected' }
  })
  await assert.rejects(() => server.callTool('obsidian_read', { path: 'linked/private.md' }), /symbolic link/)
  assert.deepEqual(obsidianToolDefinitions.map(tool => tool.name), ['obsidian_read'])
  await assert.rejects(() => server.callTool('obsidian_search', { query: 'roadmap' }), /unsupported Obsidian tool/)
  assert.equal(calls.length, 0)
})

test('Obsidian runner accepts only the approved app binary and exact canonical vault identity before wrapper launch', async () => {
  const cli = '/Applications/Obsidian.app/Contents/MacOS/obsidian-cli'
  const calls = []
  let wrapper
  await runMcpServer({
    serverId: 'obsidian-safe', sourceRoot,
    environment: {
      PATH: '/safe/path', HOME: '/user', OBSIDIAN_VAULT: 'Work', OBSIDIAN_VAULT_ROOT: '/approved/vault',
      SENTINEL_INHERITED: 'must-not-reach-child'
    },
    platform: 'darwin', fs: obsidianFs({ cli, aliasTarget: '/untrusted/obsidian' }), installSignalHandlers: false,
    spawnImpl: (command, args, options) => {
      calls.push({ command, args, options })
      if (command === cli && args[0] === '--version') return fakeProbeChild({ stdout: 'Obsidian 1.12.7\n' })
      if (command === cli && args[0] === 'vault=Work') return fakeProbeChild({ stdout: '/approved/vault\n' })
      wrapper = { command, args, options }
      return fakeChild()
    }
  })
  assert.deepEqual(calls.slice(0, 2).map(call => [call.command, call.args]), [
    [cli, ['--version']],
    [cli, ['vault=Work', 'vault', 'info=path']]
  ])
  assert.match(wrapper.command, /^\//)
  assert.match(wrapper.args.at(-1), /src\/mcp\/obsidian-safe-wrapper\.js$/)
  assert.equal(wrapper.options.env.OBSIDIAN_CLI, cli)
  assert.equal(wrapper.options.env.SENTINEL_INHERITED, undefined)
  assert.equal(Object.getPrototypeOf(wrapper.options.env), null)
})

test('Obsidian Linux runtime accepts only its fixed canonical user CLI candidate', async () => {
  const cli = '/linux-user/.local/bin/obsidian'
  const calls = []
  await runMcpServer({
    serverId: 'obsidian-safe', sourceRoot,
    environment: { PATH: '/safe/path', HOME: '/linux-user', OBSIDIAN_VAULT: 'Work', OBSIDIAN_VAULT_ROOT: '/approved/vault' },
    platform: 'linux', fs: obsidianFs({ cli }), installSignalHandlers: false,
    spawnImpl: (command, args, options) => {
      calls.push({ command, args })
      if (command === cli && args[0] === '--version') return fakeProbeChild({ stdout: 'Obsidian 1.12.7\n' })
      if (command === cli && args[0] === 'vault=Work') return fakeProbeChild({ stdout: '/approved/vault\n' })
      assert.match(options.env.OBSIDIAN_CLI, /^\/linux-user\/\.local\/bin\/obsidian$/)
      return fakeChild()
    }
  })
  assert.deepEqual(calls.slice(0, 2).map(call => call.command), [cli, cli])
})

test('Obsidian runner fails closed for an unsafe CLI alias, mismatched vault output, and oversized probe output', async () => {
  const cli = '/Applications/Obsidian.app/Contents/MacOS/obsidian-cli'
  const environment = { PATH: '/safe/path', HOME: '/user', OBSIDIAN_VAULT: 'Work', OBSIDIAN_VAULT_ROOT: '/approved/vault' }
  let wrapperStarted = false
  await assert.rejects(() => runMcpServer({
    serverId: 'obsidian-safe', sourceRoot, environment, platform: 'darwin', installSignalHandlers: false,
    fs: obsidianFs({ cli, reportedVault: '/different/vault', reportedCanonical: '/different/canonical-vault' }),
    spawnImpl: (command, args) => {
      if (command === cli && args[0] === '--version') return fakeProbeChild({ stdout: 'Obsidian 1.12.7\n' })
      if (command === cli && args[0] === 'vault=Work') return fakeProbeChild({ stdout: '/different/vault\n' })
      wrapperStarted = true
      return fakeChild()
    }
  }), error => {
    assert.match(error.message, /vault identity verification failed/)
    assert.doesNotMatch(error.message, /different\/vault/)
    return true
  })
  assert.equal(wrapperStarted, false)

  await assert.rejects(() => runMcpServer({
    serverId: 'obsidian-safe', sourceRoot, environment, platform: 'darwin', installSignalHandlers: false,
    fs: obsidianFs({ cli }),
    spawnImpl: (command, args) => {
      if (command === cli && args[0] === '--version') return fakeProbeChild({ stdout: 'Obsidian 1.12.7\n' })
      if (command === cli && args[0] === 'vault=Work') return fakeProbeChild({ stdout: '/approved/vault\nsecond-line\n' })
      throw new Error('wrapper must not be started')
    }
  }), error => {
    assert.match(error.message, /vault identity verification failed/)
    assert.doesNotMatch(error.message, /second-line/)
    return true
  })

  await assert.rejects(() => runMcpServer({
    serverId: 'obsidian-safe', sourceRoot, environment, platform: 'darwin', installSignalHandlers: false,
    fs: obsidianFs({ cli }),
    spawnImpl: (command, args) => {
      if (command === cli && args[0] === '--version') return fakeProbeChild({ stdout: Buffer.alloc(4097) })
      throw new Error('wrapper must not be started')
    }
  }), /probe output exceeded the safe limit/)
})
