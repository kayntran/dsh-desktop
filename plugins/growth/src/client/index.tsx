/**
 * Client half of Soul and Memory. The engine serves this file at
 * `/plugins/harness-desktop-growth/client.js`.
 *
 * **Level 1 — additive only.** One registration, into `settings.section` — a
 * `list` slot upstream already fills with General, Models, Agent presets and
 * Plugins. Theirs stay; ours joins the nav below them.
 * @module
 */

import type { ClientContext } from '@deepseek-ai/dsh-client-runtime/client'
import { ComposerLine } from './ComposerLine.tsx'
import { GrowthSection } from './GrowthSection.tsx'
import styles from './styles.css'

// Pull upstream's slot declarations into the program. Without these lines the
// slot names do not exist as far as the type system is concerned.
import type {} from '@deepseek-ai/dsh-client-ui-settings/client'
import type {} from '@deepseek-ai/dsh-client-ui-conversation/client'

export const name = 'harness-desktop-growth'

export const inject = ['slots']

/**
 * Inject the plugin's CSS with an ownership tag, following upstream's convention
 * for plugin stylesheets — the tag is how the module teardown knows whose it is.
 * @returns the disposer that removes the style tag.
 */
function injectStyles(): () => void {
  const tag = document.createElement('style')
  tag.dataset['plugin'] = name
  tag.dataset['pluginCss'] = `${name}/styles.css`
  tag.textContent = styles
  document.head.append(tag)
  return () => { tag.remove() }
}

/**
 * Plugin body on the browser side.
 * @param ctx - the client-side root context.
 */
export function apply(ctx: ClientContext): void {
  ctx.effect(injectStyles, 'hdw-growth: css')

  // `ctx.slots.inject` is required: registering straight into a slot that has not
  // been declared throws. It waits until the slot owner mounts, and re-registers
  // if that owner crashes and comes back.
  //
  // `order` 25 puts the page after upstream's own four sections — General 0,
  // Models 10, Plugins 15, Agent presets 20. There is no icon option: the shell
  // picks the nav glyph from the section id and everything it does not recognize
  // gets the gear.
  ctx.slots.inject('settings.section', () => ctx.slots.register({
    name: 'settings.section',
    id: 'growth',
    order: 25,
    label: 'Growth',
  }, GrowthSection))

  // The band under the composer card, where upstream already keeps its stats
  // line. It is a `list` slot, so both sit there — `order` 10 puts ours after
  // theirs. This is the one place the user learns a review ran at all.
  ctx.slots.inject('conversation.composer.dock', () => ctx.slots.register({
    name: 'conversation.composer.dock',
    id: 'growth-review',
    order: 10,
  }, ComposerLine))
}
