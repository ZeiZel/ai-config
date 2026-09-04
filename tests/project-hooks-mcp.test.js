import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, mkdir, readFile, writeFile } from 'node:fs/promises'
import { spawn } from 'node:child_process'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { initializeProject } from '../src/init/index.js'
import { uninstallManagedFiles } from '../src/install/index.js'
import { evaluateToolEvent } from '../src/hooks/policy.js'
import { loadMcpCatalog, resolveMcpProfile } from '../src/mcp/index.js'

const temp = () => mkdtemp(join(tmpdir(), 'ai-config-project-hooks-'))
const specsDir = resolve('ai-specs')
const initOptions = root => ({ projectRoot: root, providers: ['claude', 'codex', 'gemini', 'opencode'], specsDir, includeSpecKit: false, initializeBeads: false, includeExternal: false, runtimeEnv: { PATH: process.env.PATH }, executableFinder: async () => true })

function run(command, args, { cwd, input } = {}) {
  return new Promise((resolvePromise, reject) => {
    const child = spawn(command, args, { cwd, shell: false, stdio: ['pipe', 'pipe', 'pipe'] })
    const stdout = []; const stderr = []
    child.stdout.on('data', chunk => stdout.push(chunk)); child.stderr.on('data', chunk => stderr.push(chunk))
    child.once('error', reject)
    child.once('close', code => resolvePromise({ code, stdout: Buffer.concat(stdout).toString(), stderr: Buffer.concat(stderr).toString() }))
    child.stdin.end(input)
  })
}

test('project init installs native hooks and combines Gemini hooks with MCP without replacing user entries', async () => {
  const root = await temp(); await mkdir(join(root, '.git')); await mkdir(join(root, '.claude')); await mkdir(join(root, '.codex')); await mkdir(join(root, '.gemini'))
  await writeFile(join(root, '.claude/settings.json'), JSON.stringify({ hooks: { PreToolUse: [{ hooks: [{ type: 'command', command: 'user-claude-hook' }] }] } }))
  await writeFile(join(root, '.codex/hooks.json'), JSON.stringify({ hooks: { PreToolUse: [{ hooks: [{ type: 'command', command: 'user-codex-hook' }] }] } }))
  await writeFile(join(root, '.gemini/settings.json'), JSON.stringify({ mcpServers: { user: { command: 'user' } }, hooks: { BeforeTool: [{ matcher: 'user', hooks: [{ type: 'command', command: 'user-gemini-hook' }] }] } }))
  await initializeProject(initOptions(root))
  const claude = JSON.parse(await readFile(join(root, '.claude/settings.json')))
  const codex = JSON.parse(await readFile(join(root, '.codex/hooks.json')))
  const gemini = JSON.parse(await readFile(join(root, '.gemini/settings.json')))
  const opencode = JSON.parse(await readFile(join(root, 'opencode.json')))
  assert.equal(claude.hooks.PreToolUse.flatMap(entry => entry.hooks).some(hook => hook.command === 'user-claude-hook'), true)
  assert.equal(claude.hooks.PreToolUse.flatMap(entry => entry.hooks).some(hook => hook.command.includes('.ai-config/hooks/guard.mjs')), true)
  assert.deepEqual(Object.keys(codex.hooks).sort(), ['PermissionRequest', 'PreToolUse'])
  assert.equal(gemini.mcpServers.user.command, 'user')
  assert.equal(gemini.mcpServers['ai-config-context7'].httpUrl, 'https://mcp.context7.com/mcp')
  assert.equal(gemini.security.environmentVariableRedaction.enabled, true)
  assert.equal(gemini.hooks.BeforeTool.some(entry => entry.hooks.some(hook => hook.command === 'user-gemini-hook')), true)
  assert.equal(opencode.mcp['ai-config-context7'].type, 'remote')
  assert.equal(Object.hasOwn(opencode.mcp, 'servers'), false)
  const agents = await readFile(join(root, 'AGENTS.md'), 'utf8')
  assert.match(agents, /BEADS_DOLT_SHARED_SERVER=1 bd dolt status/)
  assert.match(agents, /BEADS_DOLT_SHARED_SERVER=1 bd --global prime --memories-only/)
  assert.match(agents, /PRIVATE\/global Beads values or secrets/)
  assert.match(await readFile(join(root, '.opencode/plugins/ai-config-security.js'), 'utf8'), /tool\.execute\.before/)
  assert.match(await readFile(join(root, '.ai-config/hooks/guard.mjs'), 'utf8'), /secret-or-vault-read/)

  await initializeProject({ ...initOptions(root), includeMcp: false })
  const withoutMcp = JSON.parse(await readFile(join(root, '.gemini/settings.json')))
  assert.deepEqual(Object.keys(withoutMcp.mcpServers), ['user'])
  assert.equal(withoutMcp.hooks.BeforeTool.some(entry => entry.hooks.some(hook => hook.command.includes('.ai-config/hooks/guard.mjs'))), true)

  await writeFile(join(root, '.claude/settings.json'), `${await readFile(join(root, '.claude/settings.json'), 'utf8')}\n`)
  await uninstallManagedFiles({ targetRoot: root })
  const after = JSON.parse(await readFile(join(root, '.claude/settings.json')))
  assert.equal(after.hooks.PreToolUse.flatMap(entry => entry.hooks).some(hook => hook.command === 'user-claude-hook'), true)
  assert.equal(after.hooks.PreToolUse.flatMap(entry => entry.hooks).some(hook => hook.command.includes('.ai-config/hooks/guard.mjs')), false)
})

