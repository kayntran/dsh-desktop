/**
 * The installed-plugin list: what is on this machine, and the switch for each one.
 *
 * Grown out of the old "On/off" tab in Settings. Two things changed and one did
 * not. Changed: each plugin is now a CARD carrying an icon and the sentence from
 * its own manifest, because a list of bare ids (`dsh-base:1a2b`) told the user
 * nothing about what any of it does. Unchanged: every guard that was paid for in
 * a real failure — the lock list with its reasons, the confirmation before
 * disabling a core plugin, the "only after a reload" notice, and the escape hatch
 * printed at the bottom.
 *
 * Every material comes from the system: `Button`, `Pill`, `StateDot`, `Input`,
 * `RiskConfirmation`, `Tooltip`, `Icon*`. No hand-drawn toggle switch — the
 * primitive set has none, and every binary choice in upstream's Settings is a
 * button.
 * @module
 */

import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  Button,
  IconRefreshOutline16,
  IconSearchOutline16,
  IconTrashOutline16,
  IconWarningOutline16,
  Input,
  Pill,
  RiskConfirmation,
  StateDot,
  Tooltip,
  type StateDotState,
} from '@deepseek-ai/dsh-client-ui-primitives'
import {
  fetchJob, fetchPlugins, hasClientHalf, removePlugin, restartEngine, togglePlugin,
  type LockReason, type PendingView, type PluginView,
} from './api.ts'
import { pluginIcon } from './plugin-icon.tsx'

type ViewState =
  | { status: 'loading' }
  | { status: 'error', reason: string }
  | { status: 'ready', entries: PluginView[], pending: PendingView[], statePath: string }

/** Why a plugin is locked, told through the consequence the user would hit. */
const LOCK_TEXT: Record<LockReason, string> = {
  'kills-engine': 'Cannot be disabled: the app would no longer start.',
  'breaks-ui': 'Cannot be disabled: this removes the route into Settings, leaving nowhere to switch it back on.',
  'no-return': 'Cannot be disabled: measured — it turns off, but turning it back on does not restart it.',
  'generated-id': 'Cannot be disabled: the engine recreates this row on every launch, so the choice cannot be saved.',
  'ambiguous-id': 'Cannot be disabled: two rows share this name, so disabling one would disable the other.',
  'self': 'This is the page you are using to switch plugins on and off.',
}

/** Lifecycle phase of a plugin, in the same words upstream uses. */
const PHASE_TEXT: Record<string, string> = {
  pending: 'waiting for dependencies',
  loading: 'loading',
  active: 'running',
  failed: 'failed to load',
  unloading: 'unloading',
}

/**
 * State dot, using the four states `StateDot` actually has. A disabled plugin gets
 * NO dot — the same thing upstream's read-only tab does, and the right meaning:
 * there is no lifecycle to report.
 */
function dotState(entry: PluginView): StateDotState {
  if (entry.fiberPhase === 'active') return 'done'
  if (entry.fiberPhase === 'failed') return 'error'
  if (entry.fiberPhase === null) return 'warning'
  return 'ongoing'
}

/** Readable short name: drop the scope and the prefixes every package repeats. */
function shortName(moduleName: string): string {
  const unscoped = moduleName.startsWith('@') ? moduleName.slice(moduleName.indexOf('/') + 1) : moduleName
  return unscoped
    .replace(/^cordis:/, '')
    .replace(/^cordis-plugin-/, '')
    .replace(/^dsh-(?:host-|client-)?/, '')
    .replace(/^harness-desktop-/, '')
}

function matches(entry: PluginView, query: string): boolean {
  if (query.length === 0) return true
  return [entry.moduleName, entry.entryId, entry.description ?? '']
    .some((value) => value.toLocaleLowerCase().includes(query))
}

/**
 * The installed list.
 * @param props.active - whether this tab is the one on screen.
 * @returns the tab body.
 */
