import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { parse } from 'yaml'
import { assessMcpServer, buildAllowlistedEnv, interpolateAllowed, requireBoundedSession, SecurityPolicyError } from '../security-guard/index.js'

const TRANSPORTS = new Set(['stdio', 'streamable-http'])
const SERVER_FIELDS = new Set(['id', 'description', 'transport', 'url', 'urlTemplate', 'risk', 'optIn', 'mutating', 'envAllowlist', 'requiredEnv', 'fixedEnv', 'toolAllowlist', 'enforceToolsInUrl', 'dataBoundary', 'source', 'runtimeIntegrity', 'runtime', 'sessionPolicy', 'timeouts'])
const RUNTIME_FIELDS = new Set(['package', 'version', 'integrity', 'treeSha256', 'bin', 'binPath', 'args', 'wrapper', 'availability'])

function assertSafeRemoteUrl(value, serverId) {
  let url
  try { url = new URL(value) } catch { throw new SecurityPolicyError(`invalid MCP URL: ${serverId}`, 'UNSAFE_MCP_URL') }
  const loopback = ['localhost', '127.0.0.1', '::1', '[::1]'].includes(url.hostname)
  if (url.protocol !== 'https:' && !(url.protocol === 'http:' && loopback)) {
    throw new SecurityPolicyError(`MCP URL must use HTTPS or loopback HTTP: ${serverId}`, 'UNSAFE_MCP_URL')
  }
  if (url.username || url.password) throw new SecurityPolicyError(`credentials in MCP URL are forbidden: ${serverId}`, 'CREDENTIAL_IN_URL')
  if (url.hash) throw new SecurityPolicyError(`fragments in MCP URL are forbidden: ${serverId}`, 'UNSAFE_MCP_URL')
  return url
}

function validateRemoteEndpoint(server) {
  if (server.url !== undefined) {
    if (typeof server.url !== 'string' || server.url.includes('${')) throw new SecurityPolicyError(`invalid fixed MCP URL: ${server.id}`, 'UNSAFE_MCP_URL')
    assertSafeRemoteUrl(server.url, server.id)
  }
  if (server.urlTemplate !== undefined) {
    if (typeof server.urlTemplate !== 'string' || !server.urlTemplate) throw new SecurityPolicyError(`invalid MCP URL template: ${server.id}`, 'UNSAFE_MCP_URL')
    const names = [...server.urlTemplate.matchAll(/\$\{([A-Z_][A-Z0-9_]*)\}/g)].map(match => match[1])
    const remainder = server.urlTemplate.replace(/\$\{[A-Z_][A-Z0-9_]*\}/g, '')
    if ((server.urlTemplate.includes('${') && names.length === 0) || names.some(name => !server.envAllowlist.includes(name) || !server.requiredEnv.includes(name)) || new Set(names).size !== names.length) {
      throw new SecurityPolicyError(`invalid MCP URL template references: ${server.id}`, 'UNSAFE_MCP_URL')
    }
    // Substitute a safe non-secret value solely to validate the static URL
    // shape. The provider projection retains only the environment reference.
    const substituted = server.urlTemplate.replace(/\$\{[A-Z_][A-Z0-9_]*\}/g, 'https://example.invalid')
    if (remainder.includes('#')) throw new SecurityPolicyError(`fragments in MCP URL are forbidden: ${server.id}`, 'UNSAFE_MCP_URL')
    assertSafeRemoteUrl(substituted, server.id)
  }
}

function projectedUrl(server) {
  const value = server.url || server.urlTemplate
  if (!server.enforceToolsInUrl || !server.toolAllowlist?.length) return value
  return `${value}${value.includes('?') ? '&' : '?'}tools=${encodeURIComponent(server.toolAllowlist.join(','))}`
}

function assertRuntimeAvailable(server) {
  if (server.runtime?.availability === 'unavailable') {
    throw new SecurityPolicyError(`MCP server is unavailable pending verified runtime isolation: ${server.id}`, 'MCP_RUNTIME_UNAVAILABLE')
  }
}

