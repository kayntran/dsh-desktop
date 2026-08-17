/**
 * The workspace gate: a path sent up by the client is only accepted when it is a
 * workspace **registered with the engine**.
 *
 * This is a server-side decision. Letting the client declare its own root directory
 * means one edited URL browses the whole drive — and with the Terminal tab it is worse
 * still: a shell anywhere. The workspace list is the one thing the client cannot
 * invent.
 *
 * Split out of `fs-routes.ts` because the Files tab and the Terminal tab need exactly
 * this same gate. A security gate copied into two places is a gate that eventually
 * drifts apart.
 * @module
 */

import type { Context } from '@deepseek-ai/cordis'
import type { FsTarget } from '@deepseek-ai/dsh-fs'

// Pull the extra declarations into the program: these packages attach `fs` and
// `workspaceRegistry` to `Context` through declaration merging, and the merge only
// applies when the module is genuinely part of the program.
import type {} from '@deepseek-ai/dsh-workspace'

/**
 * Resolve a path and confirm it is a registered workspace.
 *
 * Compared AFTER resolving rather than as strings: `C:/x` and `C:\x` are the same
 * directory yet differ character by character. String comparison rejects a valid
 * spelling for reasons nobody can see, while this way the gate stays intact — only a
 * registered directory passes, however it is spelled.
 * @param ctx - the plugin's context; needs `fs` and `workspaceRegistry`.
 * @param root - the path the client sent up.
 * @returns the resolved target, or undefined when it is not a registered workspace.
 */
export async function resolveWorkspaceRoot(ctx: Context, root: string): Promise<FsTarget | undefined> {
  let target: FsTarget
  try {
    target = await ctx.fs.resolve(root)
  } catch {
    return undefined
  }
  const registered = await Promise.all(
    ctx.workspaceRegistry.list().map(async (workspace) => {
      try {
        return (await ctx.fs.resolve(workspace.path)).targetKey
      } catch {
        // A workspace pointing at a deleted directory — skip it, do not fail the whole request.
        return undefined
      }
    }),
  )
  return registered.includes(target.targetKey) ? target : undefined
}
