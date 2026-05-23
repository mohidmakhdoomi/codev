# Spec 786 — Manual Verify-Phase Scenarios

This document scripts the manual verification of the multi-architect feature.
Per [[feedback_e2e_headline_path]], every scenario MUST be run on a real
workspace before the feature is tagged as shipped. Automated tests cover
each path individually; this script exercises them end-to-end so a regression
like the v3.0.5 → v3.0.7 routing break (#774) cannot ship undetected.

**Prerequisites**:
- `pnpm -w run local-install` has run (fresh codev install on this machine).
- `afx tower start` is running.
- A workspace is activated (`afx workspace start`).
- A fresh terminal in the workspace root.

For each scenario, mark the checkbox when you've personally observed the
expected outcome. Skipping a scenario means the feature ships unverified.

---

## Scenario 1 — Headline round-trip (THE Spec 786 acceptance test)

The headline value prop of multi-architect support is "messages routed to the
right architect". The v3.0.5 → v3.0.7 silent break (#774) happened because
nobody ever ran this scenario end-to-end before tagging.

- [ ] `afx workspace add-architect --name ob-refine`
- [ ] Dashboard sidebar shows an `ob-refine` tab in the architect strip
- [ ] Click the `ob-refine` tab in the dashboard — its terminal opens (Spec 761 / 786 Phase 4 strip click). Alternatively, open VSCode's Codev sidebar → expand "Architects" → click `ob-refine` (Spec 786 Phase 6). Note: `afx open` is the file-annotation command, not a terminal opener.
- [ ] From inside `ob-refine`'s terminal, run a builder: `afx spawn 786 --task "diagnostic"`
- [ ] Wait for the builder to come up
- [ ] From the builder's terminal, run: `afx send architect "ping from builder"`
- [ ] **Expected**: `ob-refine`'s terminal receives the message (not `main`)
- [ ] Verify the recorded affinity: `sqlite3 .agent-farm/state.db "SELECT id, spawned_by_architect FROM builders WHERE id LIKE '%786%'"` shows `spawned_by_architect = 'ob-refine'`

---

## Scenario 2 — Persistence round-trip (graceful stop+start)

The Spec 755 v1 persistence story was broken on graceful stop; Spec 786
Phase 3 fixes it via the intentional-stop flag.

- [ ] Continuing from Scenario 1, with `ob-refine` registered
- [ ] `afx workspace stop` (do NOT use `tower stop-all`)
- [ ] Verify the sibling row survives: `sqlite3 .agent-farm/state.db "SELECT id FROM architect"` shows BOTH `main` and `ob-refine`
- [ ] `afx workspace start`
- [ ] **Expected**: dashboard sidebar shows `ob-refine` automatically (didn't disappear)
- [ ] `afx send architect:ob-refine "test message"` from any terminal lands on `ob-refine`'s PTY

---

## Scenario 3 — Tower stop+start

Distinct from workspace stop+start. Exercises `afx tower stop` + start.

- [ ] With `ob-refine` registered (from Scenarios 1/2)
- [ ] `afx tower stop`
- [ ] `afx tower start` (or `pnpm -w run local-install` if testing a rebuild)
- [ ] **Expected**: `afx status` shows `ob-refine` with its PID/port (reconciled from shellper sockets)

---

## Scenario 4 — Crash recovery (Tower SIGKILL)

Pre-Spec 786 already worked; regression check that the new code doesn't break it.

- [ ] With `ob-refine` registered
- [ ] `pkill -9 -f tower-server.js` (or equivalent SIGKILL of the Tower process)
- [ ] Wait 5s for shellper to detect the dropped connection
- [ ] `afx tower start`
- [ ] **Expected**: `ob-refine` is reconnected via the existing `reconcileTerminalSessions()` path. Its terminal_sessions row survived because Tower didn't gracefully clean up.

---

## Scenario 5 — Permanent-exit auto-delete (OQ-B)

When an architect's claude process exits permanently (max-restart exhaustion),
Spec 786 OQ-B says the row is auto-deleted so `state.db` mirrors reality.

- [ ] With `ob-refine` registered
- [ ] Force max-restart exhaustion: open `ob-refine`'s terminal and repeatedly kill the claude process until shellper gives up (it takes ~50 restarts; for the test, you can edit `restartOnExit: false` temporarily and kill once)
- [ ] **Expected**: `sqlite3 .agent-farm/state.db "SELECT id FROM architect WHERE id = 'ob-refine'"` returns no rows
- [ ] `afx status` no longer lists `ob-refine`
- [ ] Builders that were spawned by `ob-refine` fall back to `main` for their next `afx send architect`

---

## Scenario 6 — `remove-architect` CLI

- [ ] Re-add: `afx workspace add-architect --name ob-refine`
- [ ] `afx workspace remove-architect ob-refine`
- [ ] **Expected**: success message, sibling gone from dashboard and `afx status`
- [ ] `afx workspace remove-architect main`
- [ ] **Expected**: error message "Cannot remove the default 'main' architect."
- [ ] `afx workspace remove-architect nonexistent`
- [ ] **Expected**: error message "Architect 'nonexistent' not found ..."

---

## Scenario 7 — Naming validation

- [ ] `afx workspace add-architect --name main` → rejected ("reserved")
- [ ] `afx workspace add-architect --name ""` → rejected ("cannot be empty")
- [ ] `afx workspace add-architect --name "with space"` → rejected (regex)
- [ ] `afx workspace add-architect --name "WithCaps"` → rejected (regex)
- [ ] `afx workspace add-architect --name "has:colon"` → rejected (regex)
- [ ] `afx workspace add-architect --name "ob-refine"` → accepted
- [ ] `afx workspace add-architect` (no flag, auto-number) → accepted as `architect-2` (or next gap)
- [ ] `afx workspace remove-architect ob-refine` (clean up)
- [ ] `afx workspace remove-architect architect-2` (clean up)

---

## Scenario 8 — Architect-to-architect messaging

- [ ] Add two siblings: `afx workspace add-architect --name a` then `--name b`
- [ ] From `main`'s terminal: `afx send architect:a "hi a"`
- [ ] **Expected**: `a`'s terminal receives the message
- [ ] From `a`'s terminal: `afx send architect:b "hi b"`
- [ ] **Expected**: `b`'s terminal receives the message
- [ ] From `b`'s terminal: `afx send architect:main "hi main"`
- [ ] **Expected**: `main`'s terminal receives the message
- [ ] Clean up: `afx workspace remove-architect a`, `afx workspace remove-architect b`

---

## Scenario 9 — Surface enumeration (`afx status`)

- [ ] With `main` + 2 siblings: `afx workspace add-architect --name a`, `--name b`
- [ ] `afx status` (Tower running)
- [ ] **Expected**: "Architects:" section lists all three with name + pid + terminal id
- [ ] `afx tower stop`
- [ ] `afx status` (Tower-down fallback)
- [ ] **Expected**: "Architects: 3 registered" + "(Tower not running — PID/port not available)" + name + cmd for each
- [ ] `afx tower start`, clean up

---

## Scenario 10 — Dashboard UX (Playwright optional; manual fine)

Per [[feedback_ui_visual_verification]]: render and visually inspect.

- [ ] **N=1**: workspace with just `main`. Dashboard tab label is `'Architect'` (per #764), NOT `'main'`. No close button on the tab.
- [ ] **N=2**: add `sibling`. Both tabs visible. `main` labelled `'main'` (not `'Architect'`), no close button. `sibling` labelled `'sibling'`, has close button.
- [ ] **N=3**: add another. All three labelled by name, sibling tabs have close buttons.
- [ ] Click X on `sibling` tab → confirmation modal appears with text mentioning architect name; modal shows in-flight builders count
- [ ] Click "Cancel" → modal closes, no change
- [ ] Click X on `sibling` again → modal → "Remove" → sibling tab disappears, active tab falls back to `main` (if `sibling` was active)

---

## Scenario 11 — VSCode extension UX

Per the architect's plan-time direction. Requires the VSCode extension installed.

- [ ] Open VSCode on the workspace
- [ ] Sidebar shows "Architects" expandable tree section (not the pre-786 singleton "Open Architect" row)
- [ ] **N=1**: expanding shows `main` only. Right-click `main` → no "Remove Architect" option
- [ ] Add a sibling via CLI: `afx workspace add-architect --name sib`
- [ ] In VSCode: the tree **refreshes automatically within ~1s** of the add (Spec 823 Phase 4 closes the prior limitation — Tower now emits an `architects-updated` SSE event from both add and remove route handlers, and the VSCode `WorkspaceProvider` subscribes alongside its existing `worktree-config-updated` subscriber). No manual Refresh click needed.
- [ ] Expanding "Architects" shows both `main` and `sib`
- [ ] Click `sib` → opens `sib`'s terminal in a NEW VSCode terminal slot (not reusing `main`'s)
- [ ] Right-click `sib` → "Remove Architect" → modal confirmation → confirm → sib removed, tree refreshes, `sib`'s VSCode terminal closes gracefully (or remains showing "session ended")
- [ ] Backlog inline-button: with both `main` and `sib` open, click a backlog issue's "reference in architect" inline button. Expected: text appears in `main`'s terminal (not the active/expanded architect, regardless of which one was selected — this is the documented Phase 6 decision).

---

## Scenario 12 — Stop-all full wipe

- [ ] Add a sibling: `afx workspace add-architect --name temp`
- [ ] Trigger workspace stop-all (dashboard "Stop All" button OR `POST /workspace/<base64>/api/stop` directly)
- [ ] **Expected**: BOTH `main` and `temp` are removed from `state.db.architect`. `afx status` shows no architects.
- [ ] Distinct from Scenario 2's `workspace stop`: stop-all is the explicit nuke, stop is the graceful pause.

---

## Sign-off

When ALL 12 scenarios are checked, the verify phase is complete. Record in the
review document (`codev/reviews/786-multi-architect-feature-is-und.md`) which
scenarios were exercised, by whom, on what date, on what machine.

The PR may be merged BEFORE this verify is run (architect's call). But the
feature isn't truly "shipped" until the verify is complete and any regressions
caught.
