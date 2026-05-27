# bugfix-878 thread

## Investigate phase — 2026-05-26

### Issue summary
`packages/codev/src/commands/consult/index.ts:38` hardcodes `gemini-3-pro-preview` which Google retired on 2026-03-09. Every gemini consult fast-fails in ~1.8s with an opaque `[object Object]` error.

### Reproduction in my environment (2026-05-26)
- `gemini --model gemini-3-pro-preview` → **WORKS** (returned "OK" in ~4s)
- `gemini --model gemini-3-pro` → 404 `ModelNotFoundError`
- `gemini --model gemini-3.1-pro-preview` → **WORKS** (returned "OK" in ~4s)
- gemini-cli version: 0.38.2

So the issue's initial reproduction did not reproduce locally, BUT the architect added a clarifying comment (2026-05-27) noting:
> The proposed fix (`gemini-3-pro`) would also fail. Per Google's docs, Gemini 3 Pro Preview was shut down March 9, 2026. The current actively-supported Pro identifier is **`gemini-3.1-pro-preview`** (Gemini 3.1 Pro, released Feb 19, 2026).

The discrepancy is likely due to different gemini-cli versions / model-rollout cohorts. The architect's recommendation matches my verification — `gemini-3.1-pro-preview` is the correct target.

### Root cause
- `packages/codev/src/commands/consult/index.ts:38` — hardcoded model identifier
- `packages/codev/src/commands/consult/usage-extractor.ts:19` — no pricing entry for `gemini-3.1-pro`
- `CLAUDE.md:284`, `AGENTS.md:284` — docs reference the retired identifier
- `packages/codev/src/commands/consult/__tests__/metrics.test.ts:617` — test fixture uses retired identifier

### Fix plan (per architect's updated acceptance criteria)
1. `consult/index.ts:38` → `gemini-3.1-pro-preview`
2. `usage-extractor.ts` pricing → add `'gemini-3.1-pro': { inputPer1M: 2.00, cachedInputPer1M: 0.50, outputPer1M: 12.00 }` (cached at 25% of input, consistent with other entries)
3. `CLAUDE.md`, `AGENTS.md` → update to `Gemini 3.1 Pro (gemini-3.1-pro-preview)`
4. Test fixture → update to `gemini-3.1-pro-preview` with new expected cost $14 (1M input × $2 + 1M output × $12)

Size: ~10 LOC. Comfortably within BUGFIX scope.
