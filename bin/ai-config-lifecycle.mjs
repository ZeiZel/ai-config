#!/usr/bin/env bun
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  doctorInstallation, initializeProject, installManagedFiles, loadGeneratedFiles,
  loadMcpCatalog, projectMcpProfile, repairManagedFiles, selectProjectInitEnvironment,
  selectManagedFilesForIntegration, uninstallManagedFiles, installGlobal, uninstallGlobal,
  GLOBAL_STATE_PATH, evaluateProviderEvent, nativeHookDecision, readBoundedHookInput
} from '../src/lifecycle.js'
import { runMcpServer } from '../src/mcp/runtime.js'
import { assertBunRuntime } from '../src/runtime/bun.js'

const bundledGeneratedRoot = fileURLToPath(new URL('../generated/', import.meta.url))
const bundledSpecsRoot = fileURLToPath(new URL('../ai-specs/', import.meta.url))

const COMMAND_OPTIONS = {
  install: new Set(['source', 'target', 'providers', 'profiles', 'provider', 'profile', 'approve-external', 'dry-run']),
  repair: new Set(['source', 'target', 'dry-run']),
  'uninstall-managed': new Set(['target', 'state', 'global', 'dry-run']),
  doctor: new Set(['target', 'state', 'global']),
  'mcp-profile': new Set(['specs', 'profile', 'approve']),
  'mcp-run': new Set(['server']),
  init: new Set(['source', 'target', 'providers', 'provider', 'profiles', 'profile', 'mcp-profiles', 'approve-mcp', 'approve-external', 'no-mcp', 'no-spec-kit', 'no-beads', 'dry-run']),
  guard: new Set(['provider', 'event'])
}
const BOOLEAN_OPTIONS = new Set(['dry-run', 'global', 'no-mcp', 'no-spec-kit', 'no-beads'])
const HELP = `Usage: ai-config <command> [options]

Commands:
  init --target <project> --providers <ids> [--profiles <ids>] [--mcp-profiles <ids>] [--approve-mcp <ids>] [--approve-external <ids>] [--no-mcp] [--no-spec-kit] [--no-beads] [--dry-run]
  install [--providers <ids>] [--profiles <ids>] [--target <home>] [--approve-external <ids>] [--dry-run]
  repair --target <project> [--source <generated>] [--dry-run]
  uninstall-managed --target <project> [--state <relative-path>] [--dry-run]
  uninstall-managed --global [--dry-run]
  doctor [--target <project>] [--state <relative-path>] [--global]
  mcp-profile [--specs <dir>] [--profile <id>] [--approve <ids>]
  mcp-run --server <known-id>
  guard --provider <claude|codex|gemini|opencode> [--event <name>]
`

function parseArguments(argv) {
  if (argv[0] === '--help' || argv[0] === '-h' || argv[1] === '--help' || argv[1] === '-h') return { command: 'help', options: {} }
  const [command, ...rest] = argv
  const allowed = COMMAND_OPTIONS[command]
  if (!allowed) throw new Error('usage: ai-config <install|repair|uninstall-managed|doctor|init|mcp-profile|mcp-run|guard> [options]')
  const options = {}
  for (let index = 0; index < rest.length; index += 1) {
    const token = rest[index]
    if (!token.startsWith('--')) throw new Error(`unexpected argument: ${token}`)
    const name = token.slice(2)
    if (!allowed.has(name)) throw new Error(`unknown option for ${command}: --${name}`)
    if (Object.hasOwn(options, name)) throw new Error(`duplicate option: --${name}`)
    if (BOOLEAN_OPTIONS.has(name)) options[name] = true
    else {
      const value = rest[index += 1]
      if (!value || value.startsWith('--')) throw new Error(`missing value for --${name}`)
      options[name] = value
    }
  }
  return { command, options }
}

async function desiredFiles(options) {
  return loadGeneratedFiles(options.source ? resolve(options.source) : bundledGeneratedRoot)
}

