import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { installGlobal, GLOBAL_STATE_PATH, GLOBAL_WRAPPER_PATH, mapGlobalExternalFiles } from '../src/bootstrap/global.js'

const temp = () => mkdtemp(join(tmpdir(), 'ai-config-global-test-'))

test('global bootstrap dry-run is provider/profile aware and uses isolated state', async () => {
  const home = await temp()
  const result = await installGlobal({
    targetRoot: home,
    sourceRoot: resolve('.'),
    specsDir: resolve('ai-specs'),
    generatedRoot: resolve('generated'),
    providers: ['codex'],
    profileIds: ['base'],
    dryRun: true,
    runtimeEnv: { PATH: '/bin' }
  })
  assert.equal(result.operation, 'global-install')
  assert.equal(result.dryRun, true)
  assert.deepEqual(result.providers, ['codex'])
  assert.equal(result.plan.statePath, GLOBAL_STATE_PATH)
  assert.deepEqual(result.external, { sourceIds: ['superpowers-core'], status: 'not-yet-materialized-in-dry-run' })
  assert.equal(JSON.stringify(result).includes('SKILL.md'), true)
})

test('global bootstrap installs wrapper and does not use legacy checkout state', async () => {
  const home = await temp()
  const result = await installGlobal({
    targetRoot: home,
    sourceRoot: resolve('.'),
    specsDir: resolve('ai-specs'),
    generatedRoot: resolve('generated'),
    providers: ['codex'],
    profileIds: ['base'],
    includeExternal: false,
    dryRun: true
  })
  assert.equal(result.plan.statePath, GLOBAL_STATE_PATH)
  assert.equal(result.plan.changes.some(change => change.path === GLOBAL_WRAPPER_PATH), true)
  assert.equal(result.plan.changes.some(change => change.path === '.ai-config/state.json'), false)
  await mkdir(join(home, '.ai-config', 'generated'), { recursive: true })
  await writeFile(join(home, '.ai-config', 'package.json'), '{}')
  await writeFile(join(home, '.ai-config', 'generated', 'manifest.json'), '{}')
  await assert.rejects(() => installGlobal({
    targetRoot: home,
    sourceRoot: resolve('.'),
    specsDir: resolve('ai-specs'),
    generatedRoot: resolve('generated'),
    providers: ['codex'],
    profileIds: ['base'],
    dryRun: true
  }), /legacy|directory/)
  assert.equal(await readFile(join(home, '.ai-config', 'package.json'), 'utf8'), '{}')
})

test('global runtime boundary never embeds credential-bearing proxy variables', async () => {
  const home = await temp()
  const result = await installGlobal({
    targetRoot: home, sourceRoot: resolve('.'), specsDir: resolve('ai-specs'), generatedRoot: resolve('generated'),
    providers: ['codex'], profileIds: ['base'], includeExternal: false
  })
  assert.equal(result.operation, 'global-install')
  const wrapper = await readFile(join(home, GLOBAL_WRAPPER_PATH), 'utf8')
  assert.equal(wrapper.includes('HTTP_PROXY'), false)
  assert.equal(wrapper.includes('HTTPS_PROXY'), false)
  assert.equal(wrapper.includes('NO_PROXY'), false)
  assert.equal(wrapper.includes('env -i'), true)
})

test('global bootstrap rejects a legacy source checkout even when it is the declared source root', async () => {
  const home = await temp()
  const legacy = join(home, '.ai-config')
  await mkdir(join(legacy, 'generated'), { recursive: true })
  await writeFile(join(legacy, 'package.json'), '{}')
  await writeFile(join(legacy, 'generated', 'manifest.json'), '{}')
  await assert.rejects(() => installGlobal({
    targetRoot: home,
    sourceRoot: legacy,
    specsDir: resolve('ai-specs'),
    generatedRoot: resolve('generated'),
    providers: ['codex'],
    profileIds: ['base'],
    dryRun: true
  }), /legacy/)
})

test('changing global providers removes only stale hash-managed selection paths', async () => {
  const home = await temp()
  await installGlobal({
    targetRoot: home, sourceRoot: resolve('.'), specsDir: resolve('ai-specs'), generatedRoot: resolve('generated'),
    providers: ['codex'], profileIds: ['base'], includeExternal: false
  })
  const switched = await installGlobal({
    targetRoot: home, sourceRoot: resolve('.'), specsDir: resolve('ai-specs'), generatedRoot: resolve('generated'),
    providers: ['claude'], profileIds: ['base'], includeExternal: false, dryRun: true
  })
  assert.equal(switched.plan.changes.some(change => change.path.startsWith('.agents/skills/') && change.action === 'remove'), true)
  await installGlobal({
    targetRoot: home, sourceRoot: resolve('.'), specsDir: resolve('ai-specs'), generatedRoot: resolve('generated'),
    providers: ['claude'], profileIds: ['base'], includeExternal: false
  })
  await assert.rejects(() => readFile(join(home, '.agents/skills/beads/SKILL.md')), error => error.code === 'ENOENT')
})

test('global external license artifacts cannot recreate the legacy .ai-config namespace', () => {
  const files = mapGlobalExternalFiles([
    { path: '.ai-config/licenses/unity-companion-license-1.4.md', content: 'license\n' },
    { path: '.agents/skills/unity-cli/SKILL.md', content: '# Unity\n' }
  ])
  assert.deepEqual(files.map(file => file.path), [
    '.local/state/ai-config/licenses/unity-companion-license-1.4.md',
    '.agents/skills/unity-cli/SKILL.md'
  ])
})
