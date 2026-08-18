/**
 * One row in Settings > General: whether the agent may act on the web page inside the
 * panel.
 *
 * **Level 1 — additive only.** `settings.general.item` is a `list` slot, and upstream
 * plugs several rows into it (language, appearance, Enter-key behaviour). One more row
 * takes nobody's place.
 *
 * Built to upstream's own settings-row shape (`EnterBehaviorRow`): text on the left, the
 * chooser on the right, and that chooser is their `Menu`. Deliberately **no
 * hand-drawn toggle switch**: upstream's primitive set has no such component, and every
 * binary choice in their Settings is a two-item `Menu` — a hand-drawn switch would be
 * the one thing on the page that looks unlike everything else.
 * @module
 */

import { useState } from 'react'
import type { SnapshotStore } from '@deepseek-ai/dsh-client-runtime/client'
import type { InjectFace, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import { IconChevronDownOutline14, Menu } from '@deepseek-ai/dsh-client-ui-primitives'
import type { DockState } from './store.ts'

/** The data the plugin passes into this row. */
export interface AgentControlRowInjected {
  hooks: { dock: SnapshotStore<DockState> }
  actions: { setAgentControl: (allowed: boolean) => void }
}

/** The settings row's full props. */
export type AgentControlRowProps =
  PropsRuntime<'settings.general.item'>
  & InjectFace<AgentControlRowInjected>

/**
 * The "let the agent control the browser" switch row.
 * @param props - see {@link AgentControlRowProps}.
 * @returns the settings row.
 */
export function AgentControlRow({ useDock, actions }: AgentControlRowProps): React.JSX.Element {
  const allowed = useDock((s) => s.agentControl)
  const [open, setOpen] = useState(false)

  return (
    <div className="hdw-setting">
      <div className="hdw-setting-text">
        <div className="hdw-setting-title">Let the agent control the browser</div>
        {/*
          One line, like every other row on this page. The earlier three-sentence version
          explained prompt injection in full and was the only paragraph on the page — it
          read as a warning notice bolted onto a settings list rather than a setting.

          What survives is the part a reader must know to make the choice: whose sessions
          are being used, and what turning it off actually costs. The reasoning behind the
          gate is in `bus.ts` and `net-policy.ts`, which is where a reader who wants it
          will be.
        */}
        <div className="hdw-setting-desc">
          Acts with your signed-in sessions, and page content can steer it. Off: reading only.
        </div>
      </div>
      <Menu
        open={open}
        onClose={() => { setOpen(false) }}
        items={[
          { id: 'on', label: 'On' },
          { id: 'off', label: 'Off' },
        ]}
        selectedId={allowed ? 'on' : 'off'}
        onSelect={(id) => {
          setOpen(false)
          actions.setAgentControl(id === 'on')
        }}
        align="end"
        // `portal` for exactly the same reason as the pill strip's "+" menu: the Settings
        // page has a scrolling region, and a menu anchored inside one gets clipped away.
        portal
        anchor={(
          <button
            type="button"
            className="hdw-setting-pick"
            aria-haspopup="menu"
            aria-expanded={open}
            onClick={() => { setOpen((v) => !v) }}
          >
            {allowed ? 'On' : 'Off'}
            <IconChevronDownOutline14 />
          </button>
        )}
      />
    </div>
  )
}