test('explicit central MCP profile IDs dedupe and high-risk servers require exact approval IDs', async () => {
  const root = await temp(); await mkdir(join(root, '.git'))
  await assert.rejects(() => initializeProject({ ...initOptions(root), providers: ['claude'], mcpProfileIds: ['browser-isolated'] }), /explicit approval/)
  const result = await initializeProject({ ...initOptions(root), providers: ['claude'], mcpProfileIds: ['default', 'browser-isolated', 'default'], approvedMcpServerIds: ['playwright', 'chrome-devtools'] })
  assert.deepEqual(result.mcp.map(server => server.id), ['context7', 'playwright', 'chrome-devtools'])
  assert.deepEqual(result.mcpProfiles, ['default', 'browser-isolated'])
})

test('raw Vault MCP is unavailable and Gemini projects the central YouTrack runner without values', async () => {
  const catalog = await loadMcpCatalog({ specsDir })
  assert.equal(catalog.servers.has('vault'), false)
  assert.throws(() => resolveMcpProfile(catalog, 'vault-explicit'), /unknown MCP profile/)
  const root = await temp(); await mkdir(join(root, '.git'))
  await initializeProject({ ...initOptions(root), providers: ['gemini'], mcpProfileIds: ['youtrack-read'], approvedMcpServerIds: ['youtrack-read'] })
  const settings = JSON.parse(await readFile(join(root, '.gemini/settings.json')))
  const youtrack = settings.mcpServers['ai-config-youtrack-read']
  assert.equal(youtrack.command, '/bin/sh')
  assert.equal(youtrack.args[0], '-c')
  assert.match(youtrack.args[1], /env -i PATH=/)
  assert.match(youtrack.args[1], /mcp-run.*--server.*youtrack-read/)
  assert.equal(youtrack.trust, false)
  assert.equal(youtrack.includeTools.includes('search_issues'), true)
  assert.match(youtrack.args[1], /YOUTRACK_BASE_URL="\$YOUTRACK_BASE_URL"/)
})

for (const input of [
  { tool_name: 'apply_patch', tool_input: { path: '.env.local' } },
  { tool_name: 'write_file', tool_input: { path: '.vault-token' } },
  { tool_name: 'read_file', tool_input: { path: '.npmrc' } },
  { tool_name: 'shell', command: 'rm -rf "$HOME"' },
  { tool_name: 'shell', command: 'git clean -df' }
]) test(`hook core blocks ${input.tool_name} credential/destructive bypass`, () => assert.equal(evaluateToolEvent(input).allowed, false))

test('hook core keeps bounded cache cleanup neutral', () => {
  assert.equal(evaluateToolEvent({ tool_name: 'shell', command: 'rm -rf .cache' }).allowed, true)
})