function projectServer(server) {
  return {
    id: server.id,
    transport: server.transport,
    url: server.transport === 'streamable-http' ? projectedUrl(server) : undefined,
    envReferences: [...server.envAllowlist],
    requiredEnv: [...server.requiredEnv],
    fixedEnv: server.fixedEnv ? { ...server.fixedEnv } : undefined,
    toolAllowlist: server.toolAllowlist ? [...server.toolAllowlist] : undefined,
    risk: server.risk,
    mutating: server.mutating === true,
    runtime: server.runtime ? structuredClone(server.runtime) : undefined,
    session: requireBoundedSession(server),
    timeouts: server.timeouts ? { ...server.timeouts } : undefined,
    runtimeIntegrity: server.runtimeIntegrity ? structuredClone(server.runtimeIntegrity) : { status: 'remote-service' }
  }
}

export async function loadMcpCatalog({ specsDir = 'ai-specs' } = {}) {
  const root = resolve(specsDir, 'mcp')
  const [catalog, profileDocument] = await Promise.all([
    readFile(resolve(root, 'catalog.yaml'), 'utf8').then(parse),
    readFile(resolve(root, 'profiles.yaml'), 'utf8').then(parse)
  ])
  validateCatalog(catalog)
  validateProfiles(profileDocument, catalog)
  return {
    schemaVersion: 1,
    policy: catalog.policy,
    servers: new Map(catalog.servers.map(server => [server.id, structuredClone(server)])),
    profiles: new Map(profileDocument.profiles.map(profile => [profile.id, structuredClone(profile)]))
  }
}

export function validateCatalog(catalog) {
  if (!catalog || catalog.schemaVersion !== 1 || !Array.isArray(catalog.servers)) {
    throw new SecurityPolicyError('invalid MCP catalog schema', 'INVALID_MCP_CATALOG')
  }
  const ids = new Set()
  for (const server of catalog.servers) {
    if (!server || typeof server.id !== 'string' || !/^[a-z0-9][a-z0-9-]*$/.test(server.id)) {
      throw new SecurityPolicyError('MCP server has invalid id', 'INVALID_SERVER')
    }
    if (ids.has(server.id)) throw new SecurityPolicyError(`duplicate MCP server: ${server.id}`, 'DUPLICATE_SERVER')
    ids.add(server.id)
    if (Object.keys(server).some(key => !SERVER_FIELDS.has(key))) throw new SecurityPolicyError(`MCP server contains an unsupported field: ${server.id}`, 'INVALID_SERVER')
    if (Object.hasOwn(server, 'command') || Object.hasOwn(server, 'args')) throw new SecurityPolicyError(`direct MCP commands are forbidden: ${server.id}`, 'INVALID_SERVER')
    if (!TRANSPORTS.has(server.transport)) throw new SecurityPolicyError(`invalid MCP transport: ${server.id}`, 'INVALID_TRANSPORT')
    if (server.transport === 'stdio' && (!server.runtime || typeof server.runtime !== 'object' || Array.isArray(server.runtime))) {
      throw new SecurityPolicyError(`stdio MCP server has no trusted runtime policy: ${server.id}`, 'INVALID_SERVER')
    }
    if (server.transport === 'streamable-http' && !server.url && !server.urlTemplate) {
      throw new SecurityPolicyError(`HTTP MCP server has no URL: ${server.id}`, 'INVALID_SERVER')
    }
    if (!Array.isArray(server.envAllowlist) || !Array.isArray(server.requiredEnv)) {
      throw new SecurityPolicyError(`MCP environment policy is missing: ${server.id}`, 'INVALID_ENV_POLICY')
    }
    if (server.envAllowlist.some(name => typeof name !== 'string' || !/^[A-Z_][A-Z0-9_]*$/.test(name)) || server.requiredEnv.some(name => typeof name !== 'string' || !server.envAllowlist.includes(name)) || new Set(server.envAllowlist).size !== server.envAllowlist.length || new Set(server.requiredEnv).size !== server.requiredEnv.length) {
      throw new SecurityPolicyError(`MCP environment policy is invalid: ${server.id}`, 'INVALID_ENV_POLICY')
    }
    if (server.toolAllowlist !== undefined && (!Array.isArray(server.toolAllowlist) || server.toolAllowlist.some(tool => typeof tool !== 'string' || !/^[a-z][a-z0-9_]*$/.test(tool)) || new Set(server.toolAllowlist).size !== server.toolAllowlist.length)) {
      throw new SecurityPolicyError(`MCP tool allowlist is invalid: ${server.id}`, 'INVALID_SERVER')
    }
    if (server.transport === 'streamable-http') validateRemoteEndpoint(server)
    if (server.timeouts && (!Number.isInteger(server.timeouts.startupSeconds) || server.timeouts.startupSeconds <= 0 || !Number.isInteger(server.timeouts.toolSeconds) || server.timeouts.toolSeconds <= 0)) {
      throw new SecurityPolicyError(`MCP server has invalid time bounds: ${server.id}`, 'INVALID_SERVER')
    }
    if (server.runtime) {
      if (Object.keys(server.runtime).some(key => !RUNTIME_FIELDS.has(key))) throw new SecurityPolicyError(`MCP runtime contains an unsupported field: ${server.id}`, 'INVALID_SERVER')
      const unavailable = server.runtime.availability === 'unavailable'
      const wrapper = typeof server.runtime.wrapper === 'string'
      const packageRuntime = ['package', 'version', 'integrity', 'treeSha256', 'bin', 'binPath'].every(key => typeof server.runtime[key] === 'string')
      if (!unavailable && !wrapper && !packageRuntime) throw new SecurityPolicyError(`MCP runtime is incomplete: ${server.id}`, 'INVALID_SERVER')
      if (unavailable && Object.keys(server.runtime).length !== 1) throw new SecurityPolicyError(`unavailable MCP runtime has unsupported launch data: ${server.id}`, 'INVALID_SERVER')
      if (wrapper && Object.keys(server.runtime).some(key => !['wrapper'].includes(key))) throw new SecurityPolicyError(`MCP wrapper runtime has unsupported launch data: ${server.id}`, 'INVALID_SERVER')
      if (packageRuntime && server.runtime.args !== undefined && (!Array.isArray(server.runtime.args) || server.runtime.args.some(arg => typeof arg !== 'string'))) throw new SecurityPolicyError(`MCP runtime arguments are invalid: ${server.id}`, 'INVALID_SERVER')
    }
    assessMcpServer(server)
  }
  return catalog
}

