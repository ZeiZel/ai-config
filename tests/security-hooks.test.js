import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { evaluateToolEvent, HOOK_MAX_INPUT_BYTES } from '../src/hooks/policy.js'
import { claudeSettingsFragment, codexPermissionLayer, geminiSettingsFragment, nativeHookDecision, opencodeV1PermissionLayer, opencodeV1PluginSource } from '../src/hooks/providers.js'

async function withPluginSource(source, callback) {
  const directory = await mkdtemp(join(tmpdir(), 'ai-config-security-hook-'))
  const filename = join(directory, 'plugin.mjs')
  try {
    await writeFile(filename, source, 'utf8')
    const plugin = await import(`${pathToFileURL(filename).href}?cacheBust=${Date.now()}`)
    return await callback(plugin)
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
}

test('hook policy allows ordinary bounded tool input', () => {
  assert.equal(evaluateToolEvent(JSON.stringify({ tool_name: 'read_file', tool_input: { path: 'src/index.js' } })).allowed, true)
})

for (const input of [
  { tool_name: 'read_file', tool_input: { path: '.env.production' } },
  { tool_name: 'shell', command: 'printenv' },
  { tool_name: 'vault', command: 'vault kv get secret/app' },
  { tool_name: 'shell', command: 'rm -rf /' },
  { tool_name: 'shell', cwd: '/repo', command: 'archify deliver /tmp/out' },
  { tool_name: 'write_file', cwd: '/repo', tool_input: { path: '../outside.txt' } },
]) test(`hook policy denies ${input.tool_name}`, () => assert.equal(evaluateToolEvent(input).allowed, false))

test('malformed and oversized input fail closed', () => {
  assert.equal(evaluateToolEvent('{').reasonCode, 'malformed-or-oversized-input')
  assert.equal(evaluateToolEvent('x'.repeat(HOOK_MAX_INPUT_BYTES + 1)).reasonCode, 'malformed-or-oversized-input')
})

test('hook policy permits scoped environment assignment invocations', () => {
  for (const command of ['export NODE_ENV=test', 'env NODE_ENV=test npm test', 'set -e']) {
    assert.equal(evaluateToolEvent({ tool_name: 'shell', command }).allowed, true, command)
  }
  assert.equal(evaluateToolEvent({ tool_name: 'shell', command: 'env' }).allowed, false)
})

test('hook policy unwraps shell and command environment dump wrappers', () => {
  for (const command of ['command env', 'command printenv', 'exec env', '/bin/sh -c env', 'bash -lc printenv']) {
    assert.equal(evaluateToolEvent({ tool_name: 'shell', command }).reasonCode, 'raw-environment-dump', command)
  }
})

test('hook policy allows ordinary shell script invocations without -c', () => {
  for (const command of ['bash script.sh', 'sh ./script.sh', 'zsh -n script.zsh']) {
    assert.equal(evaluateToolEvent({ tool_name: 'shell', command }).allowed, true, command)
  }
})

test('hook policy scans every entry and nested value in its bounded event', () => {
  const wide = Object.fromEntries(Array.from({ length: 129 }, (_, index) => [`safe${index}`, 'ok']))
  wide.hidden = '.env'
  assert.equal(evaluateToolEvent({ tool_name: 'read_file', tool_input: wide }).reasonCode, 'secret-or-credential-read')
  assert.equal(evaluateToolEvent({ tool_name: 'read_file', tool_input: { a: { b: { c: { d: { e: '.globals' } } } } } }).reasonCode, 'secret-or-credential-read')
})

test('hook policy recognizes quoted secrets, quoted executables, recursive globs, and fd redirections', () => {
  const denied = [
    { tool_name: 'shell', command: 'cat ".env"' },
    { tool_name: 'shell', command: "cat '.globals'" },
    { tool_name: 'shell', command: "cat 'id_rsa'" },
    { tool_name: 'shell', command: '"/bin/rm" -rf /' },
    { tool_name: 'shell', command: "'rm' -rf './*'" },
    { tool_name: 'shell', cwd: '/repo', command: 'rm -rf ../outside' },
    { tool_name: 'shell', cwd: '/repo', command: 'rm -rf /tmp/outside' },
    { tool_name: 'shell', cwd: '/repo', command: 'rm -RF /' },
    { tool_name: 'shell', command: '"/usr/bin/git" reset --hard' },
    { tool_name: 'shell', command: "'git' checkout -- ." },
    { tool_name: 'shell', cwd: '/repo', command: 'echo x >> /outside' },
    { tool_name: 'shell', cwd: '/repo', command: 'echo x 2>> /outside' },
    { tool_name: 'shell', cwd: '/repo', command: 'echo x > "../outside"' },
    { tool_name: 'shell', cwd: '/repo', command: "echo x >> '../outside'" },
    { tool_name: 'shell', cwd: '/repo', command: 'archify deliver "../outside"' },
    { tool_name: 'shell', cwd: '/repo', command: 'echo x > "$HOME/out"' },
    { tool_name: 'shell', cwd: '/repo', command: 'echo x>../outside' },
    { tool_name: 'shell', cwd: '/repo', command: 'tool --output="../outside"' },
    { tool_name: 'apply_patch', cwd: '/repo', tool_input: { target: '../outside.patch' } },
    { tool_name: 'move_file', cwd: '/repo', tool_input: { destination: '../outside.txt' } },
  ]
  for (const input of denied) assert.equal(evaluateToolEvent(input).allowed, false, JSON.stringify(input))
  assert.equal(evaluateToolEvent({ tool_name: 'write_file', cwd: '/repo', tool_input: { path: 'src/../inside.txt' } }).allowed, true)
})

test('provider artifacts use documented boundaries', () => {
  assert.equal(claudeSettingsFragment().hooks.PreToolUse[0].hooks[0].type, 'command')
  assert.equal(claudeSettingsFragment().hooks.PreToolUse[0].matcher, undefined)
  assert.equal(claudeSettingsFragment().hooks.PreToolUse[0].hooks[0].timeout, 10)
  assert.equal(geminiSettingsFragment().hooks.BeforeTool[0].hooks[0].type, 'command')
  assert.equal(codexPermissionLayer().hooks.PreToolUse[0].hooks[0].type, 'command')
  assert.equal(codexPermissionLayer().hooks.PermissionRequest[0].hooks[0].type, 'command')
  assert.equal(nativeHookDecision('claude', { allowed: true, reason: 'x' }), undefined)
  assert.deepEqual(nativeHookDecision('claude', { allowed: false, reason: 'x' }), { hookSpecificOutput: { hookEventName: 'PreToolUse', permissionDecision: 'deny', permissionDecisionReason: 'x' } })
  assert.deepEqual(nativeHookDecision('codex', { allowed: false, reason: 'x' }, 'PermissionRequest'), { hookSpecificOutput: { hookEventName: 'PermissionRequest', decision: { behavior: 'deny', message: 'x' } } })
  assert.deepEqual(nativeHookDecision('gemini', { allowed: false, reason: 'x' }), { decision: 'deny', reason: 'x' })
  assert.match(opencodeV1PluginSource(), /tool\.execute\.before/)
  assert.doesNotMatch(opencodeV1PluginSource(), /ai-config\/src/)
  assert.equal(opencodeV1PermissionLayer().permission.external_directory, 'deny')
})

test('OpenCode V1 plugin evaluates the stable callback output arguments', async () => {
  await withPluginSource(opencodeV1PluginSource(), async (plugin) => {
    const callbacks = await plugin.AiConfigSecurity()
    const before = callbacks['tool.execute.before']
    // input.args is not part of OpenCode V1's actual before callback contract.
    await before({ tool: 'bash', args: { command: 'rm -rf /' } }, { args: { command: 'echo safe' } })
    await assert.rejects(
      () => before({ tool: 'bash' }, { args: { command: 'rm -rf /' } }),
      /broad-destructive-command/
    )
    await assert.rejects(
      () => before({ tool: 'write' }, { args: { path: '../outside.txt' } }),
      /path-outside-workspace/
    )
    await before({ tool: 'bash' }, { args: { command: 'env NODE_ENV=test npm test' } })
  })
})

test('OpenCode V1 plugin uses its trusted initialization root and matches core guard decisions', async () => {
  await withPluginSource(opencodeV1PluginSource(), async (plugin) => {
    const callbacks = await plugin.AiConfigSecurity({ directory: '/repo', worktree: '/repo' })
    const before = callbacks['tool.execute.before']
    await before({ tool: 'bash' }, { args: { command: 'echo safe > src/../out.txt', cwd: '/' } })
    for (const [tool, args, reason] of [
      ['bash', { command: 'echo x >> /outside' }, 'path-outside-workspace'],
      ['bash', { command: 'echo x 2>> /outside' }, 'path-outside-workspace'],
      ['bash', { command: 'echo x > "../outside"' }, 'path-outside-workspace'],
      ['bash', { command: 'echo x>../outside' }, 'path-outside-workspace'],
      ['bash', { command: 'tool --output="../outside"' }, 'path-outside-workspace'],
      ['bash', { command: '"/bin/rm" -rf /' }, 'broad-destructive-command'],
      ['bash', { command: 'rm -rf ../outside' }, 'broad-destructive-command'],
      ['bash', { command: 'rm -rf /tmp/outside' }, 'broad-destructive-command'],
      ['bash', { command: 'rm -RF /' }, 'broad-destructive-command'],
      ['bash', { command: 'cat ".env"' }, 'secret-or-credential-read'],
      ['apply_patch', { target: '../outside.patch' }, 'path-outside-workspace'],
    ]) {
      await assert.rejects(() => before({ tool }, { args }), new RegExp(reason))
    }
    for (const command of ['command env', 'command printenv', 'exec env', '/bin/sh -c env', 'bash -lc printenv']) {
      await assert.rejects(() => before({ tool: 'bash' }, { args: { command } }), /raw-environment-dump/, command)
    }
    for (const command of ['bash script.sh', 'sh ./script.sh', 'zsh -n script.zsh']) {
      await before({ tool: 'bash' }, { args: { command } })
    }
    const wide = Object.fromEntries(Array.from({ length: 129 }, (_, index) => [`safe${index}`, 'ok']))
    wide.hidden = '.env'
    await assert.rejects(() => before({ tool: 'read' }, { args: wide }), /secret-or-credential-read/)
    await assert.rejects(() => before({ tool: 'read' }, { args: { value: 'Ж'.repeat(40_000) } }), /malformed-or-oversized-input/)
  })
})
