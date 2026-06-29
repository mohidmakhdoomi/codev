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
 *   pnpm --filter @cluesmith/codev exec tsx scripts/backfill-architect-sessions.ts [workspacePath] [--all] [--dry-run]
 *
 * Target selection:
 *   - a `workspacePath` argument (the workspace root activated with `afx workspace
 *     start`), or
 *   - `--all` to backfill every workspace that currently has architects (enumerated
 *     from `global.db.terminal_sessions`), or
 *   - neither → the current directory.
 *
 * Pass `--dry-run` to PREVIEW: it performs the full (read-only) resolution and
 * prints the exact session id each architect WOULD get, but writes nothing. Re-run
 * without `--dry-run` to apply.
 *
 * How it disambiguates siblings sharing one cwd: `captureRunningClaudeSession`
 * correlates each architect's process subtree to the session file it holds OPEN
 * (exact), with a newest-by-mtime fallback only when the workspace has a single
 * architect (unambiguous). Only architects whose harness can resume a session at
 * all (`harness.session`) are considered; the rest are skipped — and a non-Claude
 * agent has no `~/.claude` jsonl, so capture would return null for it anyway. It
 * writes only the `session_id` column (a targeted UPDATE), so it is safe to run
 * while Tower is live.
 *
 * Capture is Claude-specific by nature (it reads Claude's on-disk session store),
 * so it lives here + in `claude-session-discovery.ts`, NOT in the permanent
 * `HarnessProvider` interface — this is a transitional backfill, not steady state.
 */

import { realpathSync } from 'node:fs';

import { getArchitects, setArchitectSessionId } from '../src/agent-farm/state.js';
import { getGlobalDb } from '../src/agent-farm/db/index.js';
import { getArchitectHarness } from '../src/agent-farm/utils/config.js';
import { captureRunningClaudeSession } from '../src/agent-farm/utils/claude-session-discovery.js';
import type { DbTerminalSession } from '../src/agent-farm/servers/tower-types.js';

function canonical(p: string): string {
  try {
    return realpathSync(p);
  } catch {
    return p;
  }
}

interface WorkspaceResult {
  workspacePath: string;
  captured: string[];
  skipped: string[];
  noArchitects: boolean;
}

/** Backfill a single workspace. Read-only when `dryRun` is true. */
function backfillWorkspace(rawWorkspace: string, dryRun: boolean): WorkspaceResult {
  const workspacePath = canonical(rawWorkspace);
  const captured: string[] = [];
  const skipped: string[] = [];

  const architects = getArchitects(workspacePath);
  if (architects.length === 0) {
    return { workspacePath, captured, skipped, noArchitects: true };
  }

  // Gate on the (permanent) session capability: only architects whose agent can
  // resume a session are worth capturing one for.
  const resumable = !!getArchitectHarness(workspacePath).session;

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

  for (const a of architects) {
    if (a.sessionId) {
      // Already recorded (spawned under #832, or a prior backfill run).
      continue;
    }
    if (!resumable) {
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
      liveId = captureRunningClaudeSession(workspacePath, pid, { soleArchitect });
    } catch (err) {
      skipped.push(`${a.name} (capture error: ${(err as Error).message})`);
      continue;
    }
    if (!liveId) {
      skipped.push(`${a.name} (could not resolve a session)`);
      continue;
    }

    if (!dryRun) {
      setArchitectSessionId(workspacePath, a.name, liveId);
    }
    captured.push(`${a.name} -> ${liveId}`);
  }

  return { workspacePath, captured, skipped, noArchitects: false };
}

/** Every workspace that currently has architect terminals (the backfill targets). */
function workspacesWithArchitects(): string[] {
  const rows = getGlobalDb()
    .prepare("SELECT DISTINCT workspace_path FROM terminal_sessions WHERE type = 'architect'")
    .all() as { workspace_path: string }[];
  return rows.map((r) => r.workspace_path);
}

function printResult(r: WorkspaceResult, dryRun: boolean): void {
  console.log(`\nWorkspace: ${r.workspacePath}`);
  if (r.noArchitects) {
    console.log('  No architects found.');
    return;
  }
  if (r.captured.length) {
    console.log(`  ${dryRun ? 'Would capture' : 'Captured'} (${r.captured.length}):`);
    for (const c of r.captured) console.log(`    ${c}`);
  }
  if (r.skipped.length) {
    console.log(`  Skipped (${r.skipped.length}):`);
    for (const s of r.skipped) console.log(`    ${s}`);
  }
  if (!r.captured.length && !r.skipped.length) {
    console.log('  Nothing to do — every architect already has a stored session id.');
  }
}

function main(): void {
  const args = process.argv.slice(2);
  const dryRun = args.includes('--dry-run');
  const all = args.includes('--all');
  const positional = args.find((a) => !a.startsWith('--'));

  if (all && positional) {
    console.error('Pass either a workspacePath or --all, not both.');
    process.exit(1);
  }

  const targets = all
    ? workspacesWithArchitects()
    : [positional ?? process.cwd()];

  console.log(
    `Backfill architect session ids${dryRun ? '  [DRY RUN — no changes written]' : ''}` +
    (all ? `  (--all: ${targets.length} workspace(s) with architects)` : ''),
  );

  if (targets.length === 0) {
    console.log('\nNo workspaces with architects found.');
    return;
  }

  let totalCaptured = 0;
  for (const t of targets) {
    const result = backfillWorkspace(t, dryRun);
    printResult(result, dryRun);
    totalCaptured += result.captured.length;
  }

  if (dryRun) {
    if (totalCaptured) {
      console.log('\nDry run only — re-run without `--dry-run` to write these session ids.');
    }
  } else if (totalCaptured) {
    console.log('\nDone. Restart/reboot, then `afx workspace start` to resume the captured conversations.');
  }
}

main();
