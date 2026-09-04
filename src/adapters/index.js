import { renderSkill } from '../core/render.js'

// Adapters share the normalized skill contract but retain explicit provider names
// so future provider-specific projections cannot silently fall back to another CLI.
export const adapters = Object.fromEntries(['claude', 'codex', 'opencode', 'gemini'].map(provider => [provider, {
  provider,
  renderSkill: spec => renderSkill(spec, provider)
}]))

export function getAdapter(provider) {
  if (!adapters[provider]) throw new Error(`unsupported provider: ${provider}`)
  return adapters[provider]
}
