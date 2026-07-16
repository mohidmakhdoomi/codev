/**
 * Pure presentation helpers for architect rows (Issue 841).
 *
 * Kept free of any `vscode` import so they can be unit-tested directly under
 * vitest (the rest of `workspace.ts` imports `vscode` and is only reachable via
 * source-level sentinel tests). `workspace.ts` and `extension.ts` both consume
 * these.
 *
 * Architect names are stored and used internally in lowercase — the
 * `architect:<name>` send-message form, spawn affinity, `validateArchitectName`,
 * and the Tower add/remove API all key off the lowercase identifier. These
 * helpers only affect what the user *sees*; the raw name is what flows to every
 * command argument and to `item.id`.
 */

/**
 * Display label for an architect row (Gap 3). Rendered UPPERCASE so the
 * architect rows read as a distinct, self-consistent group (`MAIN`, `WEB`,
 * `OB-REFINE`) instead of the lone lowercase `main` row that stood out before.
 */
export function displayArchitectName(name: string): string {
  return name.toUpperCase();
}

/**
 * Order architects for display: `main` first, then the rest alphabetically by
 * raw (lowercase) name (Gap 2 — the Cmd/Ctrl+K A picker). Pure and
 * non-mutating: returns a new array. Matches the main-first ordering Tower
 * already applies to the Architects tree.
 */
export function sortArchitectsForPicker<T extends { name: string }>(architects: readonly T[]): T[] {
  return [...architects].sort((a, b) => {
    if (a.name === 'main') { return -1; }
    if (b.name === 'main') { return 1; }
    return a.name.localeCompare(b.name);
  });
}
