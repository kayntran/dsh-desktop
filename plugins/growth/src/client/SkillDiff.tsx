/**
 * One proposal shown as before-and-after.
 *
 * Shared by the preview popup under the composer and the queue in Settings, so
 * both surfaces answer the same question the same way: what is on disk now, and
 * what would be there instead.
 * @module
 */

import { DiffBlock, Pill } from '@deepseek-ai/dsh-client-ui-primitives'
import type { PendingSkillView } from './api.ts'
import { skillHunks } from './linediff.ts'

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
        ? (
          // Nothing on disk yet: there is nothing to diff against, so the whole
          // file is what would be written.
          <>
            <p className="hdw-gr-preview-label">Would be written</p>
            <pre className="hdw-gr-preview">{skill.proposedText}</pre>
          </>
          )
        : (
          // Replacing a skill that exists: show only the lines that change, red
          // for gone and green for new, so the reader is not left comparing two
          // full copies line by line. The footer counts +added / -removed.
          <>
            {skill.changeNote === undefined || skill.changeNote.length === 0
              ? null
              // The assistant's own one-line summary of the change, in the user's
              // language. It sits above the diff so the gist is readable without
              // parsing red and green at all.
              : <p className="hdw-gr-change-note">{skill.changeNote}</p>}
            <p className="hdw-gr-preview-label">What would change</p>
            <SkillChange
              path={`${skill.name}/SKILL.md`}
              currentText={skill.currentText}
              proposedText={skill.proposedText}
            />
          </>
          )}
    </div>
  )
}

/**
 * The red/green change for a skill that replaces one on disk.
 * @param props - the file path header and the two sides.
 * @returns the diff, or a plain note when nothing actually differs.
 */
function SkillChange({ path, currentText, proposedText }: {
  path: string
  currentText: string
  proposedText: string
}): React.JSX.Element {
  const hunks = skillHunks(path, currentText, proposedText)
  if (hunks.length === 0) {
    return <p className="hdw-gr-empty">No change — the proposed skill is identical to the one on disk.</p>
  }
  return <DiffBlock diffs={hunks} />
}
