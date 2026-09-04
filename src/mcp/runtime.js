import { spawn as childSpawn } from 'node:child_process'
import { access, lstat, readFile, readdir, realpath } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import { constants as fsConstants } from 'node:fs'
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import { buildAllowlistedEnv, SecurityPolicyError } from '../security-guard/index.js'
import { loadMcpCatalog } from './catalog.js'
import { assertBunRuntime, bunArgs, sanitizeBunEnv } from '../runtime/bun.js'

const RUNTIME_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..')
const STARTUP_TIMEOUT_MS = 10_000
const DEFAULT_SESSION_TIMEOUT_MS = 30 * 60 * 1000
const EXTERNAL_PROBE_OUTPUT_BYTES = 4 * 1024
const TRUSTED_RUNTIMES = Object.freeze({
  playwright: Object.freeze({ package: '@playwright/mcp', version: '0.0.80', integrity: 'sha512-FOPXHm2SvFhAQylm10jMZ35B/SR2TaMLVkavAlwoG4N2qCb5RqbvhQYcu3zmXNyxR2DW0Ooxe+9XPVt5UjKRCQ==', treeSha256: 'fa1405bacb2a3114536971ed61ac88815c0153a3a4bbd52559e7b120a068efb9', bin: 'playwright-mcp', binPath: 'cli.js', args: ['--isolated', '--block-service-workers'] }),
  'chrome-devtools': Object.freeze({ package: 'chrome-devtools-mcp', version: '1.7.0', integrity: 'sha512-6xFW7oiUxTxZuHcfyYBkKQtmttjCbfifKZMSEk5CV8H2FucvKweYiJr8CblddYHtYjA4C14K9VAs1r49906RBA==', treeSha256: '63e46ad373238be1de198f8fe41a65a8c6d9e1ac80f7d534c03d89b89737552e', bin: 'chrome-devtools-mcp', binPath: 'build/src/bin/chrome-devtools-mcp.js', args: ['--isolated', '--no-usage-statistics', '--no-performance-crux', '--redact-network-headers'] }),
  'youtrack-read': Object.freeze({ package: 'mcp-remote', version: '0.8.3', integrity: 'sha512-oEwD8z8DfRjpYm5a9X3spxuESBMoQ2ph3AiiSUQGD2OoBsWewWZsjAb93MsS8/T5e4P0p2gOW7IBw0znEUSlOg==', treeSha256: '072da58f73e64f4e2ee0755bab11cac2c4dcfe942cef3fce981afa88e6a49c1b', bin: 'mcp-remote', binPath: 'dist/proxy.js' }),
  'youtrack-write': Object.freeze({ package: 'mcp-remote', version: '0.8.3', integrity: 'sha512-oEwD8z8DfRjpYm5a9X3spxuESBMoQ2ph3AiiSUQGD2OoBsWewWZsjAb93MsS8/T5e4P0p2gOW7IBw0znEUSlOg==', treeSha256: '072da58f73e64f4e2ee0755bab11cac2c4dcfe942cef3fce981afa88e6a49c1b', bin: 'mcp-remote', binPath: 'dist/proxy.js' }),
  'obsidian-safe': Object.freeze({ wrapper: 'src/mcp/obsidian-safe-wrapper.js' }),
  'cua-driver': Object.freeze({ availability: 'unavailable' }),
  'docker-gateway': Object.freeze({ availability: 'unavailable' })
})

export class McpRuntimeError extends Error {
  constructor(message, code = 'MCP_RUNTIME') {
    super(message)
    this.name = 'McpRuntimeError'
    this.code = code
  }
}

function fail(message, code) {
  throw new McpRuntimeError(message, code)
}

function pathInside(root, target) {
  const value = relative(root, target)
  return value && value !== '..' && !value.startsWith(`..${sep}`) && !isAbsolute(value)
}

async function regularFile(path, message, { executable = false } = {}) {
  try {
    const stat = await lstat(path)
    if (!stat.isFile()) fail(message, 'MCP_RUNTIME_PATH')
    if (executable) await access(path, fsConstants.X_OK).catch(() => fail(message, 'MCP_RUNTIME_PATH'))
    return path
  } catch (error) {
    if (error instanceof McpRuntimeError) throw error
    fail(message, 'MCP_RUNTIME_PATH')
  }
}

