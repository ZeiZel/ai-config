import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdir, readdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  buildSpecKitCommand,
  buildSpecKitIntegrationCommand,
  stageSpecKitIntegrations,
  SPEC_KIT_SOURCE,
  SUPPORTED_INTEGRATIONS
} from '../src/init/index.js'

const temp = () => import('node:fs/promises').then(({ mkdtemp }) => mkdtemp(join(tmpdir(), 'ai-config-speckit-test-')))

function fakeSpecKitRunner(calls, { failOn } = {}) {
  return async (command, args, { cwd }) => {
    calls.push({ command, args: [...args], cwd })
    if (failOn && calls.length === failOn) throw new Error('pinned Spec Kit failed')
    const provider = args.includes('--integration')
      ? args[args.indexOf('--integration') + 1]
      : args[args.indexOf('install') + 1]
    await mkdir(join(cwd, '.specify'), { recursive: true })
    await writeFile(join(cwd, '.specify', 'manifest.json'), '{"version":1}\n')
    for (const name of ['constitution', 'specify', 'clarify', 'plan', 'tasks', 'analyze', 'checklist', 'implement', 'taskstoissues', 'constitution-update']) {
      if (provider === 'claude' || provider === 'codex') {
        const providerHome = provider === 'claude' ? '.claude' : '.agents'
        const path = join(cwd, providerHome, 'skills', `speckit-${name}`, 'SKILL.md')
        await mkdir(join(cwd, providerHome, 'skills', `speckit-${name}`), { recursive: true })
        await writeFile(path, `${provider}:${name}\n`)
      } else {
        const extension = provider === 'gemini' ? 'toml' : 'md'
        const path = join(cwd, `.${provider}`, 'commands', `speckit.${name}.${extension}`)
        await mkdir(join(cwd, `.${provider}`, 'commands'), { recursive: true })
        await writeFile(path, `${provider}:${name}\n`)
      }
    }
    return { code: 0, stdout: '' }
  }
}

test('Spec Kit command builders use the pinned source and documented flags', () => {
  assert.deepEqual(buildSpecKitCommand('claude'), {
    command: 'uvx',
    args: ['--from', SPEC_KIT_SOURCE, 'specify', 'init', '--here', '--integration', 'claude', '--non-interactive', '--ignore-agent-tools']
  })
  assert.deepEqual(buildSpecKitIntegrationCommand('codex'), {
    command: 'uvx',
    args: ['--from', SPEC_KIT_SOURCE, 'specify', 'integration', 'install', 'codex', '--force']
  })
})

test('single-provider Spec Kit staging invokes exactly one init', async () => {
  const parent = await temp(); const calls = []
  const staged = await stageSpecKitIntegrations({ integrations: ['codex'], runtimeEnv: { PATH: '/bin' }, runner: fakeSpecKitRunner(calls), stagingParent: parent })
  try {
    assert.equal(calls.length, 1)
    assert.deepEqual(calls[0].args.slice(2, 7), ['specify', 'init', '--here', '--integration', 'codex'])
    assert.equal(staged.commands.length, 1)
    assert.equal(staged.files.some(file => file.path === '.agents/skills/speckit-specify/SKILL.md'), true)
    assert.equal(staged.files.some(file => file.path === '.claude/skills/speckit-specify/SKILL.md'), false)
  } finally { await rm(staged.stageRoot, { recursive: true, force: true }) }
})

test('all providers initialize once, then install each remaining integration', async () => {
  const parent = await temp(); const calls = []
  const staged = await stageSpecKitIntegrations({ integrations: SUPPORTED_INTEGRATIONS, runtimeEnv: { PATH: '/bin' }, runner: fakeSpecKitRunner(calls), stagingParent: parent })
  try {
    assert.equal(calls.length, 4)
    assert.deepEqual(calls.map(call => call.args.slice(2, 5)), [
      ['specify', 'init', '--here'],
      ['specify', 'integration', 'install'],
      ['specify', 'integration', 'install'],
      ['specify', 'integration', 'install']
    ])
    assert.deepEqual(calls.map(call => call.args.includes('--integration')
      ? call.args[call.args.indexOf('--integration') + 1]
      : call.args[call.args.indexOf('install') + 1]), ['claude', 'codex', 'gemini', 'opencode'])
    assert.deepEqual(calls.slice(1).map(call => call.args.at(-1)), ['--force', '--force', '--force'])
    assert.equal(staged.files.filter(file => file.path.startsWith('.claude/skills/speckit-')).length, 10)
    assert.equal(staged.files.filter(file => file.path.startsWith('.agents/skills/speckit-')).length, 10)
    assert.equal(staged.files.filter(file => file.path.startsWith('.gemini/commands/speckit.')).length, 10)
    assert.equal(staged.files.filter(file => file.path.startsWith('.opencode/commands/speckit.')).length, 10)
    assert.equal(staged.files.length, 41) // 40 provider artifacts plus .specify/manifest.json
    assert.equal(staged.files.some(file => file.path === '.claude/skills/speckit-specify/SKILL.md'), true)
    assert.equal(staged.files.some(file => file.path === '.agents/skills/speckit-specify/SKILL.md'), true)
    assert.equal(staged.files.some(file => file.path === '.gemini/commands/speckit.specify.toml'), true)
    assert.equal(staged.files.some(file => file.path === '.opencode/commands/speckit.specify.md'), true)
  } finally { await rm(staged.stageRoot, { recursive: true, force: true }) }
})

test('Spec Kit failure propagates and removes the disposable staging root', async () => {
  const parent = await temp(); const calls = []
  await assert.rejects(async () => {
    try {
      await stageSpecKitIntegrations({ integrations: ['claude', 'codex'], runtimeEnv: { PATH: '/bin' }, runner: fakeSpecKitRunner(calls, { failOn: 2 }), stagingParent: parent })
    } catch (error) {
      // The implementation owns cleanup; no partially staged tree is returned.
      assert.equal(error.message, 'pinned Spec Kit failed')
      throw error
    }
  }, /pinned Spec Kit failed/)
  assert.equal(calls.length, 2)
  assert.deepEqual(await readdir(parent), [])
})
