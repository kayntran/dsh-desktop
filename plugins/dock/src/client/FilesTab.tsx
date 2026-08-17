/**
 * The Files tab: the current session workspace's directory tree, plus a content viewer.
 *
 * Read-only, like the reference app. There is no file watcher: the tree loads when a
 * directory is expanded and when Reload is pressed. If the agent edits a file the tree
 * does not update itself — said here so nobody later goes looking for a watcher that
 * does not exist.
 *
 * The tree is built flat rather than as recursive components: each row knows its own
 * depth and indents itself. That keeps the component count independent of depth, and if
 * the list ever needs virtualizing for an enormous directory, nothing has to be
 * rewritten.
 * @module
 */

import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  Button,
  IconFolderClose16,
  IconFolderOpen16,
  IconLoadingOutline16,
  IconRefreshOutline16,
  ReadBlock,
  Tooltip,
} from '@deepseek-ai/dsh-client-ui-primitives'
import { fileIcon } from './file-icon.tsx'

/** Ceiling on lines put into the DOM. A longer file still shows its beginning. */
const MAX_LINES = 3000

interface DirEntry {
  name: string
  type: 'file' | 'directory' | 'other'
  size?: number
}

interface FileContent {
  path: string
  size?: number
  truncated?: boolean
  text?: string
  binary?: boolean
}

/** Join one path segment. Windows accepts `/` too, and the server re-normalizes. */
function join(parent: string, name: string): string {
  return parent.endsWith('/') || parent.endsWith('\\') ? `${parent}${name}` : `${parent}/${name}`
}

/** Directories first, files after, alphabetical within each group. */
function sortEntries(entries: readonly DirEntry[]): DirEntry[] {
  return [...entries].sort((a, b) => {
    if ((a.type === 'directory') !== (b.type === 'directory')) return a.type === 'directory' ? -1 : 1
    return a.name.localeCompare(b.name)
  })
}

/** One row with its position in the tree already worked out. */
interface Row {
  path: string
  name: string
  type: DirEntry['type']
  depth: number
}

export interface FilesTabProps {
  /** The root directory — the workspace path, verbatim as the registry holds it. */
  root: string | undefined
  /** Covered because another pane is showing. Not unmounted, only hidden — the expanded
      tree and the scroll position survive until the user comes back. */
  isHidden: boolean
}

/**
 * The Files tab's body.
 * @param props - see {@link FilesTabProps}.
 * @returns the tab element.
 */
