/**
 * The Growth settings page: one load, four tabs.
 *
 * Tabs rather than one long scroll because the four things have nothing to do
 * with each other in the moment — writing your profile and clearing a stale fact
 * are separate errands, and stacking them made the page ask to be scrolled past
 * rather than read.
 *
 * "What the model sees" stays OUTSIDE the tabs, collapsed. It answers a question
 * that spans all four — what actually reaches the model, once comments and dates
 * are stripped — so it belongs to no single tab.
 *
 * **Level 1 — additive only.** `settings.section` is a `list` slot; upstream's own
 * sections stay exactly where they were and this one joins the nav below them.
 * @module
 */

import { useCallback, useEffect, useState } from 'react'
import { Button, IconRefreshOutline16, IconWarningOutline16 } from '@deepseek-ai/dsh-client-ui-primitives'
import type { PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
// Pull upstream's slot declarations into the program: without them
// `settings.section` is not a known slot name here either.
import type {} from '@deepseek-ai/dsh-client-ui-settings/client'
import {
  approveSkill,
  clearFacts,
  deleteFact,
  fetchState,
  rejectSkill,
  type GrowthState,
  type ProfileView,
} from './api.ts'
import { FactList } from './FactList.tsx'
import { ModelViewCard } from './ModelViewCard.tsx'
import { ProfileCard } from './ProfileCard.tsx'
import { SkillQueue } from './SkillQueue.tsx'
import { TabStrip } from './TabStrip.tsx'

/** Full props of the section, assembled by the Settings slot renderer. */
export type GrowthSectionProps = PropsRuntime<'settings.section'>

type ViewState =
  | { status: 'loading' }
  | { status: 'error', reason: string }
  | { status: 'ready', data: GrowthState }

/**
 * The Growth section.
 * @returns the page element.
 */
export function GrowthSection(_props: GrowthSectionProps): React.JSX.Element {
  const [state, setState] = useState<ViewState>({ status: 'loading' })
  const [tab, setTab] = useState('user')
  // Bumped after every mutation so the model-view card knows to re-read rather
  // than showing text that no longer matches the list above it.
  const [revision, setRevision] = useState(0)

  const load = useCallback(async () => {
    try {
      setState({ status: 'ready', data: await fetchState() })
    } catch (error) {
      setState({ status: 'error', reason: error instanceof Error ? error.message : String(error) })
    }
    setRevision((current) => current + 1)
  }, [])

  useEffect(() => { void load() }, [load])

  if (state.status === 'loading') {
    return <div className="hdw-gr"><p className="hdw-gr-status">Reading…</p></div>
  }

  if (state.status === 'error') {
    return (
      <div className="hdw-gr">
        <p className="hdw-gr-notice" role="alert">
          <IconWarningOutline16 />
          <span>Could not read what the assistant knows: {state.reason}</span>
        </p>
        <div className="hdw-gr-actions">
          <Button
            variant="outline"
            icon={<IconRefreshOutline16 />}
            onClick={() => { setState({ status: 'loading' }); void load() }}
          >
            Retry
          </Button>
        </div>
      </div>
    )
  }

  const { data } = state
  const saved = (next: ProfileView): void => {
    setState({
      status: 'ready',
      data: next.kind === 'soul' ? { ...data, soul: next } : { ...data, user: next },
    })
    setRevision((current) => current + 1)
  }

  const tabs = [
    { id: 'user', label: 'About you' },
    { id: 'soul', label: 'Soul' },
    { id: 'skills', label: 'Skills', badge: data.pendingSkills.length },
    { id: 'facts', label: 'Remembered facts', badge: data.facts.length },
  ]

  return (
    <div className="hdw-gr">
      {/* Heading and intro in upstream's own shape — every other settings section
          opens with an 18px h2 and one tertiary line. Dropping them made this
          page start abruptly at a tab strip while its neighbours did not. */}
      <h2 className="hdw-gr-title">Growth</h2>
      <p className="hdw-gr-intro">
        What the assistant knows about you, and how it works with you.
      </p>

      {data.setupPending
        ? (
          <p className="hdw-gr-notice" role="status">
            <IconWarningOutline16 />
            <span>
              The assistant will ask who you are on your next message. Writing these yourself works
              just as well.
            </span>
          </p>
          )
        : null}

      <TabStrip tabs={tabs} active={tab} onSelect={setTab} />

      {tab === 'user' ? (
        <ProfileCard
          profile={data.user}
          note="Who you are. Read at the start of every conversation, in every project."
          onSaved={saved}
        />
      ) : null}

      {tab === 'soul' ? (
        <ProfileCard
          profile={data.soul}
          note="How the assistant should behave with you. Read at the start of every conversation."
          onSaved={saved}
        />
      ) : null}

      {tab === 'skills' ? (
      <SkillQueue
        pending={data.pendingSkills}
        onApprove={async (id: string) => {
          const result = await approveSkill(id)
          setState({ status: 'ready', data: { ...data, pendingSkills: result.pendingSkills } })
          setRevision((current) => current + 1)
        }}
        onReject={async (id: string) => {
          const result = await rejectSkill(id)
          setState({ status: 'ready', data: { ...data, pendingSkills: result.pendingSkills } })
          setRevision((current) => current + 1)
        }}
      />
      ) : null}

      {tab === 'facts' ? (
      <FactList
        facts={data.facts}
        factLimit={data.factLimit}
        onDelete={async (id: string) => {
          const result = await deleteFact(id)
          setState({ status: 'ready', data: { ...data, facts: result.facts } })
          setRevision((current) => current + 1)
        }}
        onClear={async () => {
          const result = await clearFacts()
          setState({ status: 'ready', data: { ...data, facts: result.facts } })
          setRevision((current) => current + 1)
        }}
      />
      ) : null}

      <ModelViewCard revision={revision} />
    </div>
  )
}