export function validateProfiles(profileDocument, catalog) {
  if (!profileDocument || profileDocument.schemaVersion !== 1 || !Array.isArray(profileDocument.profiles)) {
    throw new SecurityPolicyError('invalid MCP profiles schema', 'INVALID_MCP_PROFILES')
  }
  const serverIds = new Set(catalog.servers.map(server => server.id))
  const ids = new Set()
  for (const profile of profileDocument.profiles) {
    if (!profile || typeof profile.id !== 'string' || ids.has(profile.id)) {
      throw new SecurityPolicyError('invalid or duplicate MCP profile', 'INVALID_MCP_PROFILE')
    }
    ids.add(profile.id)
    if (!Array.isArray(profile.servers) || profile.servers.some(id => !serverIds.has(id))) {
      throw new SecurityPolicyError(`profile references an unknown MCP server: ${profile.id}`, 'UNKNOWN_SERVER')
    }
    if (!Array.isArray(profile.approvals)) throw new SecurityPolicyError(`profile approvals are missing: ${profile.id}`, 'INVALID_MCP_PROFILE')
    if (profile.approvals.some(id => !profile.servers.includes(id))) {
      throw new SecurityPolicyError(`profile approval is outside its server set: ${profile.id}`, 'INVALID_MCP_PROFILE')
    }
    for (const serverId of profile.servers) {
      const server = catalog.servers.find(candidate => candidate.id === serverId)
      if ((server.optIn || server.risk === 'high' || server.risk === 'critical') && !profile.approvals.includes(serverId)) {
        throw new SecurityPolicyError(`profile does not declare required approval: ${profile.id}/${serverId}`, 'MISSING_PROFILE_APPROVAL')
      }
    }
  }
  return profileDocument
}

