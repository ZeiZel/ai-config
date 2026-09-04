import { readdir, readFile } from 'node:fs/promises'
import { readFileSync } from 'node:fs'
import { join, relative, resolve } from 'node:path'
import { parse } from 'yaml'
import Ajv2020 from 'ajv/dist/2020.js'
import { fail } from './errors.js'
import { assertSafeInput } from './paths.js'

const PROVIDERS = ['claude', 'codex', 'opencode', 'gemini']
const ajv = new Ajv2020({ allErrors: true, strict: false })
const metaSchema = JSON.parse(readFileSync(new URL('../../ai-specs/schemas/meta.schema.json', import.meta.url), 'utf8'))
const catalogSchema = JSON.parse(readFileSync(new URL('../../ai-specs/schemas/catalog.schema.json', import.meta.url), 'utf8'))
const metaValidate = ajv.compile(metaSchema)
const catalogValidate = ajv.compile(catalogSchema)

async function dirs(root) {
  try {
    const entries = await readdir(root, { withFileTypes: true })
    for (const entry of entries) if (entry.isSymbolicLink()) fail(`symlink in spec input: ${join(root, entry.name)}`)
    return entries.filter(x => x.isDirectory()).map(x => x.name)
  }
  catch (e) { if (e.code === 'ENOENT') return []; throw e }
}

function validateMeta(meta, location) {
  if (!metaValidate(meta)) fail(`${location}: ${ajv.errorsText(metaValidate.errors)}`)
  return meta
}

export async function loadSpecs(specRoot) {
  const root = resolve(specRoot)
  const skillsRoot = join(root, 'skills')
  await assertSafeInput(root, root)
  await assertSafeInput(root, skillsRoot)
  const skills = []
  for (const name of await dirs(skillsRoot)) {
    const dir = join(skillsRoot, name)
    const metaFile = join(dir, 'meta.yaml'); const bodyFile = join(dir, 'body.md')
    await assertSafeInput(root, dir); await assertSafeInput(root, metaFile); await assertSafeInput(root, bodyFile)
    let meta, body
    try { meta = parse(await readFile(metaFile, 'utf8')) } catch (e) { fail(`${relative(root, metaFile)}: cannot read meta.yaml (${e.message})`) }
    try { body = await readFile(bodyFile, 'utf8') } catch (e) { fail(`${relative(root, bodyFile)}: cannot read body.md (${e.message})`) }
    validateMeta(meta, relative(root, metaFile))
    if (meta.id !== name) fail(`${relative(root, metaFile)}: id must match directory name`)
    skills.push({ kind: 'skill', id: meta.id, meta, body, dir })
  }
  skills.sort((a, b) => a.id.localeCompare(b.id))
  const ids = new Set()
  for (const skill of skills) { if (ids.has(skill.id)) fail(`duplicate spec id: ${skill.id}`); ids.add(skill.id) }
  for (const skill of skills) for (const dependency of skill.meta.requires || []) {
    if (!ids.has(dependency)) fail(`${skill.id}: unresolved requirement ${dependency}`)
    const dependencySkill = skills.find(candidate => candidate.id === dependency)
    for (const provider of skill.meta.providers) if (!dependencySkill.meta.providers.includes(provider)) fail(`${skill.id}: provider ${provider} requires ${dependency} for the same provider`)
  }
  const byId = new Map(skills.map(skill => [skill.id, skill])); const visiting = new Set(); const visited = new Set()
  function visit(skill) {
    if (visiting.has(skill.id)) fail(`skill dependency cycle: ${[...visiting, skill.id].join(' -> ')}`)
    if (visited.has(skill.id)) return
    visiting.add(skill.id)
    for (const dependency of skill.meta.requires || []) visit(byId.get(dependency))
    visiting.delete(skill.id); visited.add(skill.id)
  }
  for (const skill of skills) visit(skill)
  const catalogFile = join(root, 'providers', 'catalog.yaml')
  await assertSafeInput(root, join(root, 'providers')); await assertSafeInput(root, catalogFile)
  let catalog = { providers: {} }
  try { catalog = parse(await readFile(catalogFile, 'utf8')) } catch (e) { if (e.code !== 'ENOENT') fail(`${relative(root, catalogFile)}: ${e.message}`) }
  if (!catalogValidate(catalog)) fail(`providers/catalog.yaml: ${ajv.errorsText(catalogValidate.errors)}`)
  if (!catalog.providers || typeof catalog.providers !== 'object') fail('providers/catalog.yaml: providers must be an object')
  const providers = Object.keys(catalog.providers).sort()
  if (providers.length !== PROVIDERS.length || providers.some(provider => !PROVIDERS.includes(provider))) fail(`providers/catalog.yaml: expected providers ${PROVIDERS.join(',')}`)
  for (const provider of PROVIDERS) {
    const config = catalog.providers[provider]
    if (!config || typeof config.skillDir !== 'string' || !config.skillDir || !config.skillDir.startsWith('.')) fail(`providers/catalog.yaml: invalid skillDir for ${provider}`)
  }
  return { skills, providers, catalog }
}

export { PROVIDERS }
