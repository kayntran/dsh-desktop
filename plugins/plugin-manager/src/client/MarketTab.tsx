/**
 * The market: what the community has published that this app can install.
 *
 * Every card carries the two facts that decide whether installing is safe — an
 * exact npm package, and the repository it must point back at, one click away —
 * and installing asks once more before it starts. The package is checked against
 * npm itself at that moment (`npm-check.ts`), not merely trusted from the
 * catalog.
 *
 * ## Why the progress is polled
 *
 * The install runs in the engine process and outlives this page, so there is
 * nothing for a socket to keep alive. A poll every half second while a job is
 * running costs one local request and means closing the page mid-install loses
 * nothing: reopening picks the job back up exactly where it is.
 *
 * Search is debounced. The list already lives in the Node half, so a keystroke is
 * a local round trip and never reaches the catalog — but re-rendering sixty cards
 * per character still costs the user a stutter.
 * @module
 */

import { useCallback, useEffect, useRef, useState } from 'react'
import {
  Button,
  IconDownloadOutline16,
  IconRefreshOutline16,
  IconRightUpOutline14,
  IconSearchOutline16,
  IconTrashOutline16,
  IconWarningOutline16,
  Input,
  Pill,
  RiskConfirmation,
  StateDot,
  TerminalBlock,
} from '@deepseek-ai/dsh-client-ui-primitives'
import {
  fetchJob, fetchMarket, installPlugin, refreshMarket, removePlugin, restartEngine,
  type Job, type MarketItem, type MarketPage, type MarketSort,
} from './api.ts'
import { marketIcon } from './plugin-icon.tsx'

/** How long typing settles before the list is asked again. */
const DEBOUNCE_MS = 250

/** How often a running job is asked about. */
const POLL_MS = 500

type ViewState =
  | { status: 'loading' }
  | { status: 'error', reason: string }
  | { status: 'ready', page: MarketPage }

const SORTS: ReadonlyArray<readonly [MarketSort, string]> = [
  ['installs', 'Most installed'],
  ['stars', 'Most starred'],
  ['updated', 'Recently updated'],
]

/** Compact counts: 12400 reads worse than 12.4k in a card corner. */
function compact(value: number): string {
  if (value < 1000) return String(value)
  if (value < 1_000_000) return `${(value / 1000).toFixed(value < 10_000 ? 1 : 0)}k`
  return `${(value / 1_000_000).toFixed(1)}M`
}

/** "3d ago" style, from an ISO date, without pulling in a date library. */
function since(iso: string): string {
  const then = Date.parse(iso)
  if (Number.isNaN(then)) return ''
  const days = Math.floor((Date.now() - then) / 86_400_000)
  if (days <= 0) return 'today'
  if (days === 1) return 'yesterday'
  if (days < 30) return `${days}d ago`
  if (days < 365) return `${Math.floor(days / 30)}mo ago`
  return `${Math.floor(days / 365)}y ago`
}

/**
 * English wording for `TerminalBlock`.
 *
 * Not optional: the primitive's built-in defaults are Chinese, and every caller
 * inside upstream passes its own localized set. Leaving them out put 已完成 and
 * 复制 in the middle of an otherwise English page — caught by opening the real
 * app and looking, which is the only way this kind of thing ever surfaces.
 */
const LOG_LABELS = {
  signal: (signal: string) => `Signal ${signal}`,
  exitCode: (exitCode: number) => `Exit code ${exitCode}`,
  running: 'Running',
  failed: 'Failed',
  done: 'Done',
  copy: 'Copy',
  copied: 'Copied',
  noOutput: 'No output',
  collapseAria: 'Collapse output',
  collapse: 'Collapse',
  expandAria: (hidden: number) => `Expand the remaining ${hidden} lines of output`,
  expand: (hidden: number) => `… ${hidden} more lines`,
}

/** What a job is doing, in one sentence the user can act on. */
function jobHeadline(job: Job): string {
  const what = job.kind === 'install' ? 'Installing' : 'Removing'
  if (job.status === 'running') return `${what} ${job.label}…`
  if (job.status === 'failed') return job.error ?? `Could not finish ${what.toLowerCase()} ${job.label}.`
  return job.kind === 'install'
    ? `${job.label} is installed. Restart the app to load it.`
    : `${job.label} is removed. Restart the app to unload it.`
}

/**
 * The market list.
 * @returns the tab body.
 */
