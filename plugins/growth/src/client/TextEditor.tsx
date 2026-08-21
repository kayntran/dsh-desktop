/**
 * A multi-line text box — the one piece of chrome in this plugin that is not
 * upstream's.
 *
 * The primitive set has `Input` and nothing else that accepts text, and upstream
 * says why in the first line of `Input.tsx`: textareas "live with the
 * conversation package". The one that lives there is welded into the composer and
 * is not exported, so a page outside a conversation cannot reach it.
 *
 * So this is deliberately the thinnest possible thing: a native `<textarea>`
 * wrapped exactly the way `Input` wraps its native `<input>`, reusing the same
 * `--dsw-*` variables for border, focus ring, background and text. It follows
 * light and dark mode for the same reason theirs does, and it will keep matching
 * the app as long as those variables keep their meaning.
 * @module
 */

import { useId } from 'react'

/**
 * The editor box, with its own character counter.
 * @param props - the controlled value, the budget, and an accessible label.
 * @returns the editor element.
 */
export function TextEditor({ value, onChange, limit, label, rows = 14, disabled = false }: {
  value: string
  onChange: (next: string) => void
  limit: number
  label: string
  rows?: number
  disabled?: boolean
}): React.JSX.Element {
  const countId = useId()
  const over = value.length > limit

  return (
    <div className="hdw-gr-editor">
      <textarea
        className="hdw-gr-editor-box"
        value={value}
        rows={rows}
        spellCheck={false}
        disabled={disabled}
        aria-label={label}
        aria-describedby={countId}
        aria-invalid={over}
        onChange={(event: React.ChangeEvent<HTMLTextAreaElement>) => { onChange(event.currentTarget.value) }}
      />
      <p
        id={countId}
        className={over ? 'hdw-gr-count hdw-gr-count-over' : 'hdw-gr-count'}
        // Announced only once it matters: a counter that speaks on every
        // keystroke makes a screen reader unusable.
        role={over ? 'alert' : undefined}
      >
        {String(value.length)} / {String(limit)} characters
        {over ? ' — too long to save' : null}
      </p>
    </div>
  )
}
