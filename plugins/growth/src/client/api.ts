/**
 * Typed wrappers over the plugin's own HTTP routes.
 *
 * Plain same-origin `fetch`: the app window is pointed at the engine's web UI, so
 * these are ordinary requests to the same server that served the page.
 * @module
 */

/** A fact as the page sees it. Mirrors `MemoryFact` on the Node side. */
export interface FactView {
  id: string
  text: string
  scope: 'global' | 'project'
  projectPath?: string
  createdAt: number
  source: string
  /** The conversation this came from, so the user can trace it back. */
  sessionId?: string
}

/** Which hand-written page. */
export type ProfileKind = 'soul' | 'user'

/** State of one hand-written page. Mirrors `ProfileState` on the Node side. */
export interface ProfileView {
  kind: ProfileKind
  path: string
  exists: boolean
  chars: number
  limit: number
  modifiedAt: number
  /** The raw file, which is what the in-page editor loads. */
  rawText: string
  effectiveText: string
  truncated: boolean
}

/** One proposed skill, plus what approving it would do to the disk. */
export interface PendingSkillView {
  id: string
  name: string
  description: string
  body: string
  scope: 'global' | 'project'
  projectPath?: string
  createdAt: number
  source: string
  /** The conversation this came from, so the user can trace it back. */
  sessionId?: string
  /** A plain-language line, in the user's language, saying what an improvement changed. */
  changeNote?: string
  /** Absolute path the skill file would be written to. */
  target: string
  /** The complete file that would be written. */
  proposedText: string
  /** What is already at that path, or null when nothing is. */
  currentText: string | null
}

/** One reply from `/hdw/growth/state`. */
export interface GrowthState {
  soul: ProfileView
  user: ProfileView
  /** True while the first-run questions have not been answered yet. */
  setupPending: boolean
  facts: FactView[]
  factLimit: number
  pendingSkills: PendingSkillView[]
}

/** What one background pass did, as the composer strip reads it. */
export interface ReviewRecordView {
  finishedAt: number
  saved: number
  proposed: number
  failure?: string
}

/** One reply from `/hdw/growth/session`. */
export interface SessionStatus {
  running: boolean
  latest: ReviewRecordView | null
  pendingSkills: PendingSkillView[]
  pendingTotal: number
}

/** One reply from `/hdw/growth/preview`. */
export interface ModelView {
  soulSection: string | null
  userSection: string | null
  memoryContext: string | null
}

async function readError(res: Response): Promise<string> {
  try {
    const body = await res.json() as { reason?: unknown }
    if (typeof body.reason === 'string') return body.reason
  } catch {
    // fall through to the status line
  }
  return `${String(res.status)} ${res.statusText}`
}

async function get<T>(path: string): Promise<T> {
  const res = await fetch(path, { headers: { accept: 'application/json' } })
  if (!res.ok) throw new Error(await readError(res))
  return await res.json() as T
}

async function post<T>(path: string, body: unknown): Promise<T> {
  const res = await fetch(path, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })
  if (!res.ok) throw new Error(await readError(res))
  return await res.json() as T
}

/** Read the soul file's state and every stored fact. */
export async function fetchState(): Promise<GrowthState> {
  return await get<GrowthState>('/hdw/growth/state')
}

/** Read exactly what is handed to the model. */
export async function fetchModelView(): Promise<ModelView> {
  return await get<ModelView>('/hdw/growth/preview')
}

/** Remove one fact; the reply carries the list that remains. */
export async function deleteFact(id: string): Promise<{ deleted: boolean, facts: FactView[] }> {
  return await post('/hdw/growth/facts/delete', { id })
}

/** Remove every fact. */
export async function clearFacts(): Promise<{ removed: number, facts: FactView[] }> {
  return await post('/hdw/growth/facts/clear', { confirm: true })
}

/** Write one page from the in-page editor; the reply carries its fresh state. */
export async function saveProfile(kind: ProfileKind, text: string): Promise<{ profile: ProfileView }> {
  return await post('/hdw/growth/profile/save', { kind, text })
}

/** Approve one proposal; the reply carries the queue that remains. */
export async function approveSkill(id: string): Promise<{ written: string, pendingSkills: PendingSkillView[] }> {
  return await post('/hdw/growth/skills/approve', { id })
}

/** Reject one proposal without writing anything. */
export async function rejectSkill(id: string): Promise<{ rejected: boolean, pendingSkills: PendingSkillView[] }> {
  return await post('/hdw/growth/skills/reject', { id })
}

/** Read what the background pass did for one conversation. */
export async function fetchSessionStatus(sessionId: string): Promise<SessionStatus> {
  return await get<SessionStatus>(`/hdw/growth/session?session=${encodeURIComponent(sessionId)}`)
}
