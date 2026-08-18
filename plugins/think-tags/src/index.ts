/**
 * Node half: wrap every model response stream so a provider that writes its
 * chain of thought into the answer as `<think>…</think>` still ends up with a
 * Think row instead of a tagged paragraph.
 *
 * `llm/stream` is a waterfall the engine offers for exactly this — each listener
 * receives the stream the layer below produces and hands one on. Nothing about
 * the adapters, the model catalog, or the settings document changes; a provider
 * that never sends a tag never notices this plugin is loaded.
 * @module
 */

import type { Context } from '@deepseek-ai/cordis'
import type { StreamChunk } from '@deepseek-ai/dsh-llm'
import { rewriteThinkTags } from './rewrite.ts'

export const name = 'harness-desktop-think-tags'

/** The stream seam this plugin wraps; cordis holds the fiber until it exists. */
export const inject = ['llm']

export { rewriteThinkTags, ThinkTagRewriter } from './rewrite.ts'

/**
 * Plugin body.
 * @param ctx - the plugin's context.
 */
export function apply(ctx: Context): void {
  ctx.on('llm/stream', (_options, next): AsyncIterable<StreamChunk> => rewriteThinkTags(next()))
}
