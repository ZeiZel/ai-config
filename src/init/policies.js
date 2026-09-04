import { readdir, readFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { parse } from 'yaml'

export async function loadAndValidatePolicies({ specsDir, specKitVersion, specKitCommit, skillsCliVersion, skillsCliIntegrity, skillsCliTreeSha256 } = {}) {
  const root = resolve(specsDir, 'policies'); const policies = new Map()
  for (const entry of await readdir(root, { withFileTypes: true })) {
    if (!entry.isFile() || !entry.name.endsWith('.yaml')) continue
    const value = parse(await readFile(join(root, entry.name), 'utf8'))
    if (!value || value.schemaVersion !== 1) throw new Error(`invalid policy document: ${entry.name}`)
    policies.set(entry.name.slice(0, -5), value)
  }
  for (const name of ['security', 'project-init', 'external-install']) if (!policies.has(name)) throw new Error(`required policy is missing: ${name}`)
  const security = policies.get('security')
  if (security.environment?.inheritProcessEnvironment !== false || security.audit?.metadataOnly !== true) throw new Error('security policy must deny environment inheritance and raw audit payloads')
  const init = policies.get('project-init')
  if (init.specKit?.version !== specKitVersion || init.specKit?.resolvedCommit !== specKitCommit || init.specKit?.directProjectWrites !== false) throw new Error('project-init policy does not match the pinned staged implementation')
  const external = policies.get('external-install')
  if (String(external.skillsCli?.version) !== skillsCliVersion || external.skillsCli?.lockIntegrity !== skillsCliIntegrity || external.skillsCli?.installedTreeSha256 !== skillsCliTreeSha256 || external.skillsCli?.runtime !== 'bun' || external.skillsCli?.packageManager !== 'bun' || external.skillsCli?.requireFrozenLockfile !== true || external.skillsCli?.noInstall !== true) throw new Error('external install policy does not match the locked Bun skills CLI integrity')
  if (external.externalSources?.requireCatalogLockMatch !== true || external.externalSources?.requireArchiveSha256 !== true || external.externalSources?.requireResolvedCommit !== true || external.externalSources?.stageOutsideProject !== true || external.externalSources?.publishThroughManagedInstaller !== true || external.externalSources?.consumeVerifiedArchiveSubtree !== true || external.externalSources?.rejectSelectedSubtreeLinks !== true) throw new Error('external install policy weakens required supply-chain gates')
  return { security, projectInit: init, externalInstall: external }
}
