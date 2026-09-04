#!/usr/bin/env bun
import { spawn } from 'node:child_process'
import { lstat, realpath } from 'node:fs/promises'
import { isAbsolute, join, relative, sep } from 'node:path'
import { fileURLToPath } from 'node:url'

const MAX_QUERY_LENGTH = 500
const MAX_PATH_LENGTH = 1024
const MAX_REQUEST_BYTES = 64 * 1024
const MAX_OUTPUT_BYTES = 1024 * 1024
const MAX_RESPONSE_BYTES = MAX_OUTPUT_BYTES + 8 * 1024
const MAX_REQUEST_ID_BYTES = 128
const COMMAND_TIMEOUT_MS = 15_000
const COMMAND_KILL_GRACE_MS = 250

export const obsidianToolDefinitions = Object.freeze([
  {
    name: 'obsidian_read',
    description: 'Read one relative note path from the explicitly selected Obsidian vault.',
    inputSchema: {
      type: 'object', additionalProperties: false, required: ['path'],
      properties: { path: { type: 'string', minLength: 1, maxLength: MAX_PATH_LENGTH } }
    }
  }
])

function validateRelativeNotePath(path) {
  if (typeof path !== 'string' || !path || path.length > MAX_PATH_LENGTH || /[\x00-\x1f\x7f]/.test(path)) throw new Error('invalid note path')
  const normalized = path.replaceAll('\\', '/')
  const segments = normalized.split('/')
  const basename = segments.at(-1) || ''
  const secretName = /^(?:\.env(?:\..*)?|\.globals|credentials?(?:\.[^/\\]+)?|secrets?(?:\.[^/\\]+)?|.*\.(?:pem|key)|id_(?:rsa|dsa|ecdsa|ed25519)|auth\.json|\.vault-token|\.npmrc|\.netrc|\.git-credentials|oauth(?:[-_.]?(?:token|store|cache))?)$/i
  if (normalized.startsWith('/') || segments.some(segment => !segment || segment === '.' || segment === '..' || segment.startsWith('.')) || !basename.endsWith('.md') || secretName.test(basename)) {
    throw new Error('note path must stay inside the selected vault')
  }
  return normalized
}

function insideOrEqual(root, target) {
  const difference = relative(root, target)
  return difference === '' || (difference !== '..' && !difference.startsWith(`..${sep}`) && !isAbsolute(difference))
}

async function verifyReadPath(vaultRoot, notePath, fs) {
  const root = await fs.realpath(vaultRoot).catch(() => { throw new Error('Obsidian vault root is unavailable') })
  const rootStat = await fs.lstat(root).catch(() => { throw new Error('Obsidian vault root is unavailable') })
  if (!rootStat.isDirectory()) throw new Error('Obsidian vault root is unavailable')
  let candidate = root
  const parts = notePath.split('/')
  for (const [index, part] of parts.entries()) {
    candidate = join(candidate, part)
    const stat = await fs.lstat(candidate).catch(() => { throw new Error('Obsidian note is unavailable') })
    if (stat.isSymbolicLink()) throw new Error('Obsidian note path contains a symbolic link')
    if (index < parts.length - 1 && !stat.isDirectory()) throw new Error('Obsidian note path is invalid')
    if (index === parts.length - 1 && !stat.isFile()) throw new Error('Obsidian note is unavailable')
  }
  const canonical = await fs.realpath(candidate).catch(() => { throw new Error('Obsidian note is unavailable') })
  if (!insideOrEqual(root, canonical)) throw new Error('Obsidian note path escapes the selected vault')
}

