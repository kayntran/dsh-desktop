/**
 * Turn the image data carried with a result into an address an `<img>` tag can display.
 *
 * Pure string assembly, no fetching: the image bytes are served by the Node half's
 * `/hdw/image` route (see `../image-routes.ts` for why that route has to exist rather
 * than using the engine's `session.readAttachment`). The browser handles the fetch, the
 * cache, and the cancellation on leaving the page — three jobs a hand-written loader
 * could only do worse.
 * @module
 */

import type { ImageAttachmentRef } from '@deepseek-ai/dsh-attachment'

/**
 * A viewable address for a stored image.
 *
 * Same-origin with the page, because the Node half and the client share one web server
 * — which is also the condition `isTrustedRequest` on the other side requires.
 * @param attachment - the image reference rebuilt from the data carried with the result.
 * @returns the address to put in an image tag's `src`.
 */
export function shotUrl(attachment: ImageAttachmentRef): string {
  const query = new URLSearchParams({
    id: String(attachment.attachmentId),
    type: attachment.mediaType,
    bytes: String(attachment.bytes),
    w: String(attachment.width),
    h: String(attachment.height),
  })
  return `/hdw/image?${query.toString()}`
}
