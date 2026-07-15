# bugfix-1182 — group idle sibling architects under "Idle Architects" collapsed node

Follow-up to #1174 / PR #1175. Now that childless architects stay visible under the
architect axis, several idle siblings each take a row and displace real builder work.

## Investigate (done)

**Where the architect axis renders** (all in `packages/vscode/src/views/`):
- `builder-grouping.ts` `architectGrouping().group(ordered, roster)` — buckets builders
  by `spawnedByArchitect` (null → `main`), seeds an empty bucket for every roster
  architect (childless-visible, #1174). Returns `BuilderGroup[]` ordered `main` first,
  then rest alphabetically (populated + idle mixed).
- `builders.ts` `rootChildren()` — for the architect axis, maps each group to a
  `BuilderGroupTreeItem`: empty groups → `None` (leaf-like), populated → `Expanded`;
  every architect header gets the `codev.openArchitectTerminal` command (`g.key` arg).
- `builder-tree-item.ts` `BuilderGroupTreeItem` — all-zero rollup → neutral
  `circle-outline`/`disabledForeground` glyph + "No builders" tooltip (#1174).

**Plan (architect axis only; stage/area untouched):**
1. `builder-tree-item.ts` — new `IdleArchitectsGroupTreeItem` (title-cased
   "Idle Architects (N)", Collapsed, neutral idle glyph, stable id for persistence,
   no command bound → header click = expand/collapse only).
2. `builders.ts` — split architect-axis rendering into a dedicated method:
   partition groups into `main` (always own row), populated siblings (own rows),
   idle siblings (0 builders, key !== main). Emit the Idle group only when idle
   siblings ≥ 2, else render the lone idle sibling as its own row. Ordering:
   main, populated siblings, then the idle group / lone idle at the bottom.
   `getChildren(IdleArchitectsGroupTreeItem)` returns the individual idle architect
   rows (reusing the childless `BuilderGroupTreeItem` + openArchitectTerminal).
3. Tests: 0 / 1 / ≥2 idle-sibling cases, main-always-separate under all combos,
   populated+idle mix, transitions, group header carries no command, individual
   rows inside the group carry openArchitectTerminal.

No `extension.ts` change needed: the accordion `onDidExpandElement` only acts on
`BuilderTreeItem`; the idle group toggles natively (VSCode persists per-id).
No `package.json` menu change: no menu `when`-clause targets `group-builder` in the
Agents view.

## Fix (done)

Implemented all 3 points. Net ~145 LOC src + ~314 test (well under 300 for src):
- `builder-tree-item.ts`: new `IdleArchitectsGroupTreeItem` — "Idle Architects (N)",
  Collapsed, `id='idle-architects-group'` (persistence), `contextValue='group-idle-architects'`,
  neutral `circle-outline`/`disabledForeground` glyph, NO command (toggle-only).
- `builders.ts`: extracted `makeGroupRow(g, now, isArchitectAxis)` from the old inline
  map; new `architectRootChildren(groups, now)` partitions main/populated/idle-siblings
  and emits the container only when idle ≥ 2; new `idleArchitectRows(now)` recomputes the
  container's children on expansion; `getChildren` dispatches on the new item type.
- Tests: new `builders-idle-architects-group.test.ts` (11 cases: 0/1/≥2 siblings,
  main-always-separate, ordering, glyph/command, expansion children, both transitions,
  stage-axis unaffected). Updated one #1174 test in
  `builders-childless-architect-header.test.ts` that pinned the pre-#1182 behavior
  (3 childless → all top-level) to the lone-idle-sibling case (its interaction is now
  covered by the #1182 file).

Verification (from worktree): built deps (types/core/artifact-canvas), then
`pnpm check-types` clean, `pnpm lint` clean, `pnpm vitest run` → 638 pass (54 files),
`node esbuild.js --production` bundles. 2 commits (fix + tests). Next: push, PR, CMAP.
