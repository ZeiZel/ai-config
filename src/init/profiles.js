import { readdir, readFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { parse } from 'yaml'

export async function loadProjectProfiles({ specsDir, profileIds = ['base'] } = {}) {
  const root = resolve(specsDir, 'profiles')
  const documents = new Map()
  for (const entry of await readdir(root, { withFileTypes: true })) {
    if (!entry.isFile() || !entry.name.endsWith('.yaml')) continue
    const profile = parse(await readFile(join(root, entry.name), 'utf8'))
    if (!profile || profile.schemaVersion !== 1 || typeof profile.id !== 'string') throw new Error(`invalid project profile: ${entry.name}`)
    if (documents.has(profile.id)) throw new Error(`duplicate project profile: ${profile.id}`)
    documents.set(profile.id, profile)
  }
  const visiting = new Set(); const selected = new Set()
  function visit(id) {
    if (selected.has(id)) return
    if (visiting.has(id)) throw new Error(`project profile cycle: ${id}`)
    const profile = documents.get(id)
    if (!profile) throw new Error(`unknown project profile: ${id}`)
    visiting.add(id)
    for (const parent of profile.extends || []) visit(parent)
    visiting.delete(id); selected.add(id)
  }
  for (const id of profileIds) visit(id)
  const profiles = [...selected].map(id => documents.get(id))
  const collect = key => [...new Set(profiles.flatMap(profile => profile[key] || []))]
  return { ids: [...selected], profiles, skills: collect('skills'), external: collect('external'), mcp: collect('mcp') }
}
