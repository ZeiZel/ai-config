import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, mkdir, writeFile, readFile, symlink, access, unlink, stat } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { render } from '../src/core/render.js'
import { safeOutput } from '../src/core/paths.js'
import { loadSpecs } from '../src/core/loader.js'

async function fixture() {
  const root = await mkdtemp(join(tmpdir(), 'ai-config-'))
  await mkdir(join(root, 'providers'), { recursive: true })
  await writeFile(join(root, 'providers', 'catalog.yaml'), 'schemaVersion: 1\nproviders:\n  claude: {skillDir: .claude/skills, instructionFile: CLAUDE.md}\n  codex: {skillDir: .agents/skills, instructionFile: AGENTS.md}\n  opencode: {skillDir: .opencode/skills, instructionFile: AGENTS.md}\n  gemini: {skillDir: .gemini/skills, instructionFile: GEMINI.md}\n')
  await mkdir(join(root, 'skills', 'beads'), { recursive: true })
  await writeFile(join(root, 'skills', 'beads', 'meta.yaml'), 'schemaVersion: 1\nid: beads\nname: Beads\ndescription: Durable task memory\nproviders: [claude, codex, opencode, gemini]\n')
  await writeFile(join(root, 'skills', 'beads', 'body.md'), '# Beads\n\nUse bd prime before work.\n')
  return root
}

test('renders deterministic output for all providers', async () => {
  const specs = await fixture(); const out = join(specs, 'generated')
  const first = await render({ specsDir: specs, outDir: out }); const before = await readFile(join(out, '.claude/skills/beads/SKILL.md'), 'utf8')
  await render({ specsDir: specs, outDir: out }); const after = await readFile(join(out, '.claude/skills/beads/SKILL.md'), 'utf8')
  assert.equal(first.files.length, 4); assert.equal(before, after); await render({ specsDir: specs, outDir: out, check: true })
})

test('check rejects stale and orphan generated files', async () => {
  const specs = await fixture(); const out = join(specs, 'generated'); await render({ specsDir: specs, outDir: out })
  await writeFile(join(out, '.claude/skills/beads/SKILL.md'), 'stale\n')
  await assert.rejects(() => render({ specsDir: specs, outDir: out, check: true }), /stale generated file/)
  await unlink(join(out, '.claude/skills/beads/SKILL.md')); await render({ specsDir: specs, outDir: out }); await mkdir(join(out, '.codex/skills/old'), { recursive: true }); await writeFile(join(out, '.codex/skills/old/SKILL.md'), 'orphan\n')
  await assert.rejects(() => render({ specsDir: specs, outDir: out, check: true }), /orphan generated file/)
})

test('rejects output path traversal', () => assert.throws(() => safeOutput('/tmp/generated', '../outside'), /path traversal/))

test('validates duplicate providers independently', async () => {
  const specs = await fixture()
  await writeFile(join(specs, 'skills', 'beads', 'meta.yaml'), 'schemaVersion: 1\nid: beads\nname: Beads\ndescription: Durable task memory\nproviders: [claude, claude]\n')
  await assert.rejects(() => loadSpecs(specs), /uniqueItems|providers/)
})

test('validates empty providers independently', async () => {
  const specs = await fixture()
  await writeFile(join(specs, 'skills', 'beads', 'meta.yaml'), 'schemaVersion: 1\nid: beads\nname: Beads\ndescription: Durable task memory\nproviders: []\n')
  await assert.rejects(() => loadSpecs(specs), /minItems|providers/)
})

test('rejects symlink ancestors before writing', async () => {
  const specs = await fixture(); const out = join(specs, 'generated'); await mkdir(out)
  const outside = await mkdtemp(join(tmpdir(), 'ai-config-outside-'))
  await symlink(outside, join(out, '.claude'))
  await assert.rejects(() => render({ specsDir: specs, outDir: out }), /symlink ancestor/)
  await assert.rejects(() => access(join(outside, 'skills', 'beads', 'SKILL.md')))
})

test('rejects symlinked final skill and manifest targets without touching sentinels', async () => {
  const specs = await fixture(); const out = join(specs, 'generated'); await mkdir(join(out, '.claude/skills/beads'), { recursive: true })
  const outside = await mkdtemp(join(tmpdir(), 'ai-config-sentinel-')); const sentinel = join(outside, 'sentinel'); await writeFile(sentinel, 'keep\n')
  await symlink(sentinel, join(out, '.claude/skills/beads/SKILL.md'))
  await assert.rejects(() => render({ specsDir: specs, outDir: out }), /symlink output target/)
  assert.equal(await readFile(sentinel, 'utf8'), 'keep\n')

  const manifestOut = join(specs, 'manifest-generated'); await mkdir(manifestOut); await symlink(sentinel, join(manifestOut, 'manifest.json'))
  await assert.rejects(() => render({ specsDir: specs, outDir: manifestOut }), /symlink output target/)
  assert.equal(await readFile(sentinel, 'utf8'), 'keep\n')
})

