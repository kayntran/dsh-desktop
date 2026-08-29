/**
 * Builds the plugin's two halves.
 *
 * - `lib/index.js`  — the Node half, running inside the engine process.
 * - `lib/client.js` — the client half, served to the browser by the engine at
 *   `/plugins/harness-desktop-growth/client.js`.
 *
 * The client half has to follow exactly one format that upstream's module loader
 * dictates (see `_upstream_dsh/packages/client/tsdown.client.ts:262-272`): a classic
 * script with a CJS body that only REGISTERS a factory rather than running the module
 * body. The body runs later, when the module is materialized.
 *
 *   node build.mjs
 */

import * as esbuild from 'esbuild'
import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

/** Must match `name` in package.json AND `name` in cordis.patch.yml. */
const ID = 'harness-desktop-growth'

/**
 * Modules that must NOT be bundled in: the loader supplies them through the shell's
 * frozen module table, and that table is the page's only copy.
 *
 * Two kinds of entry sit in this list. The first seven are the shell's BASELINE table —
 * the specifiers the shipped web bundle seeds the loader with. The last one is a GRAPH
 * ROW: from dsh 0.1.1-rc.2 the loader resolves `<package>/client` to the bundle of an
 * installed plugin package, so any dsh package that ships a client half can be required
 * without being in the baseline table.
 *
 * Source of truth for the baseline, read out of the bundle that actually ships:
 *   node -e "…dist/assets/index-*.js" | grep -oE '@deepseek-ai/[a-z-]+'
 * (`_upstream_dsh/packages/client/web/src/platform.ts` was the source until 0.1.0-rc.6;
 * that file's frozen table is gone, replaced by `dsh-client-modules`.)
 *
 * RE-CHECK THIS LIST AFTER EVERY `/nang-cap-engine`.
 */
const CLIENT_EXTERNALS = [
  'react',
  'react/jsx-runtime',
  'react-dom',
  'react-dom/client',
  '@deepseek-ai/cordis',
  '@deepseek-ai/dsh-client-ui-slots',
  '@deepseek-ai/dsh-client-ui-primitives',
  '@deepseek-ai/dsh-client-runtime/client',
]

/**
 * Pull CSS files into the bundle as strings.
 *
 * esbuild splits `.css` into its own file by default, while the client bundle has to be
 * ONE single script file. Loading it as `text` lets the code inject a `<style>` tag with
 * an ownership marker — exactly how upstream handles a plugin's CSS.
 */
const cssAsText = { '.css': 'text' }

const shared = { bundle: true, sourcemap: true, logLevel: 'warning' }

/**
 * The contents of every source file under a directory, recursively.
 * @param {string} dir - the root directory.
 * @returns {string[]} each file's contents.
 */
function docSources(dir, skip) {
  const out = []
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === skip) continue
    const path = join(dir, entry.name)
    if (entry.isDirectory()) out.push(...docSources(path, skip))
    else if (/\.(ts|tsx)$/.test(entry.name)) out.push(readFileSync(path, 'utf8'))
  }
  return out
}

// ---------------------------------------------------------------- Node half

await esbuild.build({
  ...shared,
  entryPoints: ['src/index.ts'],
  outfile: 'lib/index.js',
  format: 'esm',
  platform: 'node',
  target: 'node22',
  // The plugin has no runtime dependencies of its own — only node builtins and the
  // engine's own services, which arrive through `ctx`. `external` keeps it that way.
  packages: 'external',
})

// -------------------------------------------------------------- client half

await esbuild.build({
  ...shared,
  entryPoints: ['src/client/index.tsx'],
  outfile: 'lib/client.js',
  format: 'cjs',
  platform: 'browser',
  target: 'es2022',
  jsx: 'automatic',
  external: CLIENT_EXTERNALS,
  loader: cssAsText,
  define: { 'process.env.NODE_ENV': '"production"' },
  // esbuild has no `intro`, so this folds into the banner. `"use strict"` only takes
  // effect as the first statement inside the arrow function's body.
  banner: {
    js: `window.__ModuleLoader__.load({ id: ${JSON.stringify(ID)}, factory: (require) => { "use strict"; var module = { exports: {} }; var exports = module.exports;`,
  },
  footer: { js: 'return module.exports; } });' },
})

// ------------------------------------------------------------------- guards
//
// None of the four mistakes below produce any runtime error — they only blank the screen,
// make the page silently vanish, or kill the engine at startup. Catching them here turns
// the build red before the app turns white.

const out = readFileSync('lib/client.js', 'utf8')
const problems = []

if (!out.startsWith('window.__ModuleLoader__.load(')) {
  problems.push('bundle does not open with a __ModuleLoader__.load call — the loader will ignore it')
}

// Every external THAT IS ACTUALLY USED has to survive as a `require(...)` in the build.
// If esbuild managed to bundle one in, the page would carry two copies of React, and
// hooks would break in a way whose cause is unreadable from the symptom.
//
// The whole `src/client/` tree is scanned rather than the entry file alone: the imports
// are spread across individual components, and checking only the entry would leave this
// guard almost permanently silent. `import type ... from '...'` statements are stripped
// first: they emit no code, so there is no `require` to demand. Cut by statement rather
// than by line, because one import can span several lines — and not by semicolon, because
// the code here does not write trailing semicolons.
const src = docSources('src/client').join('\n')
  .replace(/import\s+type\s[\s\S]*?from\s*['"][^'"]+['"]/g, '')

for (const mod of CLIENT_EXTERNALS) {
  const used = src.includes(`'${mod}'`) || src.includes(`"${mod}"`)
  if (used && !out.includes(`require("${mod}")`)) {
    problems.push(`external got bundled instead of being supplied by the loader: ${mod}`)
  }
}

for (const trace of ['Invalid hook call', '__SECRET_INTERNALS', 'react-dom.production']) {
  if (out.includes(trace)) {
    problems.push(`bundle carries a second copy of React (found the string "${trace}")`)
  }
}

// The NODE half must never import an engine package for a VALUE. A plugin resolves
// modules from its own directory, so a value import fails with ERR_MODULE_NOT_FOUND at
// startup and takes the whole engine down with it — no build step catches that, and the
// symptom (app never opens) says nothing about the cause. Type imports emit no code and
// are stripped before the scan.
//
// `src/client/` is deliberately excluded: over there the same packages are legitimate
// value imports, supplied at runtime by the shell's frozen module table.
const nodeSrc = docSources('src', 'client')
  .join('\n')
  .replace(/import\s+type\s[\s\S]*?from\s*['"][^'"]+['"]/g, '')
for (const line of nodeSrc.split('\n')) {
  const hit = /^\s*import\s[^\n]*from\s*['"](@deepseek-ai\/[^'"]+)['"]/.exec(line)
  if (hit !== null) {
    problems.push(`value import from an engine package kills the engine at startup: ${hit[1]}`)
  }
}

if (problems.length > 0) {
  console.error('\nBUILD FAILED:')
  for (const line of problems) console.error(`  - ${line}`)
  process.exit(1)
}

console.log(`lib/index.js + lib/client.js built (${(out.length / 1024).toFixed(1)} KB client)`)