export function bundledMcpSourceRoot() {
  return RUNTIME_ROOT
}

export async function trustedMcpRunnerPath(candidate = join(RUNTIME_ROOT, 'bin', 'ai-config-lifecycle.mjs')) {
  if (!isAbsolute(candidate)) fail('MCP runner path must be absolute', 'MCP_RUNNER_PATH')
  const root = await realpath(RUNTIME_ROOT)
  const target = await realpath(candidate).catch(() => fail('trusted MCP runner is unavailable', 'MCP_RUNNER_PATH'))
  if (!pathInside(root, target)) fail('trusted MCP runner is outside the installed source tree', 'MCP_RUNNER_PATH')
  await regularFile(target, 'trusted MCP runner is not an executable regular file', { executable: true })
  return target
}

/**
 * This verifies the committed Bun lock entry, a reviewed direct package tree,
 * and the installed entrypoint. It deliberately does not claim transitive
 * closure hashing: dependencies remain covered only by Bun's lock/SRI install.
 */
export async function verifyRuntimePackage({ sourceRoot = RUNTIME_ROOT, runtime, fs = { readFile, readdir, realpath, lstat } } = {}) {
  if (!runtime || typeof runtime.package !== 'string' || typeof runtime.version !== 'string' || typeof runtime.integrity !== 'string' || !/^[a-f0-9]{64}$/.test(runtime.treeSha256 || '') || typeof runtime.bin !== 'string' || typeof runtime.binPath !== 'string') {
    fail('MCP runtime package policy is malformed', 'MCP_RUNTIME_POLICY')
  }
  if (runtime.binPath.includes('\0') || isAbsolute(runtime.binPath)) fail('MCP runtime bin policy is malformed', 'MCP_RUNTIME_POLICY')
  const root = await fs.realpath(sourceRoot).catch(() => fail('installed MCP source root is unavailable', 'MCP_SOURCE_ROOT'))
  const nodeModules = await fs.realpath(join(root, 'node_modules')).catch(() => fail('installed MCP dependencies are unavailable', 'MCP_DEPENDENCY_MISSING'))
  const packageRoot = await fs.realpath(join(root, 'node_modules', runtime.package)).catch(() => fail(`required MCP package is unavailable: ${runtime.package}`, 'MCP_DEPENDENCY_MISSING'))
  if (!pathInside(nodeModules, packageRoot)) fail('MCP package resolves outside installed dependencies', 'MCP_PACKAGE_ESCAPE')
  const [lockRaw, packageRaw, rootPackageRaw] = await Promise.all([
    fs.readFile(join(root, 'bun.lock'), 'utf8').catch(() => fail('MCP lockfile is unavailable', 'MCP_LOCKFILE_MISSING')),
    fs.readFile(join(packageRoot, 'package.json'), 'utf8').catch(() => fail('MCP package metadata is unavailable', 'MCP_DEPENDENCY_MISSING')),
    fs.readFile(join(root, 'package.json'), 'utf8').catch(() => fail('MCP root package metadata is unavailable', 'MCP_RUNTIME_POLICY'))
  ])
  let lock; let manifest; let rootManifest
  try { lock = parseJsonc(lockRaw); manifest = JSON.parse(packageRaw); rootManifest = JSON.parse(rootPackageRaw) } catch { fail('MCP package metadata is malformed', 'MCP_RUNTIME_POLICY') }
  const declaredDependency = rootManifest.dependencies?.[runtime.package]
    || rootManifest.devDependencies?.[runtime.package]
    || rootManifest.optionalDependencies?.[runtime.package]
  if (declaredDependency !== runtime.version) fail(`MCP root dependency policy does not match: ${runtime.package}`, 'MCP_RUNTIME_POLICY')
  const locked = lock?.packages?.[runtime.package]
  if (!Array.isArray(locked) || locked[0] !== `${runtime.package}@${runtime.version}` || locked[3] !== runtime.integrity) {
    fail(`MCP package lock verification failed: ${runtime.package}`, 'MCP_LOCK_MISMATCH')
  }
  const declaredBin = typeof manifest.bin?.[runtime.bin] === 'string' ? manifest.bin[runtime.bin].replace(/^\.\//, '') : undefined
  if (manifest.name !== runtime.package || manifest.version !== runtime.version || declaredBin !== runtime.binPath) {
    fail(`MCP package installation verification failed: ${runtime.package}`, 'MCP_INSTALL_MISMATCH')
  }
  const entry = resolve(packageRoot, runtime.binPath)
  if (!pathInside(packageRoot, entry)) fail('MCP package binary escapes its package directory', 'MCP_BIN_ESCAPE')
  const bin = await fs.realpath(entry).catch(() => fail(`MCP package binary is unavailable: ${runtime.package}`, 'MCP_DEPENDENCY_MISSING'))
  if (!pathInside(packageRoot, bin)) fail('MCP package binary resolves outside its package directory', 'MCP_BIN_ESCAPE')
  const stat = await fs.lstat(bin).catch(() => fail('MCP package binary is unavailable', 'MCP_DEPENDENCY_MISSING'))
  if (!stat.isFile()) fail('MCP package binary is not a regular file', 'MCP_BIN_ESCAPE')
  const treeSha256 = await hashPackageTree(packageRoot, fs)
  if (treeSha256 !== runtime.treeSha256) fail(`MCP package content verification failed: ${runtime.package}`, 'MCP_PACKAGE_CONTENT_MISMATCH')
  return { packageRoot, bin, integrityStatus: 'lockfile-install-direct-package-content-verified' }
}

function parseJsonc(text) {
  if (!globalThis.Bun?.JSONC || typeof globalThis.Bun.JSONC.parse !== 'function') throw new Error('Bun JSONC parser is unavailable')
  return globalThis.Bun.JSONC.parse(text)
}

async function hashPackageTree(packageRoot, fs) {
  const files = []
  const walk = async directory => {
    let names
    try { names = await fs.readdir(directory) } catch { fail('MCP package content is unavailable', 'MCP_DEPENDENCY_MISSING') }
    if (!Array.isArray(names) || names.some(name => typeof name !== 'string')) fail('MCP package content is malformed', 'MCP_PACKAGE_CONTENT_MISMATCH')
    for (const name of names.sort()) {
      if (!name || name.includes('\0') || name.includes('/') || name.includes('\\')) fail('MCP package content is malformed', 'MCP_PACKAGE_CONTENT_MISMATCH')
      const path = join(directory, name)
      const stat = await fs.lstat(path).catch(() => fail('MCP package content is unavailable', 'MCP_DEPENDENCY_MISSING'))
      if (stat.isSymbolicLink()) fail('MCP package content contains a symbolic link', 'MCP_PACKAGE_CONTENT_MISMATCH')
      if (stat.isDirectory()) await walk(path)
      else if (stat.isFile()) files.push(path)
      else fail('MCP package content contains an unsupported file', 'MCP_PACKAGE_CONTENT_MISMATCH')
    }
  }
  await walk(packageRoot)
  const hash = createHash('sha256')
  for (const path of files) {
    const name = relative(packageRoot, path).split(sep).join('/')
    const content = await fs.readFile(path).catch(() => fail('MCP package content is unavailable', 'MCP_DEPENDENCY_MISSING'))
    hash.update(name, 'utf8'); hash.update('\0'); hash.update(Buffer.from(content)); hash.update('\0')
  }
  return hash.digest('hex')
}

function assertSafeRemoteUrl(value, serverId) {
  let url
  try { url = new URL(value) } catch { fail(`MCP endpoint is malformed: ${serverId}`, 'UNSAFE_MCP_URL') }
  const loopback = ['localhost', '127.0.0.1', '::1', '[::1]'].includes(url.hostname)
  if (url.protocol !== 'https:' && !(url.protocol === 'http:' && loopback)) fail(`MCP endpoint must use HTTPS or loopback HTTP: ${serverId}`, 'UNSAFE_MCP_URL')
  if (url.username || url.password || url.hash) fail(`MCP endpoint is unsafe: ${serverId}`, 'UNSAFE_MCP_URL')
  return url
}

export function buildYouTrackBridgeUrl(server, environment) {
  const base = environment.YOUTRACK_BASE_URL
  if (!base) fail('required MCP environment variables are missing: YOUTRACK_BASE_URL', 'MISSING_ENV')
  let url
  try { url = new URL(base) } catch { fail(`MCP endpoint is malformed: ${server.id}`, 'UNSAFE_MCP_URL') }
  if (url.pathname.endsWith('/')) url.pathname = `${url.pathname}mcp`
  else url.pathname = `${url.pathname}/mcp`
  url.search = ''
  url.searchParams.set('tools', server.toolAllowlist.join(','))
  assertSafeRemoteUrl(url.toString(), server.id)
  return url.toString()
}

function obsidianCliPolicy(platform, environment) {
  const fixed = path => ({ path, canonical: [path] })
  if (platform === 'darwin') {
    return { direct: [fixed('/Applications/Obsidian.app/Contents/MacOS/obsidian-cli')], aliases: ['/usr/local/bin/obsidian'] }
  }
  if (platform === 'linux') return {
    direct: [typeof environment.HOME === 'string' && isAbsolute(environment.HOME) ? fixed(join(environment.HOME, '.local/bin/obsidian')) : undefined].filter(Boolean),
    aliases: []
  }
  return { direct: [], aliases: [] }
}

async function canonicalRegularFile(path, fs) {
  const target = await fs.realpath(path)
  const stat = await fs.lstat(target)
  if (!stat.isFile()) throw new Error('not-file')
  return target
}

async function resolveApprovedExecutable(environment, { platform = process.platform, fs = { realpath, lstat } } = {}) {
  const policy = obsidianCliPolicy(platform, environment)
  const approved = new Set()
  for (const candidate of policy.direct) {
    try {
      const target = await canonicalRegularFile(candidate.path, fs)
      if (candidate.canonical.includes(target)) approved.add(target)
    } catch { /* fixed candidate not installed */ }
  }
  if (!approved.size) fail('approved Obsidian CLI is unavailable', 'MCP_EXTERNAL_UNAVAILABLE')
  // An alias is never independently trusted: it must resolve exactly to an
  // installed app binary from the canonical direct allowlist.
  for (const path of policy.aliases) {
    try {
      const target = await canonicalRegularFile(path, fs)
      if (approved.has(target)) return target
    } catch { /* optional alias is absent or unsafe */ }
  }
  return [...approved][0]
}

function parseVersion(value) {
  const match = String(value).match(/(?:^|\s|v)(\d+)\.(\d+)\.(\d+)(?:\s|$|[-+])/m)
  return match ? match.slice(1, 4).map(Number) : undefined
}

function atLeast(actual, minimum) {
  for (let index = 0; index < minimum.length; index += 1) {
    if (actual[index] !== minimum[index]) return actual[index] > minimum[index]
  }
  return true
}

async function probeExternal(command, args, environment, { spawnImpl = childSpawn, timeoutMs = STARTUP_TIMEOUT_MS, outputLimit = EXTERNAL_PROBE_OUTPUT_BYTES } = {}) {
  return new Promise((resolvePromise, reject) => {
    let child
    try { child = spawnImpl(command, args, { cwd: dirname(command), env: environment, shell: false, stdio: ['ignore', 'pipe', 'pipe'], detached: false }) }
    catch { reject(new McpRuntimeError('external MCP CLI is unavailable', 'MCP_EXTERNAL_UNAVAILABLE')); return }
    // The probe is intentionally bounded independently of how a child splits
    // stdout. A fixed buffer prevents a hostile CLI from turning chunks into
    // unbounded retained objects before its identity is accepted.
    const output = Buffer.allocUnsafe(outputLimit)
    let outputBytes = 0; let exceeded = false; let settled = false
    const settle = (error, value) => { if (settled) return; settled = true; clearTimeout(timer); error ? reject(error) : resolvePromise(value) }
    const timer = setTimeout(() => { try { child.kill('SIGKILL') } catch {}; settle(new McpRuntimeError('external MCP CLI probe timed out', 'MCP_EXTERNAL_TIMEOUT')) }, timeoutMs)
    child.stdout?.on('data', chunk => {
      if (exceeded) return
      const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)
      const remaining = outputLimit - outputBytes
      if (bytes.length > remaining) { exceeded = true; try { child.kill() } catch {}; return }
      bytes.copy(output, outputBytes); outputBytes += bytes.length
    })
    child.stderr?.resume()
    child.once('error', () => settle(new McpRuntimeError('external MCP CLI is unavailable', 'MCP_EXTERNAL_UNAVAILABLE')))
    child.once('close', code => {
      if (exceeded) return settle(new McpRuntimeError('external MCP CLI probe output exceeded the safe limit', 'MCP_EXTERNAL_OUTPUT_LIMIT'))
      return code === 0
        ? settle(undefined, output.subarray(0, outputBytes).toString('utf8'))
        : settle(new McpRuntimeError('external MCP CLI identity verification failed', 'MCP_EXTERNAL_UNAVAILABLE'))
    })
  })
}

