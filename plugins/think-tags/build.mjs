/**
 * Builds the plugin's single half.
 *
 * - `lib/index.js` — Node half, runs inside the engine process.
 *
 * There is no client half: this plugin never draws anything, it only rewrites
 * the stream the engine already renders.
 *
 *   node build.mjs
 */

import * as esbuild from 'esbuild'

await esbuild.build({
  bundle: true,
  sourcemap: true,
  logLevel: 'warning',
  entryPoints: ['src/index.ts'],
  outfile: 'lib/index.js',
  format: 'esm',
  platform: 'node',
  target: 'node22',
  packages: 'external',
})

console.log('lib/index.js built')
