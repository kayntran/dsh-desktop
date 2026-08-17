/**
 * Two read-only routes for the Files tab: list a directory and preview a file.
 *
 * Uses upstream's `ctx.fs` rather than `node:fs` directly. The technical reason: it
 * already handles realpath, containment checks, UTF-8 decoding, refusing binary files,
 * and typed error codes. The more important reason: it is **exactly the view the agent
 * has**, so what the user sees in the panel matches what the model sees.
 * @module
 */

import type { IncomingMessage, ServerResponse } from 'node:http'
import type { Context } from '@deepseek-ai/cordis'
import type { FsTarget } from '@deepseek-ai/dsh-fs'
import { isTrustedRequest } from './trust.ts'
import { resolveWorkspaceRoot } from './workspace-guard.ts'

// Pull in these two packages' extra declarations: they attach `webServer` and
// `workspaceRegistry` to `Context` through declaration merging, and the merge only
// applies when the module is part of the program.
import type {} from '@deepseek-ai/dsh-host-webserver'
import type {} from '@deepseek-ai/dsh-workspace'

/** Preview content ceiling. Past it, the content is cut and the answer says so. */
const MAX_PREVIEW_BYTES = 512 * 1024

/** Ceiling on entries returned per directory, so an enormous one cannot hang the UI. */
const MAX_ENTRIES = 2000

/**
 * Directories that never appear in the tree. These are the places holding tens of
 * thousands of files that a user almost never wants to browse by hand.
 */
const HIDDEN_DIRS = new Set(['node_modules', '.git', '.hg', '.svn', '__pycache__', '.venv'])

/** One child entry in the directory tree, trimmed for the UI. */
interface DirEntryView {
  name: string
  type: 'file' | 'directory' | 'other'
  size?: number
}

function json(res: ServerResponse, status: number, body: unknown): void {
  const text = JSON.stringify(body)
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
    'content-length': String(Buffer.byteLength(text)),
  })
  res.end(text)
}

/** `ctx.fs`'s typed error code, or undefined when the error is not one of its own. */
function fsCode(error: unknown): string | undefined {
  const code = (error as { code?: unknown }).code
  return typeof code === 'string' && code.startsWith('FS_') ? code : undefined
}

/**
 * Validate and resolve a (root, path) pair from the query string.
 *
 * The order of the steps here is deliberate and must not be swapped:
 * 1. `root` has to be a registered workspace — this gate is the **server's**
 *    decision; the client cannot declare its own root, so nobody browses the whole
 *    drive by editing a URL.
 * 2. `lstat` runs BEFORE `resolve` — `resolve` follows symlinks, so asking afterwards
 *    is too late: a symlink pointing outside the workspace would be legitimized.
 * 3. `contains` seals it at the end.
 */
async function resolveInsideWorkspace(
  ctx: Context,
  url: URL,
): Promise<{ ok: true, target: FsTarget } | { ok: false, status: number, reason: string }> {
  const root = url.searchParams.get('root')
  const path = url.searchParams.get('path')
  if (root === null || path === null) return { ok: false, status: 400, reason: 'missing root or path' }

  const rootTarget = await resolveWorkspaceRoot(ctx, root)
  if (rootTarget === undefined) {
    return { ok: false, status: 403, reason: 'root is not a registered workspace' }
  }

  const info = await ctx.fs.lstat(path)
  if (info === undefined) return { ok: false, status: 404, reason: 'no such path' }
  if (info.type === 'symlink') return { ok: false, status: 403, reason: 'symlinks are not followed' }

  const target = await ctx.fs.resolve(path)
  if (rootTarget.targetKey !== target.targetKey && !ctx.fs.contains(rootTarget, target)) {
    return { ok: false, status: 403, reason: 'the path is outside the workspace' }
  }
  return { ok: true, target }
}

/**
 * Register the Files tab's two read-only routes.
 * @param ctx - the plugin's context; needs the `webServer`, `fs` and `workspaceRegistry` services.
 * @returns a function that removes both routes.
 */
export function registerFsRoutes(ctx: Context): () => void {
  const guard = (req: IncomingMessage, res: ServerResponse): URL | undefined => {
    if (!isTrustedRequest(req)) {
      json(res, 403, { reason: 'the request did not pass the trust gate' })
      return undefined
    }
    return new URL(req.url ?? '/', 'http://127.0.0.1')
  }

  const offList = ctx.webServer.register({
    kind: 'exact',
    path: '/hdw/fs/list',
    handler: async (req, res) => {
      const url = guard(req, res)
      if (url === undefined) return
      const resolved = await resolveInsideWorkspace(ctx, url)
      if (!resolved.ok) { json(res, resolved.status, { reason: resolved.reason }); return }
      try {
        const info = await ctx.fs.stat(resolved.target)
        if (info?.type !== 'directory') { json(res, 400, { reason: 'not a directory' }); return }
        const children = await ctx.fs.listDir(resolved.target)
        const entries: DirEntryView[] = children
          .filter((child) => !(child.type === 'directory' && HIDDEN_DIRS.has(child.name)))
          .slice(0, MAX_ENTRIES)
          .map((child) => child.size === undefined
            ? { name: child.name, type: child.type }
            : { name: child.name, type: child.type, size: child.size })
        json(res, 200, {
          path: resolved.target.displayPath,
          entries,
          truncated: children.length > MAX_ENTRIES,
        })
      } catch (error) {
        json(res, 500, { reason: fsCode(error) ?? 'the directory could not be read' })
      }
    },
  })

  const offRead = ctx.webServer.register({
    kind: 'exact',
    path: '/hdw/fs/read',
    handler: async (req, res) => {
      const url = guard(req, res)
      if (url === undefined) return
      const resolved = await resolveInsideWorkspace(ctx, url)
      if (!resolved.ok) { json(res, resolved.status, { reason: resolved.reason }); return }
      try {
        const info = await ctx.fs.stat(resolved.target)
        if (info?.type !== 'file') { json(res, 400, { reason: 'not a file' }); return }
        const size = info.size ?? 0
        // A large file: take only the beginning. `readBytes` has a hard ceiling, so this
        // is the only path that does not pull hundreds of megabytes into memory.
        if (size > MAX_PREVIEW_BYTES) {
          const bytes = await ctx.fs.readBytes(resolved.target, undefined, MAX_PREVIEW_BYTES)
          json(res, 200, {
            path: resolved.target.displayPath,
            size,
            truncated: true,
            text: new TextDecoder('utf-8', { fatal: false }).decode(bytes),
          })
          return
        }
        const text = await ctx.fs.readText(resolved.target)
        json(res, 200, { path: resolved.target.displayPath, size, truncated: false, text })
      } catch (error) {
        // A binary file is not a failure — it is a valid answer the UI needs in order to
        // show "this file type cannot be previewed".
        if (fsCode(error) === 'FS_NOT_TEXT') {
          json(res, 200, { path: resolved.target.displayPath, binary: true })
          return
        }
        json(res, 500, { reason: fsCode(error) ?? 'the file could not be read' })
      }
    },
  })

  return () => { offList(); offRead() }
}
