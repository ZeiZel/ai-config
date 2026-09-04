#!/usr/bin/env bun
import { render } from '../core/render.js'
import { assertBunRuntime } from '../runtime/bun.js'
import { fileURLToPath } from 'node:url'
try {
  await assertBunRuntime({ sourceRoot: fileURLToPath(new URL('../../', import.meta.url)) })
  const args = new Set(process.argv.slice(2)); const result = await render({ check: args.has('--check'), clean: args.has('--clean') })
  if (!args.has('--clean')) console.log(`${result.files.length} generated files`)
} catch (error) { console.error(`render: ${error.message}`); process.exitCode = 1 }
