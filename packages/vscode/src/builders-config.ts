/**
 * Typed reader for the `codev.buildersFileViewAsTree` setting (#1072).
 *
 * The same key + default (`true`) was read inline in three places —
 * `views/builders.ts`, `extension.ts`, and `commands/diff-nav.ts`. Centralising
 * it keeps the key string and default value in one spot so they can't drift.
 *
 * Scope note: this package has no central config-helpers module by design —
 * roughly ten files read `getConfiguration('codev')` inline. This reader is
 * deliberately scoped to the one duplicated key; whether the rest should follow
 * is a separate call (see #1072's "Out of scope").
 */

import * as vscode from 'vscode';

/**
 * Whether the Builders sidebar renders each builder's changed files as a folder
 * tree (`true`, the default) or a flat list (`false`).
 */
export function readBuildersFileViewAsTree(): boolean {
  return vscode.workspace
    .getConfiguration('codev')
    .get<boolean>('buildersFileViewAsTree', true);
}
