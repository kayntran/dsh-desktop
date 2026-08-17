/**
 * The "On/off" tab inside Settings > Plugins.
 *
 * **Level 1 — additive only.** `settings.plugins.tab` is a `list` slot; upstream's
 * read-only "Plugin list" tab stays right next to ours.
 *
 * Every material comes from the system: `Button`, `Pill`, `StateDot`, `Input`,
 * `RiskConfirmation`, `Icon*`. No hand-drawn toggle switch — the primitive set has
 * no such component, and every binary choice in upstream's Settings is a button or
 * a menu; drawing our own would be the one thing on the page that looks unlike
 * everything else. Same reasoning already recorded in the dock's `AgentControlRow`.
 * @module
 */

import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  Button,
  IconRefreshOutline16,
  IconSearchOutline16,
  IconWarningOutline16,
  Input,
  Pill,
  RiskConfirmation,
  StateDot,
  Tooltip,
  type StateDotState,
} from '@deepseek-ai/dsh-client-ui-primitives'
import type { PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import { fetchPlugins, hasClientHalf, togglePlugin, type LockReason, type PluginView } from './api.ts'

/** Full props of the tab, assembled by the Settings slot renderer. */
export type PluginSwitchTabProps = PropsRuntime<'settings.plugins.tab'>

type ViewState =
  | { status: 'loading' }
  | { status: 'error', reason: string }
  | { status: 'ready', entries: PluginView[], statePath: string }

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
  return [entry.moduleName, entry.entryId].some((value) => value.toLocaleLowerCase().includes(query))
}

/**
 * The plugin on/off tab.
 * @returns the tab body.
 */
export function PluginSwitchTab(_props: PluginSwitchTabProps): React.JSX.Element {
  const [state, setState] = useState<ViewState>({ status: 'loading' })
  const [query, setQuery] = useState('')
  const [busyId, setBusyId] = useState<string | null>(null)
  // Two kinds of message: 'info' is done-but-worth-knowing, 'error' is could-not-do.
  // They differ in accessibility role, so they are not merged.
  const [notice, setNotice] = useState<{ kind: 'info' | 'error', text: string } | null>(null)
  // A core plugin waiting for confirmation, plus whether the box is checked.
  const [pending, setPending] = useState<PluginView | null>(null)
  const [acknowledged, setAcknowledged] = useState(false)

  const reload = useCallback(async () => {
    try {
      const result = await fetchPlugins()
      setState({ status: 'ready', entries: result.entries, statePath: result.statePath })
    } catch (error) {
      setState({ status: 'error', reason: error instanceof Error ? error.message : String(error) })
    }
  }, [])

  useEffect(() => { void reload() }, [reload])

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

  /** Switch pressed: core plugins ask first, our own flip straight away. */
  const request = useCallback((entry: PluginView, enabled: boolean) => {
    // Only ask when DISABLING a core plugin. Enabling has nothing to lose.
    if (!enabled && !entry.ours) {
      setAcknowledged(false)
      setPending(entry)
      return
    }
    void apply(entry, enabled)
  }, [apply])

  const filtered = useMemo(() => {
    if (state.status !== 'ready') return { ours: [], core: [] }
    const normalized = query.trim().toLocaleLowerCase()
    const visible = state.entries.filter((entry) => matches(entry, normalized))
    return {
      ours: visible.filter((entry) => entry.ours),
      core: visible.filter((entry) => !entry.ours),
    }
  }, [query, state])

  if (state.status === 'loading') {
    return <div className="hdw-pm"><p className="hdw-pm-status">Reading plugins…</p></div>
  }
  if (state.status === 'error') {
    return (
      <div className="hdw-pm">
        <p className="hdw-pm-status" role="alert">Could not read the plugin list: {state.reason}</p>
        <Button
          variant="outline"
          icon={<IconRefreshOutline16 />}
          onClick={() => { setState({ status: 'loading' }); void reload() }}
        >
          Retry
        </Button>
      </div>
    )
  }

  const row = (entry: PluginView): React.JSX.Element => {
    const busy = busyId === entry.entryId
    const phase = entry.fiberPhase === null ? 'not mounted' : PHASE_TEXT[entry.fiberPhase] ?? entry.fiberPhase
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
      <li className="hdw-pm-row" key={entry.entryId} data-plugin-entry={entry.entryId}>
        <div className="hdw-pm-row-text">
          <div className="hdw-pm-row-title">
            {entry.enabled ? <StateDot state={dotState(entry)} /> : null}
            <strong title={entry.moduleName}>{shortName(entry.moduleName)}</strong>
            <Pill>{entry.enabled ? phase : 'disabled'}</Pill>
          </div>
          <code className="hdw-pm-row-id">{entry.entryId}</code>
        </div>
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
    <div className="hdw-pm">
      <p className="hdw-pm-intro">
        Flipping a switch affects the running part immediately, and the choice is saved so the next
        launch matches. A plugin's <b>on-screen part</b> only follows after a reload. A few plugins are
        locked because disabling them costs you the app — hover the button for the reason.
      </p>

      {notice === null ? null : (
        <p className="hdw-pm-notice" role={notice.kind === 'error' ? 'alert' : 'status'}>
          <IconWarningOutline16 />
          <span>{notice.text}</span>
          {notice.kind === 'info' ? (
            <Button variant="outline" size="sm" onClick={() => { window.location.reload() }}>
              Reload now
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
          : <ul className="hdw-pm-list">{filtered.ours.map(row)}</ul>}
      </section>

      <section className="hdw-pm-group">
        <h3>DeepSeek core plugins ({filtered.core.length})</h3>
        <p className="hdw-pm-status">
          These are the app's internals. Disabling one here asks for confirmation first.
        </p>
        {filtered.core.length === 0
          ? <p className="hdw-pm-status">No matching plugins.</p>
          : <ul className="hdw-pm-list">{filtered.core.map(row)}</ul>}
      </section>

      <p className="hdw-pm-escape">
        If the app will not start after you disable something: delete the contents of
        <code> {state.statePath} </code>
        and replace them with the two characters <code>[]</code>, then reopen the app.
      </p>

      <RiskConfirmation
        open={pending !== null}
        title={pending === null ? '' : `Disable ${shortName(pending.moduleName)}?`}
        description={pending === null ? '' : `${shortName(pending.moduleName)} is one of DeepSeek's core`
          + ' plugins. Disabling it removes whatever it handles, and plugins that depend on it may stop'
          + ' working too. You can switch it back on right here.'}
        acknowledgeLabel="I understand the app may lose some functionality"
        cancelLabel="Cancel"
        confirmLabel="Disable"
        acknowledged={acknowledged}
        onAcknowledgedChange={setAcknowledged}
        onCancel={() => { setPending(null) }}
        onConfirm={() => {
          const entry = pending
          setPending(null)
          if (entry !== null) void apply(entry, false)
        }}
      />
    </div>
  )
}
