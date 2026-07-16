# Decision note — Q5: Multi-workspace UX

**Status**: Proposed (needs main's ratification)
**Date**: 2026-07-07
**Question** (interaction-model §9.5): User has three workspaces — per-workspace tabs? Unified feed with workspace tags?

## Ground truth

- Since #1118, one `~/.agent-farm/global.db` holds all workspaces (composite `(workspace_path, id)` keys), and Tower serves `GET /api/workspaces` plus per-workspace scoped routes. One Tower = many workspaces is the native shape.
- Cross-workspace addressing already exists in the messaging grammar (`afx send <workspace>:architect`).
- A user may ALSO have multiple Towers (home/office) once cloud-connected — that's a different axis (May doc's "multi-tower switching", Tier 2).

## Decision

**Unified `needs-you` inbox across workspaces; everything else workspace-scoped behind a switcher.**

1. **The approval inbox is unified.** Pending gates and questions from all workspaces in one list, each row tagged with its workspace. Rationale: the 30-second use case is "what needs me?" — the user should never have to check three tabs to find out the answer is "nothing." This is the screen push notifications deep-link into, and pushes arrive workspace-agnostic.
2. **Feed and chat are workspace-scoped**, behind a workspace switcher (current-workspace context persisted per device). Rationale: an interleaved multi-workspace activity feed is noise — activity volume is high (every phase change, spawn, message) and cross-workspace interleaving destroys glanceability. Chat targets (`architect:main`) are only meaningful within a workspace.
3. **Multi-tower is Phase 2** and composes the same way: tower switcher above workspace switcher, inbox unified across both. v0 (LAN PoC) is single-Tower by construction.

## Consequence for codev-sdk (#1189)

Client calls take explicit `baseUrl` + `workspacePath` (the dashboard's implicit-URL-scoping knot, now a #1189 design requirement), and the inbox is the one deliberately cross-workspace query: a pending-attention client aggregating across `GET /api/workspaces`. (The sdk is framework-free; each surface wraps this in its own state idiom — a hook on web/mobile, a tree provider in vscode.)

## Related

- [[q4-push-controls]] (muted workspace mutes its sources), interaction-model §7.2.
