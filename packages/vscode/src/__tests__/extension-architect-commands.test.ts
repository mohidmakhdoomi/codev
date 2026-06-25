/**
 * Spec 786 Phase 6: unit tests for the architect-related command
 * registrations in `extension.ts`.
 *
 * These are source-level sentinel tests for the same reason the workspace
 * and terminal-manager tests are: spinning up the full extension activation
 * path requires mocking the entire `vscode` module. The behavioral guarantees
 * end-to-end are exercised by the verify phase. These tests guard against
 * specific regressions:
 *
 *   1. `codev.openArchitectTerminal` accepts an optional architect name
 *      argument (the pre-786 command took none).
 *   2. The command resolves from `state.architects` (Phase 5 collection)
 *      with a fallback to the scalar `state.architect` for older Tower.
 *   3. `codev.removeArchitect` is registered, refuses 'main', shows a modal
 *      confirmation, and calls `workspaceProvider.refresh()` on success.
 *   4. `codev.referenceIssueInArchitect` still calls `injectArchitectText`
 *      with no name arg → defaults to 'main' (the explicit Phase 6 decision
 *      to keep the Backlog button targeting main regardless of N).
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const EXT_SRC = readFileSync(
  resolve(__dirname, '../extension.ts'),
  'utf8',
);

describe('Spec 786 Phase 6 — extension.ts architect commands', () => {
  it('codev.openArchitectTerminal accepts an optional architectName arg', () => {
    expect(EXT_SRC).toMatch(
      /(?:registerCommand|reg)\(['"]codev\.openArchitectTerminal['"],\s*async\s*\(architectName\?: string\)/
    );
  });

  it('resolves from state.architects (Phase 5) with scalar fallback', () => {
    // Backward-compat with older Tower versions that haven't shipped the
    // Phase 5 architects[] collection: fall through to the scalar.
    expect(EXT_SRC).toMatch(
      /const architects = state\?\.architects \?\? \(state\?\.architect \? \[state\.architect\] : \[\]\)/
    );
  });

  it("targetName defaults to 'main' for a no-arg, single-architect workspace", () => {
    // Issue 841 Gap 2 restructured this: no-arg invocations only default to
    // 'main' when there's at most one architect; with >1 a picker runs. The
    // single-architect branch still preserves today's open-main behaviour.
    const openBlock = EXT_SRC.split("reg('codev.openArchitectTerminal'")[1] ?? '';
    expect(openBlock).toMatch(/let targetName = architectName/);
    expect(openBlock).toMatch(/targetName = ['"]main['"]/);
  });

  it('codev.openArchitectTerminal shows a picker when no-arg and >1 architect', () => {
    // Gap 2: keyboard/palette invocation with multiple architects prompts.
    const openBlock = EXT_SRC.split("reg('codev.openArchitectTerminal'")[1] ?? '';
    expect(openBlock).toMatch(/targetName === undefined/);
    expect(openBlock).toMatch(/architects\.length > 1/);
    expect(openBlock).toMatch(/showQuickPick/);
    expect(openBlock).toMatch(/sortArchitectsForPicker/);
  });

  it('codev.addArchitect is registered and validates with the shared rule', () => {
    // Gap 1: the new UI command. Validates via the codev-core validator (same
    // rule Tower enforces) and refreshes the tree on success.
    expect(EXT_SRC).toMatch(/(?:registerCommand|regCli)\(['"]codev\.addArchitect['"]/);
    const addBlock = EXT_SRC.split("regCli('codev.addArchitect'")[1] ?? '';
    expect(addBlock).toMatch(/showInputBox/);
    expect(addBlock).toMatch(/validateInput:.*validateArchitectName/);
    expect(addBlock).toMatch(/client\.addArchitect\(/);
    expect(addBlock).toMatch(/workspaceProvider\.refresh\(\)/);
  });

  it('codev.addArchitect imports validateArchitectName from codev-core (single source)', () => {
    expect(EXT_SRC).toMatch(
      /import \{ validateArchitectName \} from ['"]@cluesmith\/codev-core\/architect-name['"]/
    );
  });

  it("codev.removeArchitect resolves the raw name from item.id, not the (uppercased) label", () => {
    // Issue 841 Gap 3: with UPPERCASE labels, arg.label != the canonical name,
    // so removeArchitect MUST read the raw name from item.id
    // (`workspace-architect-<name>`). Reading the label would DELETE a name
    // Tower doesn't know (e.g. 'WEB' vs 'web').
    const removeBlock = EXT_SRC.split("regCli('codev.removeArchitect'")[1] ?? '';
    expect(removeBlock).toMatch(/workspace-architect-/);
    expect(removeBlock).toMatch(/arg\.id/);
  });

  it('codev.removeArchitect is registered', () => {
    expect(EXT_SRC).toMatch(/(?:registerCommand|regCli)\(['"]codev\.removeArchitect['"]/);
  });

  it("codev.removeArchitect refuses 'main' before calling Tower", () => {
    // The server enforces this too (Phase 4 OQ-B), but the client gate gives
    // a faster error and keeps the modal from appearing for an impossible
    // operation.
    const removeBlock = EXT_SRC.split("regCli('codev.removeArchitect'")[1] ?? '';
    expect(removeBlock).toMatch(/if \(name === ['"]main['"]\)/);
    expect(removeBlock).toMatch(/Cannot remove.*main/i);
  });

  it('codev.removeArchitect uses a modal confirmation', () => {
    const removeBlock = EXT_SRC.split("regCli('codev.removeArchitect'")[1] ?? '';
    expect(removeBlock).toMatch(/showInformationMessage/);
    expect(removeBlock).toMatch(/modal: true/);
  });

  it('codev.removeArchitect refreshes the workspace tree on success', () => {
    // Spec 786 Phase 6 (post iter-1 CMAP): without this call, the removed
    // sibling stays visible in the sidebar until the next unrelated state
    // event.
    const removeBlock = EXT_SRC.split("regCli('codev.removeArchitect'")[1] ?? '';
    expect(removeBlock).toMatch(/workspaceProvider\.refresh\(\)/);
  });

  it("codev.referenceIssueInArchitect calls injectArchitectText with no name → defaults to 'main'", () => {
    // The Backlog inline button's documented Phase 6 behaviour: always
    // targets main, regardless of how many sibling architects exist. The
    // signature default (`architectName: string = 'main'`) makes the no-arg
    // call route to main.
    //
    // Post-#808 the injection text comes from buildArchitectReferenceInjection
    // (so the call is `injectArchitectText(buildArchitectReferenceInjection(...))`
    // instead of an inline template literal). The assertion now anchors on the
    // helper call rather than the literal `#${issueId} ` template — the
    // architect-name default behaviour is still the point of this test.
    const refBlock = EXT_SRC.split("regCli('codev.referenceIssueInArchitect'")[1] ?? '';
    // The injection call passes only the text — no architect name.
    expect(refBlock).toMatch(/injectArchitectText\(buildArchitectReferenceInjection\(/);
  });

  it('workspaceProvider is held in a const so commands can call .refresh()', () => {
    expect(EXT_SRC).toMatch(/const workspaceProvider = new WorkspaceProvider/);
    expect(EXT_SRC).toMatch(/registerTreeDataProvider\(['"]codev\.workspace['"], workspaceProvider\)/);
  });
});
