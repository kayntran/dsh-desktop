/**
 * Where one saved thing came from: when, and from which conversation.
 *
 * Every remembered fact and every proposed skill carries this. Without it the
 * lists answer "what does the assistant think" but not "why does it think that",
 * and a fact you cannot trace is a fact you cannot judge.
 * @module
 */

import { Tooltip } from '@deepseek-ai/dsh-client-ui-primitives'

/** Absolute local time, for the tooltip. */
function exact(stamp: number): string {
  if (stamp <= 0) return 'unknown time'
  return new Date(stamp).toLocaleString()
}

/** Coarse relative time, for the line itself. */
function ago(stamp: number): string {
  if (stamp <= 0) return 'unknown'
  const minutes = Math.floor((Date.now() - stamp) / 60000)
  if (minutes < 1) return 'just now'
  if (minutes < 60) return `${String(minutes)}m ago`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${String(hours)}h ago`
  return `${String(Math.floor(hours / 24))}d ago`
}

/**
 * The when-and-where line.
 * @param props - the record's timestamp and originating session.
 * @returns the provenance element.
 */
export function Provenance({ createdAt, sessionId }: {
  createdAt: number
  sessionId?: string | undefined
}): React.JSX.Element {
  // The session id is shown short: it is a correlation handle for the user to
  // match against a chat, not something anyone reads in full.
  const short = sessionId === undefined ? null : sessionId.replace(/^session-/, '').slice(0, 8)
  return (
    <Tooltip
      label={`Saved ${exact(createdAt)}${sessionId === undefined ? '' : ` · chat ${sessionId}`}`}
      side="top"
      maxWidth={320}
    >
      <span className="hdw-gr-provenance" tabIndex={0}>
        {ago(createdAt)}
        {short === null ? null : <> · chat <code>{short}</code></>}
      </span>
    </Tooltip>
  )
}