test('hook core normalizes workspace paths and catches shell output redirection', () => {
  assert.equal(evaluateToolEvent({ tool_name: 'write_file', cwd: '/repo', tool_input: { path: 'src/../file.txt' } }).allowed, true)
  assert.equal(evaluateToolEvent({ tool_name: 'write_file', cwd: '/repo', tool_input: { path: '../outside.txt' } }).allowed, false)
  assert.equal(evaluateToolEvent({ tool_name: 'shell', cwd: '/repo', command: 'echo safe > src/../out.txt' }).allowed, true)
  assert.equal(evaluateToolEvent({ tool_name: 'shell', cwd: '/repo', command: 'echo secret > ../outside.txt' }).allowed, false)
  for (const target of ['~/.cache/out', '$HOME/out', '${HOME}/out', 'C:\\tmp\\out', '\\\\server\\share\\out']) {
    assert.equal(evaluateToolEvent({ tool_name: 'write_file', cwd: '/repo', tool_input: { path: target } }).allowed, false, target)
  }
  assert.equal(evaluateToolEvent({ tool_name: 'write_file', tool_input: { path: 'inside.txt' } }).allowed, false)
  assert.equal(evaluateToolEvent({ tool_name: 'write_file', cwd: '.', tool_input: { path: 'inside.txt' } }).allowed, false)
})

test('project guard streams a bounded stdin and hook registration finds its project from nested repositories', async () => {
  const root = await temp(); const nested = join(root, 'submodule/deep')
  await mkdir(join(root, '.git')); await mkdir(join(nested, '.git'), { recursive: true })
  await initializeProject({ ...initOptions(root), providers: ['claude'], includeMcp: false })
  const guard = join(root, '.ai-config/hooks/guard.mjs')
  const oversized = await run(process.execPath, [guard, '--provider', 'claude'], { cwd: root, input: Buffer.alloc(64 * 1024 + 1, 'x') })
  assert.equal(oversized.code, 0, oversized.stderr)
  assert.match(oversized.stdout, /malformed-or-oversized-input/)

  const settings = JSON.parse(await readFile(join(root, '.claude/settings.json')))
  const command = settings.hooks.PreToolUse.flatMap(entry => entry.hooks).find(hook => hook.command.includes('.ai-config/hooks/guard.mjs')).command
  assert.doesNotMatch(command, /git rev-parse/)
  assert.match(command, /^\/bin\/sh -c /)
  assert.equal(command.includes(root), false)
  // A nested dependency can shadow the filename, but never the reviewed
  // source identity; an oversized decoy must be stat-rejected before read.
  await mkdir(join(nested, '.ai-config/hooks'), { recursive: true })
  await writeFile(join(nested, '.ai-config/hooks/guard.mjs'), Buffer.alloc(2 * 1024 * 1024, 'x'))
  const nestedResult = await run('sh', ['-c', command], { cwd: nested, input: JSON.stringify({ tool_name: 'shell', command: 'printenv' }) })
  assert.equal(nestedResult.code, 0, nestedResult.stderr)
  assert.match(nestedResult.stdout, /raw-environment-dump/)

  const projectSafe = await run('sh', ['-c', command], { cwd: nested, input: JSON.stringify({ tool_name: 'write_file', cwd: nested, tool_input: { path: 'src/../inside.txt' } }) })
  assert.equal(projectSafe.stdout, '')
  const projectUnsafe = await run('sh', ['-c', command], { cwd: nested, input: JSON.stringify({ tool_name: 'shell', cwd: nested, command: 'echo x > ../outside.txt' }) })
  assert.match(projectUnsafe.stdout, /path-outside-workspace/)

  for (const [input, reason] of [
    [{ tool_name: 'shell', cwd: nested, command: 'rm -rf ../outside' }, 'broad-destructive-command'],
    [{ tool_name: 'shell', cwd: nested, command: 'rm -rf /tmp/outside' }, 'broad-destructive-command'],
    [{ tool_name: 'shell', cwd: nested, command: 'rm -RF /' }, 'broad-destructive-command'],
    [{ tool_name: 'shell', cwd: nested, command: 'echo x > "../outside"' }, 'path-outside-workspace'],
    [{ tool_name: 'shell', cwd: nested, command: "echo x >> '../outside'" }, 'path-outside-workspace'],
    [{ tool_name: 'shell', cwd: nested, command: 'archify deliver "../outside"' }, 'path-outside-workspace'],
    [{ tool_name: 'shell', cwd: nested, command: 'echo x > "$HOME/out"' }, 'path-outside-workspace'],
    [{ tool_name: 'shell', cwd: nested, command: 'echo x>../outside' }, 'path-outside-workspace'],
    [{ tool_name: 'shell', cwd: nested, command: 'tool --output="../outside"' }, 'path-outside-workspace'],
    [{ tool_name: 'shell', command: 'command env' }, 'raw-environment-dump'],
    [{ tool_name: 'shell', command: '/bin/sh -c env' }, 'raw-environment-dump'],
    [{ tool_name: 'shell', command: 'cat ".env"' }, 'secret-or-credential-read'],
  ]) {
    const result = await run('sh', ['-c', command], { cwd: nested, input: JSON.stringify(input) })
    assert.match(result.stdout, new RegExp(reason))
  }
  const wide = Object.fromEntries(Array.from({ length: 129 }, (_, index) => [`safe${index}`, 'ok']))
  wide.hidden = '.env'
  const deepResult = await run('sh', ['-c', command], { cwd: nested, input: JSON.stringify({ tool_name: 'read_file', tool_input: wide }) })
  assert.match(deepResult.stdout, /secret-or-credential-read/)
  const multibyte = await run('sh', ['-c', command], { cwd: nested, input: JSON.stringify({ tool_name: 'read_file', tool_input: { value: 'Ж'.repeat(40_000) } }) })
  assert.match(multibyte.stdout, /malformed-or-oversized-input/)

  const scoped = await run(process.execPath, [guard, '--provider', 'claude'], { cwd: root, input: JSON.stringify({ tool_name: 'shell', command: 'env NODE_ENV=test npm test' }) })
  assert.equal(scoped.stdout, '')
  for (const shellCommand of ['bash script.sh', 'sh ./script.sh', 'zsh -n script.zsh']) {
    const neutral = await run('sh', ['-c', command], { cwd: nested, input: JSON.stringify({ tool_name: 'shell', command: shellCommand }) })
    assert.equal(neutral.stdout, '', shellCommand)
  }
})

