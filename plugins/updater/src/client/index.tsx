/**
 * Client half of the app-update surface. The engine serves this file at
 * `/plugins/harness-desktop-updater/client.js`.
 *
 * **Level 1 — additive only**, in both places:
 *
 * - `settings.general.item` — a `list` slot upstream calls "the additive seat for a
 *   single setting that needs no page of its own". Language, Appearance and the
 *   composer's Enter key stay exactly where they were.
 * - `shell.overlay` — a `list` slot upstream leaves deliberately unowned, for "a
 *   badge, a toast stack or a status pill". The panel's entry keeps its place.
 *
 * Neither registration replaces anything, so both keep receiving whatever DeepSeek
 * does to those areas next.
 * @module
 */

import type { ClientContext } from '@deepseek-ai/dsh-client-runtime/client'
import { UpdatePill } from './UpdatePill.tsx'
import { UpdateRow } from './UpdateRow.tsx'
import styles from './styles.css'

// Pull upstream's slot declarations into the program. Without these lines
// `settings.general.item` and `shell.overlay` do not exist as far as the type
// system is concerned.
import type {} from '@deepseek-ai/dsh-client-ui-settings/client'
import type {} from '@deepseek-ai/dsh-client-ui-layout/client'

export const name = 'harness-desktop-updater'

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
 * Register both surfaces.
 * @param ctx - client root context.
 */
export function apply(ctx: ClientContext): void {
  ctx.effect(injectStyles)

  // After the panel's own two rows (order 50 and 60), because this is about the app
  // itself rather than about a feature, and upstream's core options come first.
  ctx.slots.inject('settings.general.item', () => ctx.slots.register({
    name: 'settings.general.item',
    id: 'hdw-update',
    order: 70,
  }, UpdateRow))

  ctx.slots.inject('shell.overlay', () => ctx.slots.register({
    name: 'shell.overlay',
    id: 'hdw-update-pill',
  }, UpdatePill))
}
