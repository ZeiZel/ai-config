const MAX_INPUT_BYTES = 64 * 1024

const SECRET_PATH = /(?:^|[/\\\s"'`=;|&(){}\[\]])(?:\.env(?:\..*)?|\.globals|credentials?(?:\.[^/\\]+)?|secrets?(?:\.[^/\\]+)?|.*\.pem|.*\.key|id_(?:rsa|dsa|ecdsa|ed25519)|auth\.json|\.vault-token|\.npmrc|\.netrc|\.git-credentials|oauth(?:[-_.]?(?:token|store|cache))?)(?=$|[/\\\s"'`=;|&(){}\[\]])/i
const SECRET_COMMAND = /(?:vault\s+(?:read|kv\s+(?:get|list))|mcp(?:\s+|_)(?:read[_ -]?secret|secret)|read[_ -]?secret)/i
const BROAD_DESTRUCTIVE = [
  /\bgit\s+(?:reset\s+--hard|clean\s+-[^;&|]*f[^;&|]*d|checkout\s+--\s+\.)/i,
  /\b(?:mkfs(?:\.[\w-]+)?|fdisk|parted)\b/i,
  /\bdd\s+[^;&|]*\bof=\/dev\//i,
  /\bdocker\s+(?:system\s+prune|volume\s+prune)\b/i,
  /\bkubectl\s+delete\s+[^;&|]*(?:--all|--all-namespaces)\b/i,
]

export const HOOK_MAX_INPUT_BYTES = MAX_INPUT_BYTES

function deny(code) { return { allowed: false, decision: 'deny', reasonCode: code, reason: `ai-config security policy: ${code}` } }
function allow() { return { allowed: true, decision: 'allow', reasonCode: 'policy-allow', reason: 'ai-config security policy: policy-allow' } }

function boundedJson(input) {
  if (input === undefined || input === null) throw new Error('missing hook input')
  const text = Buffer.isBuffer(input) ? input.toString('utf8') : typeof input === 'string' ? input : JSON.stringify(input)
  if (!text || Buffer.byteLength(text, 'utf8') > MAX_INPUT_BYTES) throw new Error('hook input exceeds bounded limit')
  const value = typeof input === 'string' || Buffer.isBuffer(input) ? JSON.parse(text) : input
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('hook input must be a JSON object')
  return value
}

function textValues(value, depth = 0) {
  if (depth > 4 || value === null || value === undefined) return []
  if (typeof value === 'string') return [value]
  if (Array.isArray(value)) return value.slice(0, 64).flatMap(item => textValues(item, depth + 1))
  if (typeof value !== 'object') return []
  return Object.entries(value).slice(0, 128).flatMap(([key, item]) => [key, ...textValues(item, depth + 1)])
}

function commandFrom(event) {
  const input = event.tool_input ?? event.toolInput ?? event.input ?? event.arguments ?? event.args
  const candidates = [event.command, event.cmd, input?.command, input?.cmd, input?.script, input?.shell]
  return candidates.find(value => typeof value === 'string') || ''
}

function outputTargets(event, command) {
  const input = event.tool_input ?? event.toolInput ?? event.input ?? event.arguments ?? {}
  const targets = []
  if (input && typeof input === 'object' && !Array.isArray(input)) {
    for (const [key, value] of Object.entries(input)) {
      if (/(?:path|output|destination|target|directory|dir|file)/i.test(key) && typeof value === 'string') targets.push(value)
    }
  }
  const shellTarget = value => targets.push(unquote(value))
  const parts = command.match(/(?:^|\s)(?:--?(?:output|out|destination|target)|deliver)(?:=|\s+)("[^"]*"|'[^']*'|[^\s;&|]+)/i)
  if (parts) shellTarget(parts[1])
  // This is intentionally a small shell-token heuristic, not a shell parser.
  // It catches the common write forms while leaving quoted command syntax to
  // the provider's own sandbox.
  for (const match of command.matchAll(/(?:\d?>>|\d?>)\s*("[^"]*"|'[^']*'|[^\s;&|]+)/g)) shellTarget(match[1])
  return targets
}

function escapesWorkspace(target, cwd) {
  if (typeof cwd !== 'string' || !cwd.startsWith('/') || cwd.startsWith('//') || /[\x00\r\n]/.test(cwd)) return true
  const normalized = String(target).replaceAll('\\', '/')
  if (!normalized || /^\/?(?:~|\$\{?[A-Za-z_][A-Za-z0-9_]*\}?)(?:\/|$)/.test(normalized) || /(?:^|\/)\$\{?[A-Za-z_][A-Za-z0-9_]*\}?/.test(normalized) || /^[A-Za-z]:\//.test(normalized) || normalized.startsWith('//')) return true
  const baseParts = cwd.split('/').filter(Boolean)
  const targetParts = (normalized.startsWith('/') ? normalized.slice(1) : normalized).split('/')
  const resolved = normalized.startsWith('/') ? [] : [...baseParts]
  for (const part of targetParts) {
    if (!part || part === '.') continue
    if (part === '..') { if (!resolved.length) return true; resolved.pop() }
    else resolved.push(part)
  }
  return normalized.startsWith('/') ? resolved.slice(0, baseParts.length).join('/') !== baseParts.join('/') : resolved.length < baseParts.length || resolved.slice(0, baseParts.length).join('/') !== baseParts.join('/')
}

function shellTokens(command) {
  // Conservative classification rather than shell parsing: catches quoted
  // home/PWD targets without blanket-denying a harmless `rm -rf .cache`.
  return command.match(/(?:"[^"]*"|'[^']*'|[^\s;&|]+)/g) || []
}

function unquote(token) {
  return token.replace(/^['"]|['"]$/g, '')
}

function rawEnvironmentTokens(tokens, depth = 0) {
  if (!tokens.length || depth > 2) return true
  let index = 0
  while (['command', 'builtin', 'exec'].includes(tokens[index]?.split('/').at(-1))) index += 1
  if (index >= tokens.length) return true
  const executable = tokens[index]
  const name = executable.split('/').at(-1)
  const rest = tokens.slice(index + 1)
  if (['sh', 'bash', 'zsh'].includes(name)) {
    const commandFlag = rest.findIndex(token => /^-[A-Za-z]*c[A-Za-z]*$/.test(token))
    if (commandFlag < 0) return false
    if (typeof rest[commandFlag + 1] !== 'string' || !rest[commandFlag + 1]) return true
    return rawEnvironmentDump(rest[commandFlag + 1], depth + 1)
  }
  if (name === 'printenv') return true
  if (name === 'export') return !rest.length || rest.some(token => !/^[A-Za-z_][A-Za-z0-9_]*=/.test(token))
  if (name === 'set') return !rest.length || rest.includes('-o') || rest.includes('+o')
  if (name !== 'env') return false
  let hasCommand = false
  for (let offset = 0; offset < rest.length; offset += 1) {
    const token = rest[offset]
    if (/^[A-Za-z_][A-Za-z0-9_]*=/.test(token)) continue
    if (token === '-u' || token === '--unset') { offset += 1; continue }
    if (token.startsWith('-')) continue
    hasCommand = true
    break
  }
  return !hasCommand
}

function rawEnvironmentDump(command, depth = 0) {
  for (const segment of command.split(/[;&|]+/)) {
    const tokens = shellTokens(segment).map(unquote)
    if (!tokens.length) continue
    if (rawEnvironmentTokens(tokens, depth)) return true
  }
  return false
}

function unsafeRecursiveDelete(command, cwd) {
  for (const segment of command.split(/[;&|]+/)) {
    const tokens = shellTokens(segment).map(unquote)
    const index = tokens.findIndex(token => token === 'rm' || /(?:^|\/)rm$/.test(token))
    if (index < 0) continue
    const rest = tokens.slice(index + 1)
    if (!rest.some(token => token === '--recursive' || /^-[A-Za-z]*r[A-Za-z]*$/i.test(token))) continue
    const targets = rest.filter(token => !token.startsWith('-')).map(token => token.replace(/^['"]|['"]$/g, ''))
    if (targets.some(target => ['/', '.', '..', '*', './*', '~', '$HOME', '${HOME}', '$PWD', '${PWD}'].includes(target) || /^\$(?:\{)?(?:HOME|PWD)/.test(target) || (typeof cwd === 'string' && escapesWorkspace(target, cwd)))) return true
  }
  return false
}

function broadGitClean(command) {
  return command.split(/[;&|]+/).some(segment => {
    const tokens = shellTokens(segment); const index = tokens.findIndex(token => token === 'git' || /(?:^|\/)git$/.test(token))
    if (index < 0 || tokens[index + 1] !== 'clean') return false
    const flags = tokens.slice(index + 2).filter(token => token.startsWith('-')).join('')
    return flags.includes('f') && flags.includes('d')
  })
}

// Regexes retain broad coverage for normal shell spellings; this companion
// token pass closes the quoted/absolute executable form (for example
// `"/usr/bin/git" reset --hard`) without evaluating shell syntax.
function tokenizedDestructive(command) {
  for (const segment of command.split(/[;&|]+/)) {
    const parts = shellTokens(segment).map(unquote)
    for (let index = 0; index < parts.length; index += 1) {
      const name = parts[index].split('/').at(-1)
      const rest = parts.slice(index + 1)
      if (name === 'git') {
        if ((rest[0] === 'reset' && rest.includes('--hard')) || (rest[0] === 'checkout' && rest[1] === '--' && rest[2] === '.')) return true
        if (rest[0] === 'clean') { const flags = rest.slice(1).filter(token => token.startsWith('-')).join(''); if (flags.includes('f') && flags.includes('d')) return true }
      }
      if (name === 'docker' && ((rest[0] === 'system' && rest[1] === 'prune') || (rest[0] === 'volume' && rest[1] === 'prune'))) return true
      if (name === 'kubectl' && rest[0] === 'delete' && rest.some(token => token === '--all' || token === '--all-namespaces')) return true
      if (name === 'dd' && rest.some(token => /^of=\/dev\//.test(token))) return true
      if (name === 'fdisk' || name === 'parted' || /^mkfs(?:\.[\w-]+)?$/.test(name)) return true
    }
  }
  return false
}

export function evaluateToolEvent(input) {
  let event
  try { event = boundedJson(input) } catch { return deny('malformed-or-oversized-input') }
  const command = commandFrom(event)
  const toolName = String(event.tool_name ?? event.toolName ?? event.name ?? event.tool ?? '').toLowerCase()
  // The event was already byte-bounded by boundedJson.  Scan its complete
  // serialized representation so a credential path cannot hide after a
  // traversal depth/entry-count convenience limit.
  const joined = JSON.stringify(event)
  if (SECRET_COMMAND.test(`${toolName}\n${command}\n${joined}`)) return deny('secret-or-vault-read')
  if (rawEnvironmentDump(command) || (/(?:shell|bash|terminal|exec|run)/i.test(toolName) && rawEnvironmentDump(joined))) return deny('raw-environment-dump')
  // Writes are as dangerous as reads for credential paths: patch/edit events
  // must not evade this decision merely because they are not read-like.
  if (SECRET_PATH.test(joined)) return deny('secret-or-credential-read')
  if (unsafeRecursiveDelete(command, event.cwd ?? event.working_directory ?? event.workingDirectory) || broadGitClean(command) || tokenizedDestructive(command) || BROAD_DESTRUCTIVE.some(pattern => pattern.test(command))) return deny('broad-destructive-command')
  const writeLike = /(?:write|edit|patch|apply|move|shell|bash|terminal|exec|run)/i.test(toolName) || /\barchify\b/i.test(command)
  if (writeLike && outputTargets(event, command).some(target => escapesWorkspace(target, event.cwd ?? event.working_directory ?? event.workingDirectory))) return deny('path-outside-workspace')
  return allow()
}

export function parseHookInput(input) { return boundedJson(input) }

/**
 * Consume hook stdin without ever materialising more than the policy limit.
 * A missing/oversized/failed stream is deliberately represented as undefined:
 * evaluateToolEvent treats it as a fail-closed malformed event.
 */
export async function readBoundedHookInput(stream) {
  const chunks = []
  let bytes = 0
  try {
    for await (const chunk of stream) {
      const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)
      bytes += buffer.length
      if (bytes > MAX_INPUT_BYTES) {
        stream.destroy?.()
        return undefined
      }
      chunks.push(buffer)
    }
  } catch {
    return undefined
  }
  return Buffer.concat(chunks)
}
