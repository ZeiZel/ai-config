import { randomUUID } from 'node:crypto'
import { lstat, mkdir, mkdtemp, open, readFile, rename, rm, unlink, writeFile } from 'node:fs/promises'
import { dirname, join, relative, resolve, sep } from 'node:path'
import { tmpdir } from 'node:os'
import { DEFAULT_STATE_PATH, STATE_SCHEMA_VERSION, emptyState, readInstallState, validateStateMetadata } from './state.js'
import { assertNoSymlinkAncestors, safeAuditEvent, safeRelativePath, sha256 } from '../security-guard/index.js'

const PROTECTED_PROVIDER_HOMES = new Set(['.agents', '.claude', '.codex', '.gemini', '.opencode'])
const PROJECT_GUARD_MARKER = '.ai-config/hooks/guard.mjs'

export async function assertSafeTargetRoot(root) {
  const stat = await lstat(resolve(root))
  if (stat.isSymbolicLink()) throw new Error('managed target root must not be a symlink')
  if (!stat.isDirectory()) throw new Error('managed target root must be a directory')
}

function normalizeFiles(files, targetRoot) {
  if (!Array.isArray(files)) throw new TypeError('files must be an array')
  const seen = new Set()
  return files.map(file => {
    if (!file || typeof file.path !== 'string' || (file.remove !== true && typeof file.content !== 'string' && !Buffer.isBuffer(file.content))) {
      throw new TypeError('each managed file needs a path plus content or an explicit remove marker')
    }
    const { relativePath } = safeRelativePath(targetRoot, file.path)
    if (PROTECTED_PROVIDER_HOMES.has(relativePath)) throw new Error(`provider home cannot be a managed file: ${relativePath}`)
    if (relativePath === DEFAULT_STATE_PATH) throw new Error('managed files cannot replace the state manifest')
    if (seen.has(relativePath)) throw new Error(`duplicate managed path: ${relativePath}`)
    seen.add(relativePath)
    // Reconciled removals carry the user-preserving replacement content while
    // still removing their ownership record from state.
    const content = file.remove === true && file.content === undefined
      ? undefined
      : (Buffer.isBuffer(file.content) ? Buffer.from(file.content) : Buffer.from(file.content, 'utf8'))
    return {
      path: relativePath, content, sha256: content ? sha256(content) : undefined, mode: file.mode ?? 0o644,
      semantic: file.semantic, mergeBaseSha256: file.mergeBaseSha256, remove: file.remove === true,
      mergeStrategy: file.mergeStrategy, origin: file.origin, owners: file.owners,
      externalSourceId: file.externalSourceId
    }
  }).sort((a, b) => a.path.localeCompare(b.path))
}

