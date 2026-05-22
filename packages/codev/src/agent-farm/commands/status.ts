/**
 * Status command - shows status of all agents
 *
 * Phase 3 (Spec 0090): Uses tower API for workspace status.
 */

import { loadState } from '../state.js';
import { logger } from '../utils/logger.js';
import { getConfig } from '../utils/config.js';
import { getTowerClient } from '../lib/tower-client.js';
import { getTypeColor } from '../utils/display.js';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { loadConfig } from '../../lib/config.js';
import chalk from 'chalk';

/**
 * Display status of all agent farm processes
 */
export async function status(): Promise<void> {
  const config = getConfig();
  const workspacePath = config.workspaceRoot;

  logger.header('Agent Farm Status');

  // Try tower API first (Phase 3 - Spec 0090)
  const client = getTowerClient();
  const towerRunning = await client.isRunning();

  if (towerRunning) {
    // Get health info
    const health = await client.getHealth();
    if (health) {
      logger.kv('Tower', chalk.green('running'));
      logger.kv('  Uptime', `${Math.floor(health.uptime)}s`);
      logger.kv('  Active Workspaces', health.activeWorkspaces);
      logger.kv('  Memory', `${Math.round(health.memoryUsage / 1024 / 1024)}MB`);
    }

    showArtifactConfig(workspacePath);

    logger.blank();

    // Get workspace status from tower
    const workspaceStatus = await client.getWorkspaceStatus(workspacePath);

    if (workspaceStatus) {
      const statusText = workspaceStatus.active ? chalk.green('active') : chalk.gray('inactive');
      logger.kv('Workspace', workspaceStatus.name);
      logger.kv('  Status', statusText);
      logger.kv('  Terminals', workspaceStatus.terminals.length);

      if (workspaceStatus.terminals.length > 0) {
        // Spec 786 Phase 5: enumerate architects explicitly first, so users see
        // ALL registered architects (not just one collapsed "Architect" row).
        // Each architect entry's `architectName`, `pid`, and optional `port`
        // come from the Tower API (per Spec 786 Phase 5's TowerWorkspaceStatus
        // extension). Builders/shells/dev remain in the general Terminals list.
        const architectTerminals = workspaceStatus.terminals.filter(t => t.type === 'architect');
        const otherTerminals = workspaceStatus.terminals.filter(t => t.type !== 'architect');

        if (architectTerminals.length > 0) {
          logger.blank();
          logger.info('Architects:');
          for (const term of architectTerminals) {
            const name = term.architectName || term.label;
            const pid = term.pid ? `pid=${term.pid}` : 'pid=?';
            const port = term.port ? ` port=${term.port}` : '';
            const termId = ` terminal=${term.id}`;
            logger.info(`  ${chalk.cyan(name)} (${pid}${port}${termId})`);
          }
        }

        if (otherTerminals.length > 0) {
          logger.blank();
          logger.info('Terminals:');
          for (const term of otherTerminals) {
            const typeColor = term.type === 'builder' ? chalk.blue
              : term.type === 'dev' ? chalk.green
              : chalk.gray;
            logger.info(`  ${typeColor(term.type)} - ${term.label} (${term.active ? 'active' : 'stopped'})`);
          }
        }
      }

      return;
    }

    // Workspace not found in tower, show "not active"
    logger.kv('Workspace', chalk.gray('not active in tower'));
    logger.info(`Run 'afx tower start' to activate this workspace`);
    return;
  }

  // Tower not running - show message and fall back to local state
  logger.kv('Tower', chalk.gray('not running'));
  logger.info(`Run 'afx tower start' to start the tower daemon`);

  showArtifactConfig(workspacePath);

  logger.blank();

  // Fall back to local state for legacy display.
  // Spec 786 Phase 5: enumerate ALL architects from state.db. PID and port
  // are not available without Tower (the architect table persists pid=0,
  // port=0 — see state.ts:79, :103), so the fallback shows name + cmd only.
  const state = loadState();

  if (state.architects && state.architects.length > 0) {
    logger.kv('Architects', chalk.green(`${state.architects.length} registered`));
    logger.info(`  (Tower not running — PID/port not available)`);
    for (const a of state.architects) {
      logger.info(`  ${chalk.cyan(a.name ?? 'main')}: cmd=${a.cmd} started=${a.startedAt}`);
    }
  } else {
    logger.kv('Architects', chalk.gray('none registered'));
  }

  logger.blank();

  // Builders
  if (state.builders.length > 0) {
    logger.info('Builders:');
    const widths = [20, 20, 10, 12, 10];

    logger.row(['ID', 'Name', 'Type', 'Status', 'Phase'], widths);
    logger.row(['──', '────', '────', '──────', '─────'], widths);

    for (const builder of state.builders) {
      const running = !!builder.terminalId;
      const statusColor = getStatusColor(builder.status, running);
      const typeColor = getTypeColor(builder.type || 'spec');

      logger.row([
        builder.id,
        builder.name.substring(0, 18),
        typeColor(builder.type || 'spec'),
        statusColor(builder.status),
        builder.phase.substring(0, 8),
      ], widths);
    }
  } else {
    logger.info('Builders: none');
  }

  logger.blank();

  // Utils
  if (state.utils.length > 0) {
    logger.info('Utility Terminals:');
    const widths = [8, 20];

    logger.row(['ID', 'Name'], widths);
    logger.row(['──', '────'], widths);

    for (const util of state.utils) {
      logger.row([
        util.id,
        util.name.substring(0, 18),
      ], widths);
    }
  } else {
    logger.info('Utility Terminals: none');
  }

  logger.blank();

  // Annotations
  if (state.annotations.length > 0) {
    logger.info('Annotations:');
    const widths = [8, 30];

    logger.row(['ID', 'File'], widths);
    logger.row(['──', '────'], widths);

    for (const annotation of state.annotations) {
      logger.row([
        annotation.id,
        annotation.file.substring(0, 28),
      ], widths);
    }
  } else {
    logger.info('Annotations: none');
  }
}