async function verifiedObsidianCli(environment, { platform = process.platform, ...options } = {}) {
  const command = await resolveApprovedExecutable(environment, { platform, ...options })
  const version = parseVersion(await probeExternal(command, ['--version'], environment, options))
  if (!version || !atLeast(version, [1, 12, 7])) fail('Obsidian CLI is unavailable or below the required version', 'MCP_EXTERNAL_UNAVAILABLE')
  return command
}

function validObsidianSelector(value) {
  return typeof value === 'string' && value && value.length <= 255 && value !== '.' && value !== '..'
    && !/[\\/]/.test(value) && !value.includes(String.fromCharCode(0))
    && ![...value].some(character => character.charCodeAt(0) < 0x20 || character.charCodeAt(0) === 0x7f)
}

function pathFromVaultInfo(value) {
  const match = String(value).match(/^([^\r\n\x00-\x1f\x7f]+)\r?\n?$/)
  if (!match || !isAbsolute(match[1])) fail('Obsidian vault identity verification failed', 'MCP_EXTERNAL_UNAVAILABLE')
  return match[1]
}

async function verifiedObsidianVault(environment, command, { fs = { realpath, lstat }, ...options } = {}) {
  const vault = environment.OBSIDIAN_VAULT
  const root = environment.OBSIDIAN_VAULT_ROOT
  if (!validObsidianSelector(vault)) {
    fail('Obsidian vault identity is invalid', 'MCP_EXTERNAL_UNAVAILABLE')
  }
  if (typeof root !== 'string' || !root || /[\x00-\x1f\x7f]/.test(root) || !isAbsolute(root)) {
    fail('Obsidian vault root is invalid', 'MCP_EXTERNAL_UNAVAILABLE')
  }
  const canonicalRoot = await fs.realpath(root).catch(() => fail('Obsidian vault root is unavailable', 'MCP_EXTERNAL_UNAVAILABLE'))
  const stat = await fs.lstat(canonicalRoot).catch(() => fail('Obsidian vault root is unavailable', 'MCP_EXTERNAL_UNAVAILABLE'))
  if (!stat.isDirectory()) fail('Obsidian vault is unavailable', 'MCP_EXTERNAL_UNAVAILABLE')
  const reported = pathFromVaultInfo(await probeExternal(command, [`vault=${vault}`, 'vault', 'info=path'], environment, options))
  const canonicalReported = await fs.realpath(reported).catch(() => fail('Obsidian vault identity verification failed', 'MCP_EXTERNAL_UNAVAILABLE'))
  if (canonicalReported !== canonicalRoot) fail('Obsidian vault identity verification failed', 'MCP_EXTERNAL_UNAVAILABLE')
  return { vault, canonicalRoot }
}

