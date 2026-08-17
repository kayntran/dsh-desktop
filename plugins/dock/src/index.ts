/**
 * The right-hand panel's Node half: it runs inside the dsh engine process and serves
 * data to the client half over same-origin loopback HTTP.
 *
 * The client half lives in `src/client/` and is served by the engine at
 * `/plugins/harness-desktop-dock/client.js`. The two halves do not use Electron's
 * IPC — the app window points straight at the engine's web UI, so `fetch` is
 * same-origin, and that is the very path every other upstream plugin takes.
 * @module
 */

import type { Context } from '@deepseek-ai/cordis'
import type { ToolRunContext } from '@deepseek-ai/dsh-tools'
import { registerBusRoutes, type ToolProbe } from './bus-routes.ts'
import { registerFsRoutes } from './fs-routes.ts'
import { registerImageRoutes } from './image-routes.ts'
import { registerPtyRoutes } from './pty-routes.ts'
import { registerShotRoutes } from './shot-routes.ts'
import { registerBrowserTools } from './tools.ts'

export const name = 'harness-desktop-dock'

/**
 * Services that must exist before `apply` runs. Cordis keeps the fiber pending until
 * they all do, so there is no need to check for them.
 */
export const inject = ['webServer', 'fs', 'workspaceRegistry', 'tools', 'attachments']

/**
 * Plugin body.
 * @param ctx - the plugin's context.
 */
export function apply(ctx: Context): void {
  ctx.effect(() => registerFsRoutes(ctx), 'hdw-dock: Files routes')
  ctx.effect(() => registerPtyRoutes(ctx), 'hdw-dock: Terminal routes')
  ctx.effect(() => registerImageRoutes(ctx), 'hdw-dock: screenshot image route')
  // The bridge to the client half, and the tool set standing on it.
  //
  // These two have to share one `effect`: the tools hold a reference to `bus`, so
  // disposing the bridge while leaving the tools alive leaves a tool set calling into
  // nothing — every agent request times out, with no error reported. One lifetime
  // means they live together and die together.
  ctx.effect(() => {
    const shot = registerShotRoutes(ctx)
    // An empty slot, filled in just below. The bridge must exist first because the tools hold a reference to it.
    const probe: ToolProbe = {}
    const { bus, dispose } = registerBusRoutes(ctx, async (id) => shot.link.capture(id), probe)
    const { tools, dispose: offTools } = registerBrowserTools(ctx, bus, shot.link)

    probe.run = async (name, args) => {
      const tool = tools.find((t) => t.name === name)
      if (tool === undefined) {
        throw new Error(`there is no tool named "${name}" — available: ${tools.map((t) => t.name).join(', ')}`)
      }
      // No agent is running on this path, and every tool has to withstand that:
      // `modelReadsImages` asks through `exec.agent?` and then fails closed. That is
      // exactly the branch DeepSeek's models take every day.
      const exec = { signal: AbortSignal.timeout(90_000) } as unknown as ToolRunContext
      // `execute` is declared to return `unknown` while `render` demands JSON — and the
      // value passing through here IS JSON: it just travelled over the WebSocket
      // bridge. The cast lives in exactly one place.
      const value = await tool.execute(args, exec) as never
      const blocks = tool.output.render(args as never, value) as Array<{ type?: string, text?: string }>
      return {
        value: value as unknown,
        text: blocks.filter((b) => b.type === 'text').map((b) => b.text ?? '').join('\n'),
        meta: tool.output.presentationMeta?.(args as never, value),
      }
    }

    return () => { offTools(); shot.dispose(); dispose() }
  }, 'hdw-dock: bridge and browser tool set')
}
