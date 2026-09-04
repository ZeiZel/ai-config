import { lstat, readFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { safeRelativePath } from '../security-guard/index.js'

export const STATE_SCHEMA_VERSION = 3
export const DEFAULT_STATE_PATH = '.ai-config/state.json'
const ALLOWED_SCOPES = new Set(['managed', 'project', 'global', 'legacy'])

export function emptyState() {
  return { schemaVersion: STATE_SCHEMA_VERSION, scope: 'managed', selection: {}, files: {} }
}

export function validateStateMetadata(scope, selection) {
  if (!ALLOWED_SCOPES.has(scope) || !selection || Array.isArray(selection) || typeof selection !== 'object') throw new Error('invalid ai-config state metadata')
  validateSelection(selection)
  return true
}

export async function readInstallState(targetRoot, statePath = DEFAULT_STATE_PATH) {
  const root = resolve(targetRoot)
  const { target, relativePath } = safeRelativePath(root, statePath)
  try {
    const rootStat = await lstat(root)
    if (rootStat.isSymbolicLink() || !rootStat.isDirectory()) throw new Error('state target root must be a real directory')
    let current = root
    const segments = relativePath.split('/')
    for (const [index, segment] of segments.entries()) {
      current = join(current, segment)
      const stat = await lstat(current)
      if (stat.isSymbolicLink()) throw new Error(`state manifest path contains a symlink: ${relativePath}`)
      if (index < segments.length - 1 && !stat.isDirectory()) throw new Error(`state manifest parent is not a directory: ${relativePath}`)
      if (index === segments.length - 1 && !stat.isFile()) throw new Error(`state manifest is not a regular file: ${relativePath}`)
    }
    const state = JSON.parse(await readFile(target, 'utf8'))
    return validateInstallState(state, targetRoot)
  } catch (error) {
    if (error.code === 'ENOENT') return emptyState()
    throw error
  }
}

export function validateInstallState(state, targetRoot = '.') {
  if (!state || !state.files || Array.isArray(state.files) || typeof state.files !== 'object') {
    throw new Error('invalid ai-config state manifest')
  }
  if (state.schemaVersion === 1) state = {
    schemaVersion: STATE_SCHEMA_VERSION, scope: 'legacy', selection: {},
    files: Object.fromEntries(Object.entries(state.files).map(([path, record]) => [path, { ...record, mode: record.mode ?? 0o644, ...(record.mergeStrategy ? { mergeStrategy: { type: 'legacy-unverified' } } : {}) }]))
  }
  if (state.schemaVersion === 2) state = {
    ...state,
    schemaVersion: STATE_SCHEMA_VERSION,
    files: Object.fromEntries(Object.entries(state.files).map(([path, record]) => [
      path,
      record.mergeStrategy ? { ...record, mergeStrategy: { type: 'legacy-unverified' } } : record
    ]))
  }
  if (state.schemaVersion !== STATE_SCHEMA_VERSION) throw new Error('invalid ai-config state manifest')
  validateStateMetadata(state.scope, state.selection)
  for (const [path, record] of Object.entries(state.files)) {
    safeRelativePath(targetRoot, path)
    if (!record || typeof record.sha256 !== 'string' || !/^[a-f0-9]{64}$/.test(record.sha256)) {
      throw new Error(`invalid state record: ${path}`)
    }
    if (!Number.isInteger(record.mode) || record.mode < 0 || record.mode > 0o777) throw new Error(`invalid state mode: ${path}`)
    if (record.mergeStrategy !== undefined) validateMergeStrategy(record.mergeStrategy, path)
    if (record.origin !== undefined && (!['internal', 'external', 'external-provenance', 'project', 'spec-kit', 'legacy'].includes(record.origin))) throw new Error(`invalid state origin: ${path}`)
    if (record.owners !== undefined && (!Array.isArray(record.owners) || record.owners.some(owner => typeof owner !== 'string'))) throw new Error(`invalid state owners: ${path}`)
    if (record.externalSourceId !== undefined && (typeof record.externalSourceId !== 'string' || !/^[a-z0-9][a-z0-9-]{0,63}$/.test(record.externalSourceId))) throw new Error(`invalid state external source: ${path}`)
  }
  return structuredClone(state)
}

function validateSelection(selection) {
  for (const key of ['providers', 'profiles', 'mcpProfiles', 'externalSourceIds']) {
    if (selection[key] !== undefined && (!Array.isArray(selection[key]) || selection[key].some(value => typeof value !== 'string') || new Set(selection[key]).size !== selection[key].length)) throw new Error(`invalid state selection: ${key}`)
  }
  if (selection.flags !== undefined && (!selection.flags || typeof selection.flags !== 'object' || Array.isArray(selection.flags) || Object.entries(selection.flags).some(([key, value]) => !['includeSpecKit', 'includeExternal', 'includeMcp'].includes(key) || typeof value !== 'boolean'))) throw new Error('invalid state selection flags')
}

function validateMergeStrategy(strategy, path) {
  if (!strategy || typeof strategy !== 'object' || Array.isArray(strategy)) throw new Error(`invalid merge strategy: ${path}`)
  if (strategy.type === 'legacy-unverified') {
    if (!onlyStrategyFields(strategy, ['type'])) throw new Error(`invalid legacy merge strategy: ${path}`)
    return
  }
  if (strategy.type === 'managed-section') {
    const signature = `${strategy.begin}\n${strategy.end}`
    const allowed = new Set([
      '<!-- BEGIN AI-CONFIG MANAGED -->\n<!-- END AI-CONFIG MANAGED -->',
      '# BEGIN AI-CONFIG MANAGED MCP\n# END AI-CONFIG MANAGED MCP'
    ])
    if (!allowed.has(signature) || !onlyStrategyFields(strategy, ['type', 'begin', 'end', 'blockSha256', 'legacyUnverified'])) throw new Error(`invalid managed-section strategy: ${path}`)
    if (strategy.legacyUnverified === true) return
    if (typeof strategy.blockSha256 !== 'string' || !/^[a-f0-9]{64}$/.test(strategy.blockSha256)) throw new Error(`invalid managed-section identity: ${path}`)
    return
  }
  if (strategy.type === 'json-namespace') {
    if (!['mcp', 'mcpServers'].includes(strategy.key) || strategy.prefix !== 'ai-config-') throw new Error(`invalid JSON namespace strategy: ${path}`)
    return
  }
  if (strategy.type === 'provider-json') {
    if (!['claude', 'codex', 'gemini', 'opencode', 'mcp'].includes(strategy.provider)) throw new Error(`invalid provider JSON strategy: ${path}`)
    if (!onlyStrategyFields(strategy, ['type', 'provider', 'key', 'events', 'ownedMcpEntries', 'ownedHookRegistrations', 'redaction', 'permissions', 'schemaValue', 'legacyUnverified'])) throw new Error(`invalid provider JSON strategy: ${path}`)
    if (strategy.legacyUnverified === true) return
    if (strategy.key !== undefined && !['mcp', 'mcpServers'].includes(strategy.key)) throw new Error(`invalid provider JSON namespace: ${path}`)
    if (!Array.isArray(strategy.events) || strategy.events.some(event => !['PreToolUse', 'PermissionRequest', 'BeforeTool'].includes(event))) throw new Error(`invalid provider hook events: ${path}`)
    validateOwnedMcpEntries(strategy.ownedMcpEntries, path)
    validateOwnedHookRegistrations(strategy.ownedHookRegistrations, path)
    if (strategy.redaction !== undefined && strategy.redaction !== true) throw new Error(`invalid provider redaction strategy: ${path}`)
    if (strategy.permissions !== undefined && (!strategy.permissions || typeof strategy.permissions !== 'object' || Array.isArray(strategy.permissions))) throw new Error(`invalid provider permissions strategy: ${path}`)
    if (strategy.schemaValue !== undefined && strategy.schemaValue !== 'https://opencode.ai/config.json') throw new Error(`invalid provider schema strategy: ${path}`)
    return
  }
  throw new Error(`unknown merge strategy: ${path}`)
}

function onlyStrategyFields(strategy, fields) {
  return Object.keys(strategy).every(key => fields.includes(key))
}

function validateOwnedMcpEntries(entries, path) {
  if (entries === undefined) return
  if (!Array.isArray(entries) || entries.some(entry => !entry || typeof entry.key !== 'string' || !/^ai-config-[a-z0-9][a-z0-9-]*$/.test(entry.key) || typeof entry.sha256 !== 'string' || !/^[a-f0-9]{64}$/.test(entry.sha256)) || new Set(entries.map(entry => entry.key)).size !== entries.length) {
    throw new Error(`invalid provider MCP ownership: ${path}`)
  }
}

function validateOwnedHookRegistrations(entries, path) {
  if (entries === undefined) return
  if (!Array.isArray(entries) || entries.some(entry => !entry || !['PreToolUse', 'PermissionRequest', 'BeforeTool'].includes(entry.event) || !Number.isInteger(entry.index) || entry.index < 0 || typeof entry.sha256 !== 'string' || !/^[a-f0-9]{64}$/.test(entry.sha256)) || new Set(entries.map(entry => entry.event)).size !== entries.length) {
    throw new Error(`invalid provider hook ownership: ${path}`)
  }
}
