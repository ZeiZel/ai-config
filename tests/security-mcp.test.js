import test from 'node:test'
import assert from 'node:assert/strict'
import { resolve } from 'node:path'
import { buildAllowlistedEnv, redactMetadata, safeAuditEvent } from '../src/security-guard/index.js'
import { loadMcpCatalog, projectMcpProfile, resolveMcpProfile } from '../src/mcp/index.js'

test('environment construction is default-deny and audit values are redacted', () => {
  const env = buildAllowlistedEnv({ source: { PATH: '/bin', UNEXPECTED_TOKEN: 'must-not-pass' }, allowlist: ['PATH'] })
  assert.deepEqual({ ...env }, { PATH: '/bin' })
  assert.deepEqual(redactMetadata({ token: 'secret', nested: { password: 'secret', safe: 'value' } }), {
    token: '[REDACTED]', nested: { password: '[REDACTED]', safe: 'value' }
  })
  const event = safeAuditEvent({ operation: 'spawn', args: ['secret-value'], env: { PATH: '/bin', API_TOKEN: 'secret-value' } })
  assert.equal(JSON.stringify(event).includes('secret-value'), false)
  assert.deepEqual(event.environmentNames, ['API_TOKEN', 'PATH'])
})

test('default MCP profile resolves without high-risk servers', async () => {
  const catalog = await loadMcpCatalog({ specsDir: resolve('ai-specs') })
  const profile = resolveMcpProfile(catalog, 'default')
  assert.deepEqual(profile.servers.map(server => server.id), ['context7'])
})

test('high-risk MCP needs runtime approval in addition to profile declaration', async () => {
  const catalog = await loadMcpCatalog({ specsDir: resolve('ai-specs') })
  assert.throws(() => resolveMcpProfile(catalog, 'browser-isolated', { environment: { PATH: '/bin', HOME: '/tmp' } }), /explicit approval/)
  const profile = resolveMcpProfile(catalog, 'browser-isolated', {
    environment: { PATH: '/bin', HOME: '/tmp', UNEXPECTED_TOKEN: 'must-not-pass' },
    approvedServerIds: ['playwright', 'chrome-devtools']
  })
  assert.deepEqual(profile.servers.map(server => server.id), ['context7', 'playwright', 'chrome-devtools'])
  assert.equal(Object.values(profile.servers[1].env).includes('must-not-pass'), false)
})

test('obsidian runtime materializes only the selected vault identity and approved root', async () => {
  const catalog = await loadMcpCatalog({ specsDir: resolve('ai-specs') })
  const profile = resolveMcpProfile(catalog, 'obsidian-read', {
    environment: {
      PATH: '/bin', HOME: '/tmp/home', OBSIDIAN_VAULT: 'Work', OBSIDIAN_VAULT_ROOT: '/tmp/vaults', AI_CONFIG_ROOT: '/opt/ai-config',
      OBSIDIAN_TOKEN: 'must-not-pass'
    },
    approvedServerIds: ['obsidian-safe']
  })
  assert.deepEqual(profile.servers[0].runtime, { wrapper: 'src/mcp/obsidian-safe-wrapper.js' })
  assert.equal(profile.servers[0].env.OBSIDIAN_VAULT_ROOT, '/tmp/vaults')
  assert.equal(Object.hasOwn(profile.servers[0].env, 'AI_CONFIG_ROOT'), false)
  assert.equal(Object.hasOwn(profile.servers[0].env, 'OBSIDIAN_TOKEN'), false)
})

test('provider projection contains references rather than environment values', async () => {
  const catalog = await loadMcpCatalog({ specsDir: resolve('ai-specs') })
  const projection = projectMcpProfile(catalog, 'obsidian-read', { approvedServerIds: ['obsidian-safe'] })
  assert.deepEqual(projection.servers[0].runtime, { wrapper: 'src/mcp/obsidian-safe-wrapper.js' })
  assert.equal(projection.servers[0].envReferences.includes('AI_CONFIG_ROOT'), false)
  assert.equal(projection.servers[0].envReferences.includes('OBSIDIAN_VAULT_ROOT'), true)
  assert.equal(JSON.stringify(projection).includes(process.env.HOME || '/definitely-absent'), false)
})

test('YouTrack profiles enforce distinct server-side tool lists', async () => {
  const catalog = await loadMcpCatalog({ specsDir: resolve('ai-specs') })
  const read = resolveMcpProfile(catalog, 'youtrack-read', {
    environment: { YOUTRACK_BASE_URL: 'https://youtrack.example' }, approvedServerIds: ['youtrack-read']
  }).servers.find(server => server.id === 'youtrack-read')
  const write = resolveMcpProfile(catalog, 'youtrack-write-approved', {
    environment: { YOUTRACK_BASE_URL: 'https://youtrack.example' }, approvedServerIds: ['youtrack-read', 'youtrack-write']
  }).servers.find(server => server.id === 'youtrack-write')
  assert.equal(new URL(read.url).searchParams.get('tools').includes('search_issues'), true)
  assert.equal(new URL(read.url).searchParams.get('tools').includes('create_issue'), false)
  assert.equal(new URL(write.url).searchParams.get('tools').includes('create_issue'), true)
  assert.equal(new URL(write.url).searchParams.get('tools').includes('search_issues'), false)
})

test('remote MCP URLs reject credentials and non-loopback cleartext HTTP', async () => {
  const catalog = await loadMcpCatalog({ specsDir: resolve('ai-specs') })
  assert.throws(() => resolveMcpProfile(catalog, 'youtrack-read', {
    environment: { YOUTRACK_BASE_URL: 'http://tracker.example' }, approvedServerIds: ['youtrack-read']
  }), /HTTPS or loopback HTTP/)
  assert.throws(() => resolveMcpProfile(catalog, 'youtrack-read', {
    environment: { YOUTRACK_BASE_URL: 'https://user:pass@tracker.example' }, approvedServerIds: ['youtrack-read']
  }), /credentials in MCP URL/)
  const local = resolveMcpProfile(catalog, 'youtrack-read', {
    environment: { YOUTRACK_BASE_URL: 'http://localhost:3489' }, approvedServerIds: ['youtrack-read']
  })
  assert.equal(local.servers.some(server => server.id === 'youtrack-read'), true)
  const ipv6 = resolveMcpProfile(catalog, 'youtrack-read', {
    environment: { YOUTRACK_BASE_URL: 'http://[::1]:3489' }, approvedServerIds: ['youtrack-read']
  })
  assert.equal(ipv6.servers.some(server => server.id === 'youtrack-read'), true)
})
