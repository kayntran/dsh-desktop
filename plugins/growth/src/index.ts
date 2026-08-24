/**
 * Node half of Soul and Memory.
 *
 * Two contributions to what the model sees, deliberately made through two
 * different seams:
 *
 * - **Soul** → `systemPrompt.section()`, the cached request header. It is stable
 *   across a session, so it belongs where the cache can keep it.
 * - **Memory** → `systemPrompt.context()`, logged after retained history. It
 *   changes mid-session, and a context emits nothing while its text is unchanged,
 *   so the prompt cache survives every write.
 *
 * Plus one tool (`remember`) and the routes behind the Settings page.
 * @module
 */

import { existsSync } from 'node:fs'
import type { Context } from '@deepseek-ai/cordis'
// Declaration merges that attach the services below onto `Context`. They only
// apply when the module is part of the program, hence the empty type imports.
import type {} from '@deepseek-ai/dsh-system-prompt'
import type {} from '@deepseek-ai/dsh-storage-domain'
import type {} from '@deepseek-ai/dsh-tools'
import type {} from '@deepseek-ai/dsh-host-webserver'
import { growthDomainSpec } from './memory-domain.ts'
import { createMemoryStore } from './memory-store.ts'
import { memoryContextProvider } from './memory-context.ts'
import { registerBackgroundReview } from './review.ts'
import { registerRoutes } from './routes.ts'
import { createSkillStore } from './skill-store.ts'
import { createProfileReader, ensureProfileFile, renderProfile } from './profile.ts'
import { renderOnboarding, writeStartFile } from './onboarding.ts'
import { growthDir } from './paths.ts'
import { proposeSkillTool, rememberTool, updateProfileTool } from './tools.ts'

export const name = 'harness-desktop-growth'

/**
 * Services this plugin cannot run without. Cordis holds the fiber pending until
 * every one exists, so nothing below needs an existence check.
 */
export const inject = ['systemPrompt', 'storageDomain', 'tools', 'webServer', 'agents', 'subagents']

/**
 * The soul section sits in the free 1–99 band: after the deployment persona
 * (order 0 — registering that name a second time throws and takes the engine
 * with it) and before tool guidance (100–199). Semantically right too: the
 * persona says what the assistant is, the soul says how this user wants it to
 * behave, and both are read before any tool instructions.
 */
const SOUL_ORDER = 20

/** Right after the soul: how to behave, then who it is for. */
const USER_ORDER = 22

/** Ahead of both: while it renders, nothing else matters yet. */
const ONBOARDING_ORDER = 10

/** Contexts are joined in ascending order; this one sits after upstream's own. */
const MEMORY_ORDER = 100

/**
 * Plugin body.
 * @param ctx - the plugin's context.
 */
export function apply(ctx: Context): void {
  const soul = createProfileReader('soul')
  const user = createProfileReader('user')

  ctx.effect(() => {
    // Created up front so Settings has files to open on the very first launch.
    // A failure here must not stop the plugin: the sections simply render empty
    // until the files can be written.
    try {
      // The growth directory not existing is what "never launched before" means,
      // and it is the only moment the first-run script may be written. Checking
      // after the files are created would recreate the script on every launch.
      const first = !existsSync(growthDir())
      ensureProfileFile('soul')
      ensureProfileFile('user')
      if (first) writeStartFile()
    } catch (error) {
      ctx.logger?.warn?.('growth: could not create the profile files — %s', error)
    }

    // All three registered unconditionally, returning an empty string while
    // their file is absent or still untouched. Registering conditionally would
    // mean re-registering later, and a duplicate section name throws.
    const offSetup = ctx.systemPrompt.section({
      name: 'harness-desktop:setup',
      order: ONBOARDING_ORDER,
      text: () => renderOnboarding(),
    })
    const offSoul = ctx.systemPrompt.section({
      name: 'harness-desktop:soul',
      order: SOUL_ORDER,
      text: () => renderProfile(soul.read()),
    })
    const offUser = ctx.systemPrompt.section({
      name: 'harness-desktop:user',
      order: USER_ORDER,
      text: () => renderProfile(user.read()),
    })
    return () => { offUser(); offSoul(); offSetup() }
  }, 'hdw-growth: profile prompt sections')

  ctx.effect(async () => {
    const domain = await ctx.storageDomain.open(growthDomainSpec)
    const store = createMemoryStore(domain.table('facts'))
    const skills = createSkillStore(domain.table('pending_skills'))

    const offContext = ctx.systemPrompt.context({
      name: 'harness-desktop:memory',
      order: MEMORY_ORDER,
      text: memoryContextProvider(store),
    })
    // Shared between the review pass, which fills it, and the two tools, which
    // read it to stamp who wrote each record and which chat it came from.
    const reviewSessions = new Map<string, string>()

    const offTool = ctx.tools.register(rememberTool(store, reviewSessions))
    const offSkillTool = ctx.tools.register(proposeSkillTool(skills, reviewSessions))
    const offProfileTool = ctx.tools.register(updateProfileTool())
    const review = registerBackgroundReview(ctx, {
      reviewSessions,
      factCount: () => store.all().length,
      pendingCount: () => skills.all().length,
      pendingList: () => skills.all(),
    })
    const offRoutes = registerRoutes(ctx, {
      store,
      skills,
      review,
      readSoul: () => soul.read(),
      readUser: () => user.read(),
    })

    // One effect for all four because they share a lifetime: the context
    // provider, the tool and the routes all hold the store, and the store is the
    // open domain. Disposing them separately would leave live references reading
    // a closed domain, with every call failing and nothing saying why.
    return async () => {
      offRoutes()
      review.dispose()
      offProfileTool()
      offSkillTool()
      offTool()
      offContext()
      await domain.close()
    }
  }, 'hdw-growth: memory store, context, tool and routes')
}
