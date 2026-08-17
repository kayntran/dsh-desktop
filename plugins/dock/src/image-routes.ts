/**
 * The route that fetches a stored image's bytes so the result card can display it:
 * `/hdw/image`.
 *
 * ## Why this route has to exist at all
 *
 * The engine already has a route for the UI to read images (`session.readAttachment`),
 * and it **refuses** ours. Measured during a real run with a real model; the refusal
 * reads *"Image is not referenced by this session."*
 *
 * Their rule, read from `packages/host/apiproxy/src/api-proxy.ts`: the UI may only
 * read an image when the session transcript holds an `image` block **the model can
 * see**. And such a block is only allowed to exist when the model route can read
 * images — upstream states the reason itself in `tool-fs/src/read-image.ts`: a tool
 * result enters the session history, so pushing an image into a route that cannot
 * carry images corrupts every later turn on that route.
 *
 * Those two rules add up to a hard constraint: **DeepSeek's models cannot read
 * images, so the image never enters the transcript, so the UI can never ask to read it
 * through their route.** There is no way around that within their frame without lying
 * about the model's capabilities.
 *
 * So the image is still saved into the engine's attachment store — content-addressed,
 * durable across restarts, no transcript bloat — while reading it back travels this
 * route.
 *
 * ## The trade-off, stated plainly
 *
 * This route does **not** check whether the image belongs to the session being viewed,
 * which is exactly the check upstream imposes. Two things stand in its place:
 *
 * - `isTrustedRequest`, the same as every other `/hdw/*` route;
 * - and the image id is the **sha256 of the image's own content** — fetching an image
 *   requires knowing its hash first, and knowing the hash means already having the image.
 *
 * So what is given up is not "anyone can read images", it is "a page inside the app
 * could read another session's image if it already knew the hash". What is gained is
 * that the project owner can see what the agent just saw.
 * @module
 */

import type { IncomingMessage, ServerResponse } from 'node:http'
import type { Context } from '@deepseek-ai/cordis'
import type { ImageAttachmentRef } from '@deepseek-ai/dsh-attachment'
import { isTrustedRequest } from './trust.ts'

/** Image types the attachment store accepts. Anything not listed is not served. */
const MEDIA_TYPES = new Set(['image/png', 'image/jpeg', 'image/webp', 'image/gif'])

/** Answer an error as plain text. When an image fails, an `<img>` tag only needs to know it failed. */
function fail(res: ServerResponse, status: number, reason: string): void {
  res.writeHead(status, { 'content-type': 'text/plain; charset=utf-8', 'cache-control': 'no-store' })
  res.end(reason)
}

/** Read a positive integer from the query, or undefined. */
function positiveInt(raw: string | null): number | undefined {
  if (raw === null) return undefined
  const value = Number(raw)
  return Number.isInteger(value) && value > 0 ? value : undefined
}

/**
 * Open the `/hdw/image` route.
 * @param ctx - the plugin's context; needs the `attachments` service.
 * @returns a function that removes the route.
 */
export function registerImageRoutes(ctx: Context): () => void {
  return ctx.webServer.register({
    kind: 'exact',
    path: '/hdw/image',
    handler: async (req: IncomingMessage, res: ServerResponse) => {
      if (!isTrustedRequest(req)) { fail(res, 403, 'the request did not pass the trust gate'); return }

      const url = new URL(req.url ?? '/', 'http://127.0.0.1')
      const id = url.searchParams.get('id')
      const mediaType = url.searchParams.get('type') ?? 'image/png'
      const bytes = positiveInt(url.searchParams.get('bytes'))
      const width = positiveInt(url.searchParams.get('w'))
      const height = positiveInt(url.searchParams.get('h'))

      if (id === null || id === '') { fail(res, 400, 'missing id'); return }
      if (!MEDIA_TYPES.has(mediaType)) { fail(res, 400, `unsupported image type: ${mediaType}`); return }
      if (bytes === undefined || width === undefined || height === undefined) {
        // The attachment store checks the bytes against the exact reference it recorded,
        // so it needs all five fields. Refuse here while the error is still readable
        // rather than letting it break deep inside.
        fail(res, 400, 'missing bytes/w/h')
        return
      }

      const store = ctx.get('attachments')
      if (store === undefined) { fail(res, 503, 'the engine has no attachment store'); return }

      const ref = {
        attachmentId: id, mediaType, bytes, width, height,
      } as unknown as ImageAttachmentRef

      try {
        const stored = await store.readImage(ref)
        const body = Buffer.from(stored.data)
        res.writeHead(200, {
          'content-type': mediaType,
          'content-length': String(body.length),
          // The image id is a hash of the content, so the content behind an id never
          // changes. A long cache is correct, and it eliminates a refetch on every scroll.
          'cache-control': 'private, max-age=31536000, immutable',
        })
        res.end(body)
      } catch (error) {
        fail(res, 404, error instanceof Error ? error.message : String(error))
      }
    },
  })
}