function sessionMilliseconds(server, override) {
  if (override !== undefined) {
    if (!Number.isInteger(override) || override <= 0) fail('MCP session timeout is invalid', 'MCP_SESSION_TIMEOUT')
    return override
  }
  const minutes = server.sessionPolicy?.maxSessionMinutes
  return Number.isInteger(minutes) && minutes > 0 ? minutes * 60_000 : DEFAULT_SESSION_TIMEOUT_MS
}

function stopChild(child, platform, signal = 'SIGTERM', killImpl = process.kill, { forceGroup = false } = {}) {
  if (!child) return
  const exited = child.exitCode !== null && child.exitCode !== undefined
  try {
    // Once a POSIX process has been detached, the group must be addressed even
    // if its direct leader reported close: grandchildren can still be alive.
    if (platform !== 'win32' && Number.isInteger(child.pid) && (!exited || forceGroup)) killImpl(-child.pid, signal)
    else if (!exited) child.kill(signal)
  } catch {
    if (!exited) try { child.kill(signal) } catch {}
  }
}

export function runMcpChild({ command, args, env, cwd, spawnImpl = childSpawn, platform = process.platform, startupTimeoutMs = STARTUP_TIMEOUT_MS, sessionTimeoutMs, killGraceMs = 250, installSignalHandlers = true, killImpl = process.kill } = {}) {
  if (!isAbsolute(command) || !isAbsolute(cwd) || !env || Object.getPrototypeOf(env) !== null) fail('MCP child launch policy is malformed', 'MCP_RUNTIME_POLICY')
  return new Promise((resolvePromise, reject) => {
    let child; let settled = false; let startupTimer; let sessionTimer; let killTimer; let terminatingError
    const signalHandlers = []
    const cleanup = () => {
      clearTimeout(startupTimer); clearTimeout(sessionTimer); clearTimeout(killTimer)
      for (const [signal, handler] of signalHandlers) process.removeListener(signal, handler)
    }
    const settle = error => {
      if (settled) return; settled = true; cleanup(); error ? reject(error) : resolvePromise()
    }
    try {
      child = spawnImpl(command, args, { cwd, env, shell: false, detached: platform !== 'win32', stdio: ['inherit', 'inherit', 'pipe'] })
    } catch { settle(new McpRuntimeError('MCP server failed before startup', 'MCP_START_FAILED')); return }
    child.stderr?.resume()
    const terminate = error => {
      if (terminatingError) return
      terminatingError = error; stopChild(child, platform, 'SIGTERM', killImpl)
      // A detached child can own descendants (browser/bridge processes). Give
      // its process group a short graceful window, then terminate the group.
      killTimer = setTimeout(() => {
        stopChild(child, platform, 'SIGKILL', killImpl, { forceGroup: true })
        settle(terminatingError)
      }, killGraceMs)
    }
    const closeProcessGroup = outcome => {
      clearTimeout(startupTimer); clearTimeout(sessionTimer)
      if (platform === 'win32') return settle(outcome)
      // A leader exit is not proof that a detached browser/bridge descendant
      // has exited. Always signal the original group before reporting close.
      stopChild(child, platform, 'SIGTERM', killImpl, { forceGroup: true })
      killTimer = setTimeout(() => {
        stopChild(child, platform, 'SIGKILL', killImpl, { forceGroup: true })
        settle(outcome)
      }, killGraceMs)
    }
    startupTimer = setTimeout(() => terminate(new McpRuntimeError('MCP server startup timed out', 'MCP_STARTUP_TIMEOUT')), startupTimeoutMs)
    child.once('spawn', () => {
      clearTimeout(startupTimer)
      sessionTimer = setTimeout(() => terminate(new McpRuntimeError('MCP server session timed out', 'MCP_SESSION_TIMEOUT')), sessionTimeoutMs)
    })
    child.once('error', () => {
      if (!terminatingError) settle(new McpRuntimeError('MCP server failed before startup', 'MCP_START_FAILED'))
    })
    child.once('close', code => {
      // Do not clear the grace timer here. A closed leader does not prove its
      // detached descendants are gone, so terminate() always reaches SIGKILL.
      if (!terminatingError) closeProcessGroup(code === 0 ? undefined : new McpRuntimeError('MCP server exited unexpectedly', 'MCP_CHILD_EXIT'))
    })
    if (installSignalHandlers) for (const signal of ['SIGINT', 'SIGTERM', 'SIGHUP']) {
      const handler = () => terminate(new McpRuntimeError('MCP server terminated', 'MCP_TERMINATED'))
      signalHandlers.push([signal, handler]); process.once(signal, handler)
    }
  })
}

