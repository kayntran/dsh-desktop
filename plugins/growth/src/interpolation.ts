/**
 * The one guard between user-written prose and the engine's strict interpolator.
 *
 * `renderPrompt` interpolates `{{name}}` against a fixed variable table, and an
 * unknown or valueless name THROWS at render time — which fails the whole turn.
 * There is no escape syntax for a literal brace pair.
 *
 * Both of this plugin's inputs can carry one. SOUL.md is free prose a human wrote,
 * and remembered facts are written by the model itself — so the model is capable
 * of saving a fact that kills every later conversation until someone hand-edits a
 * JSON file. Hence: neutralize on the way in AND on the way out.
 * @module
 */

/**
 * Break template delimiters so text is safe to hand to the strict interpolator.
 *
 * Both delimiters are broken rather than the opening one alone. A lone `{{` with
 * no closing pair is documented as literal prose today, so breaking `{{` would be
 * enough — breaking both stays correct under any later change to that rule, and
 * costs one extra pass. The result is still readable to the model, which beats
 * deleting the text.
 * @param text - arbitrary text bound for a prompt section or context.
 * @returns the same text with `{{` and `}}` split apart.
 */
export function neutralize(text: string): string {
  return text.replaceAll('{{', '{ {').replaceAll('}}', '} }')
}
