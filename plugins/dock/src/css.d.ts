/**
 * `build.mjs` loads `.css` files as strings (`loader: { '.css': 'text' }`), because
 * the client bundle has to be a single script file — letting esbuild split the CSS
 * into its own file means the module loader would never fetch it. This declaration
 * tells TypeScript that.
 * @module
 */

declare module '*.css' {
  const content: string
  export default content
}
