/**
 * The memory half of the Growth page: everything the assistant has saved, grouped
 * by the layer it belongs to.
 *
 * Grouping shows every project, not only the one currently open. The settings
 * panel has no notion of a "current" conversation, so hiding the other projects
 * would make the list quietly lie about what is stored.
 * @module
 */

import { useMemo, useState } from 'react'
import {
  Button,
  IconSearchOutline16,
  IconTrashOutline16,
  Input,
  Pill,
  RiskConfirmation,
} from '@deepseek-ai/dsh-client-ui-primitives'
import type { FactView } from './api.ts'
import { Provenance } from './Provenance.tsx'

/** One heading and the facts under it. */
interface Group {
  key: string
  title: string
  facts: FactView[]
}

function group(facts: readonly FactView[]): Group[] {
  const out: Group[] = []
  const global = facts.filter((fact) => fact.scope === 'global')
  if (global.length > 0) out.push({ key: 'global', title: 'About you, everywhere', facts: global })

  const paths = new Set<string>()
  for (const fact of facts) {
    if (fact.scope !== 'project') continue
    const path = fact.projectPath ?? ''
    if (path.length === 0 || paths.has(path)) continue
    paths.add(path)
    out.push({
      key: path,
      title: path,
      facts: facts.filter((row) => row.projectPath === path),
    })
  }
  return out
}

/**
 * The remembered-facts card.
 * @param props - the facts, the soft cap, and the two mutating callbacks.
 * @returns the card element.
 */
export function FactList({ facts, factLimit, onDelete, onClear }: {
  facts: readonly FactView[]
  factLimit: number
  onDelete: (id: string) => Promise<void>
  onClear: () => Promise<void>
}): React.JSX.Element {
  const [query, setQuery] = useState('')
  const [busyId, setBusyId] = useState<string | null>(null)
  const [clearing, setClearing] = useState(false)
  const [acknowledged, setAcknowledged] = useState(false)

  const groups = useMemo(() => {
    const needle = query.trim().toLocaleLowerCase()
    const visible = needle.length === 0
      ? facts
      : facts.filter((fact) => (
        fact.text.toLocaleLowerCase().includes(needle)
        || (fact.projectPath ?? '').toLocaleLowerCase().includes(needle)
      ))
    return group(visible)
  }, [facts, query])

  const crowded = groups.some((one) => one.facts.length > factLimit / 2)

  return (
    <section className="hdw-gr-card">
      <p className="hdw-gr-note">
        Saved by the assistant as you worked, and treated as true from then on. Delete whatever is
        wrong or out of date.
      </p>

      {facts.length === 0
        ? (
          <p className="hdw-gr-empty">
            Nothing yet. Mention a preference in a conversation — it decides what is worth keeping.
          </p>
          )
        : (
          <>
            <Input
              className="hdw-gr-search"
              icon={<IconSearchOutline16 />}
              type="search"
              value={query}
              placeholder="Search facts"
              aria-label="Search facts"
              onChange={(event: React.ChangeEvent<HTMLInputElement>) => {
                setQuery(event.currentTarget.value)
              }}
            />

            {crowded
              ? (
                <p className="hdw-gr-note">
                  One layer is filling up. Past {String(factLimit)} facts the assistant is refused
                  new ones and has to replace an old one instead.
                </p>
                )
              : null}

            {groups.map((one) => (
              <div className="hdw-gr-group" key={one.key}>
                <h4>{one.title}</h4>
                <ul className="hdw-gr-list">
                  {one.facts.map((fact) => (
                    <li className="hdw-gr-row" key={fact.id}>
                      <div className="hdw-gr-row-text">
                        <p>{fact.text.length === 0 ? '(empty entry — safe to delete)' : fact.text}</p>
                        <div className="hdw-gr-row-meta">
                          <Pill>{fact.source}</Pill>
                          <Provenance createdAt={fact.createdAt} sessionId={fact.sessionId} />
                          <code className="hdw-gr-row-id">{fact.id}</code>
                        </div>
                      </div>
                      <Button
                        variant="outline"
                        size="sm"
                        icon={<IconTrashOutline16 />}
                        disabled={busyId === fact.id}
                        aria-label="Delete this fact"
                        onClick={() => {
                          setBusyId(fact.id)
                          void onDelete(fact.id).finally(() => { setBusyId(null) })
                        }}
                      >
                        Delete
                      </Button>
                    </li>
                  ))}
                </ul>
              </div>
            ))}

            <div className="hdw-gr-actions">
              <Button
                variant="outline"
                icon={<IconTrashOutline16 />}
                onClick={() => { setAcknowledged(false); setClearing(true) }}
              >
                Delete all
              </Button>
            </div>

            <RiskConfirmation
              open={clearing}
              title="Erase everything the assistant remembers?"
              description={
                `All ${String(facts.length)} facts go, across every project. This cannot be undone, `
                + 'and the assistant starts the next conversation knowing nothing about you. Your '
                + 'soul file is not touched.'
              }
              acknowledgeLabel="I understand this cannot be undone"
              cancelLabel="Keep them"
              confirmLabel="Erase everything"
              acknowledged={acknowledged}
              onAcknowledgedChange={setAcknowledged}
              onCancel={() => { setClearing(false) }}
              onConfirm={() => {
                setClearing(false)
                void onClear()
              }}
            />
          </>
          )}
    </section>
  )
}
