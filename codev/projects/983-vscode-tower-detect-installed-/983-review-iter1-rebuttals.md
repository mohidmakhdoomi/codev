# PIR #983 — Review Iteration 1 Rebuttals

## Verdicts
- **Gemini**: APPROVE — no issues.
- **Claude**: APPROVE — no issues.
- **Codex**: REQUEST_CHANGES (HIGH confidence) — one issue, **accepted and fixed**.

## Codex finding: futile restart on 404 when the installed CLI is itself outdated

**Finding** (`preflight-core.ts:176-177`, `preflight.ts`): any 404 from `/api/version` became `too-old` and, once the CLI preflight resolved with a non-null `cachedVersion`, showed the "Restart Tower" toast. In the "extension updated ahead of CLI" case, the installed CLI is old and endpoint-less; the running Tower (that old CLI) returns 404. Restarting reloads the same old CLI, which still has no `/api/version` — so the prompt is futile and co-fires with the #791 "update CLI" toast. Codex correctly identified this as the same futile-remedy class already fixed for the extension-version comparison.

**Disposition: ACCEPTED — fixed in commit `cf68274e`.**

`decideTowerStatus` now gates the `too-old` (404) result on `cliStatus === 'ok'`:
- `cliStatus === 'ok'` means the installed CLI is at least as new as this extension, which expects `/api/version` — so a restart would load an endpoint-having Tower. → `too-old` (prompt restart).
- Otherwise (CLI outdated / missing) a restart can't add the endpoint → return `ok` (suppress the Tower prompt); #791's "update the CLI" toast is the correct and only remedy.

`stale` is deliberately **not** gated on `cliStatus`: `running < installedCLI` means a restart loads genuinely newer code, and the `200` we received from the older running Tower proves the newer installed CLI also has the endpoint. Verified this stays actionable even when the CLI is itself behind the extension (test below).

**Regression tests added** (`preflight-core.test.ts`):
- `404 + cliStatus 'outdated' → ok` (the exact case Codex raised — no restart prompt).
- `404 + cliStatus 'missing' → ok`.
- `stale + cliStatus 'outdated' → stale` (locks in that staleness is not over-gated).

vscode: `check-types` ✓, `lint` ✓, `test:unit` ✓ 331 tests (3 new).

## Note on PIR single-pass

Per PIR, the consultation is a single advisory pass — this fix is **not** independently re-reviewed by the models. The remaining check is the human at the `pr` gate, who should confirm the 404-gating change.
