import { createHash } from 'node:crypto'
import { lstat } from 'node:fs/promises'
import { basename, isAbsolute, relative, resolve, sep } from 'node:path'

const REDACTED = '[REDACTED]'
const SECRET_KEY = /(token|secret|password|passwd|cookie|authorization|api[-_]?key|private[-_]?key|credential)/i
const RISK_LEVELS = new Set(['low', 'medium', 'high', 'critical'])

export class SecurityPolicyError extends Error {
  constructor(message, code = 'SECURITY_POLICY') {
    super(message)
    this.name = 'SecurityPolicyError'
    this.code = code
  }
}

export function sha256(value) {
  return createHash('sha256').update(value).digest('hex')
}

export function safeRelativePath(root, candidate) {
  if (typeof candidate !== 'string' || !candidate || candidate.includes('\0')) {
    throw new SecurityPolicyError('managed path must be a non-empty string', 'INVALID_PATH')
  }
  if (isAbsolute(candidate)) throw new SecurityPolicyError('absolute managed path is forbidden', 'ABSOLUTE_PATH')
  const base = resolve(root)
  const target = resolve(base, candidate)
  const rel = relative(base, target)
  if (!rel || rel === '..' || rel.startsWith(`..${sep}`) || isAbsolute(rel)) {
    throw new SecurityPolicyError('managed path escapes its root', 'PATH_TRAVERSAL')
  }
  return { target, relativePath: rel.split(sep).join('/') }
}

export async function assertNoSymlinkAncestors(root, candidate) {
  const base = resolve(root)
  const { relativePath } = safeRelativePath(base, candidate)
  let current = base
  for (const segment of relativePath.split('/').slice(0, -1)) {
    current = resolve(current, segment)
    try {
      const stat = await lstat(current)
      if (stat.isSymbolicLink()) throw new SecurityPolicyError(`path has a symlink ancestor: ${relativePath}`, 'SYMLINK_ANCESTOR')
      if (!stat.isDirectory()) throw new SecurityPolicyError(`path ancestor is not a directory: ${relativePath}`, 'INVALID_PATH_ANCESTOR')
    } catch (error) {
      if (error.code === 'ENOENT') return
      throw error
    }
  }
}

/**
 * Build a fresh environment object from explicit names. This function intentionally
 * has no process.env fallback: callers must consciously supply a source object.
 */
export function buildAllowlistedEnv({ source = {}, allowlist = [], fixed = {}, required = [] } = {}) {
  if (!Array.isArray(allowlist) || !Array.isArray(required)) {
    throw new SecurityPolicyError('environment allowlist and required names must be arrays', 'INVALID_ENV_POLICY')
  }
  const allowed = new Set(allowlist)
  const result = Object.create(null)
  for (const name of allowlist) {
    if (typeof name !== 'string' || !/^[A-Z_][A-Z0-9_]*$/.test(name)) {
      throw new SecurityPolicyError(`invalid environment variable name: ${String(name)}`, 'INVALID_ENV_NAME')
    }
    if (Object.hasOwn(source, name) && source[name] !== undefined) result[name] = String(source[name])
  }
  for (const [name, value] of Object.entries(fixed)) {
    if (!/^[A-Z_][A-Z0-9_]*$/.test(name)) {
      throw new SecurityPolicyError(`invalid fixed environment variable name: ${name}`, 'INVALID_ENV_NAME')
    }
    if (allowed.has(name)) throw new SecurityPolicyError(`fixed environment overlaps allowlist: ${name}`, 'AMBIGUOUS_ENV')
    result[name] = String(value)
  }
  const missing = required.filter(name => !Object.hasOwn(result, name) || result[name] === '')
  if (missing.length) {
    throw new SecurityPolicyError(`required environment variables are missing: ${missing.join(', ')}`, 'MISSING_ENV')
  }
  return result
}

export function interpolateAllowed(template, environment, allowedNames) {
  const allowed = new Set(allowedNames)
  return String(template).replace(/\$\{([A-Z_][A-Z0-9_]*)\}/g, (_, name) => {
    if (!allowed.has(name)) throw new SecurityPolicyError(`template references non-allowlisted environment: ${name}`, 'ENV_NOT_ALLOWED')
    if (!Object.hasOwn(environment, name) || environment[name] === '') {
      throw new SecurityPolicyError(`template environment is missing: ${name}`, 'MISSING_ENV')
    }
    return environment[name]
  })
}

export function redactMetadata(value, seen = new WeakSet()) {
  if (value === null || typeof value !== 'object') return value
  if (seen.has(value)) return '[CIRCULAR]'
  seen.add(value)
  if (Array.isArray(value)) return value.map(item => redactMetadata(item, seen))
  const result = {}
  for (const [key, item] of Object.entries(value)) {
    result[key] = SECRET_KEY.test(key) ? REDACTED : redactMetadata(item, seen)
  }
  return result
}

export function safeAuditEvent({ operation, server, command, args = [], env = {}, target, outcome, reasons = [] } = {}) {
  const metadata = {
    operation: String(operation || 'unknown'),
    serverId: server?.id || undefined,
    risk: server?.risk || undefined,
    executable: command ? basename(command) : undefined,
    argumentCount: Array.isArray(args) ? args.length : 0,
    environmentNames: Object.keys(env).sort(),
    targetFingerprint: target ? sha256(String(target)) : undefined,
    outcome: outcome || undefined,
    reasons: reasons.map(reason => String(reason))
  }
  return redactMetadata(metadata)
}

export function assessMcpServer(server, { approvedServerIds = [] } = {}) {
  if (!server || typeof server.id !== 'string') throw new SecurityPolicyError('invalid MCP server descriptor', 'INVALID_SERVER')
  if (!RISK_LEVELS.has(server.risk)) throw new SecurityPolicyError(`invalid MCP risk for ${server.id}`, 'INVALID_RISK')
  const approved = new Set(approvedServerIds)
  const approvalRequired = server.optIn === true || server.risk === 'high' || server.risk === 'critical'
  const reasons = []
  if (approvalRequired && !approved.has(server.id)) reasons.push('explicit-opt-in-required')
  if (server.risk === 'critical') reasons.push('task-scoped-only')
  return {
    allowed: reasons[0] !== 'explicit-opt-in-required',
    approvalRequired,
    reasons,
    metadata: safeAuditEvent({ operation: 'mcp-enable', server, outcome: reasons.length ? 'review' : 'allow', reasons })
  }
}

export function requireBoundedSession(server, { maxSessionMinutes } = {}) {
  if (!server?.sessionPolicy) return undefined
  const catalogLimit = server.sessionPolicy.maxSessionMinutes
  const requested = maxSessionMinutes ?? catalogLimit
  if (!Number.isInteger(requested) || requested <= 0 || requested > catalogLimit) {
    throw new SecurityPolicyError(`session duration exceeds policy for ${server.id}`, 'SESSION_LIMIT')
  }
  return { maxSessionMinutes: requested, persistent: false }
}

export const securityConstants = Object.freeze({ REDACTED })
