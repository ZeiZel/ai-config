import test from 'node:test'
import assert from 'node:assert/strict'
import { cp, lstat, mkdir, mkdtemp, readFile, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { c as createTar } from 'tar'
import { stageExternalSkills } from '../src/install/external.js'
import { loadExternalSources } from '../src/install/external.js'
import { sha256 } from '../src/security-guard/index.js'

const temp = () => mkdtemp(join(tmpdir(), 'ai-config-curated-external-'))
const specsDir = join(resolve(dirname(fileURLToPath(import.meta.url)), '..'), 'ai-specs')

function streamResponse(bytes) {
  return { ok: true, body: new ReadableStream({ start(controller) { controller.enqueue(bytes); controller.close() } }) }
}

async function archiveFrom(root, entries, file = join(root, 'fixture.tar.gz')) {
  await createTar({ gzip: true, file, cwd: root }, entries)
  return readFile(file)
}

function source({ id = 'fixture', archive, selectedSkills = ['fixture'], skillPath = '', archiveLayout = 'flat', ...rest } = {}) {
  return {
    id, repository: 'https://example.test/source', resolvedCommit: 'a'.repeat(40), archive: 'https://example.test/source.tar.gz',
    sha256: sha256(archive), selectedSkills, skillPath, archiveLayout, license: 'MIT', review: 'fixture-review', approvalRequired: false, risk: 'low', ...rest
  }
}

async function stage({ source: selectedSource, runner, approvedSourceIds = [] }) {
  const wrappedRunner = async (command, args, options) => {
    if (args.includes('install')) {
      await cp(join(resolve(dirname(fileURLToPath(import.meta.url)), '..'), 'node_modules'), join(options.cwd, 'node_modules'), { recursive: true, verbatimSymlinks: true })
      return { code: 0, stdout: '' }
    }
    return runner(command, args, options)
  }
  return stageExternalSkills({
    sources: [selectedSource], providers: ['codex'], runtimeEnv: { PATH: process.env.PATH, HOME: await temp() }, cacheRoot: await temp(),
    approvedSourceIds, runner: wrappedRunner,
    fetchImpl: async () => streamResponse(selectedSource.__archive)
  })
}

test('flat archive accepts one selected skill and passes only its requested --skill value', async () => {
  const root = await temp(); await writeFile(join(root, 'SKILL.md'), '# flat fixture\n'); await mkdir(join(root, 'rules')); await writeFile(join(root, 'rules/a.md'), 'rule\n')
  const archive = await archiveFrom(root, ['SKILL.md', 'rules'])
  const selectedSource = source({ id: 'flat-fixture', archive, selectedSkills: ['flat-fixture'] }); selectedSource.__archive = archive
  const calls = []
  const staged = await stage({ source: selectedSource, runner: async (_command, args, { cwd }) => {
    calls.push(args); await mkdir(join(cwd, '.agents/skills/flat-fixture'), { recursive: true }); await writeFile(join(cwd, '.agents/skills/flat-fixture/SKILL.md'), '# installed\n')
  } })
  assert.deepEqual(calls[0].slice(calls[0].indexOf('--skill') + 1, calls[0].indexOf('--copy')), ['flat-fixture'])
  assert.deepEqual(staged.files.map(file => file.path), ['.agents/skills/flat-fixture/SKILL.md'])
})

test('subtree extraction exposes only selected roots and ignores links outside them', async () => {
  const root = await temp(); await mkdir(join(root, 'tree/skills/selected'), { recursive: true }); await writeFile(join(root, 'tree/skills/selected/SKILL.md'), '# selected\n')
  await mkdir(join(root, 'tree/skills/unselected'), { recursive: true }); await writeFile(join(root, 'tree/skills/unselected/SKILL.md'), '# unselected\n')
  await symlink('/outside-must-not-be-extracted', join(root, 'tree/unselected-link'))
  const archive = await archiveFrom(root, ['tree'])
  const selectedSource = source({ id: 'subtree-fixture', archive, selectedSkills: ['selected'], skillPath: 'skills', archiveLayout: 'subtree' }); selectedSource.__archive = archive
  await stage({ source: selectedSource, runner: async (_command, args, { cwd }) => {
    const localSource = args[args.indexOf('add') + 1]
    assert.equal((await lstat(join(localSource, 'selected/SKILL.md'))).isFile(), true)
    await assert.rejects(() => lstat(join(localSource, 'unselected/SKILL.md')), error => error.code === 'ENOENT')
    await assert.rejects(() => lstat(join(localSource, '../unselected-link')), error => error.code === 'ENOENT')
    await mkdir(join(cwd, '.agents/skills/selected'), { recursive: true }); await writeFile(join(cwd, '.agents/skills/selected/SKILL.md'), '# installed\n')
  } })
})

test('subtree skillPath may itself be a single skill root', async () => {
  const root = await temp(); await mkdir(join(root, 'tree/archify'), { recursive: true }); await writeFile(join(root, 'tree/archify/SKILL.md'), '# archify\n')
  const archive = await archiveFrom(root, ['tree'])
  const selectedSource = source({ id: 'single-root-fixture', archive, skillPath: 'archify', archiveLayout: 'subtree' }); delete selectedSource.selectedSkills; selectedSource.__archive = archive
  const calls = []
  const staged = await stage({ source: selectedSource, runner: async (_command, args, { cwd }) => {
    calls.push(args)
    assert.equal(args.includes('--skill'), false)
    await mkdir(join(cwd, '.agents/skills/archify'), { recursive: true }); await writeFile(join(cwd, '.agents/skills/archify/SKILL.md'), '# installed\n')
  } })
  assert.equal(calls.length, 1)
  assert.deepEqual(staged.files.map(file => file.path), ['.agents/skills/archify/SKILL.md'])
})

test('a link in selected subtree aborts before the runner and selected identifiers are strict', async () => {
  const root = await temp(); await mkdir(join(root, 'tree/skills/selected'), { recursive: true }); await writeFile(join(root, 'tree/skills/selected/SKILL.md'), '# selected\n')
  await symlink('/outside-must-not-be-read', join(root, 'tree/skills/selected/link'))
  const archive = await archiveFrom(root, ['tree'])
  const selectedSource = source({ id: 'linked-fixture', archive, selectedSkills: ['selected'], skillPath: 'skills', archiveLayout: 'subtree' }); selectedSource.__archive = archive
  let calls = 0
  await assert.rejects(() => stage({ source: selectedSource, runner: async () => { calls += 1 } }), /subtree contains a forbidden SymbolicLink entry/)
  assert.equal(calls, 0)
  await assert.rejects(() => stage({ source: { ...selectedSource, selectedSkills: ['selected', 'selected'] }, runner: async () => {} }), /invalid selectedSkills/)
})

test('selected source rejects missing or unexpected attributed skill output', async () => {
  const root = await temp(); await writeFile(join(root, 'SKILL.md'), '# flat fixture\n')
  const archive = await archiveFrom(root, ['SKILL.md'])
  const selectedSource = source({ id: 'attribution-fixture', archive, selectedSkills: ['attribution-fixture'] }); selectedSource.__archive = archive
  await assert.rejects(() => stage({ source: selectedSource, runner: async (_command, _args, { cwd }) => {
    await mkdir(join(cwd, '.agents/skills/unexpected'), { recursive: true }); await writeFile(join(cwd, '.agents/skills/unexpected/SKILL.md'), '# unexpected\n')
  } }), /did not produce requested skill/)
  await assert.rejects(() => stage({ source: selectedSource, runner: async (_command, _args, { cwd }) => {
    for (const skill of ['attribution-fixture', 'unexpected']) { await mkdir(join(cwd, `.agents/skills/${skill}`), { recursive: true }); await writeFile(join(cwd, `.agents/skills/${skill}/SKILL.md`), '# installed\n') }
  } }), /unexpected attributed output/)
})

test('Unity-style license evidence is hash-verified and emitted as a managed artifact', async () => {
  const root = await temp(); const notice = 'Unity Companion License 1.4\n'
  await mkdir(join(root, 'tree/skills/unity-cli'), { recursive: true }); await mkdir(join(root, 'tree/skills/unity-package-management'), { recursive: true }); await mkdir(join(root, 'tree/skills/new-unity-project'), { recursive: true })
  await writeFile(join(root, 'tree/LICENSE.md'), notice)
  for (const skill of ['unity-cli', 'unity-package-management', 'new-unity-project']) await writeFile(join(root, `tree/skills/${skill}/SKILL.md`), `# ${skill}\n`)
  const archive = await archiveFrom(root, ['tree'])
  const selectedSource = source({
    id: 'unity-fixture', archive, selectedSkills: ['unity-cli', 'unity-package-management', 'new-unity-project'], skillPath: 'skills', archiveLayout: 'subtree', approvalRequired: true, risk: 'high',
    licenseEvidence: { path: 'LICENSE.md', sha256: sha256(notice), provenance: 'https://example.test/LICENSE.md', artifactPath: '.ai-config/licenses/unity-companion-license-1.4.md' }
  }); selectedSource.__archive = archive
  const staged = await stage({ source: selectedSource, approvedSourceIds: ['unity-fixture'], runner: async (_command, _args, { cwd }) => {
    for (const skill of selectedSource.selectedSkills) { await mkdir(join(cwd, `.agents/skills/${skill}`), { recursive: true }); await writeFile(join(cwd, `.agents/skills/${skill}/SKILL.md`), `# ${skill}\n`) }
  } })
  assert.equal(staged.files.find(file => file.path === '.ai-config/licenses/unity-companion-license-1.4.md').content.toString(), notice)
})

test('curated records lock the two Vercel release assets and require exact Unity approval', async () => {
  const frontend = await loadExternalSources({ specsDir, selectedIds: ['frontend-react-best-practices', 'frontend-composition-patterns'] })
  assert.deepEqual(frontend.map(item => [item.archiveLayout, item.sha256, item.selectedSkills]), [
    ['flat', '551e671112c393bec0b4a8551badb9bf3f63187e57a901a4e1b6b932bdffe995', ['vercel-react-best-practices']],
    ['flat', '0af47b94aa0ff20a60a1629cfb6b29db3ab47dfa781873ef08193a2da57932c7', ['vercel-composition-patterns']]
  ])
  await assert.rejects(() => loadExternalSources({ specsDir, selectedIds: ['unity-curated'] }), /requires explicit approval/)
  const [unity] = await loadExternalSources({ specsDir, selectedIds: ['unity-curated'], approvedSourceIds: ['unity-curated'] })
  assert.deepEqual(unity.selectedSkills, ['unity-cli', 'unity-package-management', 'new-unity-project'])
  assert.equal(unity.licenseEvidence.artifactPath, '.ai-config/licenses/unity-companion-license-1.4.md')
})
