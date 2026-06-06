# PIR #1001 — terminal-adapter reconnect notices

vscode: reconnect notices accumulate as orphaned scrollback; not cleared on successful reconnect.

## Plan phase (in progress)

- Read PIR protocol, issue #1001, `packages/vscode/src/terminal-adapter.ts`, and the existing test suite.
- Root cause confirmed: `scheduleReconnect()` (terminal-adapter.ts:204-207) terminates each notice with `\r\n`, so notices stack; there is no success-side handler to wipe the notice.
- Approach: overwrite-in-place (leading `\r\x1b[2K`, no trailing `\r\n`) for retry notices + a `hadReconnectNotice` flag wiped in the `ws.on('open')` success path. Give-up notice (#939) stays visible.
- Tower replays its full buffer on reconnect, so any real output transiently cleared by the ANSI controls is re-rendered — the notice only ever occupies one transient line.
- Writing plan to `codev/plans/1001-vscode-terminal-adapter-reconn.md`.
