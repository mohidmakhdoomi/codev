/**
 * Architect-name utilities (Spec 755).
 *
 * - validateArchitectName: enforces the [a-z][a-z0-9-]* rule with a 64-char cap.
 * - autoNumberArchitectName: returns the next available `architect-<N>` name
 *   (smallest unused integer ≥ 2) given the set of already-registered names.
 *
 * Both functions are pure — they don't read process state or Tower; the caller
 * is responsible for sourcing the existing-names set. Keeping them pure makes
 * them trivially unit-testable.
 */

export const ARCHITECT_NAME_PATTERN = /^[a-z][a-z0-9-]*$/;
export const MAX_ARCHITECT_NAME_LENGTH = 64;

/** Reserved default for the singleton case. */
export const DEFAULT_ARCHITECT_NAME = 'main';

/**
 * Validate an architect name. Returns `null` if valid, or a human-readable
 * error message otherwise. Callers should treat a non-null return as "reject
 * with this message" — the text is intentionally operator-facing.
 */
export function validateArchitectName(name: string): string | null {
  if (!name) {
    return 'Architect name cannot be empty.';
  }
  if (name.length > MAX_ARCHITECT_NAME_LENGTH) {
    return `Architect name must be at most ${MAX_ARCHITECT_NAME_LENGTH} characters (got ${name.length}).`;
  }
  if (!ARCHITECT_NAME_PATTERN.test(name)) {
    return `Architect name '${name}' is invalid. Names must match [a-z][a-z0-9-]* (lowercase letter, then lowercase letters / digits / dashes).`;
  }
  return null;
}

/**
 * Compute the next auto-numbered architect name, given the set of names
 * already in use. Uses "smallest unused integer ≥ 2" semantics:
 *
 *   - {} → 'architect-2'
 *   - {'main'} → 'architect-2'
 *   - {'main', 'architect-2'} → 'architect-3'
 *   - {'main', 'architect-3'} → 'architect-2' (fills the gap)
 *   - {'main', 'architect-2', 'architect-3'} → 'architect-4'
 *   - {'main', 'sibling'} → 'architect-2' (custom names don't shift numbering)
 *
 * Custom names (anything not matching `architect-<N>` exactly) are ignored
 * by the numbering loop — they're not part of the auto-numbered sequence.
 */
export function autoNumberArchitectName(existingNames: Iterable<string>): string {
  const usedNumbers = new Set<number>();
  for (const name of existingNames) {
    const match = /^architect-(\d+)$/.exec(name);
    if (match) {
      const n = Number.parseInt(match[1], 10);
      if (Number.isFinite(n) && n >= 2) {
        usedNumbers.add(n);
      }
    }
  }
  let n = 2;
  while (usedNumbers.has(n)) n++;
  return `architect-${n}`;
}
