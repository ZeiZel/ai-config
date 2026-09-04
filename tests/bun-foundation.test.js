import test from 'node:test'
import assert from 'node:assert/strict'
import { chmod, mkdtemp, writeFile } from 'node:fs/promises'
import { spawn } from 'node:child_process'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { resolve } from 'node:path'
import { BUN_FLAGS, assertBunRuntime, bunArgs, sanitizeBunEnv, trustedBunConfig } from '../src/runtime/bun.js'

test('Bun runtime contract is exact and returns a real executable', async () => {
  const runtime = await assertBunRuntime()
  assert.equal(runtime.version, '1.4.0')
  assert.equal(runtime.config, trustedBunConfig())
  assert.deepEqual(runtime.flags, BUN_FLAGS)
  assert.match(runtime.executable, /\/?bun(?:\.exe)?$/)
})

test('runtime assertion rejects an injected or wrong runtime', async () => {
  await assert.rejects(
    assertBunRuntime({ runtime: { versions: { bun: '1.3.14' }, execPath: process.execPath } }),
    /Bun 1\.4\.0 is required/
  )
})

test('Bun arguments use absolute trusted config and injection-safe flags', () => {
  const script = resolve('bin/ai-config-lifecycle.mjs')
  const args = bunArgs({ script, args: ['doctor'] })
  assert.deepEqual(args.slice(0, 2), ['--no-env-file', '--no-install'])
  assert.equal(args[2], `--config=${resolve(trustedBunConfig())}`)
  assert.deepEqual(args.slice(3), [script, 'doctor'])
})

test('bare or missing scripts are rejected', () => {
  assert.throws(() => bunArgs({ script: 'bin/ai-config-lifecycle.mjs' }), /absolute path/)
  assert.throws(() => bunArgs({ script: resolve('missing-script.mjs') }), /ENOENT/)
})

test('ambient runtime and package-manager configuration is stripped', () => {
  const clean = sanitizeBunEnv({ PATH: '/usr/bin', HOME: '/tmp/home', BUN_OPTIONS: '--preload evil', BUN_INSTALL_CACHE_DIR: '/tmp/cache', BUN_RUNTIME_TRANSPILER_CACHE_PATH: '/tmp/evil', NODE_OPTIONS: '--require evil', BUN_CONFIG_FILE: '/tmp/evil', npm_config_userconfig: '/tmp/evil', COREPACK_HOME: '/tmp/evil', SAFE: 'yes' })
  assert.deepEqual(clean, { PATH: '/usr/bin', HOME: '/tmp/home', SAFE: 'yes' })
})

test('Bun package scripts use the trusted PATH runtime despite hostile inherited metadata', async () => {
  const root = await mkdtemp(join(tmpdir(), 'ai-config-bun-runtime-'))
  const fake = join(root, 'bun')
  await writeFile(fake, '#!/bin/sh\nprintf FAKE-BUN >&2\nexit 91\n')
  await chmod(fake, 0o755)
  const result = await new Promise(resolvePromise => {
    const child = spawn(process.execPath, ['--no-env-file', '--no-install', '--config=./bunfig.toml', 'run', 'check'], {
      cwd: resolve('.'), env: { ...process.env, npm_execpath: '/usr/bin/false', PATH: `${resolve(process.execPath, '..')}:${root}:${process.env.PATH}` }, shell: false,
      stdio: ['ignore', 'pipe', 'pipe']
    })
    const stderr = []; child.stderr.on('data', chunk => stderr.push(chunk))
    child.once('close', code => resolvePromise({ code, stderr: Buffer.concat(stderr).toString() }))
  })
  assert.equal(result.code, 0, result.stderr)
  assert.doesNotMatch(result.stderr, /FAKE-BUN/)
})
