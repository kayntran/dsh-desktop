/**
 * Builds the plugin's two halves.
 *
 * - `lib/index.js`  — Node half, runs inside the engine process.
 * - `lib/client.js` — client half, served to the browser at
 *   `/plugins/harness-desktop-plugin-manager/client.js`.
 *
 * Same shape as `plugins/dock/build.mjs`, including the three guards at the end:
 * they catch mistakes that produce NO runtime error and instead leave a blank
 * screen or a tab that silently never appears.
 *
 *   node build.mjs
 */

import * as esbuild from 'esbuild'
import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

/** Must match `name` in package.json AND `name` in cordis.patch.yml. */
const ID = 'harness-desktop-plugin-manager'

/**
 * Modules that must NOT be bundled: the loader supplies them through the shell's
 * frozen module table, and that table is the page's only copy. Two Reacts in one
 * page break hooks in a way whose cause is unreadable from the symptom.
 *
 * Source of truth: `PLATFORM_MODULES` in
 * `_upstream_dsh/packages/client/web/src/platform.ts`.
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
  '@deepseek-ai/dsh-client-web-react',
  '@deepseek-ai/dsh-client-ui-primitives',
  '@deepseek-ai/dsh-client-ui-attachment',
  '@deepseek-ai/dsh-client-schema-form',
  '@deepseek-ai/dsh-client-runtime/client',
]

const cssAsText = { '.css': 'text' }
const shared = { bundle: true, sourcemap: true, logLevel: 'warning' }

/**
 * Contents of every source file under a directory, recursively.
 * @param {string} dir - the root directory.
 * @returns {string[]} each file's contents.
 */
function docSources(dir) {
  const out = []
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name)
    if (entry.isDirectory()) out.push(...docSources(path))
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
  banner: {
    js: `window.__ModuleLoader__.load({ id: ${JSON.stringify(ID)}, factory: (require) => { "use strict"; var module = { exports: {} }; var exports = module.exports;`,
  },
  footer: { js: 'return module.exports; } });' },
})

// ------------------------------------------------------------------- guards

const out = readFileSync('lib/client.js', 'utf8')
const problems = []

if (!out.startsWith('window.__ModuleLoader__.load(')) {
  problems.push('bundle does not open with a __ModuleLoader__.load call — the loader will ignore it')
}

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

if (problems.length > 0) {
  console.error('\nBUILD FAILED:')
  for (const line of problems) console.error(`  - ${line}`)
  process.exit(1)
}

console.log(`lib/index.js + lib/client.js built (${(out.length / 1024).toFixed(1)} KB client)`)