async function main() {
  await assertBunRuntime({ sourceRoot: fileURLToPath(new URL('../', import.meta.url)) })
  const { command, options } = parseArguments(process.argv.slice(2))
  if (command === 'help') { process.stdout.write(HELP); return }
  if (typeof process.getuid === 'function' && process.getuid() === 0 && ['install', 'repair', 'uninstall-managed', 'init'].includes(command)) {
    throw new Error('mutating lifecycle commands refuse to run as uid 0')
  }
  if (options.global && options.state) throw new Error('--state cannot be combined with --global')
  const globalOperation = command === 'install' || options.global
  if (globalOperation && !options.target && !process.env.HOME) throw new Error('global operation requires HOME or --target')
  if (['repair', 'uninstall-managed', 'init'].includes(command) && !options.target) throw new Error(`${command} requires an explicit --target`)
  const defaultTarget = globalOperation ? process.env.HOME : '.'
  const targetRoot = resolve(options.target || defaultTarget)
  let result
  if (command === 'install') {
    if (options.providers && options.provider) throw new Error('use only one of --providers or --provider')
    if (options.profiles && options.profile) throw new Error('use only one of --profiles or --profile')
    result = await installGlobal({
      targetRoot, sourceRoot: fileURLToPath(new URL('../', import.meta.url)), specsDir: bundledSpecsRoot,
      generatedRoot: options.source ? resolve(options.source) : bundledGeneratedRoot,
      providers: options.providers || options.provider,
      profileIds: splitList(options.profiles || options.profile || 'base'),
      approvedSourceIds: splitList(options['approve-external']),
      dryRun: options['dry-run'] === true
    })
  }
  else if (command === 'repair') result = await repairManagedFiles({ targetRoot, files: await desiredFiles(options), dryRun: options['dry-run'] === true })
  else if (command === 'uninstall-managed') {
    result = options.global
      ? await uninstallGlobal({ targetRoot, statePath: GLOBAL_STATE_PATH, dryRun: options['dry-run'] === true })
      : await uninstallManagedFiles({ targetRoot, statePath: options.state, dryRun: options['dry-run'] === true })
  }
  else if (command === 'doctor') {
    result = await doctorInstallation({ targetRoot, statePath: options.global ? GLOBAL_STATE_PATH : options.state })
    if (!result.healthy) process.exitCode = result.repairable ? 2 : 4
  }
  else if (command === 'mcp-profile') {
    const catalog = await loadMcpCatalog({ specsDir: options.specs ? resolve(options.specs) : bundledSpecsRoot })
    result = projectMcpProfile(catalog, options.profile || 'default', {
      approvedServerIds: options.approve ? options.approve.split(',').filter(Boolean) : []
    })
  }
  else if (command === 'mcp-run') {
    if (!options.server) throw new Error('--server is required')
    await runMcpServer({ serverId: options.server })
    return
  }
  else if (command === 'init') {
    if (options.providers && options.provider) throw new Error('use only one of --providers or --provider')
    if (options.profiles && options.profile) throw new Error('use only one of --profiles or --profile')
    const providers = splitList(options.providers || options.provider)
    const profileIds = splitList(options.profiles || options.profile || 'base')
    if (!providers.length) throw new Error('--providers is required (claude,codex,opencode,gemini)')
    const generated = await desiredFiles(options)
    result = await initializeProject({
      projectRoot: targetRoot,
      providers,
      profileIds,
      specsDir: bundledSpecsRoot,
      managedFiles: providers.flatMap(provider => selectManagedFilesForIntegration(generated, provider)),
      includeSpecKit: options['no-spec-kit'] !== true,
      initializeBeads: options['no-beads'] !== true,
      includeMcp: options['no-mcp'] !== true,
      mcpProfileIds: splitList(options['mcp-profiles']),
      approvedMcpServerIds: splitList(options['approve-mcp']),
      approvedSourceIds: splitList(options['approve-external']),
      runtimeEnv: selectProjectInitEnvironment(process.env),
      dryRun: options['dry-run'] === true
    })
  }
  else if (command === 'guard') {
    if (!options.provider) throw new Error('--provider is required')
    const input = await readBoundedHookInput(process.stdin)
    const output = nativeHookDecision(options.provider, evaluateProviderEvent(options.provider, input), options.event || 'PreToolUse')
    if (output) process.stdout.write(`${JSON.stringify(output)}\n`)
    return
  }
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`)
  if (result?.conflicts?.length && !process.exitCode) process.exitCode = 3
}

function splitList(value) {
  if (!value) return []
  return [...new Set(value.split(',').map(item => item.trim()).filter(Boolean))]
}

main().catch(error => {
  process.stderr.write(`ai-config-lifecycle: ${error.message}\n`)
  if (Array.isArray(error.beadsPersistentSideEffects) && error.beadsPersistentSideEffects.length) {
    process.stderr.write(`beadsPersistentSideEffects: ${JSON.stringify(error.beadsPersistentSideEffects)}\n`)
  }
  process.exitCode = 1
})
