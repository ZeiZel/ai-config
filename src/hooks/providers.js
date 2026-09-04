import { evaluateToolEvent } from './policy.js'

const GUARD = 'ai-config guard'

export function claudeSettingsFragment() {
  return { hooks: { PreToolUse: [{ hooks: [{ type: 'command', command: `${GUARD} --provider claude --event PreToolUse`, timeout: 10 }] }] } }
}

export function geminiSettingsFragment() {
  return { hooks: { BeforeTool: [{ matcher: '*', hooks: [{ name: 'ai-config-security', type: 'command', command: `${GUARD} --provider gemini --event BeforeTool`, timeout: 10_000 }] }] }, security: { environmentVariableRedaction: { enabled: true } } }
}

export function codexPermissionLayer() {
  const command = `${GUARD} --provider codex --event PreToolUse`; const hook = { type: 'command', command, timeout: 10 }
  return { hooks: { PreToolUse: [{ hooks: [hook] }], PermissionRequest: [{ hooks: [{ ...hook, command: `${GUARD} --provider codex --event PermissionRequest` }] }] } }
}

export function opencodeV1PluginSource() {
  // Standalone OpenCode V1 plugin: it never assumes a globally installed guard.
  return String.raw`const MAX = 64 * 1024
const SECRET = /(?:^|[/\\\s"'=;|&(){}\[\]])(?:\.env(?:\..*)?|\.globals|credentials?(?:\.[^/\\]+)?|secrets?(?:\.[^/\\]+)?|.*\.(?:pem|key)|id_(?:rsa|dsa|ecdsa|ed25519)|auth\.json|\.vault-token|\.npmrc|\.netrc|\.git-credentials|oauth(?:[-_.]?(?:token|store|cache))?)(?=$|[/\\\s"'=;|&(){}\[\]])/i
const VAULT = /(?:\bvault\s+(?:read|kv\s+(?:get|list))|\b(?:mcp\s+)?read[_ -]?secret\b)/i
const DESTRUCTIVE = /\bgit\s+(?:reset\s+--hard|clean\s+-[^;&|]*(?:f[^;&|]*d|d[^;&|]*f)|checkout\s+--\s+\.)|\b(?:mkfs(?:\.[\w-]+)?|fdisk|parted)\b|\bdd\s+[^;&|]*\bof=\/dev\/|\bdocker\s+(?:system\s+prune|volume\s+prune)\b|\bkubectl\s+delete\s+[^;&|]*(?:--all|--all-namespaces)\b/i
const tokens = command => command.match(/(?:"[^"]*"|'[^']*'|[^\s;&|]+)/g) || []
const unquote = token => token.replace(/^['"]|['"]$/g, '')
const rawEnvTokens = (parts, depth = 0) => { if (!parts.length || depth > 2) return true; let index = 0; while (['command', 'builtin', 'exec'].includes(parts[index]?.split('/').at(-1))) index += 1; if (index >= parts.length) return true; const name = parts[index].split('/').at(-1); const rest = parts.slice(index + 1); if (['sh', 'bash', 'zsh'].includes(name)) { const commandFlag = rest.findIndex(value => /^-[A-Za-z]*c[A-Za-z]*$/.test(value)); if (commandFlag < 0) return false; if (typeof rest[commandFlag + 1] !== 'string' || !rest[commandFlag + 1]) return true; return rawEnv(rest[commandFlag + 1], depth + 1) }; if (name === 'printenv') return true; if (name === 'export') return !rest.length || rest.some(value => !/^[A-Za-z_][A-Za-z0-9_]*=/.test(value)); if (name === 'set') return !rest.length || rest.includes('-o') || rest.includes('+o'); if (name !== 'env') return false; let commandSeen = false; for (let offset = 0; offset < rest.length; offset += 1) { const value = rest[offset]; if (/^[A-Za-z_][A-Za-z0-9_]*=/.test(value)) continue; if (value === '-u' || value === '--unset') { offset += 1; continue }; if (value.startsWith('-')) continue; commandSeen = true; break }; return !commandSeen }
const rawEnv = (command, depth = 0) => command.split(/[;&|]+/).some(segment => { const parts = tokens(segment).map(unquote); return parts.length && rawEnvTokens(parts, depth) })
const rootDelete = (command, root) => command.split(/[;&|]+/).some(segment => { const parts = tokens(segment).map(unquote); const index = parts.findIndex(value => value === 'rm' || /(?:^|\/)rm$/.test(value)); if (index < 0) return false; const rest = parts.slice(index + 1); if (!rest.some(value => value === '--recursive' || /^-[A-Za-z]*r[A-Za-z]*$/i.test(value))) return false; return rest.filter(value => !value.startsWith('-')).some(value => ['/', '.', '..', '*', './*', '~'].includes(value) || /^\$(?:\{)?(?:HOME|PWD)/.test(value) || outside(value, root)) })
const tokenizedDestructive = command => command.split(/[;&|]+/).some(segment => { const parts = tokens(segment).map(unquote); return parts.some((value, index) => { const name = value.split('/').at(-1); const rest = parts.slice(index + 1); if (name === 'git') { if ((rest[0] === 'reset' && rest.includes('--hard')) || (rest[0] === 'checkout' && rest[1] === '--' && rest[2] === '.')) return true; if (rest[0] === 'clean') { const flags = rest.slice(1).filter(token => token.startsWith('-')).join(''); if (flags.includes('f') && flags.includes('d')) return true } }; if (name === 'docker' && ((rest[0] === 'system' && rest[1] === 'prune') || (rest[0] === 'volume' && rest[1] === 'prune'))) return true; if (name === 'kubectl' && rest[0] === 'delete' && rest.some(token => token === '--all' || token === '--all-namespaces')) return true; if (name === 'dd' && rest.some(token => /^of=\/dev\//.test(token))) return true; return name === 'fdisk' || name === 'parted' || /^mkfs(?:\.[\w-]+)?$/.test(name) }) })
const targets = (args, command) => { const result = []; if (args && typeof args === 'object' && !Array.isArray(args)) for (const [key, value] of Object.entries(args)) if (/(?:path|output|destination|target|directory|dir|file)/i.test(key) && typeof value === 'string') result.push(value); const shellTarget = value => result.push(unquote(value)); const option = command.match(/(?:^|\s)(?:--?(?:output|out|destination|target)|deliver)(?:=|\s+)("[^"]*"|'[^']*'|[^\s;&|]+)/i); if (option) shellTarget(option[1]); for (const match of command.matchAll(/(?:\d?>>|\d?>)\s*("[^"]*"|'[^']*'|[^\s;&|]+)/g)) shellTarget(match[1]); return result }
const outside = (value, root) => { if (typeof root !== 'string' || !root.startsWith('/') || root.startsWith('//') || /[\x00\r\n]/.test(root)) return true; const path = String(value).replaceAll('\\', '/'); if (!path || /^\/?(?:~|\$\{?[A-Za-z_][A-Za-z0-9_]*\}?)(?:\/|$)/.test(path) || /(?:^|\/)\$\{?[A-Za-z_][A-Za-z0-9_]*\}?/.test(path) || /^[A-Za-z]:\//.test(path) || path.startsWith('//')) return true; const base = root.split('/').filter(Boolean); const parts = (path.startsWith('/') ? path.slice(1) : path).split('/'); const resolved = path.startsWith('/') ? [] : [...base]; for (const part of parts) { if (!part || part === '.') continue; if (part === '..') { if (!resolved.length) return true; resolved.pop() } else resolved.push(part) }; return path.startsWith('/') ? resolved.slice(0, base.length).join('/') !== base.join('/') : resolved.length < base.length || resolved.slice(0, base.length).join('/') !== base.join('/') }
const check = (tool, args, root) => { let value; try { value = JSON.stringify({ tool, args }) } catch { return 'malformed-or-oversized-input' }; const command = String(args?.command || args?.cmd || args?.script || args?.shell || ''); if (!value || new TextEncoder().encode(value).byteLength > MAX) return 'malformed-or-oversized-input'; if (SECRET.test(value)) return 'secret-or-credential-read'; if (VAULT.test(value + '\n' + command)) return 'raw-vault-secret-read'; if (rawEnv(command) || (/(?:shell|bash|terminal|exec|run)/i.test(tool) && rawEnv(value))) return 'raw-environment-dump'; if (rootDelete(command, root) || tokenizedDestructive(command) || DESTRUCTIVE.test(command)) return 'broad-destructive-command'; if (/(?:write|edit|patch|apply|move|shell|bash|terminal|exec|run)/i.test(tool) && targets(args, command).some(target => outside(unquote(target), root))) return 'path-outside-workspace'; return null }
export const AiConfigSecurity = async (context = {}) => { const root = typeof context.worktree === 'string' ? context.worktree : context.directory; return { 'tool.execute.before': async (input, output) => { const code = check(String(input?.tool || '').toLowerCase(), output?.args || {}, root); if (code) throw new Error('ai-config security policy: ' + code) } } }
`
}

export function opencodeV1PermissionLayer() {
  return { permission: { bash: 'ask', edit: 'ask', write: 'ask', external_directory: 'deny' }, plugin: 'ai-config-security' }
}

export function evaluateProviderEvent(provider, input) {
  if (!['claude', 'codex', 'gemini', 'opencode'].includes(provider)) throw new Error(`unsupported provider: ${provider}`)
  return evaluateToolEvent(input)
}

export function nativeHookDecision(provider, decision, event = 'PreToolUse') {
  if (!decision || typeof decision !== 'object') throw new Error('invalid security decision')
  if (decision.allowed) return undefined
  if (provider === 'claude' || provider === 'codex') {
    if (event === 'PermissionRequest') return { hookSpecificOutput: { hookEventName: 'PermissionRequest', decision: { behavior: 'deny', message: decision.reason } } }
    return { hookSpecificOutput: { hookEventName: 'PreToolUse', permissionDecision: 'deny', permissionDecisionReason: decision.reason } }
  }
  if (provider === 'gemini') return { decision: 'deny', reason: decision.reason }
  return decision
}
