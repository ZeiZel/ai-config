import { lstatSync, realpathSync } from 'node:fs'
import { realpath } from 'node:fs/promises'
import { isAbsolute, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

// Bun 1.4.0 Darwin arm64 bootstrap asset:
// https://github.com/oven-sh/bun/releases/download/bun-v1.4.0/bun-darwin-aarch64.zip
// SHA-256: c669e97f6164e1c96e0701748db98dfa77492908cbd8394c7557134a735de381
export const BUN_VERSION = '1.4.0'
export const BUN_FLAGS = Object.freeze(['--no-env-file', '--no-install'])
const SOURCE_ROOT = resolve(fileURLToPath(new URL('../../', import.meta.url)))
const INJECTION_KEYS = /^(?:BUN_|NODE_OPTIONS|NODE_PATH|npm_config_|NPM_CONFIG_|COREPACK_|DENO_)/i

export function sanitizeBunEnv(environment = process.env, { install = false, cacheDir } = {}) {
  const clean = Object.fromEntries(Object.entries(environment).filter(([key]) => !INJECTION_KEYS.test(key)))
  if (install && typeof cacheDir === 'string' && isAbsolute(cacheDir)) clean.BUN_INSTALL_CACHE_DIR = cacheDir
  return clean
}

export function trustedBunConfig(sourceRoot = SOURCE_ROOT) {
  const root = realpathSync(resolve(sourceRoot))
  const config = resolve(root, 'bunfig.toml')
  const outside = relative(root, config)
  if (!isAbsolute(root) || outside.startsWith('..') || isAbsolute(outside)) {
    throw new Error('Bun configuration must remain inside the source root')
  }
  const stat = lstatSync(config)
  if (!stat.isFile()) throw new Error('Bun configuration must be a regular file')
  if (realpathSync(config) !== config) throw new Error('Bun configuration must not be a symlink')
  return config
}

export async function verifyTrustedBunConfig(sourceRoot = SOURCE_ROOT) {
  const root = await realpath(resolve(sourceRoot))
  return trustedBunConfig(root)
}

export function bunArgs({ sourceRoot = SOURCE_ROOT, script, args = [] } = {}) {
  if (typeof script !== 'string' || !isAbsolute(script)) throw new TypeError('Bun script must be an absolute path')
  const root = realpathSync(resolve(sourceRoot))
  const scriptPath = realpathSync(script)
  if (!lstatSync(scriptPath).isFile()) throw new Error('Bun script must be a regular file')
  const scriptRelative = relative(root, scriptPath)
  if (scriptRelative === '..' || scriptRelative.startsWith(`..${requirePathSeparator()}`) || isAbsolute(scriptRelative)) {
    throw new Error('Bun script must remain inside the source root')
  }
  const config = trustedBunConfig(root)
  return [...BUN_FLAGS, `--config=${config}`, scriptPath, ...args]
}

function requirePathSeparator() {
  return process.platform === 'win32' ? '\\' : '/'
}

export async function assertBunRuntime({ runtime = process, sourceRoot = SOURCE_ROOT } = {}) {
  const version = runtime?.versions?.bun
  if (version !== BUN_VERSION) throw new Error(`Bun ${BUN_VERSION} is required (found ${version || 'another runtime'})`)
  if (typeof runtime.execPath !== 'string' || !isAbsolute(runtime.execPath)) throw new Error('Bun executable path must be absolute')
  const executable = await realpath(runtime.execPath)
  if (!isAbsolute(executable)) throw new Error('Bun executable realpath must be absolute')
  return Object.freeze({ version, executable, config: trustedBunConfig(sourceRoot), flags: [...BUN_FLAGS] })
}

export default Object.freeze({ BUN_VERSION, BUN_FLAGS, assertBunRuntime, bunArgs, sanitizeBunEnv, trustedBunConfig, verifyTrustedBunConfig })