test('project hook shell boundary rejects Bun preload injection from hostile cwd', async () => {
  const root = await temp(); await mkdir(join(root, '.git')); await mkdir(join(root, 'nested'))
  await initializeProject({ ...initOptions(root), providers: ['claude'], includeMcp: false })
  await writeFile(join(root, '.env'), 'BUN_OPTIONS=--preload ./sentinel.mjs\n')
  await writeFile(join(root, 'sentinel.mjs'), `await Bun.write(${JSON.stringify(join(root, 'pwned'))}, 'executed')\n`)
  await writeFile(join(root, 'bunfig.toml'), `preload = [${JSON.stringify(join(root, 'sentinel.mjs'))}]\n`)
  const settings = JSON.parse(await readFile(join(root, '.claude/settings.json')))
  const command = settings.hooks.PreToolUse[0].hooks[0].command
  const result = await run('/bin/sh', ['-c', command], {
    cwd: join(root, 'nested'),
    env: { PATH: process.env.PATH, HOME: root, BUN_OPTIONS: '--preload ./sentinel.mjs', NODE_OPTIONS: '--require ./sentinel.cjs' },
    input: JSON.stringify({ tool_name: 'read_file', tool_input: { path: 'src/index.js' }, cwd: root })
  })
  assert.equal(result.code, 0)
  assert.equal(await readFile(join(root, 'pwned'), 'utf8').catch(() => undefined), undefined)
})

test('project init tracks only Gemini redaction and OpenCode permissions it added', async () => {
  const root = await temp(); await mkdir(join(root, '.git')); await mkdir(join(root, '.gemini'))
  await writeFile(join(root, '.gemini/settings.json'), JSON.stringify({ security: { environmentVariableRedaction: { enabled: true } } }))
  const userPermission = { bash: 'ask', edit: 'ask', write: 'ask', external_directory: 'deny' }
  await writeFile(join(root, 'opencode.json'), JSON.stringify({ permission: userPermission }))
  await initializeProject({ ...initOptions(root), providers: ['gemini', 'opencode'], includeMcp: false })
  await uninstallManagedFiles({ targetRoot: root })
  const gemini = JSON.parse(await readFile(join(root, '.gemini/settings.json')))
  const opencode = JSON.parse(await readFile(join(root, 'opencode.json')))
  assert.equal(gemini.security.environmentVariableRedaction.enabled, true)
  assert.deepEqual(opencode.permission, userPermission)
})

