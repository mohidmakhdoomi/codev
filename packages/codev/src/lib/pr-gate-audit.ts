/**
 * PR-gate audit (#943) — guardrail enforcing #927's universal `pr` gate contract.
 *
 * #927 made Needs Attention surface PRs via the universal `pr` gate: porch
 * requests the `pr` gate when a protocol's PR-creating phase completes
 * (`isPrCreatingPhase`, i.e. `phase.gate === 'pr'`), and the dashboard / VSCode
 * surface the PR from that pending gate (`derivePrReady`). A PR-producing
 * protocol whose resolved definition carries NO `pr` gate is therefore never
 * requested, and its PRs silently vanish from Needs Attention.
 *
 * `codev update` deliberately preserves user-modified files as local overrides
 * (tier-1 `.codev/` / tier-2 `codev/`), so a customized override that predates
 * #927 — and lacks a `pr` gate — keeps winning the 4-tier resolution while
 * silently breaking surfacing. This module detects exactly that case so doctor
 * and update can turn the silent breakage into an actionable migration prompt.
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import { resolveCodevFile, findWorkspaceRoot } from './skeleton.js';

/**
 * Bundled PR-producing protocols — the set whose PR-creating phase carries a
 * `pr` gate in the stock skeleton (mirrors `derivePrReady`'s documented set in
 * overview.ts). experiment/maintain are NOT PR-producing (their completion
 * gates are `experiment-complete` / `maintain-complete`, not `pr`) and are
 * excluded by design. A new PR-producing protocol must be added here.
 */
export const PR_PRODUCING_PROTOCOLS = ['bugfix', 'air', 'spir', 'aspir', 'pir'] as const;

/** Resolution tier the offending protocol.json was resolved from. */
export type PrGateSource = 'override' | 'cache' | 'skeleton';

export interface PrGateWarning {
  /** Protocol name (e.g. "bugfix"). */
  protocol: string;
  /** Absolute path to the resolved protocol.json. */
  resolvedPath: string;
  /** Path relative to the workspace root, for display. */
  displayPath: string;
  /** Which resolution tier the offending file came from. */
  source: PrGateSource;
}

/**
 * Extract a phase's gate name, accepting both the string form (`"gate": "pr"`)
 * and the object form (`"gate": { "name": "pr", ... }`). Mirrors the gate
 * parsing in porch's `normalizePhase` (commands/porch/protocol.ts) so this
 * check stays faithful to how porch actually reads gates.
 */
function gateName(phase: unknown): string | undefined {
  if (!phase || typeof phase !== 'object') return undefined;
  const gate = (phase as Record<string, unknown>).gate;
  if (typeof gate === 'string') return gate;
  if (gate && typeof gate === 'object') {
    const name = (gate as Record<string, unknown>).name;
    return typeof name === 'string' ? name : undefined;
  }
  return undefined;
}

/** Classify which resolution tier a resolved path belongs to. */
function classifySource(root: string, resolvedPath: string): PrGateSource {
  const dotCodev = path.join(root, '.codev') + path.sep;
  const localCodev = path.join(root, 'codev') + path.sep;
  if (resolvedPath.startsWith(dotCodev) || resolvedPath.startsWith(localCodev)) {
    return 'override';
  }
  if (resolvedPath.includes(`${path.sep}skeleton${path.sep}`)) return 'skeleton';
  return 'cache';
}

/**
 * Audit the bundled PR-producing protocols for a missing `pr` gate.
 *
 * Each protocol is resolved through the 4-tier resolver (local overrides win),
 * and any whose resolved definition has no phase gated `pr` is flagged. Returns
 * one entry per offending protocol; an empty array means every PR-producing
 * protocol is correctly gated.
 *
 * Protocols that don't resolve at all, or whose override is unparseable, are
 * skipped — neither is the "lost pr gate" condition this guardrail targets.
 */
export function auditPrGates(workspaceRoot?: string): PrGateWarning[] {
  const root = workspaceRoot || findWorkspaceRoot();
  const warnings: PrGateWarning[] = [];

  for (const protocol of PR_PRODUCING_PROTOCOLS) {
    const resolvedPath = resolveCodevFile(`protocols/${protocol}/protocol.json`, root);
    if (!resolvedPath) continue;

    let phases: unknown[];
    try {
      const json = JSON.parse(fs.readFileSync(resolvedPath, 'utf-8'));
      phases = Array.isArray(json?.phases) ? json.phases : [];
    } catch {
      continue; // Unparseable override — out of scope for the pr-gate check.
    }

    if (phases.some(p => gateName(p) === 'pr')) continue;

    warnings.push({
      protocol,
      resolvedPath,
      displayPath: path.relative(root, resolvedPath) || resolvedPath,
      source: classifySource(root, resolvedPath),
    });
  }

  return warnings;
}

/**
 * Format a PR-gate warning into a single loud, actionable line (no icon/indent
 * — callers add those). Shared by doctor and update so the wording stays in sync.
 */
export function formatPrGateWarning(w: PrGateWarning): string {
  const where =
    w.source === 'override'
      ? `local override at \`${w.displayPath}\``
      : `resolved from ${w.source} at \`${w.displayPath}\``;
  return (
    `Protocol \`${w.protocol}\` (${where}) has no \`pr\` gate on its PR-creating phase. ` +
    `Its PRs will not surface in Needs Attention (Codev ≥ 3.1.5). ` +
    `Add \`"gate": "pr"\` to that phase, or remove the override to use the stock pr-gated protocol.`
  );
}