function runnerEnvironment(server, environment) {
  try {
    return buildAllowlistedEnv({ source: environment, allowlist: server.envAllowlist, fixed: server.fixedEnv || {}, required: server.requiredEnv })
  } catch (error) {
    if (error instanceof SecurityPolicyError) fail(error.message, error.code)
    throw error
  }
}

function unavailable(server) {
  if (server.runtime?.availability !== 'unavailable') return
  fail(`MCP server is unavailable pending verified runtime isolation: ${server.id}`, 'MCP_RUNTIME_UNAVAILABLE')
}

function trustedRuntimeFor(server) {
  const trusted = TRUSTED_RUNTIMES[server.id]
  if (!trusted || JSON.stringify(server.runtime || {}) !== JSON.stringify(trusted)) {
    fail(`MCP runtime policy does not match the trusted launcher: ${server.id}`, 'MCP_RUNTIME_POLICY')
  }
  return trusted
}

export async function runMcpServer({ serverId, sourceRoot = RUNTIME_ROOT, environment = process.env, spawnImpl = childSpawn, platform = process.platform, startupTimeoutMs, sessionTimeoutMs, installSignalHandlers = true, fs } = {}) {
  if (serverId === 'vault') fail('raw Vault MCP is unavailable', 'MCP_RAW_VAULT_UNAVAILABLE')
  if (typeof serverId !== 'string' || !/^[a-z0-9][a-z0-9-]*$/.test(serverId)) fail('MCP server id is invalid', 'MCP_UNKNOWN_SERVER')
  const root = await realpath(sourceRoot).catch(() => fail('installed MCP source root is unavailable', 'MCP_SOURCE_ROOT'))
  const bun = await assertBunRuntime({ sourceRoot: root }).catch(error => fail(error.message, 'MCP_RUNTIME_PATH'))
  const catalog = await loadMcpCatalog({ specsDir: join(root, 'ai-specs') })
  const server = catalog.servers.get(serverId)
  if (!server) fail(`unknown MCP server: ${serverId}`, 'MCP_UNKNOWN_SERVER')
  unavailable(server)
  if (!['playwright', 'chrome-devtools', 'obsidian-safe', 'youtrack-read', 'youtrack-write'].includes(serverId)) {
    fail(`MCP server does not use a local runner: ${serverId}`, 'MCP_RUNNER_UNSUPPORTED')
  }
  const trustedRuntime = trustedRuntimeFor(server)
  const env = runnerEnvironment(server, sanitizeBunEnv(environment))
  const sessionTimeout = sessionMilliseconds(server, sessionTimeoutMs)
  const spawnOptions = { spawnImpl, platform, startupTimeoutMs, sessionTimeoutMs: sessionTimeout, installSignalHandlers }
  if (serverId === 'youtrack-read' || serverId === 'youtrack-write') {
    const verified = await verifyRuntimePackage({ sourceRoot: root, runtime: trustedRuntime, ...(fs ? { fs } : {}) })
    const url = buildYouTrackBridgeUrl(server, env)
    const bridgeArgs = [url, '--transport', 'http-only', '--silent']
    if (new URL(url).protocol === 'http:') bridgeArgs.push('--allow-http')
    return runMcpChild({ command: bun.executable, args: [...bunArgs({ sourceRoot: root, script: verified.bin }), ...bridgeArgs], env, cwd: root, ...spawnOptions })
  }
  if (server.transport !== 'stdio') fail(`MCP server does not use a local runner: ${serverId}`, 'MCP_RUNNER_UNSUPPORTED')
  if (serverId === 'obsidian-safe') {
    const cli = await verifiedObsidianCli(env, { spawnImpl, platform, ...(fs ? { fs } : {}) })
    const vault = await verifiedObsidianVault(env, cli, { spawnImpl, platform, ...(fs ? { fs } : {}) })
    env.OBSIDIAN_VAULT = vault.vault
    env.OBSIDIAN_VAULT_ROOT = vault.canonicalRoot
    env.OBSIDIAN_CLI = cli
    const wrapper = await realpath(join(root, trustedRuntime.wrapper)).catch(() => fail('Obsidian MCP bridge is unavailable', 'MCP_DEPENDENCY_MISSING'))
    if (!pathInside(root, wrapper)) fail('Obsidian MCP bridge escapes the installed source tree', 'MCP_BIN_ESCAPE')
    await regularFile(wrapper, 'Obsidian MCP bridge is not a regular file')
    return runMcpChild({ command: bun.executable, args: bunArgs({ sourceRoot: root, script: wrapper }), env, cwd: root, ...spawnOptions })
  }
  if (!['playwright', 'chrome-devtools'].includes(serverId)) fail(`MCP server has no trusted local launcher: ${serverId}`, 'MCP_RUNNER_UNSUPPORTED')
  const verified = await verifyRuntimePackage({ sourceRoot: root, runtime: trustedRuntime, ...(fs ? { fs } : {}) })
  return runMcpChild({ command: bun.executable, args: [...bunArgs({ sourceRoot: root, script: verified.bin }), ...trustedRuntime.args], env, cwd: root, ...spawnOptions })
}