test('uninstall removes a uniquely identified shifted hook without adopting the prepended user hook', async () => {
  const root = await temp(); await mkdir(join(root, '.git'))
  await initializeProject({ ...initOptions(root), providers: ['claude'], includeMcp: false })
  const path = join(root, '.claude/settings.json')
  const settings = JSON.parse(await readFile(path, 'utf8'))
  settings.hooks.PreToolUse.unshift({ hooks: [{ type: 'command', command: 'user-prepended-hook' }] })
  await writeFile(path, `${JSON.stringify(settings, null, 2)}\n`)
  await uninstallManagedFiles({ targetRoot: root })
  const after = JSON.parse(await readFile(path, 'utf8'))
  const commands = after.hooks.PreToolUse.flatMap(entry => entry.hooks).map(hook => hook.command)
  assert.deepEqual(commands, ['user-prepended-hook'])
  await assert.rejects(() => readFile(join(root, '.ai-config/hooks/guard.mjs')), error => error.code === 'ENOENT')
})

test('uninstall retains the guard and state when a referenced hook is modified or ambiguous', async () => {
  for (const mutation of ['timeout', 'duplicate']) {
    const root = await temp(); await mkdir(join(root, '.git'))
    await initializeProject({ ...initOptions(root), providers: ['claude'], includeMcp: false })
    const path = join(root, '.claude/settings.json')
    const settings = JSON.parse(await readFile(path, 'utf8'))
    if (mutation === 'timeout') settings.hooks.PreToolUse[0].hooks[0].timeout = 999
    else settings.hooks.PreToolUse.push(structuredClone(settings.hooks.PreToolUse[0]))
    await writeFile(path, `${JSON.stringify(settings, null, 2)}\n`)
    const result = await uninstallManagedFiles({ targetRoot: root })
    assert.equal(result.changes.find(change => change.path === '.ai-config/hooks/guard.mjs')?.reason, 'guard-required-by-preserved-hook', mutation)
    await readFile(join(root, '.ai-config/hooks/guard.mjs'))
    assert.equal(Object.hasOwn(result.state.files, '.claude/settings.json'), true, mutation)
    assert.equal(Object.hasOwn(result.state.files, '.ai-config/hooks/guard.mjs'), true, mutation)
  }
})

test('first init refuses exact reserved hook and MCP projections without state ownership', async () => {
  const source = await temp(); await mkdir(join(source, '.git'))
  await initializeProject({ ...initOptions(source), providers: ['claude'], includeMcp: false })
  const preexistingHook = await readFile(join(source, '.claude/settings.json'), 'utf8')
  const hookTarget = await temp(); await mkdir(join(hookTarget, '.git')); await mkdir(join(hookTarget, '.claude'))
  await writeFile(join(hookTarget, '.claude/settings.json'), preexistingHook)
  await assert.rejects(() => initializeProject({ ...initOptions(hookTarget), providers: ['claude'], includeMcp: false }), error => error.code === 'MANAGED_FRAGMENT_CONFLICT')

  const mcpSource = await temp(); await mkdir(join(mcpSource, '.git'))
  await initializeProject({ ...initOptions(mcpSource), providers: ['opencode'] })
  const preexistingMcp = await readFile(join(mcpSource, 'opencode.json'), 'utf8')
  const mcpTarget = await temp(); await mkdir(join(mcpTarget, '.git'))
  await writeFile(join(mcpTarget, 'opencode.json'), preexistingMcp)
  await assert.rejects(() => initializeProject({ ...initOptions(mcpTarget), providers: ['opencode'] }), error => error.code === 'MANAGED_FRAGMENT_CONFLICT')
})

test('user hook text mentioning the guard marker remains unowned and survives uninstall', async () => {
  const root = await temp(); await mkdir(join(root, '.git')); await mkdir(join(root, '.claude'))
  await writeFile(join(root, '.claude/settings.json'), JSON.stringify({ hooks: { PreToolUse: [{ hooks: [{ type: 'command', command: 'echo .ai-config/hooks/guard.mjs is user text' }] }] } }))
  await initializeProject({ ...initOptions(root), providers: ['claude'], includeMcp: false })
  await uninstallManagedFiles({ targetRoot: root })
  const after = JSON.parse(await readFile(join(root, '.claude/settings.json')))
  assert.equal(after.hooks.PreToolUse.flatMap(entry => entry.hooks).some(hook => hook.command === 'echo .ai-config/hooks/guard.mjs is user text'), true)
})

