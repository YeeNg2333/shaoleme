#!/usr/bin/env node
/**
 * Self-check for the two Cordis plugin halves.
 *
 * `host.js` and `client.js` are function BODIES handed to `cordis_define`
 * (each begins with `return {`), so they are not stand-alone modules and
 * `node --check <file>` cannot parse them. Each body is instead compiled with
 * `new AsyncFunction(source)` — which permits both `await` and a plain
 * `return { ... }` — and then invoked once; both bodies only build a plugin
 * object at the top level (every side effect lives inside `apply`), so this is
 * a pure syntax plus shape check.
 */
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = dirname(dirname(fileURLToPath(import.meta.url)))
const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor
const TARGETS = ['host.js', 'client.js']

let failed = false
for (const name of TARGETS) {
  let source
  try {
    source = readFileSync(join(root, name), 'utf8')
  } catch (error) {
    failed = true
    console.error(`FAIL ${name}: cannot read (${error.message})`)
    continue
  }
  try {
    if (!source.includes('return {')) throw new Error('a plugin body must `return { ... }`')
    const plugin = await new AsyncFunction(source)()
    if (plugin === null || typeof plugin !== 'object') throw new Error('the body must return a plugin object')
    if (typeof plugin.apply !== 'function') throw new Error('the returned plugin must expose apply(ctx)')
    const inject = plugin.inject === undefined ? '' : ` inject: [${[].concat(plugin.inject).join(', ')}]`
    console.log(`ok   ${name}${inject}`)
  } catch (error) {
    failed = true
    console.error(`FAIL ${name}: ${error.message}`)
  }
}

if (failed) {
  console.error('\nplugin body check failed')
  process.exit(1)
}
console.log('\nplugin body check passed')