function defaultRunner(command, args, { environment }) {
  return new Promise((resolve, reject) => {
    const detached = process.platform !== 'win32'
    const child = spawn(command, args, { env: environment, shell: false, detached, stdio: ['ignore', 'pipe', 'pipe'] })
    const stdout = []
    let outputBytes = 0; let settled = false; let ending = false; let terminalError; let killTimer
    const settle = error => {
      if (settled) return
      settled = true; clearTimeout(timeout); clearTimeout(killTimer)
      if (error) return reject(error)
      try { resolve(sanitizeObsidianCliOutput(Buffer.concat(stdout))) } catch (sanitizationError) { reject(sanitizationError) }
    }
    const signal = (name, forceGroup = false) => {
      try {
        if (detached && Number.isInteger(child.pid)) process.kill(-child.pid, name)
        else if (forceGroup || child.exitCode === null || child.exitCode === undefined) child.kill(name)
      } catch { try { child.kill(name) } catch {} }
    }
    const cleanupProcessGroup = error => {
      if (ending) return
      ending = true; terminalError = error
      // The CLI is the leader of a detached POSIX group.  It can exit while
      // descendants keep inherited resources alive, so success is not settled
      // until the original group has received TERM and then forced KILL.
      signal('SIGTERM')
      killTimer = setTimeout(() => { signal('SIGKILL', true); settle(terminalError) }, COMMAND_KILL_GRACE_MS)
    }
    const timeout = setTimeout(() => cleanupProcessGroup(new Error('Obsidian CLI command timed out')), COMMAND_TIMEOUT_MS)
    child.stdout.on('data', chunk => {
      outputBytes += chunk.length
      if (outputBytes > MAX_OUTPUT_BYTES) cleanupProcessGroup(new Error('Obsidian CLI output exceeded the safe limit'))
      else stdout.push(chunk)
    })
    child.stderr.resume()
    child.once('error', () => { cleanupProcessGroup(new Error('Obsidian CLI is unavailable')) })
    child.once('close', code => {
      if (ending) return
      cleanupProcessGroup(code === 0 ? undefined : new Error('Obsidian CLI command failed'))
    })
  })
}

export function sanitizeObsidianCliOutput(output) {
  let text
  try { text = new TextDecoder('utf-8', { fatal: true }).decode(output) } catch { throw new Error('Obsidian CLI output is not valid UTF-8') }
  if (Buffer.byteLength(text, 'utf8') > MAX_OUTPUT_BYTES) throw new Error('Obsidian CLI output exceeded the safe limit')
  if (/[\x00-\x08\x0b-\x1f\x7f]/.test(text)) throw new Error('Obsidian CLI output contains unsafe control characters')
  return text
}

export function createObsidianSafeServer({ vault, vaultRoot, command, runtimeEnv = {}, runner = defaultRunner, fs = { lstat, realpath } } = {}) {
  if (typeof vault !== 'string' || !vault.trim() || vault.length > 255 || /[\\/\x00-\x1f\x7f]/.test(vault) || vault === '.' || vault === '..') throw new Error('OBSIDIAN_VAULT must select one vault')
  if (typeof command !== 'string' || !isAbsolute(command)) throw new Error('OBSIDIAN_CLI must be a verified absolute executable path')
  const environment = Object.create(null)
  for (const name of ['PATH', 'HOME']) if (runtimeEnv[name]) environment[name] = String(runtimeEnv[name])
  return {
    async callTool(name, input = {}) {
      let args
      if (name === 'obsidian_read') {
        const path = validateRelativeNotePath(input.path)
        if (vaultRoot) await verifyReadPath(vaultRoot, path, fs)
        args = [`vault=${vault}`, 'read', `path=${path}`]
      } else throw new Error(`unsupported Obsidian tool: ${name}`)
      return runner(command, args, { environment })
    }
  }
}