test('fresh OpenCode no-MCP initialization still projects its permission layer', async () => {
  const root = await temp(); await mkdir(join(root, '.git'))
  await initializeProject({ ...initOptions(root), providers: ['opencode'], includeMcp: false })
  const config = JSON.parse(await readFile(join(root, 'opencode.json')))
  assert.equal(config.permission.external_directory, 'deny')
  assert.equal(Object.hasOwn(config, 'mcp'), false)
})

test('frontend to base re-init removes only stale frontend files from shared agents skills', async () => {
  const root = await temp(); await mkdir(join(root, '.git'))
  const base = { path: '.agents/skills/base/SKILL.md', content: 'base\n' }
  const frontend = { path: '.agents/skills/frontend/SKILL.md', content: 'frontend\n' }
  await initializeProject({ ...initOptions(root), providers: ['codex'], profileIds: ['frontend'], includeMcp: false, managedFiles: [base, frontend] })
  await initializeProject({ ...initOptions(root), providers: ['codex'], profileIds: ['base'], includeMcp: false, managedFiles: [base] })
  assert.equal(await readFile(join(root, base.path), 'utf8'), 'base\n')
  await assert.rejects(() => readFile(join(root, frontend.path)), error => error.code === 'ENOENT')
  assert.equal((await readFile(join(root, 'AGENTS.md'), 'utf8')).includes('Providers: codex'), true)
})

test('re-init reconciles omitted provider/profile artifacts while preserving user-owned merged content', async () => {
  const root = await temp(); await mkdir(join(root, '.git')); await mkdir(join(root, '.claude'))
  await writeFile(join(root, '.claude/settings.json'), JSON.stringify({ hooks: { PreToolUse: [{ hooks: [{ type: 'command', command: 'user-hook' }] }] } }))
  const options = { ...initOptions(root), includeMcp: false, managedFiles: [{ path: '.agents/skills/base/SKILL.md', content: 'base\n' }, { path: '.agents/skills/frontend/SKILL.md', content: 'frontend\n' }] }
  await initializeProject({ ...options, providers: ['claude', 'codex', 'gemini', 'opencode'], profileIds: ['frontend'] })
  await initializeProject({ ...options, providers: ['codex'], profileIds: ['base'], managedFiles: [{ path: '.agents/skills/base/SKILL.md', content: 'base\n' }] })
  assert.equal(await readFile(join(root, '.agents/skills/base/SKILL.md'), 'utf8'), 'base\n')
  await assert.rejects(() => readFile(join(root, '.agents/skills/frontend/SKILL.md')), error => error.code === 'ENOENT')
  const claude = JSON.parse(await readFile(join(root, '.claude/settings.json')))
  assert.equal(claude.hooks.PreToolUse.flatMap(entry => entry.hooks).some(hook => hook.command === 'user-hook'), true)
  assert.equal(claude.hooks.PreToolUse.flatMap(entry => entry.hooks).some(hook => hook.command.includes('.ai-config/hooks/guard.mjs')), false)
  await assert.rejects(() => readFile(join(root, '.opencode/plugins/ai-config-security.js')), error => error.code === 'ENOENT')
})

test('re-init reports a conflict rather than deleting a locally modified stale managed file', async () => {
  const root = await temp(); await mkdir(join(root, '.git'))
  const options = { ...initOptions(root), providers: ['codex'], includeMcp: false, managedFiles: [{ path: '.agents/skills/frontend/SKILL.md', content: 'managed\n' }] }
  await initializeProject(options)
  await writeFile(join(root, '.agents/skills/frontend/SKILL.md'), 'user change\n')
  await assert.rejects(() => initializeProject({ ...options, managedFiles: [] }), error => error.code === 'MANAGED_FILE_CONFLICT' && error.conflicts.some(change => change.path === '.agents/skills/frontend/SKILL.md'))
  assert.equal(await readFile(join(root, '.agents/skills/frontend/SKILL.md'), 'utf8'), 'user change\n')
})
