# Plan 778 — Iteration-1 Rebuttals

**Verdicts:** Gemini APPROVE · Codex REQUEST_CHANGES · Claude COMMENT
**Disposition:** All substantive points accepted and addressed (no rejections). Codex and Claude
converged on the two key items; both are now pinned in a new **Cross-Cutting Implementation
Contracts** section + Phase 4. Code claims re-verified against the tree.

## Codex (REQUEST_CHANGES)
- **CX1 — Backend context must reach the parsing/metrics pipeline.** ✅ Verified `extractReviewText`/
  `extractUsage` branch on `model === 'gemini'` and assume the old CLI JSON (`stats.models`). Added a
  Cross-Cutting contract: thread the resolved **`backend`** into the extractor — `agy` → raw text +
  null usage (graceful degradation); `api` → `usageMetadata` → real cost; old `stats.models` path
  removed. (Also addresses Claude #1.)
- **CX2 — `doctor` operational-model counting.** ✅ Added to Phase 4: the Gemini lane must count as
  operational when **either** backend is usable, so an **API-only** setup (no `agy`, `GEMINI_API_KEY`
  set) is reported operational, not failed.
- **CX3 — Wrong test paths.** ✅ Verified: tests live under `packages/codev/src/__tests__/` (+
  `…/cli/` e2e; `…/commands/consult/__tests__/metrics.test.ts`;
  `…/commands/porch/__tests__/consultation-models.test.ts`); `packages/codev/tests/e2e|unit` do **not**
  exist. Fixed Phase 4 and added a canonical "Test locations" note.

## Claude (COMMENT)
- **CL1 — `extractUsage`/`extractReviewText` disambiguation.** ✅ Same as CX1 (backend threaded
  through). 
- **CL2 — Test path `packages/codev/tests/e2e/` doesn't exist.** ✅ Same as CX3.
- **CL3 — `consult.gemini.backend` is a NEW top-level `consult` key.** ✅ Cross-Cutting contract now
  states it is distinct from `porch.consultation.models`; don't nest it there.
- **Dual-dispatch architecture** (single `if (model==='gemini')` → backend-branched). ✅ Cross-Cutting
  contract states how Phase 1/2 branches merge under the Phase 3 selector.
- **`protocol-schema.json` conflation** (enum only in the skeleton copy; `codev/protocols` has none).
  ✅ Noted in Phase 4 consistency.
- **Config migration.** ✅ Cross-Cutting contract: missing key → default (`auto`); no migration logic.

## Gemini (APPROVE)
- No issues.

## Net
Two precision gaps (backend-aware pipeline; test paths) fixed; doctor counting, new-config-key,
dual-dispatch, schema-enum scope, and no-migration all pinned. Scope unchanged (still "two backends +
a selector" + supporting doctor/docs/e2e). No blocker remains.
