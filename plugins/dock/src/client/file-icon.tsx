/**
 * Pick an icon for a file from its extension.
 *
 * Upstream's set of 70 icons has **no file icon** — DeepSeek has not needed one,
 * because their directory browser lists only directories and never shows files
 * (`ui-directory-picker-browse/src/client/DirectoryBrowser.tsx`). So rather than
 * drawing a file icon set by hand, we borrow the icons they already have and already
 * use for the same meaning elsewhere in the app:
 *
 * - `IconCodeOutline16` is the icon they assign to a tool card's `code` variant
 * - `IconApiOutline14` is the icon they assign to the `bash` variant
 * - `IconGlobeOutline14` is a globe, used for web pages
 * - `IconDataOutline16` is a data block, used for config and data files
 * - `IconListPenOutline16` is a page with a pen, used for text files
 * - `IconPaperclipOutline16` is a paperclip — something attached rather than readable
 *
 * Six groups are enough to tell apart at a glance, and far fewer than a complete
 * extension table nobody could maintain.
 * @module
 */

import {
  IconApiOutline14,
  IconCodeOutline16,
  IconDataOutline16,
  IconGlobeOutline14,
  IconListPenOutline16,
  IconPaperclipOutline16,
} from '@deepseek-ai/dsh-client-ui-primitives'

/** File extensions by group. An extension not listed falls into the "attachment" group. */
const GROUPS: readonly (readonly [React.ReactNode, readonly string[]])[] = [
  [<IconApiOutline14 key="sh" size={16} />, ['sh', 'bash', 'zsh', 'fish', 'ps1', 'psm1', 'bat', 'cmd']],
  [<IconGlobeOutline14 key="web" size={16} />, ['html', 'htm', 'xhtml']],
  [<IconDataOutline16 key="data" />, [
    'json', 'jsonc', 'json5', 'yml', 'yaml', 'toml', 'ini', 'cfg', 'conf', 'env',
    'xml', 'csv', 'tsv', 'sql', 'db', 'sqlite', 'lock', 'properties',
  ]],
  [<IconListPenOutline16 key="text" />, ['md', 'mdx', 'markdown', 'txt', 'text', 'rst', 'adoc', 'log', 'nfo']],
  [<IconCodeOutline16 key="code" />, [
    'js', 'jsx', 'mjs', 'cjs', 'ts', 'tsx', 'mts', 'cts', 'vue', 'svelte', 'astro',
    'py', 'pyi', 'rb', 'php', 'go', 'rs', 'java', 'kt', 'kts', 'swift', 'scala', 'dart',
    'c', 'h', 'cc', 'cpp', 'hpp', 'cxx', 'cs', 'm', 'mm', 'lua', 'pl', 'r', 'jl', 'ex', 'exs',
    'css', 'scss', 'sass', 'less', 'styl', 'graphql', 'gql', 'proto', 'ipynb',
  ]],
]

/**
 * The icon that suits a file type.
 *
 * An extensionless file (`Makefile`, `Dockerfile`, `LICENSE`) falls into the text group
 * — almost always right, and far more right than a paperclip.
 * @param name - the file's name, not its path.
 * @returns a 16px icon element.
 */
export function fileIcon(name: string): React.ReactNode {
  const dot = name.lastIndexOf('.')
  // `.gitignore` has its dot at index 0: that is an extensionless hidden file, not a
  // file with the extension `gitignore`.
  if (dot <= 0) return <IconListPenOutline16 />
  const ext = name.slice(dot + 1).toLowerCase()
  for (const [icon, exts] of GROUPS) {
    if (exts.includes(ext)) return icon
  }
  return <IconPaperclipOutline16 />
}