export function materializeMcpServer(server, { environment = {}, approvedServerIds = [] } = {}) {
  const assessment = assessMcpServer(server, { approvedServerIds })
  if (!assessment.allowed) {
    throw new SecurityPolicyError(`MCP server requires explicit approval: ${server.id}`, 'MCP_APPROVAL_REQUIRED')
  }
  const selectedEnvironment = buildAllowlistedEnv({
    source: environment,
    allowlist: server.envAllowlist,
    fixed: server.fixedEnv || {},
    required: server.requiredEnv
  })
  const result = {
    id: server.id,
    transport: server.transport,
    risk: server.risk,
    mutating: server.mutating === true,
    env: selectedEnvironment,
    toolAllowlist: server.toolAllowlist ? [...server.toolAllowlist] : undefined,
    session: requireBoundedSession(server),
    audit: assessment.metadata
  }
  if (server.transport === 'stdio') {
    result.runtime = structuredClone(server.runtime)
  } else {
    result.url = server.url || interpolateAllowed(server.urlTemplate, selectedEnvironment, server.envAllowlist)
    assertSafeRemoteUrl(result.url, server.id)
    if (server.enforceToolsInUrl && server.toolAllowlist?.length) {
      const url = new URL(result.url)
      url.searchParams.set('tools', server.toolAllowlist.join(','))
      result.url = url.toString()
    }
  }
  return result
}

/**
 * Produce provider-renderable descriptors without reading any runtime environment.
 * Environment references remain names, never values. High-risk entries still need
 * an explicit approval list, which keeps rendering from silently enabling them.
 */
export function projectMcpProfile(catalog, profileId, { approvedServerIds = [] } = {}) {
  const profile = catalog.profiles.get(profileId)
  if (!profile) throw new SecurityPolicyError(`unknown MCP profile: ${profileId}`, 'UNKNOWN_MCP_PROFILE')
  return {
    id: profile.id,
    servers: profile.servers.map(id => {
      const server = catalog.servers.get(id)
      const assessment = assessMcpServer(server, { approvedServerIds })
      if (!assessment.allowed) throw new SecurityPolicyError(`MCP server requires explicit approval: ${id}`, 'MCP_APPROVAL_REQUIRED')
      assertRuntimeAvailable(server)
      return projectServer(server)
    })
  }
}

export function projectMcpServers(catalog, serverIds, { approvedServerIds = [] } = {}) {
  const approvals = new Set(approvedServerIds)
  return [...new Set(serverIds)].map(id => {
    const server = catalog.servers.get(id)
    if (!server) throw new SecurityPolicyError(`unknown MCP server: ${id}`, 'UNKNOWN_SERVER')
    const assessment = assessMcpServer(server, { approvedServerIds: [...approvals] })
    if (!assessment.allowed) throw new SecurityPolicyError(`MCP server requires explicit approval: ${id}`, 'MCP_APPROVAL_REQUIRED')
    assertRuntimeAvailable(server)
    return projectServer(server)
  })
}

export function resolveMcpProfile(catalog, profileId, { environment = {}, approvedServerIds = [] } = {}) {
  const profile = catalog.profiles.get(profileId)
  if (!profile) throw new SecurityPolicyError(`unknown MCP profile: ${profileId}`, 'UNKNOWN_MCP_PROFILE')
  const approvals = new Set(approvedServerIds)
  const undeclared = [...approvals].filter(id => !profile.approvals.includes(id))
  if (undeclared.length) throw new SecurityPolicyError(`approval is outside profile ${profileId}: ${undeclared.join(', ')}`, 'APPROVAL_OUTSIDE_PROFILE')
  return {
    id: profile.id,
    description: profile.description,
    servers: profile.servers.map(id => {
      const server = catalog.servers.get(id)
      assertRuntimeAvailable(server)
      return materializeMcpServer(server, { environment, approvedServerIds: [...approvals] })
    })
  }
}
