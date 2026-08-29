/**
 * The shared poll behind both surfaces.
 *
 * ## Why a poll rather than a push
 *
 * The page cannot be pushed to: the shell reaches the ENGINE, and the engine has no
 * open channel of its own to this plugin's client half. A poll is what is left, and
 * it costs almost nothing — the request never leaves the machine.
 *
 * ## Why two speeds
 *
 * Most of the time nothing is happening and once a minute is plenty. While a
 * download is running the number on screen has to move, so the poll tightens. Both
 * surfaces share this hook, so they never disagree about what is going on.
 * @module
 */

import { useEffect, useState } from 'react'
import { fetchState } from './api.ts'
import type { UpdateState } from '../state.ts'

/**
 * Quiet cadence: nothing is in flight.
 *
 * Three seconds, not sixty. Sixty was the first guess and the acceptance run showed
 * what it costs: press "Check for updates" and the row sits unchanged for up to a
 * minute, so the button reads as broken; finish a download and the pill takes just
 * as long to appear. The request never leaves the machine — it is a loopback GET
 * answering from memory — so the saving was imaginary and the delay was not.
 */
const IDLE_MS = 3_000

/** Busy cadence: a download is running and the percentage should move. */
const BUSY_MS = 700

/** Before the first answer arrives. */
const START: UpdateState = { phase: 'unknown', current: '' }

/**
 * Follow the update state for as long as the component is mounted.
 * @returns the latest state the Node half reported.
 */
export function useUpdateState(): UpdateState {
  const [state, setState] = useState<UpdateState>(START)

  useEffect(() => {
    let live = true
    let timer: ReturnType<typeof setTimeout> | undefined

    const tick = async (): Promise<void> => {
      const next = await fetchState()
      if (!live) return
      setState(next)
      // Read the phase from the ANSWER, not from the state variable: a closure
      // created on mount would keep asking at the idle rate forever, and the
      // percentage would crawl up in one-minute steps.
      timer = setTimeout(() => { void tick() }, next.phase === 'downloading' ? BUSY_MS : IDLE_MS)
    }

    void tick()
    return () => {
      live = false
      if (timer !== undefined) clearTimeout(timer)
    }
  }, [])

  return state
}
