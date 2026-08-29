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
  }, [attachment, load, attempt])

  const onActivate = useCallback(() => {
    if (failed) setAttempt((n) => n + 1)
    else if (url !== undefined) setZoomed(true)
  }, [failed, url])

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
          ? <img src={url} alt={labels.image} width={attachment.width} height={attachment.height} />
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
