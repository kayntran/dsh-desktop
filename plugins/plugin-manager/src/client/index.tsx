/**
 * Client half of the plugin manager. The engine serves this file at
 * `/plugins/harness-desktop-plugin-manager/client.js`.
 *
 * **Level 1 — additive only.** One registration, into `sidebar.footer.action` — a
 * `list` slot upstream leaves open, rendered just above the Settings row.
 * Upstream's own Cordis panel already sits in that list; ours joins it.
 *
 * This used to register a tab into `settings.plugins.tab` instead. That tab is
 * gone on purpose: one job deserves one place, and Settings was the wrong one —
 * managing plugins now includes installing them, which is not a setting. Upstream's
 * read-only "Plugin list" tab inside Settings is untouched.
 * @module
 */

import type { ClientContext } from '@deepseek-ai/dsh-client-runtime/client'
import { PluginsPage } from './PluginsPage.tsx'
import styles from './styles.css'

// Pull upstream's slot declarations into the program. Without this line
// `sidebar.footer.action` does not exist as far as the type system is concerned.
import type {} from '@deepseek-ai/dsh-client-ui-sidebar/client'

export const name = 'harness-desktop-plugin-manager'

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
  ctx.effect(injectStyles, 'hdw-plugin-manager: css')

  // `ctx.slots.inject` is required: registering straight into a slot that has not
  // been declared throws. It waits until the slot owner mounts, and re-registers if
  // that owner crashes and comes back.
  //
  // `order` 20 leaves room below upstream's own footer entry (the Cordis panel),
  // so the app's shipped control keeps its place and ours lands under it.
  ctx.slots.inject('sidebar.footer.action', () => ctx.slots.register({
    name: 'sidebar.footer.action',
    id: 'hdw-plugins',
    order: 20,
    label: 'Plugins',
  }, PluginsPage))
}
