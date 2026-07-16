/**
 * Issue 841: behavior tests for the pure architect-row presentation helpers.
 *
 * These import the real implementations (the module is vscode-free by design),
 * so they exercise actual behavior rather than source-level sentinels.
 */

import { describe, it, expect } from 'vitest';
import { displayArchitectName, sortArchitectsForPicker } from '../views/architect-display.js';

describe('Issue 841 Gap 3 — displayArchitectName', () => {
  it('uppercases the default architect', () => {
    expect(displayArchitectName('main')).toBe('MAIN');
  });

  it('uppercases single-word siblings', () => {
    expect(displayArchitectName('web')).toBe('WEB');
    expect(displayArchitectName('mobile')).toBe('MOBILE');
    expect(displayArchitectName('security')).toBe('SECURITY');
  });

  it('uppercases hyphenated and numbered names whole', () => {
    expect(displayArchitectName('ob-refine')).toBe('OB-REFINE');
    expect(displayArchitectName('architect-2')).toBe('ARCHITECT-2');
  });

  it('is display-only — never mutates the identifier it was given', () => {
    // The raw lowercase name is what flows to command args / item.id; this
    // helper must be a pure transform of its input.
    const name = 'web';
    displayArchitectName(name);
    expect(name).toBe('web');
  });
});

describe('Issue 841 Gap 2 — sortArchitectsForPicker', () => {
  it('puts main first, then the rest alphabetically', () => {
    const input = [
      { name: 'web' },
      { name: 'mobile' },
      { name: 'main' },
      { name: 'security' },
    ];
    expect(sortArchitectsForPicker(input).map(a => a.name)).toEqual([
      'main', 'mobile', 'security', 'web',
    ]);
  });

  it('keeps main first even when it is already first or last', () => {
    expect(sortArchitectsForPicker([{ name: 'main' }, { name: 'web' }]).map(a => a.name))
      .toEqual(['main', 'web']);
    expect(sortArchitectsForPicker([{ name: 'web' }, { name: 'main' }]).map(a => a.name))
      .toEqual(['main', 'web']);
  });

  it('does not mutate the input array', () => {
    const input = [{ name: 'web' }, { name: 'main' }];
    const before = input.map(a => a.name);
    sortArchitectsForPicker(input);
    expect(input.map(a => a.name)).toEqual(before);
  });

  it('preserves the full entry objects (terminalId carried through)', () => {
    const input = [
      { name: 'web', terminalId: 't-web' },
      { name: 'main', terminalId: 't-main' },
    ];
    expect(sortArchitectsForPicker(input)).toEqual([
      { name: 'main', terminalId: 't-main' },
      { name: 'web', terminalId: 't-web' },
    ]);
  });
});
