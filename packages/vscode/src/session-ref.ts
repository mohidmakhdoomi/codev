import type { SessionRef } from '@cluesmith/codev-core/session-successor';

/**
 * Map a terminal's stable map key (from `TerminalManager`'s `terminals` map) to
 * a {@link SessionRef} for successor resolution (#991). Only builder
 * (`builder-<id>`) and architect (`architect:<name>`) sessions are persistent
 * and restart-reconciled; shell (`shell-<n>`) and dev (`dev-<id>`) terminals
 * don't survive a Tower restart, so they have no successor and return `null`.
 *
 * Pure and `vscode`-free so it can be unit-tested in a node env without the
 * adapter's transport/import chain. The `SessionRef` import is type-only
 * (erased at runtime), so this module has no runtime dependencies.
 */
export function sessionRefFromMapKey(mapKey: string): SessionRef | null {
  if (mapKey.startsWith('architect:')) {
    return { kind: 'architect', name: mapKey.slice('architect:'.length) };
  }
  if (mapKey.startsWith('builder-')) {
    return { kind: 'builder', id: mapKey.slice('builder-'.length) };
  }
  return null;
}
