/**
 * The one-line readout under the composer: what the background pass just did.
 *
 * **Level 1 — additive only.** `conversation.composer.dock` is a `list` slot; the
 * stats line upstream already puts there stays exactly where it is, and this sits
 * beside it in the same band.
 *
 * It is the only place the user learns a review ran at all — which matters,
 * because a pass costs real tokens. Staying silent about that would be hiding a
 * cost, so the line reports one even when the outcome was "nothing kept".
 * @module
 */

import { useCallback, useEffect, useRef, useState } from 'react'
import { Button, Modal } from '@deepseek-ai/dsh-client-ui-primitives'
import type { PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
// Pull upstream's slot declarations into the program: without them
// `conversation.composer.dock` is not a known slot name here.
import type {} from '@deepseek-ai/dsh-client-ui-conversation/client'
import { fetchSessionStatus, type SessionStatus } from './api.ts'
import { SkillDiff } from './SkillDiff.tsx'

/** Full props of the strip, assembled by the conversation slot renderer. */
export type ComposerLineProps = PropsRuntime<'conversation.composer.dock'>

/** How often the strip re-reads while it is watching for a pass. */
const RUNNING_POLL_MS = 4000

/**
 * How long the strip keeps watching after a turn ends.
 *
 * A pass is scheduled after the turn is committed, not during it, and then takes
 * seconds to run. Reading once at turn end would almost always land in the gap
 * before the pass starts, see nothing, and stay silent for the rest of the page's
 * life — which is exactly the bug this window closes.
 */
const WATCH_MS = 90 * 1000

/** How long after a finished pass the line keeps reporting it. */
const FRESH_MS = 15 * 60 * 1000

function ago(stamp: number): string {
  const minutes = Math.floor((Date.now() - stamp) / 60000)
  if (minutes < 1) return 'just now'
  return `${String(minutes)}m ago`
}

/**
 * The composer readout.
 * @param props - the owner share; only the session id is read.
 * @returns the strip, or null when there is nothing to report.
 */
export function ComposerLine(props: ComposerLineProps): React.JSX.Element | null {
  const sessionId = props.session.sessionId
  const turnRunning = props.session.running
  const [status, setStatus] = useState<SessionStatus | null>(null)
  const [open, setOpen] = useState(false)
  // When the watch began, or 0 when the strip is idle. Kept as state rather than
  // a ref because the polling effect has to restart when it changes.
  const [watchFrom, setWatchFrom] = useState(0)
  const wasRunning = useRef(false)

  const load = useCallback(async () => {
    try {
      const next = await fetchSessionStatus(sessionId)
      setStatus(next)
      // Stop watching as soon as the question is answered: a pass finished after
      // the watch began, or the window ran out and none did.
      setWatchFrom((from) => {
        if (from === 0 || next.running) return from
        if (next.latest !== null && next.latest.finishedAt >= from) return 0
        return Date.now() - from > WATCH_MS ? 0 : from
      })
    } catch {
      // A failed read leaves the strip silent. It is an ambient readout; an
      // error banner here would shout about something the user did not ask for.
      setStatus(null)
    }
  }, [sessionId])

  useEffect(() => { void load() }, [load])

  // The turn just ended, which is the only moment a pass can start. `session` is
  // a point-in-time snapshot re-rendered by the slot owner, so this transition
  // arrives without subscribing to anything.
  useEffect(() => {
    if (wasRunning.current && !turnRunning) setWatchFrom(Date.now())
    wasRunning.current = turnRunning
  }, [turnRunning])

  // Polls only while watching, then stops. A permanent timer under every open
  // conversation would be a cost nobody sees.
  useEffect(() => {
    if (status?.running !== true && watchFrom === 0) return undefined
    const timer = setInterval(() => { void load() }, RUNNING_POLL_MS)
    return () => { clearInterval(timer) }
  }, [status?.running, watchFrom, load])

  if (status === null) return null

  if (status.running) {
    return <span className="hdw-gr-line">Growth review · looking back over this conversation…</span>
  }

  const { latest, pendingSkills } = status
  const fresh = latest !== null && Date.now() - latest.finishedAt < FRESH_MS
  if (!fresh && pendingSkills.length === 0) return null

  const parts: string[] = []
  if (latest !== null && fresh) {
    if (latest.failure !== undefined) parts.push('review could not finish')
    else if (latest.saved === 0 && latest.proposed === 0) parts.push(`nothing kept · ${ago(latest.finishedAt)}`)
    else {
      if (latest.saved > 0) parts.push(`remembered ${String(latest.saved)}`)
      if (latest.proposed > 0) parts.push(`proposed ${String(latest.proposed)} skill`)
      parts.push(ago(latest.finishedAt))
    }
  }
  if (pendingSkills.length > 0) {
    parts.push(`${String(pendingSkills.length)} waiting for you`)
  }

  return (
    <>
      <span className="hdw-gr-line">
        Growth review · {parts.join(' · ')}
        {pendingSkills.length > 0
          ? (
            <Button variant="ghost" size="sm" onClick={() => { setOpen(true) }}>
              Preview
            </Button>
            )
          : null}
      </span>

      <Modal
        open={open}
        title="Skills this conversation proposed"
        onClose={() => { setOpen(false) }}
      >
        <div className="hdw-gr-modal">
          {pendingSkills.map((skill) => (
            <SkillDiff key={skill.id} skill={skill} />
          ))}
          <p className="hdw-gr-note">
            Nothing here is active yet. Approve or reject them under Settings → Growth.
          </p>
        </div>
      </Modal>
    </>
  )
}
