# PIR #1001 — terminal-adapter reconnect notices

vscode: reconnect notices accumulate as orphaned scrollback; not cleared on successful reconnect.

## Plan phase (in progress)

- Read PIR protocol, issue #1001, `packages/vscode/src/terminal-adapter.ts`, and the existing test suite.
- Root cause confirmed: `scheduleReconnect()` (terminal-adapter.ts:204-207) terminates each notice with `\r\n`, so notices stack; there is no success-side handler to wipe the notice.
- Approach: overwrite-in-place (leading `\r\x1b[2K`, no trailing `\r\n`) for retry notices + a `hadReconnectNotice` flag wiped in the `ws.on('open')` success path. Give-up notice (#939) stays visible.
- Tower replays its full buffer on reconnect, so any real output transiently cleared by the ANSI controls is re-rendered — the notice only ever occupies one transient line.
- Writing plan to `codev/plans/1001-vscode-terminal-adapter-reconn.md`.

## Plan approved → Implement phase (commit fc6c9bc7)

- Implemented all 4 edits in `terminal-adapter.ts`: `hadReconnectNotice` flag, leading `\r\x1b[2K` overwrite-in-place retry notice (no trailing `\r\n`), `clearReconnectNotice()` helper called from `ws.on('open')`, conditional erase prefix in `giveUp()`. Dropped em dashes from both messages.
- Added 6 tests under a `PIR #1001` describe block: overwrite-in-place, wipe-on-success, happy-path-silence, give-up-overwrites-but-never-wiped, immediate-4xx-no-prefix.
- Gotcha: fresh worktree — `@cluesmith/codev-types` / `-core` dists weren't built, so vitest failed to resolve the package entry. Built both (`pnpm --filter ... build`) then everything passed.
- check-types ✓, lint ✓, esbuild ✓, `vitest run` ✓ (336 tests, 6 new).
- Pushing branch, signaling `porch done` → `dev-approval` gate.

