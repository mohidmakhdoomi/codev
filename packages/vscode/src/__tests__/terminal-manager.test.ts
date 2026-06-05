/**
 * Spec 786 Phase 6: unit tests for `TerminalManager`'s per-name terminal-slot
 * keying.
 *
 * Constructing a full `TerminalManager` requires a `vscode.OutputChannel`,
 * `vscode.Uri`, `ConnectionManager`, and `OverviewCache` — heavyweight deps
 * that would force broad vscode-API mocking. Instead, this test file
 * verifies the keying invariants at the source level:
 *
 *   1. `openArchitect` keys terminals by `architect:${architectName}` (not the
 *      pre-786 singleton `'architect'` key).
 *   2. `injectArchitectText` looks up the same key.
 *   3. Both methods default `architectName` to `'main'` so existing no-arg
 *      callers (e.g. `codev.referenceIssueInArchitect`) keep targeting `main`.
 *
 * The integration behavior (open `main` then `ob-refine` → two separate
 * VSCode terminals) is exercised by the verify-phase manual round-trip.
 * These sentinel tests catch any regression that re-introduces the singleton
 * key without requiring a full vscode harness.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
// `sessionRefFromMapKey` lives in its own vscode-free module so it imports
// cleanly here without the adapter's transport/types chain (#991).
import { sessionRefFromMapKey } from '../session-ref.js';

const TM_SRC = readFileSync(
  resolve(__dirname, '../terminal-manager.ts'),
  'utf8',
);

describe('Spec 786 Phase 6 — TerminalManager per-name keying', () => {
  it('openArchitect builds map key as `architect:${architectName}`', () => {
    // The keying scheme is critical: pre-786 used the literal `'architect'`
    // singleton, conflating all architects into one terminal slot.
    expect(TM_SRC).toMatch(/openArchitect\([^)]*architectName[^)]*\)/);
    expect(TM_SRC).toMatch(/const key = `architect:\$\{architectName\}`/);
  });

  it('injectArchitectText also keys by `architect:${architectName}`', () => {
    // Symmetric with openArchitect — same key shape so a `main` terminal
    // opened by openArchitect can be injected to by injectArchitectText.
    expect(TM_SRC).toMatch(/injectArchitectText\([^)]*architectName[^)]*\)/);
    // The key construction inside injectArchitectText.
    const injectBody = TM_SRC.split('injectArchitectText')[1] ?? '';
    expect(injectBody).toMatch(/const key = `architect:\$\{architectName\}`/);
  });

  it("both methods default architectName to 'main' for backward compat", () => {
    // Existing no-arg callers like codev.referenceIssueInArchitect MUST keep
    // targeting `main` — Phase 6 plan pin.
    expect(TM_SRC).toMatch(/openArchitect\(terminalId: string,\s*architectName: string = 'main'/);
    expect(TM_SRC).toMatch(/injectArchitectText\(text: string,\s*architectName: string = 'main'/);
  });

  it('no longer uses the pre-786 singleton `terminals.get(\'architect\')` lookup', () => {
    // The singleton key was the root cause of the "all architects share one
    // terminal" bug. Regression guard: if a future refactor brings the
    // literal back, this test fails.
    expect(TM_SRC).not.toMatch(/terminals\.get\(['"]architect['"]\)/);
  });

  it('architect label distinguishes main from siblings', () => {
    // UX detail: a sibling's VSCode terminal title includes its name so the
    // user can tell `main` from `ob-refine` in the terminal-list dropdown.
    expect(TM_SRC).toMatch(/Codev: Architect \(\$\{architectName\}\)/);
  });
});

describe('#991 — successor-session recovery wiring', () => {
  describe('sessionRefFromMapKey', () => {
    it('maps a builder map key to a builder ref (id stripped of the prefix)', () => {
      expect(sessionRefFromMapKey('builder-spir-153')).toEqual({ kind: 'builder', id: 'spir-153' });
    });

    it('maps an architect map key to an architect ref (name stripped of the prefix)', () => {
      expect(sessionRefFromMapKey('architect:main')).toEqual({ kind: 'architect', name: 'main' });
      expect(sessionRefFromMapKey('architect:ob-refine')).toEqual({ kind: 'architect', name: 'ob-refine' });
    });

    it('returns null for non-persistent kinds (shell/dev) — no successor to resolve', () => {
      // dev keys start with `dev-`, not `builder-`, so they don't misclassify.
      expect(sessionRefFromMapKey('shell-2')).toBeNull();
      expect(sessionRefFromMapKey('dev-spir-153')).toBeNull();
      expect(sessionRefFromMapKey('dev-builder-spir-1')).toBeNull();
    });
  });

  it('recoverSuccessor resolves the successor via the shared core helper', () => {
    // Guards the cross-cutting contract: the manager maps stable identity →
    // current terminalId through the same core helper the dashboard's rule
    // mirrors, not a bespoke inline lookup.
    expect(TM_SRC).toMatch(/resolveSuccessorTerminalId\(state, ref\)/);
    expect(TM_SRC).toMatch(/from '@cluesmith\/codev-core\/session-successor'/);
  });

  it('recoverSuccessor re-points the existing tab in place (no tab churn) only on a NEW id', () => {
    // In-place reconnect onto the successor url; the id-unchanged guard avoids
    // a needless reconnect when state still carries the same id.
    expect(TM_SRC).toMatch(/successorId && successorId !== entry\.id/);
    expect(TM_SRC).toMatch(/entry\.pty\.reconnect\(wsUrl\)/);
  });

  it('recoverSuccessor polls a bounded number of times to ride out the reconcile race', () => {
    // Tower accepts connections (and 404s the dead id) before startup reconcile
    // re-registers the successor; a one-shot lookup would race that window and
    // leave the terminal dead. Bounded poll closes the race.
    expect(TM_SRC).toMatch(/for \(let attempt = 0; attempt < RECOVER_POLL_ATTEMPTS; attempt\+\+\)/);
    expect(TM_SRC).toMatch(/await delay\(RECOVER_POLL_INTERVAL_MS\)/);
  });

  it('recoverSuccessor bails if the terminal was closed/replaced mid-poll', () => {
    // The map entry is a fresh object per (re)open; an identity mismatch means
    // this recovery is stale (manual close, or another recovery won the race).
    expect(TM_SRC).toMatch(/this\.terminals\.get\(mapKey\) !== entry/);
  });

  it('reconnectByTerminal re-resolves the successor first, falling back to a same-url retry', () => {
    // The manual "Click here to reconnect" affordance must re-resolve (so it
    // stops retrying a dead id post-restart) and only retry the same url when
    // there is genuinely no successor (transient give-up).
    const body = TM_SRC.split('reconnectByTerminal')[1] ?? '';
    expect(body).toMatch(/recoverSuccessor\(mapKey\)/);
    expect(body).toMatch(/if \(!recovered\) \{ managed\.pty\.reconnect\(\); \}/);
  });

  it('the adapter is constructed with an onSessionGone recovery hook', () => {
    expect(TM_SRC).toMatch(/void this\.recoverSuccessor\(mapKey\)/);
  });

  it('resyncAllTerminals runs recoverSuccessor over every open terminal', () => {
    // The reliable recovery trigger: on a Tower reconnect, re-point every open
    // terminal, rather than waiting for each adapter's own dead-id 404.
    const body = TM_SRC.split('resyncAllTerminals()')[1] ?? '';
    expect(body).toMatch(/\[\.\.\.this\.terminals\.keys\(\)\]/);
    expect(body).toMatch(/for \(const mapKey of mapKeys\)/);
    expect(body).toMatch(/void this\.recoverSuccessor\(mapKey\)/);
  });
});

describe('#991 — recovery is triggered by the Tower-reconnect event', () => {
  const EXT_SRC = readFileSync(resolve(__dirname, '../extension.ts'), 'utf8');

  it('extension re-syncs terminals on onStateChange → connected (reconnect)', () => {
    expect(EXT_SRC).toMatch(/connectionManager\.onStateChange\(\(state\) =>/);
    expect(EXT_SRC).toMatch(/terminalManager\?\.resyncAllTerminals\(\)/);
  });

  it("the resync is gated on a prior connect (skips the initial activation 'connected')", () => {
    expect(EXT_SRC).toMatch(/hasConnectedToTower/);
  });
});

describe('#921 — dev surface refresh on manual terminal close', () => {
  // Regression guard: a dev terminal closed via the generic onDidCloseTerminal
  // path (tab ✕ / process exit) must clear devStartedAt AND re-fire
  // onDidChangeDevTerminals, or the chip / Codev Dev tab / devServerRunning
  // context strand as "running". The explicit close paths fired the event; the
  // generic path previously only unmapped. Source-level per this file's harness
  // rationale (constructing TerminalManager needs heavy vscode mocking).
  const closeHandler = TM_SRC.split('onDidCloseTerminal((t)')[1]?.split('terminal.show')[0] ?? '';

  it('clears devStartedAt for a dev terminal closed via the generic path', () => {
    expect(closeHandler).toMatch(/mapKey\.startsWith\(['"]dev-['"]\)/);
    expect(closeHandler).toMatch(/devStartedAt\.delete\(/);
  });

  it('re-fires the dev-terminal change event from the generic close path', () => {
    expect(closeHandler).toMatch(/_onDidChangeDevTerminals\.fire\(\)/);
  });
});
