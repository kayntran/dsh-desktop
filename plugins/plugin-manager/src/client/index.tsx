/**
 * Client half of the plugin switch. The engine serves this file at
 * `/plugins/harness-desktop-plugin-manager/client.js`.
 *
 * **Level 1 — additive only.** One registration, into `settings.plugins.tab` — a
 * `list` slot upstream leaves open and already fills with their own read-only
 * "Plugin list" tab. Theirs stays; ours sits beside it.
 * @module
 */

import type { ClientContext } from '@deepseek-ai/dsh-client-runtime/client'
import { PluginSwitchTab } from './PluginSwitchTab.tsx'
import styles from './styles.css'

// Pull upstream's slot declarations into the program. Without this line
// `settings.plugins.tab` does not exist as far as the type system is concerned.
import type {} from '@deepseek-ai/dsh-client-ui-settings/client'

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
  // `order` 20 puts this tab AFTER upstream's "Plugin list" (order 10): their
  // read-only list is the place to look, this tab is the place to act.
  ctx.slots.inject('settings.plugins.tab', () => ctx.slots.register({
    name: 'settings.plugins.tab',
    id: 'hdw-switch',
    order: 20,
    label: 'On/off',
  }, PluginSwitchTab))
}