async function runStdio() {
  const runtimeEnv = { PATH: process.env.PATH, HOME: process.env.HOME }
  const server = createObsidianSafeServer({ vault: process.env.OBSIDIAN_VAULT, vaultRoot: process.env.OBSIDIAN_VAULT_ROOT, command: process.env.OBSIDIAN_CLI, runtimeEnv })
  for await (const requestLine of boundedLines(process.stdin)) {
    if (requestLine.oversized) {
      writeResponse({ jsonrpc: '2.0', id: null, error: { code: -32600, message: 'request exceeds the safe size limit' } })
      continue
    }
    const line = requestLine.line.toString('utf8')
    if (!line.trim()) continue
    let request
    try { request = JSON.parse(line) } catch {
      writeResponse({ jsonrpc: '2.0', id: null, error: { code: -32700, message: 'invalid JSON-RPC request' } })
      continue
    }
    if (!request || typeof request !== 'object' || Array.isArray(request)) {
      writeResponse({ jsonrpc: '2.0', id: null, error: { code: -32600, message: 'invalid JSON-RPC request' } })
      continue
    }
    const id = responseId(request)
    if (id === undefined) {
      // JSON-RPC notifications have no response channel, including failures.
      continue
    }
    const response = { jsonrpc: '2.0', id }
    try {
      if (request.method === 'initialize') {
        response.result = { protocolVersion: '2025-06-18', capabilities: { tools: {} }, serverInfo: { name: 'ai-config-obsidian-safe', version: '1.0.0' } }
      } else if (request.method === 'tools/list') response.result = { tools: obsidianToolDefinitions }
      else if (request.method === 'tools/call') {
        const text = await server.callTool(request.params?.name, request.params?.arguments || {})
        response.result = { content: [{ type: 'text', text }] }
      } else throw new Error('unsupported JSON-RPC method')
    } catch (error) {
      response.error = { code: -32602, message: safeErrorMessage(error) }
    }
    writeResponse(response)
  }
}

function safeErrorMessage(error) {
  const message = error instanceof Error ? error.message : ''
  return typeof message === 'string' && message.length <= 256 && !/[\x00-\x1f\x7f]/.test(message)
    ? message
    : 'request rejected'
}

function responseId(request) {
  if (!Object.hasOwn(request, 'id')) return undefined
  const { id } = request
  if (id === null) return null
  if (typeof id === 'number' && Number.isFinite(id)) return id
  if (typeof id === 'string' && Buffer.byteLength(id, 'utf8') <= MAX_REQUEST_ID_BYTES && !/[\x00-\x1f\x7f]/.test(id)) return id
  return null
}

function writeResponse(response) {
  let serialized
  try { serialized = JSON.stringify(response) } catch { serialized = '' }
  if (!serialized || Buffer.byteLength(serialized, 'utf8') > MAX_RESPONSE_BYTES) {
    serialized = '{"jsonrpc":"2.0","id":null,"error":{"code":-32603,"message":"response exceeds the safe size limit"}}'
  }
  process.stdout.write(`${serialized}\n`)
}

async function *boundedLines(input) {
  let buffered = Buffer.alloc(0)
  let oversized = false
  for await (const rawChunk of input) {
    const chunk = Buffer.isBuffer(rawChunk) ? rawChunk : Buffer.from(rawChunk)
    let offset = 0
    while (offset < chunk.length) {
      const newline = chunk.indexOf(0x0a, offset)
      const end = newline === -1 ? chunk.length : newline
      const segment = chunk.subarray(offset, end)
      if (!oversized) {
        if (buffered.length + segment.length > MAX_REQUEST_BYTES) {
          buffered = Buffer.alloc(0)
          oversized = true
        } else if (segment.length) buffered = Buffer.concat([buffered, segment], buffered.length + segment.length)
      }
      if (newline === -1) break
      yield oversized ? { oversized: true } : { line: buffered }
      buffered = Buffer.alloc(0)
      oversized = false
      offset = newline + 1
    }
  }
  if (oversized) yield { oversized: true }
  else if (buffered.length) yield { line: buffered }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  runStdio().catch(error => {
    process.stderr.write(`obsidian-safe: ${error.message}\n`)
    process.exitCode = 1
  })
}
