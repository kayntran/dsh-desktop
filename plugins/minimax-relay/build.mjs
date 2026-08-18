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
  // Two entries: the plugin itself, and the pure half on its own so the spike can
  // import it without dragging in a module that expects the engine around it.
  entryPoints: ['src/index.ts', 'src/relay.ts'],
  outdir: 'lib',
  format: 'esm',
  platform: 'node',
  target: 'node22',
  packages: 'external',
})

console.log('lib/index.js + lib/relay.js built')