function showArtifactConfig(workspacePath: string): void {
  let artifacts: { backend?: string; scope?: string; command?: string } | undefined;
  try {
    artifacts = loadConfig(workspacePath).artifacts;
  } catch { return; }

  if (!artifacts?.backend) return;

  logger.blank();

  if (artifacts.backend === 'cli') {
    const command = artifacts.command || '(not configured)';
    logger.kv('Artifacts', chalk.cyan(`cli (${command})`));
    if (artifacts.scope) {
      logger.kv('  Scope', artifacts.scope);
    }
    // Resolve data repo from env var or .env file
    let dataRepo = process.env.CODEV_ARTIFACTS_DATA_REPO;
    if (!dataRepo) {
      const envPath = join(workspacePath, '.env');
      try {
        const envContent = readFileSync(envPath, 'utf-8');
        const match = envContent.match(/^CODEV_ARTIFACTS_DATA_REPO=(.+)$/m);
        dataRepo = match?.[1]?.trim();
      } catch { /* .env may not exist */ }
    }
    if (dataRepo) {
      logger.kv('  Data Repo', dataRepo);
    }
  } else {
    logger.kv('Artifacts', `${artifacts.backend} (codev/specs/, codev/plans/)`);
  }
}

function getStatusColor(status: string, running: boolean): (text: string) => string {
  if (!running) {
    return chalk.gray;
  }

  switch (status) {
    case 'implementing':
      return chalk.blue;
    case 'blocked':
      return chalk.yellow;
    case 'pr':
      return chalk.green;
    case 'verify':
      return chalk.green;
    case 'verified':
      return chalk.green;
    case 'complete': // backward compat
      return chalk.green;
    default:
      return chalk.white;
  }
}