export function FilesTab({ root, isHidden }: FilesTabProps): React.JSX.Element {
  const [children, setChildren] = useState<Record<string, DirEntry[]>>({})
  const [expanded, setExpanded] = useState<readonly string[]>([])
  const [loading, setLoading] = useState<readonly string[]>([])
  const [current, setCurrent] = useState<string | undefined>(undefined)
  const [content, setContent] = useState<FileContent | undefined>(undefined)
  const [errorText, setErrorText] = useState<string | undefined>(undefined)

  const load = useCallback(async (path: string): Promise<void> => {
    if (root === undefined) return
    setLoading((prev) => [...prev, path])
    try {
      const res = await fetch(`/hdw/fs/list?root=${encodeURIComponent(root)}&path=${encodeURIComponent(path)}`)
      const body = await res.json() as { entries?: DirEntry[], reason?: string }
      if (!res.ok) { setErrorText(body.reason ?? `error ${String(res.status)}`); return }
      setErrorText(undefined)
      setChildren((prev) => ({ ...prev, [path]: sortEntries(body.entries ?? []) }))
    } catch (error) {
      setErrorText(error instanceof Error ? error.message : 'could not reach the engine')
    } finally {
      setLoading((prev) => prev.filter((p) => p !== path))
    }
  }, [root])

  // On a workspace change, drop all old state and reload from the root — keeping another
  // directory's tree is a sure way to display the wrong data.
  useEffect(() => {
    setChildren({})
    setExpanded([])
    setCurrent(undefined)
    setContent(undefined)
    setErrorText(undefined)
    if (root !== undefined) void load(root)
  }, [root, load])

  const toggleDir = useCallback((path: string): void => {
    setExpanded((prev) => {
      if (prev.includes(path)) return prev.filter((p) => p !== path)
      if (children[path] === undefined) void load(path)
      return [...prev, path]
    })
  }, [children, load])

  const openFile = useCallback(async (path: string): Promise<void> => {
    if (root === undefined) return
    setCurrent(path)
    setContent(undefined)
    try {
      const res = await fetch(`/hdw/fs/read?root=${encodeURIComponent(root)}&path=${encodeURIComponent(path)}`)
      const body = await res.json() as FileContent & { reason?: string }
      if (!res.ok) { setErrorText(body.reason ?? `error ${String(res.status)}`); return }
      setErrorText(undefined)
      setContent(body)
    } catch (error) {
      setErrorText(error instanceof Error ? error.message : 'could not reach the engine')
    }
  }, [root])

  // Walk the tree depth-first, descending only into expanded directories.
  const rows = useMemo((): Row[] => {
    if (root === undefined) return []
    const out: Row[] = []
    const walk = (dir: string, depth: number): void => {
      for (const entry of children[dir] ?? []) {
        const path = join(dir, entry.name)
        out.push({ path, name: entry.name, type: entry.type, depth })
        if (entry.type === 'directory' && expanded.includes(path)) walk(path, depth + 1)
      }
    }
    walk(root, 0)
    return out
  }, [root, children, expanded])

  if (root === undefined) {
    return <div className="hdw-empty" hidden={isHidden}>No session is open yet, so there is no folder to show. Start a session and come back.</div>
  }

  return (
    <div className="hdw-files" hidden={isHidden}>
      <div className="hdw-tabbar">
        <span className="hdw-note" style={{ flex: '1 1 auto', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {root}
        </span>
        <Tooltip label="Reload" side="bottom">
          <Button
            variant="ghost"
            size="sm"
            icon={<IconRefreshOutline16 />}
            aria-label="Reload"
            onClick={() => {
              setChildren({})
              setExpanded([])
              void load(root)
            }}
          />
        </Tooltip>
      </div>

      {errorText !== undefined && <div className="hdw-note">Could not read: {errorText}</div>}

      <div className="hdw-tree">
        {rows.map((row) => (
          <button
            key={row.path}
            type="button"
            className="hdw-row"
            data-current={row.path === current}
            style={{ paddingLeft: `${String(8 + row.depth * 14)}px` }}
            onClick={() => {
              if (row.type === 'directory') toggleDir(row.path)
              else void openFile(row.path)
            }}
          >
            <span className="hdw-row-icon">
              {loading.includes(row.path)
                ? <IconLoadingOutline16 />
                : row.type === 'directory'
                  ? (expanded.includes(row.path) ? <IconFolderOpen16 /> : <IconFolderClose16 />)
                  : fileIcon(row.name)}
            </span>
            <span className="hdw-row-name">{row.name}</span>
          </button>
        ))}
        {rows.length === 0 && loading.length === 0 && <div className="hdw-note">This folder is empty.</div>}
      </div>

      {current !== undefined && (
        <div className="hdw-viewer">
          {content === undefined
            ? <div className="hdw-note">Opening…</div>
            : content.binary === true
              ? <div className="hdw-note">No preview for this file type.</div>
              : <FileView content={content} />}
        </div>
      )}
    </div>
  )
}

/** File content, built with the very component upstream uses to display files. */
function FileView({ content }: { content: FileContent }): React.JSX.Element {
  const all = (content.text ?? '').split('\n')
  const lines = all.slice(0, MAX_LINES).map((text, i) => ({ number: i + 1, text }))
  const ext = content.path.split('.').pop()
  return (
    <>
      <ReadBlock
        label={content.path}
        lines={lines}
        totalLines={all.length}
        lang={ext}
        maxLines={lines.length}
      />
      {content.truncated === true && (
        <div className="hdw-note">Large file — only the beginning is shown.</div>
      )}
    </>
  )
}
