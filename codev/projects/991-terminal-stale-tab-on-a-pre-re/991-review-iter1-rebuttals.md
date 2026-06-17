# PIR #991 — Review iteration 1 rebuttal

**Verdicts:** Gemini `APPROVE`, Claude `APPROVE`, Codex `REQUEST_CHANGES`.

Codex's two findings are both **valid** — the two load-bearing Tower fixes lacked direct regression coverage. I agree with both and have **closed each with a regression test** rather than rebutting. Addressed in commit `b536e843` (PR #999 updated automatically).

---

## Finding 1 — no test for the `lsof -sTCP:LISTEN` host-kill fix

> `commands/tower.ts` is the fix for the extension-host-kill bug, but there is no automated regression test for the new `lsof -ti :PORT -sTCP:LISTEN` behavior… it should be protected by a command-level unit test / mocked `execSync` assertion.

**Agreed — fixed.** Added `packages/codev/src/agent-farm/__tests__/tower-stop.test.ts` (fast, runs in the default suite):

- `getProcessesOnPort` is now exported (a clean private util made testable).
- The test mocks `execSync` (spreading the real `node:child_process` so transitive imports keep their genuine exports) and asserts the issued command **contains `-sTCP:LISTEN`** and the target port. It fails if a future edit drops the filter — exactly the regression Codex flagged.
- Two supporting cases: returns the LISTEN pids verbatim; returns `[]` when `lsof` exits non-zero.

3 tests, passing.

## Finding 2 — id-preservation only tested at `createSessionRaw`, not through reconcile

> The only new test… only proves `createSessionRaw()` can accept an id. It would not catch a future regression where reconcile stops threading `dbSession.id` through… still lacks a true end-to-end regression at the Tower reconcile layer.

**Agreed — fixed.** Added an assertion to the existing `tower-reconnect.e2e.test.ts` (`reconnects shellper sessions after Tower restart`), which already spawns a real Tower, creates a shellper-backed terminal, stops Tower, and starts a new one:

- After the restart, it re-fetches the **original** terminal id (`/api/terminals/<shellTerminalId>`) and asserts it is **still valid** (same shellper PID). Before the fix, reconcile minted a new id and that lookup would `404`. This is the end-to-end reconcile-layer regression Codex asked for, and it directly catches reconcile dropping `dbSession.id`.
- Also corrected the now-false comment in that test ("it will have a new ID after reconnection").
- E2E-gated: runs via `pnpm test:e2e` (the e2e suite is excluded from the fast `pnpm test`, by design — expensive). The `createSessionRaw` id-reuse unit test remains as fast-suite coverage of the primitive.

## Note on PIR single-pass

PIR consultation is `max_iterations: 1`, so these two fixes were **not** independently re-reviewed. The human at the `pr` gate is the remaining reviewer of the added tests — flagged in the architect notification and in the review file's "Things to Look At".
