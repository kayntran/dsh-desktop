/**
 * Which icon stands for a plugin.
 *
 * Nothing on disk says what a plugin looks like: neither DeepSeek's packages nor
 * the community catalog carry an image. So the icon is derived, and it is derived
 * from KEYWORDS in the package name rather than from a per-plugin table. A table
 * would be one more list to keep in step — every engine upgrade brings packages
 * nobody has written a row for, and they would all fall to the same blank default.
 * A keyword rule gives them a sensible icon the day they arrive.
 *
 * Every icon here comes from the engine's own set (Rule 4). Sizes are forced to 16
 * so a 14-sized and a 20-sized glyph do not sit at different weights in one grid.
 * @module
 */

import type { ReactNode } from 'react'
import {
  IconAgentPresetOutline16,
  IconArchiveOutline20,
  IconBranchOutline16,
  IconCodeOutline16,
  IconCordisPluginOutline14,
  IconDataOutline16,
  IconFolderOpenOutline16,
  IconGlobeOutline14,
  IconGoalOutline16,
  IconNewChatOutline16,
  IconPersonalizationOutline16,
  IconQueueOutline14,
  IconSearchOutline16,
  IconSendOutline16,
  IconSkillOutline16,
  IconSparkle16,
  IconThinkOutline16,
} from '@deepseek-ai/dsh-client-ui-primitives'

/** Uniform glyph size, so mixed-size icons line up in the card grid. */
const ICON_SIZE = 16

type IconComponent = (props: { size?: number }) => ReactNode

/**
 * Keyword rules, tried in order — first match wins.
 *
 * Order matters where words overlap: `web-search` should read as search, not as
 * web, so the narrower rule comes first.
 */
const RULES: ReadonlyArray<readonly [RegExp, IconComponent]> = [
  [/search|grep|find|lookup/, IconSearchOutline16],
  [/bash|shell|terminal|pty|exec|command|sandbox/, IconCodeOutline16],
  [/browser|web|fetch|http|crawl|url|net/, IconGlobeOutline14],
  [/file|fs\b|folder|attachment|upload|read|edit/, IconFolderOpenOutline16],
  [/skill/, IconSkillOutline16],
  [/agent|preset|subagent|team/, IconAgentPresetOutline16],
  [/model|llm|provider|relay|token|billing|usage/, IconDataOutline16],
  [/memory|knowledge|rag|recall|growth|profile/, IconThinkOutline16],
  [/notify|notification|webhook|bot|mail|slack|telegram/, IconSendOutline16],
  [/session|chat|message|conversation|compact/, IconNewChatOutline16],
  [/job|queue|workflow|schedule|cron|automation|loop/, IconQueueOutline14],
  [/git|branch|diff|commit|review/, IconBranchOutline16],
  [/goal|todo|task|plan/, IconGoalOutline16],
  [/theme|skin|style|css|dock|panel|sidebar|layout|^ui-|-ui-|client-ui/, IconPersonalizationOutline16],
  [/store|market|archive|history/, IconArchiveOutline20],
  [/fun|pet|game|toy|meme/, IconSparkle16],
]

/** Catalog categories, which are a cleaner signal than the name when present. */
const BY_CATEGORY: Readonly<Record<string, IconComponent>> = {
  tools: IconCodeOutline16,
  ui: IconPersonalizationOutline16,
  dev: IconBranchOutline16,
  session: IconNewChatOutline16,
  model: IconDataOutline16,
  skill: IconSkillOutline16,
  workflow: IconQueueOutline14,
  notify: IconSendOutline16,
  fun: IconSparkle16,
  theme: IconPersonalizationOutline16,
  memory: IconThinkOutline16,
}

/** The glyph shown when nothing more specific matches: the engine's plugin mark. */
function fallback(): ReactNode {
  return <IconCordisPluginOutline14 size={ICON_SIZE} />
}

/**
 * Icon for an installed plugin, chosen from its package name.
 * @param moduleName - the package name as the loader knows it.
 * @returns the icon element.
 */
export function pluginIcon(moduleName: string): ReactNode {
  const name = moduleName.toLowerCase()
  for (const [pattern, Icon] of RULES) {
    if (pattern.test(name)) return <Icon size={ICON_SIZE} />
  }
  return fallback()
}

/**
 * Icon for a catalog entry: category first, then the name as a fallback.
 * @param category - the catalog's category id, when it has one.
 * @param name - the plugin's name, used when the category says nothing.
 * @returns the icon element.
 */
export function marketIcon(category: string | undefined, name: string): ReactNode {
  const Icon = category === undefined ? undefined : BY_CATEGORY[category]
  if (Icon !== undefined) return <Icon size={ICON_SIZE} />
  return pluginIcon(name)
}
