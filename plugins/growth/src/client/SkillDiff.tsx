/**
 * One proposal shown as before-and-after.
 *
 * Shared by the preview popup under the composer and the queue in Settings, so
 * both surfaces answer the same question the same way: what is on disk now, and
 * what would be there instead.
 * @module
 */

import { Pill } from '@deepseek-ai/dsh-client-ui-primitives'
import type { PendingSkillView } from './api.ts'

/**
 * Before-and-after for one proposal.
 * @param props - the proposal to render.
 * @returns the comparison element.
 */
export function SkillDiff({ skill }: { skill: PendingSkillView }): React.JSX.Element {
  return (
    <div className="hdw-gr-diff">
      <div className="hdw-gr-row-meta">
        <strong>{skill.name}</strong>
        <Pill>{skill.currentText === null ? 'new' : 'replaces existing'}</Pill>
        <Pill>{skill.source}</Pill>
        <Pill>{skill.scope === 'project' ? 'this project' : 'everywhere'}</Pill>
      </div>

      <p className="hdw-gr-note">{skill.description}</p>
      <code className="hdw-gr-path">{skill.target}</code>

      {skill.currentText === null
        ? null
        : (
          <>
            <p className="hdw-gr-preview-label">Now on disk</p>
            <pre className="hdw-gr-preview">{skill.currentText}</pre>
          </>
          )}

      <p className="hdw-gr-preview-label">
        {skill.currentText === null ? 'Would be written' : 'Would become'}
      </p>
      <pre className="hdw-gr-preview">{skill.proposedText}</pre>
    </div>
  )
}
