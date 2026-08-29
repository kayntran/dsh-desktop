/**
 * The image inside the `browser_screenshot` result card, with a full-size view on click.
 *
 * **Level 1 — additive only.** Nothing upstream is replaced; this renders inside our own
 * tool card, which claims only our own tool's key.
 *
 * ## Why this file has to exist
 *
 * Until dsh 0.1.0-rc.6 this card used `MessageImage` from `dsh-client-ui-attachment`,
 * which brought its own loading states and lightbox. From 0.1.1-rc.2 that package
 * deliberately stopped exporting React components as package values — its client half
 * now says so in one line: "Register attachment presentation without exporting React
 * components as package values." It fills the `conversation.message.images` slot
 * instead, and that slot belongs to message bodies, not to a tool card.
 *
 * Checked before writing, per Rule 4: none of the 25 primitives in `ui-primitives` draws
 * an image, and no service face hands out a preview. So the loading states are written
 * here — but the frame around the enlarged image is still upstream's `Modal`, and every
 * color is a `--dsw-*` variable, so this follows light and dark mode like everything
 * beside it.
 * @module
 */

import { useCallback, useEffect, useState } from 'react'
import type { ImageAttachmentRef } from '@deepseek-ai/dsh-attachment'
import { Modal } from '@deepseek-ai/dsh-client-ui-primitives'

/** Copy shown around the image. Passed in rather than held here, because this file has no locale. */
export interface ScreenshotImageLabels {
  /** Alt text for the image itself. */
  image: string
  /** Title of the enlarged view. */
  lightbox: string
  /** Accessible label for the enlarged view's close button. */
  close: string
  /** Shown while the image is being fetched. */
  loading: string
  /** Shown when the fetch failed; the block stays clickable to retry. */
  loadFailed: string
}

/** What the card hands this component. */
export interface ScreenshotImageProps {
  /** The stored image to draw. */
  attachment: ImageAttachmentRef
  /**
   * Resolve a viewable address for the stored image.
   * @param attachment - the image reference.
   * @returns an address usable in an `<img>` tag.
   */
  load: (attachment: ImageAttachmentRef) => Promise<string>
  /** Copy shown around the image. */
  labels: ScreenshotImageLabels
}

/**
 * Draw a stored screenshot, and open it full size when clicked.
 * @param props - see {@link ScreenshotImageProps}.
 * @returns the image block.
 */
export function ScreenshotImage({ attachment, load, labels }: ScreenshotImageProps): React.JSX.Element {
  const [url, setUrl] = useState<string | undefined>(undefined)
  const [failed, setFailed] = useState(false)
  // Bumped by a retry click; re-runs the effect without duplicating the fetch here.
  const [attempt, setAttempt] = useState(0)
  const [zoomed, setZoomed] = useState(false)

  /**
   * What identifies the picture, as a plain string.
   *
   * The effect below keys on THIS rather than on `attachment`, and the difference is not
   * cosmetic. The card assembles `attachment` from the block's raw data inside its render
   * body, so the object is new on every render, and slot entries are not memoized — every
   * repaint of the conversation would therefore re-run the effect and clear `failed`. A
   * card sitting on "could not load" would flip back to the image, ask for the missing
   * bytes again, fail again, and go on flickering for as long as an answer was streaming
   * beside it. The other fields travel with this id (they come from the same result), so
   * the address the effect builds does not go stale.
   */
  const attachmentId = String(attachment.attachmentId)

  useEffect(() => {
    // The card also renders while the user scrolls back through an old session, so a
    // resolved address can arrive after this card is gone. Dropping the late result
    // keeps React from warning about a set on an unmounted tree.
    let live = true
    setFailed(false)
    load(attachment)
      .then((address) => {
        if (live) setUrl(address)
      })
      .catch(() => {
        if (live) setFailed(true)
      })
    return () => {
      live = false
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- see `attachmentId` above.
  }, [attachmentId, load, attempt])

  const onActivate = useCallback(() => {
    if (failed) setAttempt((n) => n + 1)
    else if (url !== undefined) setZoomed(true)
  }, [failed, url])

  /**
   * The image itself could not be fetched.
   *
   * This is the ONLY route into the failed state, and it has to exist: `load` resolves a
   * `/hdw/image?...` address by assembling a string, so it never rejects, and the fetch
   * that can actually fail is the one the browser performs from `src`. Without this
   * handler a screenshot whose bytes are gone — an old session whose attachment was
   * pruned, so the route answers 404 — painted the browser's broken-image glyph with no
   * explanation and no way to retry, while every line below that reads `failed` sat
   * unreachable.
   */
  const onImageError = useCallback(() => {
    setFailed(true)
  }, [])

  const closeZoom = useCallback(() => {
    setZoomed(false)
  }, [])

  return (
    <>
      <button
        type="button"
        className="hdw-shot-thumb"
        data-state={failed ? 'error' : url === undefined ? 'loading' : 'ok'}
        onClick={onActivate}
        // A failed block retries; a loaded one enlarges; a loading one does neither.
        disabled={!failed && url === undefined}
        aria-label={failed ? labels.loadFailed : labels.lightbox}
      >
        {url !== undefined && !failed
          // `key` is what makes the retry a real retry. The address does not change
          // between attempts, so React would otherwise keep the same element and the
          // browser would never ask for the picture again; keying on the attempt count
          // mounts a fresh tag, which starts a fresh request.
          ? (
              <img
                key={attempt}
                src={url}
                alt={labels.image}
                width={attachment.width}
                height={attachment.height}
                onError={onImageError}
              />
            )
          : <span className="hdw-shot-status">{failed ? labels.loadFailed : labels.loading}</span>}
      </button>
      {zoomed && url !== undefined && (
        <Modal
          open
          onClose={closeZoom}
          title={labels.lightbox}
          closeLabel={labels.close}
          className="hdw-shot-zoom"
          contentClassName="hdw-shot-zoom-body"
        >
          <img src={url} alt={labels.image} />
        </Modal>
      )}
    </>
  )
}
