#!/usr/bin/env bun
import { evaluateProviderEvent, nativeHookDecision } from '../src/hooks/providers.js'
import { readBoundedHookInput } from '../src/hooks/policy.js'
import { assertBunRuntime } from '../src/runtime/bun.js'
import { fileURLToPath } from 'node:url'

await assertBunRuntime({ sourceRoot: fileURLToPath(new URL('../', import.meta.url)) })

const providerIndex = process.argv.indexOf('--provider')
const provider = providerIndex >= 0 ? process.argv[providerIndex + 1] : undefined
const eventIndex = process.argv.indexOf('--event')
const event = eventIndex >= 0 ? process.argv[eventIndex + 1] : 'PreToolUse'
if (!provider || process.argv.includes('--help')) {
  process.stdout.write('Usage: ai-config guard --provider <claude|codex|gemini|opencode> [--event <name>]\n')
  process.exitCode = provider ? 0 : 2
} else {
  const input = await readBoundedHookInput(process.stdin)
  const decision = evaluateProviderEvent(provider, input)
  const output = nativeHookDecision(provider, decision, event)
  if (output) process.stdout.write(`${JSON.stringify(output)}\n`)
  // Native hook protocols carry the decision in stdout; the command itself
  // remains successful so providers can consume deny/allow uniformly.
  process.exitCode = 0
}
