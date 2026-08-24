/**
 * The approval queue: skills the assistant wrote, waiting for a decision.
 *
 * Nothing here has touched the disk yet. Each row therefore has to answer two
 * questions before the user can decide — what would be written, and whether it
 * replaces something that already exists — so both are on screen before the
 * Approve button is reachable.
 * @module
 */

import { useState } from 'react'
import {
  Button,
  DisclosureRow,
  IconCheckOutline14,
  IconTrashOutline16,
  IconWarningOutline16,
  Pill,
} from '@deepseek-ai/dsh-client-ui-primitives'
import type { PendingSkillView } from './api.ts'
import { Provenance } from './Provenance.tsx'
import { SkillDiff } from './SkillDiff.tsx'

/**
 * The pending-skills card.
 * @param props - the queue and the two decision callbacks.
 * @returns the card element.
 */
export function SkillQueue({ pending, onApprove, onReject }: {
  pending: readonly PendingSkillView[]
  onApprove: (id: string) => Promise<void>
  onReject: (id: string) => Promise<void>
}): React.JSX.Element {
  const [openId, setOpenId] = useState<string | null>(null)
  const [busyId, setBusyId] = useState<string | null>(null)
  const [failure, setFailure] = useState<string | null>(null)

  const act = (id: string, run: (id: string) => Promise<void>): void => {
    setBusyId(id)
    setFailure(null)
    void run(id)
      .catch((error: unknown) => {
        setFailure(error instanceof Error ? error.message : String(error))
      })
      .finally(() => { setBusyId(null) })
  }

  return (
    <section className="hdw-gr-card">
      <p className="hdw-gr-note">
        Procedures the assistant wrote after finishing a task. Nothing runs until you approve it.
      </p>

      {failure === null ? null : (
        <p className="hdw-gr-notice" role="alert">
          <IconWarningOutline16 />
          <span>{failure}</span>
        </p>
      )}

      {pending.length === 0
        ? (
          <p className="hdw-gr-empty">
            Nothing waiting. After a long piece of work the assistant looks back and proposes one
            when it finds something worth keeping.
          </p>
          )
        : pending.map((skill) => (
          <div className="hdw-gr-proposal" key={skill.id}>
            <DisclosureRow
              icon={<IconCheckOutline14 />}
              title={skill.name}
              open={openId === skill.id}
              expandable
              expandOnRowClick
              onToggle={() => { setOpenId(openId === skill.id ? null : skill.id) }}
              collapsedContent={(
                <span className="hdw-gr-row-meta">
                  <Pill>{skill.currentText === null ? 'new' : 'replaces existing'}</Pill>
                  <Pill>{skill.source}</Pill>
                  {/* Scope on the row, not only in the preview: without it two
                      proposals of the same name — one global, one for a project —
                      are indistinguishable in the list, which is exactly the
                      confusion that surfaced with two `gsc` rows. */}
                  <Pill>
                    {skill.scope === 'project'
                      ? `only in ${(skill.projectPath ?? '').split(/[\\/]/).filter(Boolean).pop() ?? 'this project'}`
                      : 'everywhere'}
                  </Pill>
                  <Provenance createdAt={skill.createdAt} sessionId={skill.sessionId} />
                </span>
              )}
            >
              <SkillDiff skill={skill} />
            </DisclosureRow>

            <div className="hdw-gr-actions">
              <Button
                variant="primary"
                icon={<IconCheckOutline14 />}
                disabled={busyId === skill.id}
                onClick={() => { act(skill.id, onApprove) }}
              >
                Approve
              </Button>
              <Button
                variant="outline"
                icon={<IconTrashOutline16 />}
                disabled={busyId === skill.id}
                onClick={() => { act(skill.id, onReject) }}
              >
                Reject
              </Button>
            </div>
          </div>
        ))}
    </section>
  )
}
