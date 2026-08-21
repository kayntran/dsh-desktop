/**
 * `build.mjs` loads `.css` files as strings (`loader: { '.css': 'text' }`), because a
 * client bundle has to be one single script file — letting esbuild emit a separate
 * CSS file means the module loader never picks it up. This declaration tells
 * TypeScript about that.
 * @module
 */

declare module '*.css' {
  const content: string
  export default content
}