export function MarketTab(): React.JSX.Element {
  const [state, setState] = useState<ViewState>({ status: 'loading' })
  const [query, setQuery] = useState('')
  const [category, setCategory] = useState('')
  const [sort, setSort] = useState<MarketSort>('installs')
  const [page, setPage] = useState(0)
  const [refreshing, setRefreshing] = useState(false)

  const [job, setJob] = useState<Job | null>(null)
  const [installed, setInstalled] = useState<ReadonlySet<string>>(new Set())
  const [showLog, setShowLog] = useState(false)
  /** The plugin waiting for confirmation, and whether the box is checked. */
  const [pending, setPending] = useState<MarketItem | null>(null)
  const [acknowledged, setAcknowledged] = useState(false)
  const [failure, setFailure] = useState<string | null>(null)

  // The query the list currently reflects. Typing updates `query` on every
  // keystroke; this one only follows once typing stops.
  const [settled, setSettled] = useState('')
  useEffect(() => {
    const timer = setTimeout(() => { setSettled(query); setPage(0) }, DEBOUNCE_MS)
    return () => { clearTimeout(timer) }
  }, [query])

  // Guards against an older request landing after a newer one and overwriting it.
  const requestId = useRef(0)

  const load = useCallback(async () => {
    const mine = ++requestId.current
    try {
      const result = await fetchMarket({ q: settled, category, sort, page })
      if (mine !== requestId.current) return
      setState({ status: 'ready', page: result })
      setInstalled(new Set(result.installed))
    } catch (error) {
      if (mine === requestId.current) {
        setState({ status: 'error', reason: error instanceof Error ? error.message : String(error) })
      }
    }
  }, [settled, category, sort, page])

  useEffect(() => { void load() }, [load])

  // Pick up a job that may already have been running before this page opened,
  // then keep asking for as long as one is running.
  useEffect(() => {
    let alive = true
    let timer: ReturnType<typeof setTimeout> | undefined

    const tick = async (): Promise<void> => {
      try {
        const seen = await fetchJob()
        if (!alive) return
        setJob(seen.job)
        setInstalled(new Set(seen.installed))
        if (seen.job?.status === 'running') timer = setTimeout(() => { void tick() }, POLL_MS)
      } catch {
        // A failed poll is not worth a message: the next one either works or the
        // whole page is already showing a connection problem.
        if (alive) timer = setTimeout(() => { void tick() }, POLL_MS * 4)
      }
    }

    void tick()
    return () => { alive = false; if (timer !== undefined) clearTimeout(timer) }
  }, [job?.status === 'running'])

  const refresh = useCallback(async () => {
    setRefreshing(true)
    try {
      await refreshMarket()
      await load()
    } catch (error) {
      setState({ status: 'error', reason: error instanceof Error ? error.message : String(error) })
    } finally {
      setRefreshing(false)
    }
  }, [load])

  /** Start a job and hand the poller something to follow. */
  const start = useCallback(async (run: () => Promise<Job>) => {
    setFailure(null)
    setShowLog(false)
    try {
      setJob(await run())
    } catch (error) {
      setFailure(error instanceof Error ? error.message : String(error))
    }
  }, [])

  if (state.status === 'error') {
    return (
      <>
        <p className="hdw-pm-notice" role="alert">
          <IconWarningOutline16 />
          <span>{state.reason}</span>
        </p>
        <p className="hdw-pm-status">
          The plugin list comes from a community catalog on the internet. Everything already
          installed keeps working without it — see the Installed tab.
        </p>
        <Button variant="outline" icon={<IconRefreshOutline16 />} onClick={() => { void refresh() }}>
          Try again
        </Button>
      </>
    )
  }

  const ready = state.status === 'ready' ? state.page : undefined
  const lastPage = ready === undefined ? 0 : Math.max(0, Math.ceil(ready.total / ready.perPage) - 1)
  const working = job?.status === 'running'

  return (
    <>
      <p className="hdw-pm-intro">
        Plugins published by the community, from a catalog of everything carrying the{' '}
        <b>dsh-plugin</b> topic on GitHub. Only entries with an exact npm package that points back at
        the repository shown are listed here — the rest cannot be checked, so they are not offered.
      </p>

      {failure === null ? null : (
        <p className="hdw-pm-notice" role="alert">
          <IconWarningOutline16 />
          <span>{failure}</span>
        </p>
      )}

      {job === null ? null : (
        <div className="hdw-pm-job" role="status" data-job-status={job.status}>
          <p className="hdw-pm-job-head">
            {working
              ? <StateDot state="ongoing" />
              : <StateDot state={job.status === 'done' ? 'done' : 'error'} />}
            <span>{jobHeadline(job)}</span>
            {job.status === 'done' ? (
              <Button variant="primary" size="sm" onClick={() => { void restartEngine() }}>
                Restart now
              </Button>
            ) : null}
            <Button variant="ghost" size="sm" onClick={() => { setShowLog((on) => !on) }}>
              {showLog ? 'Hide details' : 'Details'}
            </Button>
          </p>
          {showLog ? (
            <TerminalBlock
              className="hdw-pm-job-log"
              command={`dsh plugin ${job.kind === 'install' ? 'add' : 'remove'} ${job.pkg}`}
              output={job.log}
              labels={LOG_LABELS}
              {...(job.status === 'failed' ? { exitCode: 1 } : {})}
            />
          ) : null}
        </div>
      )}

      <div className="hdw-pm-toolbar">
        <Input
          className="hdw-pm-search"
          icon={<IconSearchOutline16 />}
          type="search"
          value={query}
          placeholder="Search the catalog"
          aria-label="Search the catalog"
          onChange={(event: React.ChangeEvent<HTMLInputElement>) => { setQuery(event.currentTarget.value) }}
        />
        <div className="hdw-pm-sorts" role="group" aria-label="Sort by">
          {SORTS.map(([id, label]) => (
            <Pill key={id} active={sort === id} onClick={() => { setSort(id); setPage(0) }}>
              {label}
            </Pill>
          ))}
        </div>
        <Button
          variant="ghost"
          size="sm"
          icon={<IconRefreshOutline16 />}
          disabled={refreshing}
          onClick={() => { void refresh() }}
        >
          {refreshing ? 'Refreshing…' : 'Refresh'}
        </Button>
      </div>

      {ready === undefined ? <p className="hdw-pm-status">Reading the catalog…</p> : (
        <>
          <div className="hdw-pm-chips" role="group" aria-label="Filter by category">
            <Pill active={category === ''} onClick={() => { setCategory(''); setPage(0) }}>
              All ({ready.categories.reduce((sum, c) => sum + c.count, 0)})
            </Pill>
            {ready.categories.map((entry) => (
              <Pill
                key={entry.id}
                active={category === entry.id}
                onClick={() => { setCategory(category === entry.id ? '' : entry.id); setPage(0) }}
              >
                {entry.label} ({entry.count})
              </Pill>
            ))}
          </div>

          {ready.items.length === 0 ? <p className="hdw-pm-status">Nothing matches that.</p> : (
            <ul className="hdw-pm-grid">
              {ready.items.map((item) => {
                const here = installed.has(item.pkg)
                const mine = working && job?.pkg === item.pkg
                return (
                  <li className="hdw-pm-card" key={item.id} data-market-id={item.id}>
                    <span className="hdw-pm-card-icon" aria-hidden="true">
                      {marketIcon(item.category, item.name)}
                    </span>
                    <div className="hdw-pm-card-text">
                      <div className="hdw-pm-card-title">
                        <strong title={item.pkg}>{item.name}</strong>
                        <Pill>{item.version}</Pill>
                      </div>
                      <p className="hdw-pm-card-desc" title={item.description}>
                        {item.description === '' ? item.pkg : item.description}
                      </p>
                      <p className="hdw-pm-card-meta">
                        <span>{compact(item.stars)} stars</span>
                        <span>{compact(item.installs)} installs</span>
                        {item.updatedAt === '' ? null : <span>updated {since(item.updatedAt)}</span>}
                        <a href={item.repo} target="_blank" rel="noreferrer noopener">
                          {item.owner} <IconRightUpOutline14 />
                        </a>
                      </p>
                    </div>
                    {here ? (
                      <Button
                        variant="outline"
                        icon={<IconTrashOutline16 />}
                        disabled={working}
                        onClick={() => { void start(() => removePlugin(item.pkg)) }}
                      >
                        {mine ? 'Working…' : 'Remove'}
                      </Button>
                    ) : (
                      <Button
                        variant="primary"
                        icon={<IconDownloadOutline16 />}
                        disabled={working}
                        onClick={() => { setAcknowledged(false); setPending(item) }}
                      >
                        {mine ? 'Working…' : 'Install'}
                      </Button>
                    )}
                  </li>
                )
              })}
            </ul>
          )}

          <div className="hdw-pm-pager">
            <Button
              variant="outline"
              size="sm"
              disabled={ready.page === 0}
              onClick={() => { setPage((n) => Math.max(0, n - 1)) }}
            >
              Previous
            </Button>
            <span className="hdw-pm-status">
              {ready.total === 0 ? 'no results' : `${ready.total} plugins · page ${ready.page + 1} of ${lastPage + 1}`}
            </span>
            <Button
              variant="outline"
              size="sm"
              disabled={ready.page >= lastPage}
              onClick={() => { setPage((n) => n + 1) }}
            >
              Next
            </Button>
          </div>
        </>
      )}

      {/* Installing runs somebody else's code on this machine. Saying so plainly,
          once, is the whole point of this box — and it names the package and the
          repository so the sentence is checkable rather than scary. */}
      <RiskConfirmation
        open={pending !== null}
        title={pending === null ? '' : `Install ${pending.name}?`}
        description={pending === null ? '' : `This installs the npm package ${pending.pkg}`
          + ` version ${pending.version}, published from ${pending.repo}. It is code written by`
          + ' someone else, and once installed it runs with the same access to your files as the'
          + ' rest of the app. You can remove it again from this page.'}
        acknowledgeLabel="I understand this runs code from outside the app"
        cancelLabel="Cancel"
        confirmLabel="Install"
        acknowledged={acknowledged}
        onAcknowledgedChange={setAcknowledged}
        onCancel={() => { setPending(null) }}
        onConfirm={() => {
          const item = pending
          setPending(null)
          if (item !== null) void start(() => installPlugin(item.id))
        }}
      />
    </>
  )
}
