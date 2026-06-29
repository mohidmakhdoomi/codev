/**
 * Transitional one-off backfill (Issue #832).
 *
 * Records the live conversation `session_id` of each running architect, so the
 * architect resumes its prior conversation on the next `afx workspace start`
 * (instead of coming back fresh). Only needed for architects spawned BEFORE #832
 * shipped — those spawned under #832 store their id at spawn automatically (for
 * them this re-writes the same id idempotently).
 *
 * Deliberately kept OUT of the `afx` CLI. It is a thin client over the **running
 * Tower**, which owns the authoritative `state.db`: it reads via `TowerClient` and
 * writes through one narrow, transitional Tower endpoint (PUT
 * `/api/workspaces/:ws/architects/:name/session-id`). It never opens a database
 * file, so there is no cwd dependency — run it from anywhere:
 *
 *   pnpm --filter @cluesmith/codev exec tsx scripts/backfill-architect-sessions.ts [workspacePath] [--all] [--dry-run]
 *
 * Target selection:
 *   - a `workspacePath` argument (the workspace root, as Tower knows it), or
 *   - `--all` to process every workspace Tower currently has, or
 *   - neither → the current directory.
 *
 * `--dry-run` performs the full (read-only) resolution and prints the session id
 * each architect WOULD get, but issues no write. Re-run without it to apply.
 *
 * Disambiguation of siblings sharing one cwd: `captureRunningClaudeSession`
 * correlates each architect's process subtree to the session file it holds OPEN
 * (exact), with a newest-by-mtime fallback only when the workspace has a single
 * architect. A non-Claude architect has no `~/.claude` jsonl, so capture returns
 * null and it is skipped. Capture is Claude-specific and transitional, so it lives
 * here + in `claude-session-discovery.ts`, NOT in any permanent interface.
 *
 * Requires Tower to be running (the architects must be alive to capture from), and
 * Tower must be on the #832 code (older Tower lacks the write endpoint).
 */

import { resolve } from 'node:path';

import { getTowerClient } from '../src/agent-farm/lib/tower-client.js';
import { captureRunningClaudeSession } from '../src/agent-farm/utils/claude-session-discovery.js';

type Client = ReturnType<typeof getTowerClient>;

interface WorkspaceResult {
  workspacePath: string;
  set: string[];
  skipped: string[];
  noArchitects: boolean;
}

async function backfillWorkspace(client: Client, workspacePath: string, dryRun: boolean): Promise<WorkspaceResult> {
  const set: string[] = [];
  const skipped: string[] = [];

  const status = await client.getWorkspaceStatus(workspacePath);
  const architectTerminals = (status?.terminals ?? []).filter((t) => t.type === 'architect');
  if (architectTerminals.length === 0) {
    return { workspacePath, set, skipped, noArchitects: true };
  }

  const soleArchitect = architectTerminals.length <= 1;

  for (const t of architectTerminals) {
    const name = t.architectName;
    if (!name) {
      skipped.push('<unnamed architect terminal>');
      continue;
    }
    if (!t.pid) {
      skipped.push(`${name} (no live process)`);
      continue;
    }

    let liveId: string | null = null;
    try {
      liveId = captureRunningClaudeSession(workspacePath, t.pid, { soleArchitect });
    } catch (err) {
      skipped.push(`${name} (capture error: ${(err as Error).message})`);
      continue;
    }
    if (!liveId) {
      skipped.push(`${name} (no resumable Claude session found)`);
      continue;
    }

    if (!dryRun) {
      const res = await client.setArchitectSessionId(workspacePath, name, liveId);
      if (!res.ok) {
        skipped.push(`${name} (write failed: ${res.error ?? 'unknown error'})`);
        continue;
      }
    }
    set.push(`${name} -> ${liveId}`);
  }

  return { workspacePath, set, skipped, noArchitects: false };
}

function printResult(r: WorkspaceResult, dryRun: boolean): void {
  console.log(`\nWorkspace: ${r.workspacePath}`);
  if (r.noArchitects) {
    console.log('  No live architects.');
    return;
  }
  if (r.set.length) {
    console.log(`  ${dryRun ? 'Would set' : 'Set'} (${r.set.length}):`);
    for (const s of r.set) console.log(`    ${s}`);
  }
  if (r.skipped.length) {
    console.log(`  Skipped (${r.skipped.length}):`);
    for (const s of r.skipped) console.log(`    ${s}`);
  }
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const dryRun = args.includes('--dry-run');
  const all = args.includes('--all');
  const positional = args.find((a) => !a.startsWith('--'));

  if (all && positional) {
    console.error('Pass either a workspacePath or --all, not both.');
    process.exit(1);
  }

  const client = getTowerClient();
  if (!(await client.isRunning())) {
    console.error('Tower is not running. Start it (and the workspaces) first — the architects must be alive to capture from.');
    process.exit(1);
  }

  const targets = all
    ? (await client.listWorkspaces()).map((w) => w.path)
    : [resolve(positional ?? process.cwd())];

  console.log(
    `Backfill architect session ids${dryRun ? '  [DRY RUN — no changes written]' : ''}` +
    (all ? `  (--all: ${targets.length} workspace(s))` : ''),
  );

  if (targets.length === 0) {
    console.log('\nNo workspaces found.');
    return;
  }

  let totalSet = 0;
  for (const t of targets) {
    const result = await backfillWorkspace(client, t, dryRun);
    if (all && result.noArchitects) continue; // keep --all output focused
    printResult(result, dryRun);
    totalSet += result.set.length;
  }

  if (dryRun) {
    if (totalSet) console.log('\nDry run only — re-run without `--dry-run` to write these session ids.');
  } else if (totalSet) {
    console.log('\nDone. Restart/reboot, then `afx workspace start` to resume the captured conversations.');
  }
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
