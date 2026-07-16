/**
 * The panel placeholder provider (#812) renders a single signpost row that
 * points at the migration follow-up issues. Once a real panel view registers
 * and flips `codev.panelContainerEmpty` false, the view (and this row) hides;
 * here we only assert the provider's static content.
 *
 * `vscode` is mocked (the module only resolves inside the Electron host), so we
 * stub the two widgets the provider touches: TreeItem and ThemeIcon.
 */

import { describe, it, expect, vi } from 'vitest';

vi.mock('vscode', () => {
  class TreeItem {
    tooltip?: string;
    iconPath?: unknown;
    constructor(public label: string) {}
  }
  class ThemeIcon {
    constructor(public id: string) {}
  }
  return { TreeItem, ThemeIcon };
});

// Import AFTER the mock is registered.
const { PanelPlaceholderProvider } = await import('../views/panel-placeholder.js');

describe('PanelPlaceholderProvider', () => {
  const provider = new PanelPlaceholderProvider();

  it('returns exactly one row', () => {
    expect(provider.getChildren()).toHaveLength(1);
  });

  it('points at the migration follow-up issues', () => {
    const [item] = provider.getChildren();
    const label = typeof item.label === 'string' ? item.label : item.label?.label ?? '';
    expect(label).toContain('#813');
    expect(label).toContain('#814');
    expect(label).toContain('#815');
  });

  it('getTreeItem returns the element unchanged', () => {
    const [item] = provider.getChildren();
    expect(provider.getTreeItem(item)).toBe(item);
  });
});
