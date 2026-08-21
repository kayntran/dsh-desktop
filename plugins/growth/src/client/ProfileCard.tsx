/**
 * One hand-written page — Soul or About you — edited straight in place.
 *
 * There is no Edit button and no read-only view: the box IS the file. A settings
 * page that makes you press Edit before typing is asking you to declare an
 * intention the click already declared.
 *
 * What the box shows is the RAW file, comments and all. What the model receives
 * is narrower — comments and dates are stripped — and that gap is answered by the
 * "What the model sees" panel below the tabs rather than by a second copy here.
 * @module
 */

import { useEffect, useState } from 'react'
import { Button, IconWarningOutline16 } from '@deepseek-ai/dsh-client-ui-primitives'
import { saveProfile, type ProfileView } from './api.ts'
import { TextEditor } from './TextEditor.tsx'

/**
 * The editable page.
 * @param props - the page state, its wording, and a callback for a saved write.
 * @returns the card element.
 */
export function ProfileCard({ profile, note, onSaved }: {
  profile: ProfileView
  note: string
  onSaved: (next: ProfileView) => void
}): React.JSX.Element {
  const [draft, setDraft] = useState(profile.rawText)
  const [busy, setBusy] = useState(false)
  const [notice, setNotice] = useState<string | null>(null)

  // Re-seed when the file changes underneath — a save on the other tab, or the
  // assistant appending a line while this page is open. Keyed on the file's own
  // text so a draft in progress is never silently replaced by an identical read.
  useEffect(() => { setDraft(profile.rawText) }, [profile.rawText])

  const dirty = draft !== profile.rawText
  const over = draft.length > profile.limit

  const save = (): void => {
    setBusy(true)
    setNotice(null)
    void saveProfile(profile.kind, draft)
      .then((result) => { onSaved(result.profile); setNotice('Saved.') })
      .catch((error: unknown) => { setNotice(error instanceof Error ? error.message : String(error)) })
      .finally(() => { setBusy(false) })
  }

  return (
    <section className="hdw-gr-card">
      <div className="hdw-gr-head">
        <p className="hdw-gr-note">{note}</p>
        <Button variant="primary" disabled={busy || !dirty || over} onClick={save}>
          Save
        </Button>
      </div>

      <TextEditor
        value={draft}
        onChange={setDraft}
        limit={profile.limit}
        label={profile.kind === 'user' ? 'About you' : 'Soul'}
        disabled={busy}
      />

      <p className="hdw-gr-status">
        <code>{profile.path}</code>
      </p>

      {notice === null ? null : (
        <p className="hdw-gr-notice" role="status">
          <IconWarningOutline16 />
          <span>{notice}</span>
        </p>
      )}
    </section>
  )
}