function semanticSha256(file, content) {
  if (file.semantic !== 'spec-kit') return undefined
  const normalized = content.toString('utf8')
    .replace(/\b\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})\b/g, '<volatile-iso-timestamp>')
    .replace(/^(\s*["']?(?:created|updated|installed)(?:At|_at)?["']?\s*[:=]\s*).+$/gim, '$1<volatile-timestamp>')
  return sha256(normalized)
}

async function readExisting(path) {
  try {
    const stat = await lstat(path)
    if (stat.isSymbolicLink()) return { kind: 'symlink' }
    if (!stat.isFile()) return { kind: 'non-file' }
    const content = await readFile(path)
    return { kind: 'file', content, sha256: sha256(content), bytes: content.length, mode: stat.mode & 0o777 }
  } catch (error) {
    if (error.code === 'ENOENT') return { kind: 'missing' }
    throw error
  }
}

export async function stageManagedFiles(files, { stagingParent = tmpdir(), targetRoot = '.' } = {}) {
  const normalized = normalizeFiles(files, targetRoot)
  await mkdir(stagingParent, { recursive: true })
  const stageRoot = await mkdtemp(join(stagingParent, 'ai-config-stage-'))
  try {
    for (const file of normalized) {
      if (file.remove && !file.content) continue
      const target = safeRelativePath(stageRoot, file.path).target
      await mkdir(dirname(target), { recursive: true })
      await atomicWriteFile(target, file.content, file.mode)
    }
    return { stageRoot, files: normalized.map(({ content, ...file }) => file) }
  } catch (error) {
    await rm(stageRoot, { recursive: true, force: true })
    throw error
  }
}

async function buildManagedInstallPlan({ targetRoot, files, statePath = DEFAULT_STATE_PATH, scope = 'managed', selection = {} } = {}) {
  const root = resolve(targetRoot)
  validateStateMetadata(scope, selection)
  await assertSafeTargetRoot(root)
  const desired = normalizeFiles(files, root)
  const state = await readInstallState(root, statePath)
  const stateTarget = safeRelativePath(root, statePath).target
  const stateCurrent = await readExisting(stateTarget)
  const changes = []
  for (const file of desired) {
    await assertNoSymlinkAncestors(root, file.path)
    const target = safeRelativePath(root, file.path).target
    const current = await readExisting(target)
    const previous = state.files[file.path]
    let action; let reason
    if (file.remove && current.kind === 'missing') { action = 'forget'; reason = 'managed-file-already-missing' }
    else if (file.remove && current.kind !== 'file') { action = 'conflict'; reason = `target-is-${current.kind}` }
    else if (file.remove && !previous) { action = 'conflict'; reason = 'remove-target-is-not-managed' }
    else if (file.remove && file.mergeStrategy) {
      const result = reconcileManagedContent(current.content, file.mergeStrategy)
      if (result.status === 'update') {
        file.content = result.content; file.sha256 = sha256(result.content)
        action = 'update'; reason = 'remove-managed-fragment'
      } else if (result.status === 'remove') { action = 'remove'; reason = 'managed-fragment-was-whole-file' }
      else if (result.status === 'absent') { action = 'forget'; reason = 'managed-fragment-already-absent' }
      else { action = 'conflict'; reason = 'managed-fragment-malformed' }
    }
    else if (file.remove && file.mergeBaseSha256 && current.sha256 === file.mergeBaseSha256) { action = 'remove'; reason = 'managed-content-reconciled-empty' }
    else if (file.remove && current.sha256 === previous.sha256) { action = 'remove'; reason = 'managed-file-hash-matches' }
    else if (file.remove) { action = 'conflict'; reason = 'locally-modified-managed-file' }
    else if (current.kind === 'missing') { action = 'create'; reason = previous ? 'managed-file-missing' : 'new-managed-file' }
    else if (current.kind !== 'file') { action = 'conflict'; reason = `target-is-${current.kind}` }
    else if (current.sha256 === file.sha256) {
      action = 'unchanged'; reason = previous ? 'content-matches' : 'existing-unmanaged-content-matches'
      // A byte-identical file is not evidence of ai-config ownership. Keeping
      // it out of state prevents a later uninstall from deleting user data.
      file.track = Boolean(previous)
    }
    else if (file.semantic && semanticSha256(file, current.content) === semanticSha256(file, file.content)) {
      action = 'unchanged'; reason = 'semantic-content-matches'
      file.content = current.content; file.sha256 = current.sha256
      // Semantic equivalence (currently used for Spec Kit timestamps) is not
      // evidence that an unmanaged file was created by ai-config. Preserve
      // the same ownership rule as the byte-identical branch.
      file.track = Boolean(previous)
    }
    else if (file.mergeBaseSha256 && current.sha256 === file.mergeBaseSha256) {
      action = 'update'; reason = 'managed-section-merge'
      // Provider configs are frequently deliberately 0600. A merge must not
      // widen their mode merely because generated content defaults to 0644.
      file.mode = current.mode
    }
    else if (!previous) { action = 'conflict'; reason = 'existing-unmanaged-file' }
    else if (current.sha256 !== previous.sha256) { action = 'conflict'; reason = 'locally-modified-managed-file' }
    else { action = 'update'; reason = 'managed-update' }
    changes.push({
      path: file.path, action, reason, desiredSha256: file.sha256,
      currentSha256: current.sha256, previousSha256: previous?.sha256,
      diff: { beforeBytes: current.bytes ?? 0, afterBytes: file.content?.length ?? 0 }
    })
  }
  return { schemaVersion: STATE_SCHEMA_VERSION, root, statePath, scope, selection, state, stateSha256: stateCurrent.kind === 'file' ? stateCurrent.sha256 : undefined, desired, changes }
}

export async function planManagedInstall(options = {}) {
  const plan = await buildManagedInstallPlan(options)
  return {
    schemaVersion: plan.schemaVersion,
    root: plan.root,
    statePath: plan.statePath,
    changes: structuredClone(plan.changes)
  }
}

async function atomicWriteFile(path, content, mode = 0o644) {
  await mkdir(dirname(path), { recursive: true })
  const temporary = join(dirname(path), `.${join(path).split(sep).at(-1)}.ai-config-${randomUUID()}.tmp`)
  const handle = await open(temporary, 'wx', mode)
  try {
    await handle.writeFile(content)
    await handle.sync()
  } finally {
    await handle.close()
  }
  try { await rename(temporary, path) } catch (error) { await rm(temporary, { force: true }); throw error }
}

async function restoreSnapshots(snapshots) {
  for (const snapshot of [...snapshots].reverse()) {
    if (snapshot.kind === 'missing') await rm(snapshot.path, { force: true })
    else if (snapshot.kind === 'file') await atomicWriteFile(snapshot.path, snapshot.content, snapshot.mode)
    else throw new Error(`cannot roll back non-file target: ${snapshot.path}`)
  }
}

function nextState(plan, appliedPaths) {
  const state = structuredClone(plan.state)
  state.schemaVersion = STATE_SCHEMA_VERSION
  state.scope = plan.scope
  state.selection = structuredClone(plan.selection)
  for (const file of plan.desired) {
    if (!appliedPaths.has(file.path)) continue
    if (file.track === false) continue
    if (file.remove) delete state.files[file.path]
    else state.files[file.path] = {
      sha256: file.sha256, mode: file.mode,
      ...(file.mergeStrategy ? { mergeStrategy: file.mergeStrategy } : {}),
      ...(file.origin ? { origin: file.origin } : {}),
      ...(file.owners ? { owners: file.owners } : {}),
      ...(file.externalSourceId ? { externalSourceId: file.externalSourceId } : {})
    }
  }
  return state
}

function canonicalJson(value) {
  if (value === undefined) return 'null'
  if (value === null || typeof value !== 'object') return JSON.stringify(value)
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`
  return `{${Object.keys(value).filter(key => value[key] !== undefined).sort().map(key => `${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(',')}}`
}

function fragmentSha256(value) {
  return sha256(Buffer.from(typeof value === 'string' ? value : canonicalJson(value)))
}

function managedBlock(text, strategy) {
  const start = text.indexOf(strategy.begin); const end = text.indexOf(strategy.end)
  if (start === -1 && end === -1) return { status: 'absent' }
  if (start === -1 || end === -1 || end < start) return { status: 'malformed' }
  return { status: 'present', start, end, block: text.slice(start, end + strategy.end.length) }
}

function removeManagedSectionContent(content, strategy) {
  if (strategy.legacyUnverified === true) return { status: 'preserve' }
  const text = content.toString('utf8')
  const current = managedBlock(text, strategy)
  if (current.status !== 'present') return current
  if (typeof strategy.blockSha256 !== 'string' || fragmentSha256(current.block) !== strategy.blockSha256) return { status: 'preserve' }
  const next = `${text.slice(0, current.start)}${text.slice(current.end + strategy.end.length)}`.replace(/\n{3,}/g, '\n\n')
  return next.trim() ? { status: 'update', content: Buffer.from(next.replace(/\n*$/, '\n')) } : { status: 'remove' }
}

function removeJsonNamespaceContent(content, strategy) {
  let document
  try { document = JSON.parse(content.toString('utf8')) } catch { return { status: 'malformed' } }
  if (!document || typeof document !== 'object' || Array.isArray(document)) return { status: 'malformed' }
  const entries = document[strategy.key]
  if (entries === undefined) return { status: 'absent' }
  if (!entries || typeof entries !== 'object' || Array.isArray(entries)) return { status: 'malformed' }
  let removed = false
  for (const key of Object.keys(entries)) if (key.startsWith(strategy.prefix)) { delete entries[key]; removed = true }
  if (!removed) return { status: 'absent' }
  if (!Object.keys(entries).length) delete document[strategy.key]
  if (!Object.keys(document).length) return { status: 'remove' }
  return { status: 'update', content: Buffer.from(`${JSON.stringify(document, null, 2)}\n`) }
}

function removeProviderJsonContent(content, strategy) {
  if (strategy.legacyUnverified === true) return { status: 'preserve' }
  let document
  try { document = JSON.parse(content.toString('utf8')) } catch { return { status: 'malformed' } }
  if (!document || typeof document !== 'object' || Array.isArray(document)) return { status: 'malformed' }
  let removed = false
  if (strategy.key) {
    const entries = document[strategy.key]
    if (entries !== undefined) {
      if (!entries || typeof entries !== 'object' || Array.isArray(entries)) return { status: 'malformed' }
      for (const owned of strategy.ownedMcpEntries || []) {
        if (Object.hasOwn(entries, owned.key) && fragmentSha256(entries[owned.key]) === owned.sha256) {
          delete entries[owned.key]; removed = true
        }
      }
      if (!Object.keys(entries).length) delete document[strategy.key]
    }
  }
  if (strategy.events?.length) {
    if (document.hooks !== undefined && (!document.hooks || typeof document.hooks !== 'object' || Array.isArray(document.hooks))) return { status: 'malformed' }
    for (const event of strategy.events) {
      const registrations = document.hooks?.[event]
      if (registrations === undefined) continue
      if (!Array.isArray(registrations)) return { status: 'malformed' }
      const owned = (strategy.ownedHookRegistrations || []).filter(item => item.event === event)
      const expectedCounts = new Map()
      for (const record of owned) expectedCounts.set(record.sha256, (expectedCounts.get(record.sha256) || 0) + 1)
      for (const [expectedSha256, expectedCount] of expectedCounts) {
        const actualCount = registrations.filter(registration => fragmentSha256(registration) === expectedSha256).length
        // An extra identical registration is indistinguishable from a user
        // addition. Preserve rather than risking removal of their hook.
        if (actualCount !== expectedCount) return { status: 'preserve' }
      }
      const removeIndexes = new Set()
      for (const record of owned) {
        if (fragmentSha256(registrations[record.index]) === record.sha256) {
          removeIndexes.add(record.index)
          continue
        }
        // Array insertion can shift our registration.  A unique exact
        // identity is still safely removable; zero or duplicate matches are
        // not proof of ownership and preserve the whole provider artifact.
        const matches = registrations.flatMap((registration, index) => fragmentSha256(registration) === record.sha256 ? [index] : [])
        if (matches.length !== 1) return { status: 'preserve' }
        removeIndexes.add(matches[0])
      }
      const next = []
      for (const [index, registration] of registrations.entries()) {
        if (!registration || typeof registration !== 'object' || !Array.isArray(registration.hooks)) return { status: 'malformed' }
        if (removeIndexes.has(index)) { removed = true; continue }
        next.push(registration)
      }
      if (next.length) document.hooks[event] = next
      else delete document.hooks[event]
    }
    if (document.hooks && !Object.keys(document.hooks).length) delete document.hooks
  }
  if (strategy.redaction && document.security?.environmentVariableRedaction?.enabled === true) {
    delete document.security.environmentVariableRedaction.enabled; removed = true
    if (!Object.keys(document.security.environmentVariableRedaction).length) delete document.security.environmentVariableRedaction
    if (!Object.keys(document.security).length) delete document.security
  }
  if (strategy.permissions && document.permission && typeof document.permission === 'object' && !Array.isArray(document.permission)) {
    for (const [key, value] of Object.entries(strategy.permissions)) if (document.permission[key] === value) { delete document.permission[key]; removed = true }
    if (!Object.keys(document.permission).length) delete document.permission
  }
  if (strategy.schemaValue && document.$schema === strategy.schemaValue) { delete document.$schema; removed = true }
  if (!removed) return { status: 'absent' }
  if (!Object.keys(document).length) return { status: 'remove' }
  return { status: 'update', content: Buffer.from(`${JSON.stringify(document, null, 2)}\n`) }
}

function referencesProjectGuard(content) {
  let document
  try { document = JSON.parse(content.toString('utf8')) } catch { return false }
  if (!document?.hooks || typeof document.hooks !== 'object' || Array.isArray(document.hooks)) return false
  for (const registrations of Object.values(document.hooks)) {
    if (!Array.isArray(registrations)) continue
    for (const registration of registrations) {
      if (!registration || typeof registration !== 'object' || !Array.isArray(registration.hooks)) continue
      if (registration.hooks.some(hook => typeof hook?.command === 'string' && hook.command.includes(PROJECT_GUARD_MARKER))) return true
    }
  }
  return false
}

function reconcileManagedContent(content, strategy) {
  if (strategy.type === 'legacy-unverified') return { status: 'preserve' }
  if (strategy.type === 'managed-section') return removeManagedSectionContent(content, strategy)
  if (strategy.type === 'json-namespace') return removeJsonNamespaceContent(content, strategy)
  if (strategy.type === 'provider-json') return removeProviderJsonContent(content, strategy)
  return { status: 'malformed' }
}

async function withLifecycleLock(root, statePath, operation) {
  const lock = join(root, '.ai-config-lifecycle.lock')
  const journal = join(root, '.ai-config-lifecycle-recovery.json')
  await assertNoSymlinkAncestors(root, safeRelativePath(root, statePath).relativePath)
  await assertNoSymlinkAncestors(root, '.ai-config-lifecycle-recovery.json')
  try {
    const journalStat = await lstat(journal)
    if (journalStat.isSymbolicLink() || !journalStat.isFile()) throw new Error('managed lifecycle recovery marker is unsafe')
    throw Object.assign(new Error('managed lifecycle recovery is required; inspect and remove the recovery marker'), { code: 'MANAGED_RECOVERY_REQUIRED' })
  } catch (error) {
    if (error.code === 'MANAGED_RECOVERY_REQUIRED') throw error
    if (error.code !== 'ENOENT') throw error
  }
  await mkdir(dirname(lock), { recursive: true })
  try {
    await mkdir(lock, { mode: 0o700 })
  } catch (error) {
    if (error.code !== 'EEXIST') throw error
    const stat = await lstat(lock)
    if (stat.isSymbolicLink() || !stat.isDirectory()) throw new Error('managed lifecycle lock is unsafe')
    let owner
    try { owner = JSON.parse(await readFile(join(lock, 'owner.json'), 'utf8')) } catch { throw Object.assign(new Error('managed lifecycle lock is held or unrecoverable'), { code: 'MANAGED_INSTALL_LOCKED' }) }
    let alive = false
    if (Number.isInteger(owner?.pid) && owner.pid > 0) {
      try { process.kill(owner.pid, 0); alive = true } catch (probe) { if (probe.code !== 'ESRCH') alive = true }
    }
    if (alive) throw Object.assign(new Error('managed lifecycle lock is held'), { code: 'MANAGED_INSTALL_LOCKED' })
    // A dead process with a journal may have died after publishing some files.
    // Never guess how to roll that transaction forward or backward.
    try {
      const journalStat = await lstat(journal)
      if (journalStat.isSymbolicLink() || !journalStat.isFile()) throw new Error('managed lifecycle recovery marker is unsafe')
      throw Object.assign(new Error('managed lifecycle recovery is required; inspect and remove the recovery marker'), { code: 'MANAGED_RECOVERY_REQUIRED' })
    } catch (error) {
      if (error.code === 'MANAGED_RECOVERY_REQUIRED') throw error
      if (error.code !== 'ENOENT') throw error
    }
    // Without a journal, a dead lock is an unstarted transaction and may be
    // safely removed after validating its exact path.
    await rm(lock, { recursive: true, force: false })
    await mkdir(lock, { mode: 0o700 })
  }
  try {
    await writeFile(join(lock, 'owner.json'), `${JSON.stringify({ pid: process.pid, createdAt: new Date().toISOString() })}\n`, { mode: 0o600, flag: 'wx' })
    await writeFile(journal, `${JSON.stringify({ schemaVersion: 1, pid: process.pid, statePath, startedAt: new Date().toISOString(), recovery: 'manual-review-required' })}\n`, { mode: 0o600, flag: 'wx' })
    try {
      const result = await operation()
      await rm(journal, { force: true })
      return result
    } catch (error) {
      // The operation owns rollback for ordinary exceptions; only an abrupt
      // process death leaves the marker behind for deterministic recovery.
      if (error.rollbackFailed !== true) await rm(journal, { force: true })
      throw error
    }
  } finally {
    await rm(lock, { recursive: true, force: true })
  }
}

export async function installManagedFiles({ targetRoot, files, statePath = DEFAULT_STATE_PATH, dryRun = false, failOnConflict = true, stagingParent, scope = 'managed', selection = {} } = {}) {
  const root = resolve(targetRoot)
  if (dryRun) return installManagedFilesLocked({ targetRoot: root, files, statePath, dryRun, failOnConflict, stagingParent, scope, selection })
  return withLifecycleLock(root, statePath, () => installManagedFilesLocked({ targetRoot: root, files, statePath, dryRun, failOnConflict, stagingParent, scope, selection }))
}

async function installManagedFilesLocked({ targetRoot, files, statePath = DEFAULT_STATE_PATH, dryRun = false, failOnConflict = true, stagingParent, scope = 'managed', selection = {} } = {}) {
  const plan = await buildManagedInstallPlan({ targetRoot, files, statePath, scope, selection })
  const conflicts = plan.changes.filter(change => change.action === 'conflict')
  if (dryRun) return {
    operation: 'install', dryRun: true, root: plan.root, statePath: plan.statePath,
    changes: structuredClone(plan.changes), conflicts: structuredClone(conflicts)
  }
  if (conflicts.length && failOnConflict) {
    const error = new Error(`managed install has conflicts: ${conflicts.map(item => item.path).join(', ')}`)
    error.code = 'MANAGED_FILE_CONFLICT'
    error.conflicts = conflicts
    throw error
  }
  let stage
  try { stage = await stageManagedFiles(plan.desired, { stagingParent, targetRoot: plan.root }) }
  catch (error) { error.rollbackSucceeded = true; throw error }
  const snapshots = []
  const applied = new Set(plan.changes.filter(change => change.action === 'unchanged').map(change => change.path))
  try {
    for (const change of plan.changes) {
      if (change.action === 'forget') { applied.add(change.path); continue }
      if (change.action !== 'create' && change.action !== 'update' && change.action !== 'remove') continue
      const target = safeRelativePath(plan.root, change.path).target
      await assertNoSymlinkAncestors(plan.root, change.path)
      const current = await readExisting(target)
      if (change.action === 'create' && current.kind !== 'missing') throw new Error(`target changed during install: ${change.path}`)
      if ((change.action === 'update' || change.action === 'remove') && (current.kind !== 'file' || current.sha256 !== change.currentSha256)) throw new Error(`target changed during install: ${change.path}`)
      snapshots.push({ path: target, ...current })
      if (change.action === 'remove') await unlink(target)
      else {
        const staged = safeRelativePath(stage.stageRoot, change.path).target
        const file = plan.desired.find(candidate => candidate.path === change.path)
        await atomicWriteFile(target, await readFile(staged), file.mode)
      }
      applied.add(change.path)
    }
    const state = nextState(plan, applied)
    const stateTarget = safeRelativePath(plan.root, statePath).target
    await assertNoSymlinkAncestors(plan.root, safeRelativePath(plan.root, statePath).relativePath)
    const oldState = await readExisting(stateTarget)
    if (oldState.kind !== 'missing' && oldState.kind !== 'file') throw new Error('state manifest must be a regular file')
    if ((oldState.kind === 'file' ? oldState.sha256 : undefined) !== plan.stateSha256) {
      throw Object.assign(new Error('managed state changed during transaction'), { code: 'MANAGED_STATE_CHANGED' })
    }
    snapshots.push({ path: stateTarget, ...oldState })
    await atomicWriteFile(stateTarget, `${JSON.stringify(state, null, 2)}\n`, 0o600)
    return {
      operation: 'install', dryRun: false, changes: plan.changes, conflicts,
      state, audit: safeAuditEvent({ operation: 'managed-install', target: plan.root, outcome: conflicts.length ? 'partial' : 'success', reasons: conflicts.map(item => item.reason) })
    }
  } catch (error) {
    try { await restoreSnapshots(snapshots); error.rollbackSucceeded = true } catch (rollbackError) {
      rollbackError.rollbackFailed = true
      throw rollbackError
    }
    throw error
  } finally {
    await rm(stage.stageRoot, { recursive: true, force: true })
  }
}

export async function repairManagedFiles(options = {}) {
  const root = resolve(options.targetRoot || '.')
  const state = await readInstallState(root, options.statePath)
  const byPath = new Map((options.files || []).map(file => [file.path.replaceAll('\\', '/'), file]))
  const selected = []
  const unsupported = []
  for (const path of Object.keys(state.files)) {
    const file = byPath.get(path)
    if (file) selected.push({ ...file, mode: state.files[path].mode })
    else unsupported.push(path)
  }
  // Repair is intentionally not an installer: it never broadens a project
  // selection to every generated provider. Missing owned content must be
  // supplied by the caller's exact project selection or be repaired by init.
  if (unsupported.length) throw Object.assign(new Error(`repair cannot safely infer managed content: ${unsupported.join(', ')}`), { code: 'REPAIR_SELECTION_UNRESOLVED' })
  return installManagedFiles({
    ...options,
    targetRoot: root,
    files: selected,
    failOnConflict: false,
    scope: options.scope ?? state.scope,
    selection: options.selection ?? state.selection
  })
}

export async function uninstallManagedFiles({ targetRoot, statePath = DEFAULT_STATE_PATH, dryRun = false } = {}) {
  const root = resolve(targetRoot)
  if (dryRun) return uninstallManagedFilesLocked({ targetRoot: root, statePath, dryRun })
  return withLifecycleLock(root, statePath, () => uninstallManagedFilesLocked({ targetRoot: root, statePath, dryRun }))
}

async function uninstallManagedFilesLocked({ targetRoot, statePath = DEFAULT_STATE_PATH, dryRun = false } = {}) {
  const root = resolve(targetRoot)
  const state = await readInstallState(root, statePath)
  const changes = []
  const reconciled = new Map()
  const currentContents = new Map()
  for (const [path, record] of Object.entries(state.files).sort(([a], [b]) => a.localeCompare(b))) {
    await assertNoSymlinkAncestors(root, path)
    const current = await readExisting(safeRelativePath(root, path).target)
    if (current.kind === 'file') currentContents.set(path, current.content)
    if (current.kind === 'missing') changes.push({ path, action: 'forget', reason: 'already-missing' })
    else if (current.kind === 'file' && record.mergeStrategy) {
      const result = reconcileManagedContent(current.content, record.mergeStrategy)
      if (result.status === 'update') {
        reconciled.set(path, { content: result.content, currentSha256: current.sha256 })
        changes.push({ path, action: 'update', reason: 'remove-managed-fragment', currentSha256: current.sha256 })
      } else if (result.status === 'remove') changes.push({ path, action: 'remove', reason: 'managed-fragment-was-whole-file', currentSha256: current.sha256 })
      else if (result.status === 'absent') changes.push({ path, action: 'forget', reason: 'managed-fragment-already-absent' })
      else changes.push({ path, action: 'preserve', reason: 'managed-fragment-malformed' })
    }
    else if (current.kind === 'file' && current.sha256 === record.sha256) changes.push({ path, action: 'remove', reason: 'hash-matches-state' })
    else changes.push({ path, action: 'preserve', reason: current.kind === 'file' ? 'locally-modified' : `target-is-${current.kind}` })
  }
  // A provider fragment that cannot be safely reconciled can still contain a
  // live guard registration. Keep the guard and both ownership records so a
  // later repair/uninstall never turns that retained hook into guard-not-found.
  const retainedGuardHook = changes.some(change => {
    if (change.action !== 'preserve') return false
    const strategy = state.files[change.path]?.mergeStrategy
    return strategy?.type === 'provider-json' && referencesProjectGuard(currentContents.get(change.path) || Buffer.alloc(0))
  })
  if (retainedGuardHook) {
    const guard = changes.find(change => change.path === '.ai-config/hooks/guard.mjs')
    if (guard && (guard.action === 'remove' || guard.action === 'update' || guard.action === 'forget')) {
      guard.action = 'preserve'
      guard.reason = 'guard-required-by-preserved-hook'
    }
  }
  if (dryRun) return { operation: 'uninstall', dryRun: true, changes }
  const snapshots = []
  // A partial uninstall still describes the original installation. Preserve
  // its scope and exact selection so a later repair cannot silently broaden
  // the provider/profile set.
  const next = { ...emptyState(), scope: state.scope, selection: structuredClone(state.selection) }
  for (const change of changes) if (change.action === 'preserve') next.files[change.path] = state.files[change.path]
  try {
    for (const change of changes) {
    if (change.action !== 'remove' && change.action !== 'update') continue
      const target = safeRelativePath(root, change.path).target
      const current = await readExisting(target)
      const expectedHash = state.files[change.path].mergeStrategy ? change.currentSha256 : state.files[change.path].sha256
      if (current.kind !== 'file' || current.sha256 !== expectedHash) {
        const error = new Error(`managed file changed during uninstall: ${change.path}`)
        error.code = 'INSTALLATION_CHANGED_DURING_UNINSTALL'
        throw error
      }
      snapshots.push({ path: target, ...current })
      if (change.action === 'remove') await unlink(target)
      else {
        const payload = reconciled.get(change.path)
        if (!payload) throw new Error(`managed file changed during uninstall: ${change.path}`)
        await atomicWriteFile(target, payload.content, current.mode)
      }
    }
    const stateTarget = safeRelativePath(root, statePath).target
    if (Object.keys(next.files).length) await atomicWriteFile(stateTarget, `${JSON.stringify(next, null, 2)}\n`, 0o600)
    else await rm(stateTarget, { force: true })
    return {
      operation: 'uninstall', dryRun: false, changes, state: next,
      audit: safeAuditEvent({ operation: 'managed-uninstall', target: root, outcome: next.files && Object.keys(next.files).length ? 'partial' : 'success' })
    }
  } catch (error) {
    try { await restoreSnapshots(snapshots); error.rollbackSucceeded = true } catch (rollbackError) {
      rollbackError.rollbackFailed = true
      throw rollbackError
    }
    throw error
  }
}

export { DEFAULT_STATE_PATH, readInstallState, validateInstallState, validateStateMetadata } from './state.js'
export { assertNoSymlinkAncestors } from '../security-guard/index.js'
export { inventoryLegacyProviderHome, migrateLegacyProviderHome } from './migration.js'
export { loadGeneratedFiles } from './source.js'
export { loadExternalSources, stageExternalSkills, SKILLS_CLI_INTEGRITY, SKILLS_CLI_TREE_SHA256, SKILLS_CLI_VERSION } from './external.js'