test('rejects symlink escapes hidden behind a missing output subtree', async () => {
  const specs = await fixture(); const container = await mkdtemp(join(tmpdir(), 'ai-config-chain-')); const outside = await mkdtemp(join(tmpdir(), 'ai-config-chain-outside-'))
  await mkdir(join(outside, 'nested', 'generated'), { recursive: true }); await symlink(outside, join(container, 'link'))
  const out = join(container, 'link', 'nested', 'generated')
  await assert.rejects(() => render({ specsDir: specs, outDir: out }), /symlink ancestor/)
  await assert.rejects(() => access(join(outside, 'nested', 'generated', 'manifest.json')))
})

test('clean removes managed files and manifest, but preserves modified and unknown files', async () => {
  const specs = await fixture(); const out = join(specs, 'generated'); await render({ specsDir: specs, outDir: out })
  const managed = join(out, '.claude/skills/beads/SKILL.md'); const modified = join(out, '.agents/skills/beads/SKILL.md')
  await writeFile(modified, 'user edit\n'); await mkdir(join(out, '.claude/skills/user-owned'), { recursive: true }); await writeFile(join(out, '.claude/skills/user-owned/note'), 'keep\n')
  await render({ specsDir: specs, outDir: out, clean: true })
  await assert.rejects(() => access(managed))
  assert.equal(await readFile(modified, 'utf8'), 'user edit\n'); assert.equal(await readFile(join(out, '.claude/skills/user-owned/note'), 'utf8'), 'keep\n')
  await assert.rejects(() => access(join(out, 'manifest.json')))
})

test('rejects dependency cycles and self-requirements', async () => {
  const specs = await fixture(); const meta = join(specs, 'skills/beads/meta.yaml')
  await writeFile(meta, 'schemaVersion: 1\nid: beads\nname: Beads\ndescription: Durable task memory\nproviders: [claude, codex, opencode, gemini]\nrequires: [beads]\n')
  await assert.rejects(() => loadSpecs(specs), /self|cycle|requirement/)
})

test('rejects symlinked spec inputs before reading them', async () => {
  const specs = await fixture(); const outside = await mkdtemp(join(tmpdir(), 'ai-config-spec-outside-'))
  await unlink(join(specs, 'skills/beads/body.md')); await symlink(join(outside, 'body.md'), join(specs, 'skills/beads/body.md'))
  await assert.rejects(() => loadSpecs(specs), /symlink in spec input/)
  const providers = join(specs, 'providers'); const realCatalog = join(providers, 'catalog.yaml'); const moved = join(outside, 'catalog.yaml')
  await unlink(realCatalog); await writeFile(moved, 'schemaVersion: 1\nproviders: {}\n'); await symlink(moved, realCatalog)
  await assert.rejects(() => loadSpecs(specs), /symlink in spec input/)
})

test('does not overwrite an unmanaged desired output', async () => {
  const specs = await fixture(); const out = join(specs, 'generated'); await mkdir(join(out, '.claude/skills/beads'), { recursive: true })
  const target = join(out, '.claude/skills/beads/SKILL.md'); await writeFile(target, 'user-owned\n')
  await assert.rejects(() => render({ specsDir: specs, outDir: out }), /unmanaged output conflict/)
  assert.equal(await readFile(target, 'utf8'), 'user-owned\n')
})

test('does not overwrite a locally modified managed output', async () => {
  const specs = await fixture(); const out = join(specs, 'generated'); await render({ specsDir: specs, outDir: out })
  const target = join(out, '.claude/skills/beads/SKILL.md'); await writeFile(target, 'local change\n')
  await assert.rejects(() => render({ specsDir: specs, outDir: out }), /locally modified generated file/)
  assert.equal(await readFile(target, 'utf8'), 'local change\n')
})

test('rejects malformed manifest entries before mutation', async () => {
  const specs = await fixture(); const out = join(specs, 'generated'); await mkdir(out)
  await writeFile(join(out, 'manifest.json'), JSON.stringify({ schemaVersion: 1, files: [{ path: '../outside', sha256: '0'.repeat(64) }] }))
  await assert.rejects(() => render({ specsDir: specs, outDir: out }), /path traversal|invalid generated manifest/)
  await writeFile(join(out, 'manifest.json'), JSON.stringify({ schemaVersion: 1, files: [{ path: 'a/../b', sha256: '0'.repeat(64) }] }))
  await assert.rejects(() => render({ specsDir: specs, outDir: out }), /invalid generated manifest/)
})

test('render and clean rollback completely after injected mid-transaction failure', async () => {
  const specs = await fixture(); const out = join(specs, 'generated'); await render({ specsDir: specs, outDir: out })
  const target = join(out, '.claude/skills/beads/SKILL.md'); await chmodForTest(target, 0o640)
  const before = await readFile(target); const beforeMode = (await stat(target)).mode
  await assert.rejects(() => render({ specsDir: specs, outDir: out, faultAfter: 2 }), /injected generator failure/)
  assert.deepEqual(await readFile(target), before); assert.equal((await stat(target)).mode, beforeMode)
  await assert.rejects(() => render({ specsDir: specs, outDir: out, clean: true, faultAfter: 1 }), /injected generator failure/)
  assert.deepEqual(await readFile(target), before); assert.equal((await stat(target)).mode, beforeMode)
})

async function chmodForTest(path, mode) { const { chmod } = await import('node:fs/promises'); await chmod(path, mode) }
