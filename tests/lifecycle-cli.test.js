import test from 'node:test'
import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { sha256 } from '../src/security-guard/index.js'

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const cli = join(repoRoot, 'bin/ai-config-lifecycle.mjs')
const temp = () => mkdtemp(join(tmpdir(), 'ai-config-cli-test-'))

function run(args, { cwd, env, input } = {}) {
  return new Promise((resolvePromise, reject) => {
    const child = spawn(process.execPath, [cli, ...args], {
      cwd: cwd || repoRoot, env: env || process.env, shell: false, stdio: [input === undefined ? 'ignore' : 'pipe', 'pipe', 'pipe']
    })
    const stdout = []; const stderr = []
    child.stdout.on('data', chunk => stdout.push(chunk)); child.stderr.on('data', chunk => stderr.push(chunk))
    child.once('error', reject)
    child.once('close', code => resolvePromise({ code, stdout: Buffer.concat(stdout).toString(), stderr: Buffer.concat(stderr).toString() }))
    if (input !== undefined) child.stdin.end(input)
  })
}

async function writeState(root, path, content, statePath = '.ai-config/state.json') {
  await mkdir(dirname(join(root, statePath)), { recursive: true })
  await writeFile(join(root, path), content)
  await writeFile(join(root, statePath), `${JSON.stringify({ schemaVersion: 1, files: { [path]: { sha256: sha256(content) } } })}\n`)
}

test('doctor and uninstall-managed stay project-local unless --global is explicit', async () => {
  const project = await temp(); const home = await temp()
  await writeState(project, 'managed.txt', 'project-owned\n')
  await mkdir(join(home, '.local/state/ai-config'), { recursive: true })
  await writeFile(join(home, '.local/state/ai-config/state.json'), '{not-json\n')
  const env = { ...process.env, HOME: home }

  const doctor = await run(['doctor'], { cwd: project, env })
  assert.equal(doctor.code, 0, doctor.stderr)
  assert.equal(JSON.parse(doctor.stdout).healthy, true)

  const preview = await run(['uninstall-managed', '--target', project, '--dry-run'], { cwd: project, env })
  assert.equal(preview.code, 0, preview.stderr)
  assert.equal(JSON.parse(preview.stdout).changes[0].path, 'managed.txt')

  const globalDoctor = await run(['doctor', '--global'], { cwd: project, env })
  assert.equal(globalDoctor.code, 4)
  assert.match(JSON.parse(globalDoctor.stdout).checks[0].message, /JSON|property/i)
})

test('global state is selected only with --global and state paths remain target-relative', async () => {
  const root = await temp()
  const absoluteState = await run(['doctor', '--target', root, '--state', join(root, 'state.json')])
  assert.equal(absoluteState.code, 4)
  assert.match(JSON.parse(absoluteState.stdout).checks[0].message, /absolute|relative|outside/i)

  const invalidCombination = await run(['doctor', '--global', '--state', '.ai-config/state.json'], { env: { ...process.env, HOME: root } })
  assert.equal(invalidCombination.code, 1)
  assert.match(invalidCombination.stderr, /cannot be combined/)
})

test('guard is a lifecycle command without changing project-local hook selection', async () => {
  const result = await run(['guard', '--provider', 'codex'])
  assert.equal(result.code, 0, result.stderr)
  assert.equal(JSON.parse(result.stdout).hookSpecificOutput.hookEventName, 'PreToolUse')
})

test('lifecycle guard bounds streamed stdin and fails closed', async () => {
  const result = await run(['guard', '--provider', 'codex'], { input: Buffer.alloc(64 * 1024 + 1, 'x') })
  assert.equal(result.code, 0, result.stderr)
  assert.match(result.stdout, /malformed-or-oversized-input/)
})

test('init forwards explicit external approval for the Unity profile', async () => {
  const project = await temp(); await mkdir(join(project, '.git'))
  const result = await run([
    'init', '--target', project, '--providers', 'codex', '--profiles', 'unity',
    '--approve-external', 'unity-curated', '--no-mcp', '--no-spec-kit', '--no-beads', '--dry-run'
  ])
  assert.equal(result.code, 0, result.stderr)
  const output = JSON.parse(result.stdout)
  assert.deepEqual(output.external.sourceIds, ['superpowers-core', 'unity-curated'])
})

test('CLI help makes project targets explicit for project-scoped lifecycle commands', async () => {
  const result = await run(['--help'])
  assert.equal(result.code, 0, result.stderr)
  assert.match(result.stdout, /init --target <project>/)
  assert.match(result.stdout, /repair --target <project>/)
  assert.match(result.stdout, /uninstall-managed --target <project>/)
})