export function InstalledTab({ active }: { active: boolean }): React.JSX.Element {
  const [state, setState] = useState<ViewState>({ status: 'loading' })
  const [query, setQuery] = useState('')
  const [busyId, setBusyId] = useState<string | null>(null)
  // 'info' is done-but-worth-knowing (offers a page reload), 'restart' needs the
  // whole engine to come back, 'error' is could-not-do. They differ in what the
  // user is offered and in accessibility role, so they are not merged.
  const [notice, setNotice] = useState<{ kind: 'info' | 'restart' | 'error', text: string } | null>(null)
  /** Package currently being removed, so every Remove button locks while it runs. */
  const [removing, setRemoving] = useState<string | null>(null)
  // A core plugin waiting for confirmation, plus whether the box is checked.
  const [confirming, setConfirming] = useState<PluginView | null>(null)
  const [acknowledged, setAcknowledged] = useState(false)

  const reload = useCallback(async () => {
    try {
      const result = await fetchPlugins()
      setState({
        status: 'ready',
        entries: result.entries,
        pending: result.pending ?? [],
        statePath: result.statePath,
      })
    } catch (error) {
      setState({ status: 'error', reason: error instanceof Error ? error.message : String(error) })
    }
  }, [])

  // Read again every time this tab comes back on screen. It stays mounted while
  // hidden — deliberately, so a search survives a trip to Market — but that also
  // means it would keep showing the list from before an install done in the other
  // tab. Reported from the real app: install something, come back here, and the
  // market group still read "(0)".
  useEffect(() => { if (active) void reload() }, [active, reload])

  /** The actual flip, once every gate has been passed. */
  const apply = useCallback(async (entry: PluginView, enabled: boolean) => {
    setBusyId(entry.entryId)
    setNotice(null)
    // Whether this plugin shows anything on screen. Asked on BOTH sides of the flip,
    // and that is not belt-and-braces — the engine only serves a client bundle while
    // the plugin is enabled, so exactly one of the two answers can be yes:
    //
    //   disabling → served before, 404 after
    //   enabling  → 404 before, served after
    //
    // The first version asked only before, so re-enabling always concluded "no client
    // half", showed no notice and no Reload button — the user turned the panel back on
    // and nothing came back, with nothing explaining why. Reported from the real app.
    const servedBefore = await hasClientHalf(entry.moduleName)
    try {
      const result = await togglePlugin(entry.entryId, enabled)
      const hasClient = servedBefore || await hasClientHalf(entry.moduleName)
      const name = shortName(entry.moduleName)
      if (!result.saved) {
        setNotice({
          kind: 'error',
          text: `${name} is ${enabled ? 'enabled' : 'disabled'} right now, but the choice could NOT be saved`
            + ' — reopening the app will revert it.',
        })
      } else if (hasClient) {
        // Measured on the real page: the engine flips immediately, but a client half
        // already loaded into the page stays there until the page reloads — disabled
        // it is still visible, enabled it is not visible yet. Left unsaid, the user
        // assumes the switch did nothing and clicks it again.
        setNotice({
          kind: 'info',
          text: `${name} is ${enabled ? 'enabled' : 'disabled'}. Its on-screen part only`
            + ` ${enabled ? 'appears' : 'disappears'} after a reload.`,
        })
      }
      await reload()
    } catch (error) {
      setNotice({
        kind: 'error',
        text: `Could not flip ${shortName(entry.moduleName)}: ${error instanceof Error ? error.message : String(error)}`,
      })
    } finally {
      setBusyId(null)
    }
  }, [reload])

  /**
   * Take a market plugin back off the machine.
   *
   * Removing is not disabling: the package leaves the profile, so the engine has
   * to start again before it is really gone. The notice says so and offers the
   * restart, the same way installing does.
   */
  const uninstall = useCallback(async (pkg: string) => {
    setRemoving(pkg)
    setNotice(null)
    try {
      await removePlugin(pkg)
      for (;;) {
        await new Promise((resolve) => setTimeout(resolve, 500))
        const seen = await fetchJob()
        if (seen.job === null || seen.job.status !== 'running') {
          if (seen.job?.status === 'failed') throw new Error(seen.job.error ?? 'the removal did not finish')
          break
        }
      }
      setNotice({
        kind: 'restart',
        text: `${shortName(pkg)} is removed. Restart the app to unload it.`,
      })
      await reload()
    } catch (error) {
      setNotice({
        kind: 'error',
        text: `Could not remove ${shortName(pkg)}: ${error instanceof Error ? error.message : String(error)}`,
      })
    } finally {
      setRemoving(null)
    }
  }, [reload])

  /** Switch pressed: core plugins ask first, everything else flips straight away. */
  const request = useCallback((entry: PluginView, enabled: boolean) => {
    // Only ask when DISABLING a CORE plugin. Enabling has nothing to lose, and a
    // plugin the user installed themselves is theirs to turn off without a lecture.
    if (!enabled && entry.origin === 'core') {
      setAcknowledged(false)
      setConfirming(entry)
      return
    }
    void apply(entry, enabled)
  }, [apply])

  const filtered = useMemo(() => {
    const empty = { ours: [], market: [], core: [], pending: [] as PendingView[] }
    if (state.status !== 'ready') return empty
    const normalized = query.trim().toLocaleLowerCase()
    const visible = state.entries.filter((entry) => matches(entry, normalized))
    return {
      ours: visible.filter((entry) => entry.origin === 'ours'),
      market: visible.filter((entry) => entry.origin === 'market'),
      core: visible.filter((entry) => entry.origin === 'core'),
      pending: state.pending.filter((entry) => normalized.length === 0
        || `${entry.pkg} ${entry.description ?? ''}`.toLocaleLowerCase().includes(normalized)),
    }
  }, [query, state])

  if (state.status === 'loading') {
    return <p className="hdw-pm-status">Reading plugins…</p>
  }
  if (state.status === 'error') {
    return (
      <>
        <p className="hdw-pm-status" role="alert">Could not read the plugin list: {state.reason}</p>
        <Button
          variant="outline"
          icon={<IconRefreshOutline16 />}
          onClick={() => { setState({ status: 'loading' }); void reload() }}
        >
          Retry
        </Button>
      </>
    )
  }

  /**
   * A package that is on disk but has not been loaded yet.
   *
   * No switch: there is nothing running to switch. Remove still works, because
   * the package is on disk and that is all removing needs — which matters, since
   * changing your mind before the restart is a normal thing to do.
   */
  const pendingCard = (entry: PendingView): React.JSX.Element => (
    <li className="hdw-pm-card" key={entry.pkg} data-plugin-pending={entry.pkg}>
      <span className="hdw-pm-card-icon" aria-hidden="true">{pluginIcon(entry.pkg)}</span>
      <div className="hdw-pm-card-text">
        <div className="hdw-pm-card-title">
          <strong title={entry.pkg}>{shortName(entry.pkg)}</strong>
          <Pill>not loaded yet</Pill>
        </div>
        <p className="hdw-pm-card-desc" title={entry.description ?? entry.pkg}>
          {entry.description ?? entry.pkg}
        </p>
      </div>
      <Tooltip label={`Remove ${shortName(entry.pkg)}`} side="top">
        <Button
          variant="ghost"
          icon={<IconTrashOutline16 />}
          disabled={removing !== null}
          aria-label={removing === entry.pkg
            ? `Removing ${shortName(entry.pkg)}`
            : `Remove ${shortName(entry.pkg)}`}
          onClick={() => { void uninstall(entry.pkg) }}
        />
      </Tooltip>
    </li>
  )

  const card = (entry: PluginView): React.JSX.Element => {
    const busy = busyId === entry.entryId
    const phase = entry.fiberPhase === null ? 'not mounted' : PHASE_TEXT[entry.fiberPhase] ?? entry.fiberPhase
    // No description means no second line worth reading, so the full package name
    // takes the slot: it is at least the thing you would search for.
    const detail = entry.description ?? entry.moduleName
    const button = (
      <Button
        variant={entry.enabled ? 'outline' : 'primary'}
        disabled={entry.locked || busy}
        onClick={() => { request(entry, !entry.enabled) }}
      >
        {busy ? 'Working…' : entry.enabled ? 'Disable' : 'Enable'}
      </Button>
    )
    return (
      <li className="hdw-pm-card" key={entry.entryId} data-plugin-entry={entry.entryId}>
        <span className="hdw-pm-card-icon" aria-hidden="true">{pluginIcon(entry.moduleName)}</span>
        <div className="hdw-pm-card-text">
          <div className="hdw-pm-card-title">
            {entry.enabled ? <StateDot state={dotState(entry)} /> : null}
            <strong title={entry.moduleName}>{shortName(entry.moduleName)}</strong>
            <Pill>{entry.enabled ? phase : 'disabled'}</Pill>
          </div>
          {/* Clamped to two lines in CSS; the full text stays in the native
              tooltip, because DeepSeek's own descriptions run long. */}
          <p className="hdw-pm-card-desc" title={detail}>{detail}</p>
        </div>
        {/* Only what the user added themselves can be taken away, and this is
            where they will look for it — having to find it again in the Market
            list is a route nobody takes. */}
        {entry.origin === 'market' ? (
          // Icon only, on purpose: with the word spelled out this button and the
          // switch beside it squeezed the name column until "plugin-vetting" read
          // as "plugin-ve…". The tooltip carries the word instead.
          <Tooltip label={`Remove ${shortName(entry.moduleName)}`} side="top">
            <Button
              variant="ghost"
              icon={<IconTrashOutline16 />}
              disabled={removing !== null}
              aria-label={removing === entry.moduleName
                ? `Removing ${shortName(entry.moduleName)}`
                : `Remove ${shortName(entry.moduleName)}`}
              onClick={() => { void uninstall(entry.moduleName) }}
            />
          </Tooltip>
        ) : null}
        {entry.locked && entry.lockReason !== undefined
          // `top` rather than `left`: the primitive only offers right/bottom/top,
          // and this button sits against the right edge, so the bubble opens upward.
          //
          // The tooltip anchors to a WRAPPER, not to the button. A `disabled`
          // button fires no mouse events and cannot take focus, so a tooltip on it
          // never opens — and the intro sentence above tells the user to hover the
          // button for the reason. Measured by `npm run spike:switch`, check 3; the
          // other half of the fix is `.hdw-pm-lock` in `styles.css`.
          ? (
            <Tooltip label={LOCK_TEXT[entry.lockReason]} side="top" maxWidth={280}>
              <span className="hdw-pm-lock" tabIndex={0} aria-label={LOCK_TEXT[entry.lockReason]}>
                {button}
              </span>
            </Tooltip>
            )
          : button}
      </li>
    )
  }

  return (
    <>
      <p className="hdw-pm-intro">
        Flipping a switch affects the running part immediately, and the choice is saved so the next
        launch matches. A plugin's <b>on-screen part</b> only follows after a reload. A few plugins are
        locked because disabling them costs you the app — hover the button for the reason.
      </p>

      {notice === null ? null : (
        <p className="hdw-pm-notice" role={notice.kind === 'error' ? 'alert' : 'status'}>
          <IconWarningOutline16 />
          <span>{notice.text}</span>
          {/* A flipped switch needs the page back; a removed package needs the
              engine back. Offering the wrong one reads as a button that does
              nothing. */}
          {notice.kind === 'info' ? (
            <Button variant="outline" size="sm" onClick={() => { window.location.reload() }}>
              Reload now
            </Button>
          ) : null}
          {notice.kind === 'restart' ? (
            <Button variant="primary" size="sm" onClick={() => { void restartEngine() }}>
              Restart now
            </Button>
          ) : null}
        </p>
      )}

      <Input
        className="hdw-pm-search"
        icon={<IconSearchOutline16 />}
        type="search"
        value={query}
        placeholder="Search plugins"
        aria-label="Search plugins"
        onChange={(event: React.ChangeEvent<HTMLInputElement>) => { setQuery(event.currentTarget.value) }}
      />

      <section className="hdw-pm-group">
        <h3>Harness Desktop plugins ({filtered.ours.length})</h3>
        {filtered.ours.length === 0
          ? <p className="hdw-pm-status">No matching plugins.</p>
          : <ul className="hdw-pm-grid">{filtered.ours.map(card)}</ul>}
      </section>

      <section className="hdw-pm-group">
        <h3>Installed from the market ({filtered.market.length + filtered.pending.length})</h3>
        {/* The pending ones come first: they are the reason someone opened this
            page a second ago, and the sentence they need is "not until you
            restart" — not silence. */}
        {filtered.pending.length === 0 ? null : (
          <p className="hdw-pm-notice" role="status">
            <IconWarningOutline16 />
            <span>
              {filtered.pending.length === 1
                ? 'One plugin is installed but not loaded yet.'
                : `${filtered.pending.length} plugins are installed but not loaded yet.`}
              {' '}Restart the app to finish.
            </span>
            <Button variant="primary" size="sm" onClick={() => { void restartEngine() }}>
              Restart now
            </Button>
          </p>
        )}
        {filtered.market.length === 0 && filtered.pending.length === 0
          ? (
            <p className="hdw-pm-status">
              Nothing yet. The Market tab has plugins published by the community.
            </p>
            )
          : (
            <ul className="hdw-pm-grid">
              {filtered.pending.map(pendingCard)}
              {filtered.market.map(card)}
            </ul>
            )}
      </section>

      <section className="hdw-pm-group">
        <h3>DeepSeek core plugins ({filtered.core.length})</h3>
        <p className="hdw-pm-status">
          These are the app's internals. Disabling one here asks for confirmation first.
        </p>
        {filtered.core.length === 0
          ? <p className="hdw-pm-status">No matching plugins.</p>
          : <ul className="hdw-pm-grid">{filtered.core.map(card)}</ul>}
      </section>

      <p className="hdw-pm-escape">
        If the app will not start after you disable something: delete the contents of
        <code> {state.statePath} </code>
        and replace them with the two characters <code>[]</code>, then reopen the app.
      </p>

      <RiskConfirmation
        open={confirming !== null}
        title={confirming === null ? '' : `Disable ${shortName(confirming.moduleName)}?`}
        description={confirming === null ? '' : `${shortName(confirming.moduleName)} is one of DeepSeek's core`
          + ' plugins. Disabling it removes whatever it handles, and plugins that depend on it may stop'
          + ' working too. You can switch it back on right here.'}
        acknowledgeLabel="I understand the app may lose some functionality"
        cancelLabel="Cancel"
        confirmLabel="Disable"
        acknowledged={acknowledged}
        onAcknowledgedChange={setAcknowledged}
        onCancel={() => { setConfirming(null) }}
        onConfirm={() => {
          const entry = confirming
          setConfirming(null)
          if (entry !== null) void apply(entry, false)
        }}
      />
    </>
  )
}
