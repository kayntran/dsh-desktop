/**
 * Proof of life for both pillars: the exact text handed to the model.
 *
 * Worth its own card because the two contributions land in different places and
 * fail in different ways. It is also the only detector for a runtime context that
 * has been suppressed — when that happens the memory half simply stops reaching
 * the model, with no error anywhere.
 * @module
 */

import { useCallback, useEffect, useState } from 'react'
import {
  Button,
  DisclosureRow,
  IconRefreshOutline16,
  IconWarningOutline16,
} from '@deepseek-ai/dsh-client-ui-primitives'
import { fetchModelView, type ModelView } from './api.ts'

/**
 * The "What the model sees" card.
 * @param props - a token that changes whenever the underlying data changed.
 * @returns the card element.
 */
export function ModelViewCard({ revision }: { revision: number }): React.JSX.Element {
  const [open, setOpen] = useState(false)
  const [view, setView] = useState<ModelView | null>(null)
  const [failure, setFailure] = useState<string | null>(null)

  const load = useCallback(async () => {
    try {
      setView(await fetchModelView())
      setFailure(null)
    } catch (error) {
      setFailure(error instanceof Error ? error.message : String(error))
    }
  }, [])

  useEffect(() => {
    if (open) void load()
  }, [open, load, revision])

  return (
    <section className="hdw-gr-card">
      <DisclosureRow
        icon={<IconRefreshOutline16 />}
        title="What the model sees"
        open={open}
        expandable
        expandOnRowClick
        onToggle={() => { setOpen(!open) }}
      >
        <p className="hdw-gr-note">
          Everything this page adds to a conversation. The first two open it; the third rides
          alongside and refreshes when it changes.
        </p>

        {failure === null ? null : (
          <p className="hdw-gr-notice" role="alert">
            <IconWarningOutline16 />
            <span>Could not read it back: {failure}</span>
          </p>
        )}

        <p className="hdw-gr-preview-label">About you</p>
        {view?.userSection === null || view?.userSection === undefined
          ? <p className="hdw-gr-empty">Nothing — the file is empty.</p>
          : <pre className="hdw-gr-preview">{view.userSection}</pre>}

        <p className="hdw-gr-preview-label">Soul</p>
        {view?.soulSection === null || view?.soulSection === undefined
          ? <p className="hdw-gr-empty">Nothing — the file is empty.</p>
          : <pre className="hdw-gr-preview">{view.soulSection}</pre>}

        <p className="hdw-gr-preview-label">Remembered facts</p>
        {view?.memoryContext === null || view?.memoryContext === undefined
          ? <p className="hdw-gr-empty">Nothing.</p>
          : <pre className="hdw-gr-preview">{view.memoryContext}</pre>}

        <p className="hdw-gr-note">
          All projects are listed here. A conversation receives your own facts plus the ones for the
          folder it works in.
        </p>

        <div className="hdw-gr-actions">
          <Button variant="outline" icon={<IconRefreshOutline16 />} onClick={() => { void load() }}>
            Refresh
          </Button>
        </div>
      </DisclosureRow>
    </section>
  )
}
