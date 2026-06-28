/**
 * Transitional one-off backfill (Issue #832).
 *
 * Records the live conversation `session_id` of each running architect that
 * doesn't already have one stored, so the architect resumes its prior
 * conversation on the next `afx workspace start` (instead of coming back fresh).
 *
 * Only needed for architects spawned BEFORE #832 shipped: architects spawned
 * under #832 store their id at spawn automatically. This is an upgrade bridge,
 * deliberately kept OUT of the `afx` CLI and the Tower REST API — run it by hand
 * once, while the architects are still alive, before a planned restart/reboot:
 *
 *   pnpm --filter @cluesmith/codev exec tsx scripts/backfill-architect-sessions.ts [workspacePath]
 *
 * (workspacePath defaults to the current directory.)
 *
 * How it disambiguates siblings sharing one cwd: it asks the resolved harness's
 * `captureRunningSession`, which correlates each architect's process subtree to
 * the session file it holds OPEN (exact), with a newest-by-mtime fallback only
 * when the workspace has a single architect (unambiguous). Agents whose harness
 * has no session capability (Codex/Gemini/OpenCode) are skipped. It writes only
 * the `session_id` column (a targeted UPDATE), so it is safe to run while Tower
 * is live.
 */

import { realpathSync } from 'node:fs';

import { getArchitects, setArchitectSessionId } from '../src/agent-farm/state.js';
import { getGlobalDb } from '../src/agent-farm/db/index.js';
import { getArchitectHarness } from '../src/agent-farm/utils/config.js';
import type { DbTerminalSession } from '../src/agent-farm/servers/tower-types.js';

function canonical(p: string): string {
  try {
    return realpathSync(p);
  } catch {
    return p;
  }
}

function main(): void {
  const rawWorkspace = process.argv[2] ?? process.cwd();
  const workspacePath = canonical(rawWorkspace);

  const architects = getArchitects(workspacePath);
  if (architects.length === 0) {
    console.log(`No architects found for workspace: ${workspacePath}`);
    console.log('(Is Tower running and the workspace active? Pass the workspace path as an argument.)');
    return;
  }

  const harness = getArchitectHarness(workspacePath);
  const capture = harness.session?.captureRunningSession;

  // Map architect name -> its recorded root pid (shellper pid for shellper-backed
  // sessions, else the agent pid). The agent process is at or below this pid.
  const pidByName = new Map<string, number>();
  const rows = getGlobalDb()
    .prepare("SELECT * FROM terminal_sessions WHERE workspace_path = ? AND type = 'architect'")
    .all(workspacePath) as DbTerminalSession[];
  for (const r of rows) {
    const pid = r.shellper_pid ?? r.pid;
    if (r.role_id && pid) pidByName.set(r.role_id, pid);
  }

  const soleArchitect = architects.length <= 1;
  const captured: string[] = [];
  const skipped: string[] = [];

  for (const a of architects) {
    if (a.sessionId) {
      // Already recorded (spawned under #832, or a prior backfill run).
      continue;
    }
    if (!capture) {
      skipped.push(`${a.name} (agent harness has no resumable sessions)`);
      continue;
    }
    const pid = pidByName.get(a.name);
    if (!pid) {
      skipped.push(`${a.name} (no running process found)`);
      continue;
    }

    let liveId: string | null = null;
    try {
      liveId = capture(workspacePath, pid, soleArchitect);
    } catch (err) {
      skipped.push(`${a.name} (capture error: ${(err as Error).message})`);
      continue;
    }
    if (!liveId) {
      skipped.push(`${a.name} (could not resolve a session)`);
      continue;
    }

    setArchitectSessionId(workspacePath, a.name, liveId);
    captured.push(`${a.name} -> ${liveId}`);
  }

  console.log(`Backfill for workspace: ${workspacePath}`);
  if (captured.length) {
    console.log(`\nCaptured (${captured.length}):`);
    for (const c of captured) console.log(`  ${c}`);
  }
  if (skipped.length) {
    console.log(`\nSkipped (${skipped.length}):`);
    for (const s of skipped) console.log(`  ${s}`);
  }
  if (!captured.length && !skipped.length) {
    console.log('\nNothing to do — every architect already has a stored session id.');
  }
  console.log('\nDone. Restart/reboot, then `afx workspace start` to resume the captured conversations.');
}

main();
