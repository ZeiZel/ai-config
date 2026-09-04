import { lstat, readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { assertNoSymlinkAncestors, sha256 } from '../security-guard/index.js'
import { opencodeV1PermissionLayer, opencodeV1PluginSource } from '../hooks/providers.js'
import { trustedMcpRunnerPath } from '../mcp/runtime.js'
import { BUN_FLAGS, assertBunRuntime, trustedBunConfig } from '../runtime/bun.js'

const PROVIDERS = {
  claude: { instruction: 'CLAUDE.md', mcp: '.mcp.json', hooks: '.claude/settings.json', type: 'claude-json' },
  codex: { instruction: 'AGENTS.md', mcp: '.codex/config.toml', hooks: '.codex/hooks.json', type: 'codex-toml' },
  opencode: { instruction: 'AGENTS.md', mcp: 'opencode.json', plugin: '.opencode/plugins/ai-config-security.js', type: 'opencode-json' },
  gemini: { instruction: 'GEMINI.md', mcp: '.gemini/settings.json', hooks: '.gemini/settings.json', type: 'gemini-json' }
}
const INSTRUCTION_MARKERS = Object.freeze({ begin: '<!-- BEGIN AI-CONFIG MANAGED -->', end: '<!-- END AI-CONFIG MANAGED -->' })
const CODEX_MCP_MARKERS = Object.freeze({ begin: '# BEGIN AI-CONFIG MANAGED MCP', end: '# END AI-CONFIG MANAGED MCP' })
const HOOK_MARKER = '.ai-config/hooks/guard.mjs'
const KNOWN_MCP_SERVER_IDS = new Set(['context7', 'playwright', 'chrome-devtools', 'youtrack-read', 'youtrack-write', 'obsidian-safe'])

async function existingFile(root, path) {
  try {
    await assertNoSymlinkAncestors(root, path)
    const target = join(root, path)
    const stat = await lstat(target)
    if (stat.isSymbolicLink() || !stat.isFile()) throw new Error(`managed merge target must be a regular file: ${path}`)
    const content = await readFile(target)
    return { content, sha256: sha256(content) }
  } catch (error) { if (error.code === 'ENOENT') return { content: Buffer.alloc(0), sha256: undefined }; throw error }
}

function canonicalJson(value) {
  if (value === undefined) return 'null'
  if (value === null || typeof value !== 'object') return JSON.stringify(value)
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`
  return `{${Object.keys(value).filter(key => value[key] !== undefined).sort().map(key => `${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(',')}}`
}

function fragmentSha256(value) {
  return sha256(Buffer.from(typeof value === 'string' ? value : canonicalJson(value)))
}

function managedBlock(text, markers) {
  const start = text.indexOf(markers.begin); const end = text.indexOf(markers.end)
  if (start === -1 && end === -1) return { status: 'absent' }
  if (start === -1 || end === -1 || end < start) return { status: 'malformed' }
  return { status: 'present', start, end, block: text.slice(start, end + markers.end.length) }
}

function ownershipConflict(path, kind) {
  const error = new Error(`ai-config ${kind} is modified or not owned: ${path}`)
  error.code = 'MANAGED_FRAGMENT_CONFLICT'
  throw error
}

function mergeManagedSection(existing, managed, markers = INSTRUCTION_MARKERS, priorStrategy, path = 'managed section') {
  const text = existing.toString('utf8'); const current = managedBlock(text, markers)
  if (priorStrategy) {
    if (typeof priorStrategy.blockSha256 !== 'string' || current.status !== 'present' || fragmentSha256(current.block) !== priorStrategy.blockSha256) ownershipConflict(path, 'managed section')
  } else if (current.status !== 'absent') ownershipConflict(path, 'managed section')
  const block = `${markers.begin}\n${managed.trim()}\n${markers.end}`
  const content = current.status === 'absent'
    ? `${text.trimEnd()}${text.trim() ? '\n\n' : ''}${block}\n`
    : `${text.slice(0, current.start)}${block}${text.slice(current.end + markers.end.length)}`.replace(/\n*$/, '\n')
  return { content, mergeStrategy: { type: 'managed-section', ...markers, blockSha256: fragmentSha256(block) } }
}

function removeManagedSection(existing, markers = INSTRUCTION_MARKERS) {
  const text = existing.toString('utf8'); const start = text.indexOf(markers.begin); const end = text.indexOf(markers.end)
  if (start === -1 && end === -1) return text
  if (start === -1 || end === -1 || end < start) throw new Error('malformed ai-config managed instruction section')
  return `${text.slice(0, start)}${text.slice(end + markers.end.length)}`.replace(/\n{3,}/g, '\n\n')
}

function providerEnvironment(server, type) {
  const environment = Object.fromEntries(server.envReferences.map(name => [name, type === 'opencode-json' ? `{env:${name}}` : `\${${name}}`]))
  return { ...environment, ...(server.fixedEnv || {}) }
}

function shellQuote(value) {
  return `'${String(value).replaceAll("'", "'\\''")}'`
}

// Do not pass proxy values through env(1)'s argv: they may contain credentials
// or disclose private network topology. MCP credentials are appended only from
// the server's explicit envReferences list.
const SAFE_MCP_ENV = Object.freeze(['PATH', 'HOME', 'TMPDIR', 'LANG', 'LC_ALL', 'LC_CTYPE', 'XDG_CONFIG_HOME', 'XDG_CACHE_HOME', 'SSL_CERT_FILE', 'NODE_EXTRA_CA_CERTS'])

function safeEnvAssignments(names) {
  return [...new Set(names)].filter(name => /^[A-Za-z_][A-Za-z0-9_]*$/.test(name)).map(name => `${name}="$${name}"`).join(' ')
}

function safeBunLaunch(command, args, requiredEnv = []) {
  const quoted = [command, ...args].map(shellQuote).join(' ')
  const environment = safeEnvAssignments([...SAFE_MCP_ENV, ...requiredEnv])
  const script = `exec /usr/bin/env -i ${environment} ${quoted}`
  return { command: '/bin/sh', args: ['-c', script] }
}

function projectedServer(server, type, mcpRunnerPath, mcpRunnerArgs = []) {
  if (!KNOWN_MCP_SERVER_IDS.has(server.id)) throw new Error(`unknown trusted MCP server projection: ${server.id}`)
  const environment = providerEnvironment(server, type)
  // The dynamic YouTrack endpoint is always bridged by the installed runner:
  // native provider URL interpolation cannot provide the runner's URL, HTTP
  // transport, or direct-package integrity enforcement consistently.
  const useRunner = server.transport === 'stdio' || server.id === 'youtrack-read' || server.id === 'youtrack-write'
  if (useRunner) {
    const launch = safeBunLaunch(mcpRunnerPath, [...mcpRunnerArgs, 'mcp-run', '--server', server.id], server.envReferences)
    if (type === 'opencode-json') return { type: 'local', command: [launch.command, ...launch.args], environment, enabled: true, timeout: (server.timeouts?.toolSeconds || 30) * 1000 }
    if (type === 'gemini-json') return { command: launch.command, args: launch.args, env: environment, includeTools: server.toolAllowlist || undefined, trust: false }
    return { command: launch.command, args: launch.args, env: environment }
  }
  if (type === 'opencode-json') return { type: 'remote', url: server.url, enabled: true, timeout: (server.timeouts?.toolSeconds || 30) * 1000 }
  if (type === 'gemini-json') return { httpUrl: server.url, includeTools: server.toolAllowlist || undefined, trust: false }
  return { type: 'http', url: server.url }
}

function validateOpenCodeMcp(mcp) {
  for (const [id, server] of Object.entries(mcp)) {
    if (!server || typeof server !== 'object' || Array.isArray(server)) throw new Error(`invalid OpenCode MCP entry: ${id}`)
    const allowed = server.type === 'local' ? new Set(['type', 'command', 'environment', 'enabled', 'timeout', 'cwd']) : server.type === 'remote' ? new Set(['type', 'url', 'headers', 'oauth', 'enabled', 'timeout']) : undefined
    if (!allowed || Object.keys(server).some(key => !allowed.has(key))) throw new Error(`unsupported OpenCode MCP schema entry: ${id}`)
  }
}

function guardCommand(provider, event) {
  const output = provider === 'gemini'
    ? { decision: 'deny', reason: 'ai-config security policy: guard-not-found' }
    : event === 'PermissionRequest'
      ? { hookSpecificOutput: { hookEventName: 'PermissionRequest', decision: { behavior: 'deny', message: 'ai-config security policy: guard-not-found' } } }
      : { hookSpecificOutput: { hookEventName: 'PreToolUse', permissionDecision: 'deny', permissionDecisionReason: 'ai-config security policy: guard-not-found' } }
  const guardSha256 = sha256(Buffer.from(projectLocalGuardSource()))
  const guardBytes = Buffer.byteLength(projectLocalGuardSource(), 'utf8')
  const bun = JSON.stringify(process.execPath)
  const config = JSON.stringify(trustedBunConfig(fileURLToPath(new URL('../../', import.meta.url))))
  const flags = BUN_FLAGS.map(JSON.stringify).join(' ')
  // The candidate is stat'ed before it is read.  This prevents a nested
  // dependency from turning registration lookup into an unbounded read.
  const verifier = JSON.stringify("const {createHash}=require('node:crypto');const {readFileSync,statSync}=require('node:fs');try{const stat=statSync(process.argv[1]);if(!stat.isFile()||stat.size!==Number(process.argv[2]))process.exit(1);process.stdout.write(createHash('sha256').update(readFileSync(process.argv[1])).digest('hex'))}catch{process.exitCode=1}")
  const guardEnv = '/usr/bin/env -i PATH="$PATH" HOME="$HOME" TMPDIR="$TMPDIR" LANG="$LANG" LC_ALL="$LC_ALL" LC_CTYPE="$LC_CTYPE" XDG_CONFIG_HOME="$XDG_CONFIG_HOME" XDG_CACHE_HOME="$XDG_CACHE_HOME"'
  // Walk from the actual tool cwd rather than asking Git for its root. Every
  // candidate is hashed before execution so a nested repository/dependency
  // cannot shadow the project guard simply by creating the same path.
  const script = [
    // This shell is the last boundary before Bun starts.  The explicit Bun
    // flags handle .env/bunfig/autoinstall, while this removes env-level
    // preload/config injection that Bun would otherwise process first.
    `directory=$PWD`,
    `while [ "$directory" != / ]; do candidate="$directory/${HOOK_MARKER}"; if [ -f "$candidate" ]; then digest=$(${guardEnv} ${bun} ${flags} --config=${config} -e ${verifier} "$candidate" ${guardBytes} 2>/dev/null); if [ "$digest" = ${JSON.stringify(guardSha256)} ]; then exec ${guardEnv} ${bun} ${flags} --config=${config} "$candidate" --provider ${provider} --event ${event}; fi; fi; directory=\${directory%/*}; [ -n "$directory" ] || directory=/; done`,
    `printf '%s\\n' '${JSON.stringify(output)}'`
  ].join('; ')
  const shellQuoted = `'${script.replaceAll("'", "'\\''")}'`
  return `/bin/sh -c ${shellQuoted}`
}

function hookRegistration(provider, event) {
  const command = guardCommand(provider, event)
  return provider === 'gemini' ? { matcher: '*', hooks: [{ name: 'ai-config-security', type: 'command', command, timeout: 10_000 }] } : { hooks: [{ type: 'command', command, timeout: 10 }] }
}

function mergeHooks(document, provider, priorStrategy, path) {
  const events = provider === 'codex' ? ['PreToolUse', 'PermissionRequest'] : [provider === 'gemini' ? 'BeforeTool' : 'PreToolUse']
  const known = new Map((priorStrategy?.ownedHookRegistrations || []).map(record => [record.event, record.sha256]))
  const ownedHookRegistrations = []
  if (document.hooks !== undefined && (!document.hooks || typeof document.hooks !== 'object' || Array.isArray(document.hooks))) throw new Error('invalid hooks object in provider settings')
  document.hooks ||= {}
  for (const event of events) {
    if (document.hooks[event] !== undefined && !Array.isArray(document.hooks[event])) throw new Error(`invalid hook event array: ${event}`)
    const hooks = document.hooks[event] || []; const registration = hookRegistration(provider, event); const desiredSha256 = fragmentSha256(registration)
    const previousSha256 = known.get(event)
    if (previousSha256) {
      const previous = (priorStrategy?.ownedHookRegistrations || []).find(record => record.event === event)
      if (!Number.isInteger(previous?.index) || fragmentSha256(hooks[previous.index]) !== previousSha256) ownershipConflict(path, 'hook registration')
      // A prior, unchanged registration is ours to update.  Recompute the
      // embedded guard identity whenever the emitted guard changes.
      hooks[previous.index] = registration
      ownedHookRegistrations.push({ event, index: previous.index, sha256: desiredSha256 })
    } else if (hooks.some(entry => fragmentSha256(entry) === desiredSha256)) {
      // Exact generated content is not proof of ownership.  Refuse to adopt
      // a pre-existing reserved registration without a state record.
      ownershipConflict(path, 'reserved hook registration')
    } else {
      const index = hooks.length
      hooks.push(registration)
      ownedHookRegistrations.push({ event, index, sha256: desiredSha256 })
    }
    document.hooks[event] = hooks
  }
  return { events, ownedHookRegistrations }
}

function jsonDocument(existing, path) {
  if (!existing.content.length) return {}
  try {
    const result = JSON.parse(existing.content.toString('utf8'))
    if (!result || typeof result !== 'object' || Array.isArray(result)) throw new Error('not object')
    return result
  } catch { throw new Error(`cannot safely merge non-JSON provider config: ${path}`) }
}

function providerJsonStrategy({ provider, key, events = [], ownedMcpEntries = [], ownedHookRegistrations = [], redaction = false, permissions, schemaValue } = {}) {
  return {
    type: 'provider-json', provider, ...(key ? { key } : {}), events,
    ...(ownedMcpEntries.length ? { ownedMcpEntries } : {}),
    ...(ownedHookRegistrations.length ? { ownedHookRegistrations } : {}),
    ...(redaction ? { redaction: true } : {}), ...(permissions ? { permissions } : {}), ...(schemaValue ? { schemaValue } : {})
  }
}

async function jsonProviderFile(root, path, type, servers, { reconcileOwned = false, hooksProvider, opencodePermissions = false, mcpRunnerPath, mcpRunnerArgs, priorStrategy } = {}) {
  const existing = await existingFile(root, path); const document = jsonDocument(existing, path)
  const key = type === 'opencode-json' ? 'mcp' : 'mcpServers'
  if (document[key] !== undefined && (!document[key] || Array.isArray(document[key]) || typeof document[key] !== 'object')) throw new Error(`invalid ${key} object in ${path}`)
  const current = { ...(document[key] || {}) }
  const priorEntries = new Map((priorStrategy?.ownedMcpEntries || []).map(entry => [entry.key, entry.sha256]))
  const selected = new Set(servers.map(server => `ai-config-${server.id}`))
  const ownedMcpEntries = []
  if (reconcileOwned) for (const [id, expectedSha256] of priorEntries) {
    if (selected.has(id)) continue
    if (!Object.hasOwn(current, id)) continue
    if (fragmentSha256(current[id]) !== expectedSha256) ownershipConflict(path, 'MCP entry')
    delete current[id]
  }
  for (const server of servers) {
    const id = `ai-config-${server.id}`; const projection = projectedServer(server, type, mcpRunnerPath, mcpRunnerArgs)
    const priorSha256 = priorEntries.get(id)
    if (priorSha256) {
      if (!Object.hasOwn(current, id) || fragmentSha256(current[id]) !== priorSha256) ownershipConflict(path, 'MCP entry')
      current[id] = projection
      ownedMcpEntries.push({ key: id, sha256: fragmentSha256(projection) })
    } else if (Object.hasOwn(current, id)) {
      // The ai-config namespace is reserved. An exact-looking projection
      // without state identity must conflict rather than be silently adopted.
      ownershipConflict(path, 'reserved MCP entry')
    } else {
      current[id] = projection
      ownedMcpEntries.push({ key: id, sha256: fragmentSha256(projection) })
    }
  }
  if (Object.keys(current).length) document[key] = current; else delete document[key]
  const hookOwnership = hooksProvider ? mergeHooks(document, hooksProvider, priorStrategy, path) : { events: [], ownedHookRegistrations: [] }
  let redaction = false
  if (hooksProvider === 'gemini') {
    if (document.security !== undefined && (!document.security || typeof document.security !== 'object' || Array.isArray(document.security))) throw new Error('invalid Gemini security settings')
    document.security ||= {}; document.security.environmentVariableRedaction ||= {}
    if (!document.security.environmentVariableRedaction || typeof document.security.environmentVariableRedaction !== 'object' || Array.isArray(document.security.environmentVariableRedaction)) throw new Error('invalid Gemini environmentVariableRedaction settings')
    if (document.security.environmentVariableRedaction.enabled === undefined) {
      document.security.environmentVariableRedaction.enabled = true
      redaction = true
    } else if (priorStrategy?.redaction === true) {
      if (document.security.environmentVariableRedaction.enabled !== true) ownershipConflict(path, 'Gemini redaction setting')
      redaction = true
    } else if (document.security.environmentVariableRedaction.enabled !== true) ownershipConflict(path, 'Gemini redaction setting')
  }
  let permissions
  if (opencodePermissions) {
    if (document.permission !== undefined && (!document.permission || typeof document.permission !== 'object' || Array.isArray(document.permission))) throw new Error('invalid OpenCode permission settings')
    document.permission ||= {}; permissions = {}
    for (const [capability, value] of Object.entries(opencodeV1PermissionLayer().permission)) {
      if (document.permission[capability] === undefined) {
        document.permission[capability] = value
        permissions[capability] = value
      } else if (priorStrategy?.permissions && Object.hasOwn(priorStrategy.permissions, capability)) {
        if (document.permission[capability] !== priorStrategy.permissions[capability]) ownershipConflict(path, 'OpenCode permission setting')
        permissions[capability] = priorStrategy.permissions[capability]
      } else if (
        (capability === 'external_directory' && document.permission[capability] !== 'deny') ||
        (capability !== 'external_directory' && !['ask', 'deny'].includes(document.permission[capability]))
      ) ownershipConflict(path, 'OpenCode permission setting')
    }
    if (!Object.keys(permissions).length) permissions = undefined
  }
  let schemaValue
  if (type === 'opencode-json') {
    const officialSchema = 'https://opencode.ai/config.json'
    if (document.$schema === undefined) { document.$schema = officialSchema; schemaValue = officialSchema }
    else if (priorStrategy?.schemaValue) {
      if (document.$schema !== priorStrategy.schemaValue) ownershipConflict(path, 'OpenCode schema setting')
      schemaValue = priorStrategy.schemaValue
    }
    validateOpenCodeMcp(document.mcp || {})
  }
  return { path, content: `${JSON.stringify(document, null, 2)}\n`, mergeBaseSha256: existing.sha256, mergeStrategy: providerJsonStrategy({ provider: hooksProvider || (type === 'opencode-json' ? 'opencode' : 'mcp'), key, events: hookOwnership.events, ownedMcpEntries, ownedHookRegistrations: hookOwnership.ownedHookRegistrations, redaction, permissions, schemaValue }) }
}

async function hooksFile(root, provider, path, priorStrategy) {
  const existing = await existingFile(root, path); const document = jsonDocument(existing, path); const hookOwnership = mergeHooks(document, provider, priorStrategy, path)
  return { path, content: `${JSON.stringify(document, null, 2)}\n`, mergeBaseSha256: existing.sha256, mergeStrategy: providerJsonStrategy({ provider, events: hookOwnership.events, ownedHookRegistrations: hookOwnership.ownedHookRegistrations }) }
}

async function codexMcpFile(root, path, servers, { reconcileOwned = false, mcpRunnerPath, mcpRunnerArgs, priorStrategy } = {}) {
  const existing = await existingFile(root, path)
  const sections = servers.map(server => {
    const projection = projectedServer(server, 'codex-toml', mcpRunnerPath, mcpRunnerArgs)
    const lines = [`[mcp_servers."ai-config-${server.id}"]`]
    if (projection.type === 'http') lines.push(`url = ${JSON.stringify(projection.url)}`)
    else { lines.push(`command = ${JSON.stringify(projection.command)}`); lines.push(`args = ${JSON.stringify(projection.args || [])}`); if (server.envReferences.length) lines.push(`env_vars = ${JSON.stringify(server.envReferences)}`) }
    lines.push('enabled = true')
    if (server.toolAllowlist?.length) lines.push(`enabled_tools = ${JSON.stringify(server.toolAllowlist)}`)
    if (server.timeouts?.startupSeconds) lines.push(`startup_timeout_sec = ${server.timeouts.startupSeconds}`)
    if (server.timeouts?.toolSeconds) lines.push(`tool_timeout_sec = ${server.timeouts.toolSeconds}`)
    return lines.join('\n')
  }).join('\n\n')
  if (!servers.length && reconcileOwned) {
    const current = managedBlock(existing.content.toString('utf8'), CODEX_MCP_MARKERS)
    if (!priorStrategy || typeof priorStrategy.blockSha256 !== 'string' || current.status !== 'present' || fragmentSha256(current.block) !== priorStrategy.blockSha256) ownershipConflict(path, 'managed section')
    const content = removeManagedSection(existing.content, CODEX_MCP_MARKERS)
    return content.trim() ? { path, content: content.replace(/\n*$/, '\n'), mergeBaseSha256: existing.sha256, remove: true, mergeStrategy: priorStrategy } : { path, remove: true, mergeBaseSha256: existing.sha256, mergeStrategy: priorStrategy }
  }
  const merged = mergeManagedSection(existing.content, sections, CODEX_MCP_MARKERS, priorStrategy, path)
  return { path, ...merged, mergeBaseSha256: existing.sha256 }
}

function projectLocalGuardSource() {
  // This is deliberately standalone: provider hooks run in arbitrary project
  // environments where the ai-config package itself need not be installed.
  return String.raw`#!/usr/bin/env bun
const MAX = 64 * 1024
const SECRET = /(?:^|[/\\\s"'\`=;|&(){}\[\]])(?:\.env(?:\..*)?|\.globals|credentials?(?:\.[^/\\]+)?|secrets?(?:\.[^/\\]+)?|.*\.pem|.*\.key|id_(?:rsa|dsa|ecdsa|ed25519)|auth\.json|\.vault-token|\.npmrc|\.netrc|\.git-credentials|oauth(?:[-_.]?(?:token|store|cache))?)(?=$|[/\\\s"'\`=;|&(){}\[\]])/i
const VAULT = /(?:vault\s+(?:read|kv\s+(?:get|list))|mcp(?:\s+|_)(?:read[_ -]?secret|secret)|read[_ -]?secret)/i
const BROAD = [/\bgit\s+(?:reset\s+--hard|clean\s+-[^;&|]*f[^;&|]*d|checkout\s+--\s+\.)/i, /\b(?:mkfs(?:\.[\w-]+)?|fdisk|parted)\b/i, /\bdd\s+[^;&|]*\bof=\/dev\//i, /\bdocker\s+(?:system\s+prune|volume\s+prune)\b/i, /\bkubectl\s+delete\s+[^;&|]*(?:--all|--all-namespaces)\b/i]
const deny = reasonCode => ({ allowed: false, reasonCode, reason: 'ai-config security policy: ' + reasonCode })
const tokens = command => command.match(/(?:"[^"]*"|'[^']*'|[^\s;&|]+)/g) || []
const unquote = token => token.replace(/^['"]|['"]$/g, '')
const rawEnvironmentTokens = (parts, depth = 0) => { if (!parts.length || depth > 2) return true; let index = 0; while (['command', 'builtin', 'exec'].includes(parts[index]?.split('/').at(-1))) index += 1; if (index >= parts.length) return true; const name = parts[index].split('/').at(-1); const rest = parts.slice(index + 1); if (['sh', 'bash', 'zsh'].includes(name)) { const commandFlag = rest.findIndex(token => /^-[A-Za-z]*c[A-Za-z]*$/.test(token)); if (commandFlag < 0) return false; if (typeof rest[commandFlag + 1] !== 'string' || !rest[commandFlag + 1]) return true; return rawEnvironmentDump(rest[commandFlag + 1], depth + 1) }; if (name === 'printenv') return true; if (name === 'export') return !rest.length || rest.some(token => !/^[A-Za-z_][A-Za-z0-9_]*=/.test(token)); if (name === 'set') return !rest.length || rest.includes('-o') || rest.includes('+o'); if (name !== 'env') return false; let commandSeen = false; for (let offset = 0; offset < rest.length; offset += 1) { const token = rest[offset]; if (/^[A-Za-z_][A-Za-z0-9_]*=/.test(token)) continue; if (token === '-u' || token === '--unset') { offset += 1; continue }; if (token.startsWith('-')) continue; commandSeen = true; break }; return !commandSeen }
const rawEnvironmentDump = (command, depth = 0) => command.split(/[;&|]+/).some(segment => { const parts = tokens(segment).map(unquote); return parts.length && rawEnvironmentTokens(parts, depth) })
const commandFrom = event => { const input = event.tool_input ?? event.toolInput ?? event.input ?? event.arguments ?? event.args; return [event.command, event.cmd, input?.command, input?.cmd, input?.script, input?.shell].find(value => typeof value === 'string') || '' }
const outputTargets = (event, command) => { const input = event.tool_input ?? event.toolInput ?? event.input ?? event.arguments ?? {}; const targets = []; if (input && typeof input === 'object' && !Array.isArray(input)) for (const [key, value] of Object.entries(input)) if (/(?:path|output|destination|target|directory|dir|file)/i.test(key) && typeof value === 'string') targets.push(value); const shellTarget = value => targets.push(unquote(value)); const match = command.match(/(?:^|\s)(?:--?(?:output|out|destination|target)|deliver)(?:=|\s+)("[^"]*"|'[^']*'|[^\s;&|]+)/i); if (match) shellTarget(match[1]); for (const redirection of command.matchAll(/(?:\d?>>|\d?>)\s*("[^"]*"|'[^']*'|[^\s;&|]+)/g)) shellTarget(redirection[1]); return targets }
const escapesWorkspace = (target, cwd) => { if (typeof cwd !== 'string' || !cwd.startsWith('/') || cwd.startsWith('//') || /[\x00\r\n]/.test(cwd)) return true; const normalized = String(target).replaceAll('\\', '/'); if (!normalized || /^\/?(?:~|\$\{?[A-Za-z_][A-Za-z0-9_]*\}?)(?:\/|$)/.test(normalized) || /(?:^|\/)\$\{?[A-Za-z_][A-Za-z0-9_]*\}?/.test(normalized) || /^[A-Za-z]:\//.test(normalized) || normalized.startsWith('//')) return true; const baseParts = cwd.split('/').filter(Boolean); const targetParts = (normalized.startsWith('/') ? normalized.slice(1) : normalized).split('/'); const resolved = normalized.startsWith('/') ? [] : [...baseParts]; for (const part of targetParts) { if (!part || part === '.') continue; if (part === '..') { if (!resolved.length) return true; resolved.pop() } else resolved.push(part) }; return normalized.startsWith('/') ? resolved.slice(0, baseParts.length).join('/') !== baseParts.join('/') : resolved.length < baseParts.length || resolved.slice(0, baseParts.length).join('/') !== baseParts.join('/') }
const unsafeRecursiveDelete = (command, cwd) => command.split(/[;&|]+/).some(segment => { const parts = tokens(segment).map(unquote); const index = parts.findIndex(token => token === 'rm' || /(?:^|\/)rm$/.test(token)); if (index < 0) return false; const rest = parts.slice(index + 1); if (!rest.some(token => token === '--recursive' || /^-[A-Za-z]*r[A-Za-z]*$/i.test(token))) return false; return rest.filter(token => !token.startsWith('-')).some(target => ['/', '.', '..', '*', './*', '~', '$HOME', '\${HOME}', '$PWD', '\${PWD}'].includes(target) || /^\$(?:\{)?(?:HOME|PWD)/.test(target) || (typeof cwd === 'string' && escapesWorkspace(target, cwd))) })
const broadGitClean = command => command.split(/[;&|]+/).some(segment => { const parts = tokens(segment); const index = parts.findIndex(token => token === 'git' || /(?:^|\/)git$/.test(token)); if (index < 0 || parts[index + 1] !== 'clean') return false; const flags = parts.slice(index + 2).filter(token => token.startsWith('-')).join(''); return flags.includes('f') && flags.includes('d') })
const tokenizedDestructive = command => command.split(/[;&|]+/).some(segment => { const parts = tokens(segment).map(unquote); return parts.some((token, index) => { const name = token.split('/').at(-1); const rest = parts.slice(index + 1); if (name === 'git') { if ((rest[0] === 'reset' && rest.includes('--hard')) || (rest[0] === 'checkout' && rest[1] === '--' && rest[2] === '.')) return true; if (rest[0] === 'clean') { const flags = rest.slice(1).filter(value => value.startsWith('-')).join(''); if (flags.includes('f') && flags.includes('d')) return true } }; if (name === 'docker' && ((rest[0] === 'system' && rest[1] === 'prune') || (rest[0] === 'volume' && rest[1] === 'prune'))) return true; if (name === 'kubectl' && rest[0] === 'delete' && rest.some(value => value === '--all' || value === '--all-namespaces')) return true; if (name === 'dd' && rest.some(value => /^of=\/dev\//.test(value))) return true; return name === 'fdisk' || name === 'parted' || /^mkfs(?:\.[\w-]+)?$/.test(name) }) })
const values = (value, depth = 0) => { if (depth > 4 || value == null) return []; if (typeof value === 'string') return [value]; if (Array.isArray(value)) return value.slice(0, 64).flatMap(item => values(item, depth + 1)); if (typeof value !== 'object') return []; return Object.entries(value).slice(0, 128).flatMap(([key, item]) => [key, ...values(item, depth + 1)]) }
const decide = raw => { try { if (!raw || raw.length > MAX) return deny('malformed-or-oversized-input'); const event = JSON.parse(raw.toString('utf8')); if (!event || typeof event !== 'object' || Array.isArray(event)) return deny('malformed-or-oversized-input'); const text = JSON.stringify(event); const command = commandFrom(event); const tool = String(event.tool_name ?? event.toolName ?? event.name ?? event.tool ?? '').toLowerCase(); const cwd = event.cwd ?? event.working_directory ?? event.workingDirectory; if (VAULT.test(tool + '\n' + command + '\n' + text)) return deny('secret-or-vault-read'); if (rawEnvironmentDump(command) || (/(?:shell|bash|terminal|exec|run)/i.test(tool) && rawEnvironmentDump(text))) return deny('raw-environment-dump'); if (SECRET.test(text)) return deny('secret-or-credential-read'); if (unsafeRecursiveDelete(command, cwd) || broadGitClean(command) || tokenizedDestructive(command) || BROAD.some(pattern => pattern.test(command))) return deny('broad-destructive-command'); const writeLike = /(?:write|edit|patch|apply|move|shell|bash|terminal|exec|run)/i.test(tool) || /\barchify\b/i.test(command); if (writeLike && outputTargets(event, command).some(target => escapesWorkspace(target, cwd))) return deny('path-outside-workspace'); return { allowed: true } } catch { return deny('malformed-or-oversized-input') } }
const argument = name => { const index = process.argv.indexOf(name); return index < 0 ? undefined : process.argv[index + 1] }
const provider = argument('--provider'); const event = argument('--event') || 'PreToolUse'
const chunks = []; let size = 0; let oversized = false
try { for await (const chunk of process.stdin) { const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk); size += bytes.length; if (size > MAX) { oversized = true; process.stdin.destroy(); break }; chunks.push(bytes) } } catch {}
const result = oversized ? deny('malformed-or-oversized-input') : decide(Buffer.concat(chunks))
if (!result.allowed) { const output = provider === 'gemini' ? { decision: 'deny', reason: result.reason } : event === 'PermissionRequest' ? { hookSpecificOutput: { hookEventName: 'PermissionRequest', decision: { behavior: 'deny', message: result.reason } } } : { hookSpecificOutput: { hookEventName: 'PreToolUse', permissionDecision: 'deny', permissionDecisionReason: result.reason } }; process.stdout.write(JSON.stringify(output) + '\n') }
`
}

export async function buildManagedProjectFiles({ projectRoot, providers, profiles, mcpServers = [], includeMcp = true, ownedPaths = new Set(), ownedRecords, mcpRunnerPath } = {}) {
  const sourceRoot = fileURLToPath(new URL('../../', import.meta.url))
  const bun = await assertBunRuntime({ sourceRoot })
  const files = []; const instructionPaths = new Map()
  const records = ownedRecords instanceof Map ? ownedRecords : new Map([...ownedPaths].map(path => [path, undefined]))
  const trustedRunner = await trustedMcpRunnerPath(mcpRunnerPath)
  const trustedRunnerArgs = [...BUN_FLAGS, `--config=${trustedBunConfig(sourceRoot)}`, trustedRunner]
  for (const provider of providers) { const config = PROVIDERS[provider]; if (!config) throw new Error(`unsupported provider: ${provider}`); const list = instructionPaths.get(config.instruction) || []; list.push(provider); instructionPaths.set(config.instruction, list) }
  for (const [path, owningProviders] of instructionPaths) {
    const existing = await existingFile(projectRoot, path)
    const managed = [
      '# ai-config managed project context', '', `Providers: ${owningProviders.join(', ')}`, `Profiles: ${profiles.join(', ')}`, '',
      'Beads is the task source of truth. Run `BEADS_DOLT_SHARED_SERVER=1 bd dolt status`; only if unavailable/failing, run `BEADS_DOLT_SHARED_SERVER=1 bd dolt start` and retry.',
      'Then run `BEADS_DOLT_SHARED_SERVER=1 bd --global prime --memories-only`; run `bd init` when local Beads is absent, then `bd prime` before project work.',
      'Never copy PRIVATE/global Beads values or secrets into project files, commands, logs, or task notes.',
      'Generated skills and MCP entries are hash-managed; do not hand-edit them.'
    ].join('\n')
    const merged = mergeManagedSection(existing.content, managed, INSTRUCTION_MARKERS, records.get(path)?.mergeStrategy, path)
    files.push({ path, ...merged, mergeBaseSha256: existing.sha256 })
  }
  files.push({ path: '.ai-config/hooks/guard.mjs', content: projectLocalGuardSource(), mode: 0o755 })
  for (const provider of providers) {
    const config = PROVIDERS[provider]; const priorMcpStrategy = records.get(config.mcp)?.mergeStrategy; const priorHookStrategy = records.get(config.hooks)?.mergeStrategy; const reconcileOwned = records.has(config.mcp)
    if (provider === 'claude' || provider === 'codex') files.push(await hooksFile(projectRoot, provider, config.hooks, priorHookStrategy))
    if (provider === 'opencode') files.push({ path: config.plugin, content: opencodeV1PluginSource(), mode: 0o644 })
    if (provider === 'gemini') { files.push(await jsonProviderFile(projectRoot, config.mcp, config.type, includeMcp ? mcpServers : [], { reconcileOwned, hooksProvider: 'gemini', mcpRunnerPath: bun.executable, mcpRunnerArgs: trustedRunnerArgs, priorStrategy: priorMcpStrategy })); continue }
    // OpenCode permissions are useful even when MCP is disabled and must be
    // projected into a fresh config rather than silently skipped.
    if (provider !== 'opencode' && !(includeMcp && mcpServers.length) && !(reconcileOwned && !includeMcp)) continue
    files.push(config.type === 'codex-toml' ? await codexMcpFile(projectRoot, config.mcp, includeMcp ? mcpServers : [], { reconcileOwned, mcpRunnerPath: bun.executable, mcpRunnerArgs: trustedRunnerArgs, priorStrategy: priorMcpStrategy }) : await jsonProviderFile(projectRoot, config.mcp, config.type, includeMcp ? mcpServers : [], { reconcileOwned, opencodePermissions: provider === 'opencode', mcpRunnerPath: bun.executable, mcpRunnerArgs: trustedRunnerArgs, priorStrategy: priorMcpStrategy }))
  }
  const unique = new Map()
  for (const file of files) { if (unique.has(file.path)) { if (Buffer.from(unique.get(file.path).content).equals(Buffer.from(file.content))) continue; throw new Error(`managed project file collision: ${file.path}`) } unique.set(file.path, file) }
  return [...unique.values()]
}
