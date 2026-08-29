/**
 * The `browser_screenshot` result card — where the image appears for the user.
 *
 * **Level 1 — additive only.** `tool.call.toolview` is a slot keyed by TOOL NAME, and
 * the key here is our own tool. Upstream states it plainly in the slot declaration:
 * claiming a key nobody holds is additive; claiming an existing tool's key is taking
 * its place. The other eleven tools still use upstream's default row, so they still
 * receive every future improvement to it.
 *
 * ## Why this file has to exist
 *
 * An earlier version declared `presentResult` returning `{ card: 'generic', content:
 * [image] }`, correct per the contract, and **nothing appeared**. Reading the web UI's
 * source explains it: `GenericToolCard` only reads five structured card kinds —
 * terminal, file read, diff, search, web. Nobody reads the `generic` kind; the row is
 * still built from the tool's name and its raw parameter JSON. So all twelve tools'
 * `presentCall`/`presentResult` are currently dead code in this app. They stay as they
 * are (they match the contract, and another UI might use them), but the route that puts
 * an image on screen has to be this file.
 *
 * The lesson cost more than the bug: 60 automated checks were all green, because both
 * suites asked *what does that function return* without asking *does anything call it*.
 *
 * ## Building the row by hand — checked first, per Rule 4
 *
 * Upstream's `ToolRow` and `GenericToolCard` are **not exported** from the
 * `dsh-client-ui-tool` package; it exports only `apply`, `inject` and a few types. So the
 * row frame has to be built by hand. In exchange, every material inside it is the
 * system's own: icons from `ui-primitives`, the enlarged view's frame from that package's
 * `Modal`, and colors only from `--dsw-alias-*` variables. The image block itself lives
 * in `ScreenshotImage.tsx`, which records why it too had to be written by hand.
 * @module
 */

import { useCallback } from 'react'
import type { ImageAttachmentRef } from '@deepseek-ai/dsh-attachment'
import { ScreenshotImage } from './ScreenshotImage.tsx'
// Upstream's 70 icons include NO camera — counted. The globe is used instead, the same
// one the browser panel uses, so this card reads as "a browser thing" rather than
// importing some off-key drawing of our own.
import { IconGlobeOutline14 } from '@deepseek-ai/dsh-client-ui-primitives'
import type { InjectFace } from '@deepseek-ai/dsh-client-ui-slots'
import type { ToolCallViewProps } from '@deepseek-ai/dsh-client-ui-tool/client'

/** The tool name this card claims. Must match `browser_screenshot` in `tools.ts`. */
export const SCREENSHOT_TOOL = 'browser_screenshot'

/** What the plugin passes into the card. */
export interface ScreenshotCardInjected {
  /**
   * Get a viewable address for a stored image.
   * @param attachment - the image reference rebuilt from the card's data.
   * @returns an address usable in an `<img>` tag.
   */
  loadShot: (attachment: ImageAttachmentRef) => Promise<string>
}

/** The card's full props. */
export type ScreenshotCardProps =
  ToolCallViewProps
  & InjectFace<ScreenshotCardInjected>

/**
 * The shape `browser_screenshot` carries with its result, enough to rebuild the image
 * reference without asking the engine again.
 */
interface ScreenshotMeta {
  attachment_id?: unknown
  media_type?: unknown
  width?: unknown
  height?: unknown
  bytes?: unknown
  seen_by_model?: unknown
}

/**
 * Rebuild the image reference from the data carried with a result.
 *
 * It has to withstand MISSING and UNEXPECTED data: this card also runs when the user
 * scrolls back through an old session, and an old session may have been written by an
 * earlier plugin build. A missing field returns `undefined` and the card shows text only
 * — it does not throw, because throwing here breaks the whole conversation frame.
 * @param meta - the raw data carried with the result.
 * @returns the image reference, or undefined when there is not enough to draw.
 */
function toAttachment(meta: unknown): ImageAttachmentRef | undefined {
  if (typeof meta !== 'object' || meta === null) return undefined
  const shot = meta as ScreenshotMeta
  const id = shot.attachment_id
  const width = shot.width
  const height = shot.height
  if (typeof id !== 'string' || id === '') return undefined
  if (typeof width !== 'number' || typeof height !== 'number') return undefined
  if (width <= 0 || height <= 0) return undefined
  return {
    attachmentId: id as ImageAttachmentRef['attachmentId'],
    mediaType: (typeof shot.media_type === 'string' ? shot.media_type : 'image/png') as ImageAttachmentRef['mediaType'],
    bytes: typeof shot.bytes === 'number' ? shot.bytes : 0,
    width,
    height,
    name: 'Page screenshot',
  }
}

/** The copy shown inside the image block. It arrives as props rather than living in the
 * image component, because that component holds no locale. */
const IMAGE_LABELS = {
  image: 'Page screenshot',
  lightbox: 'Page screenshot, full size',
  close: 'Close',
  loading: 'Loading the image…',
  loadFailed: 'Could not load the image — click to retry',
}

/**
 * The screenshot command's result card.
 * @param props - see {@link ScreenshotCardProps}.
 * @returns the card rendered in the conversation stream.
 */
export function ScreenshotCard({ block, loadShot }: ScreenshotCardProps): React.JSX.Element {
  const load = useCallback(
    async (attachment: ImageAttachmentRef) => loadShot(attachment),
    [loadShot],
  )

  // `'kind' in block` is how upstream tells a running call from a finished one; keep
  // that exact test rather than inventing another.
  const done = 'kind' in block
  const failed = done && block.isError
  const attachment = done ? toAttachment(block.meta) : undefined

  return (
    <div className="hdw-shot-card" data-state={!done ? 'running' : failed ? 'error' : 'ok'}>
      <div className="hdw-shot-head">
        <IconGlobeOutline14 />
        <span className="hdw-shot-title">Page screenshot</span>
        <span className="hdw-shot-note">
          {!done
            ? 'capturing…'
            : failed
              ? 'capture failed'
              : attachment === undefined
                ? 'no image'
                : `${String(attachment.width)}×${String(attachment.height)}`}
        </span>
      </div>
      {attachment !== undefined && (
        <div className="hdw-shot-image">
          <ScreenshotImage attachment={attachment} load={load} labels={IMAGE_LABELS} />
        </div>
      )}
    </div>
  )
}
