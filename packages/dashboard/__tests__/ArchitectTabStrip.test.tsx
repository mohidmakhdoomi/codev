/**
 * Spec 761: ArchitectTabStrip component tests.
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import { ArchitectTabStrip } from '../src/components/ArchitectTabStrip.js';
import type { Tab } from '../src/hooks/useTabs.js';

function archTab(name: string, id: string): Tab {
  return {
    id,
    type: 'architect',
    label: name,
    closable: false,
    terminalId: `term-${name}`,
    architectName: name,
  };
}

afterEach(cleanup);

describe('ArchitectTabStrip (Spec 761)', () => {
  it('renders one button per architect', () => {
    render(
      <ArchitectTabStrip
        tabs={[archTab('main', 'architect'), archTab('sibling', 'architect:sibling')]}
        activeTabId="architect"
        onSelectTab={vi.fn()}
      />,
    );

    expect(screen.getAllByRole('tab')).toHaveLength(2);
    expect(screen.getByText('main')).toBeInTheDocument();
    expect(screen.getByText('sibling')).toBeInTheDocument();
  });

  it('marks the active tab as aria-selected and tab-active', () => {
    render(
      <ArchitectTabStrip
        tabs={[archTab('main', 'architect'), archTab('sibling', 'architect:sibling')]}
        activeTabId="architect:sibling"
        onSelectTab={vi.fn()}
      />,
    );

    const tabs = screen.getAllByRole('tab');
    expect(tabs[0]).toHaveAttribute('aria-selected', 'false');
    expect(tabs[1]).toHaveAttribute('aria-selected', 'true');
    expect(tabs[1].className).toContain('tab-active');
    expect(tabs[0].className).not.toContain('tab-active');
  });

  it('calls onSelectTab with the clicked tab id', () => {
    const onSelectTab = vi.fn();
    render(
      <ArchitectTabStrip
        tabs={[archTab('main', 'architect'), archTab('sibling', 'architect:sibling')]}
        activeTabId="architect"
        onSelectTab={onSelectTab}
      />,
    );

    fireEvent.click(screen.getByText('sibling'));
    expect(onSelectTab).toHaveBeenCalledWith('architect:sibling');
  });

  it('renders no close buttons when tabs are non-closable (e.g. main)', () => {
    render(
      <ArchitectTabStrip
        tabs={[archTab('main', 'architect'), archTab('sibling', 'architect:sibling')]}
        activeTabId="architect"
        onSelectTab={vi.fn()}
      />,
    );

    expect(screen.queryByLabelText(/close/i)).toBeNull();
  });

  // Spec 786 Phase 4: sibling architect tabs gain a close button. `main` does
  // not (the tab object's `closable: false` controls the X render).
  describe('Spec 786 Phase 4 — close-button affordance', () => {
    function closableSiblingTab(name: string, id: string): Tab {
      return { ...archTab(name, id), closable: true };
    }

    it('renders a close button on closable sibling tabs', () => {
      render(
        <ArchitectTabStrip
          tabs={[archTab('main', 'architect'), closableSiblingTab('sibling', 'architect:sibling')]}
          activeTabId="architect"
          onSelectTab={vi.fn()}
          onRequestRemove={vi.fn()}
        />,
      );
      // Exactly one close button — for the sibling.
      const closeButtons = screen.getAllByRole('button', { name: /Close sibling/ });
      expect(closeButtons).toHaveLength(1);
      // `main`'s tab has no close button.
      expect(screen.queryByRole('button', { name: /Close main/ })).toBeNull();
    });

    it('invokes onRequestRemove with the architect name when close is clicked', () => {
      const onRequestRemove = vi.fn();
      render(
        <ArchitectTabStrip
          tabs={[archTab('main', 'architect'), closableSiblingTab('sibling', 'architect:sibling')]}
          activeTabId="architect"
          onSelectTab={vi.fn()}
          onRequestRemove={onRequestRemove}
        />,
      );
      fireEvent.click(screen.getByRole('button', { name: /Close sibling/ }));
      expect(onRequestRemove).toHaveBeenCalledExactlyOnceWith('sibling');
    });

    it('does NOT call onSelectTab when the close button is clicked (stopPropagation)', () => {
      const onSelectTab = vi.fn();
      render(
        <ArchitectTabStrip
          tabs={[archTab('main', 'architect'), closableSiblingTab('sibling', 'architect:sibling')]}
          activeTabId="architect"
          onSelectTab={onSelectTab}
          onRequestRemove={vi.fn()}
        />,
      );
      fireEvent.click(screen.getByRole('button', { name: /Close sibling/ }));
      // The click on the close button should NOT bubble up to the parent
      // tab button and trigger a tab-switch.
      expect(onSelectTab).not.toHaveBeenCalled();
    });

    it('close button is silent when onRequestRemove prop is not provided', () => {
      // Defensive: the component must not throw when used without the new
      // callback (e.g. by callers that haven't migrated to Spec 786 yet).
      expect(() =>
        render(
          <ArchitectTabStrip
            tabs={[archTab('main', 'architect'), closableSiblingTab('sibling', 'architect:sibling')]}
            activeTabId="architect"
            onSelectTab={vi.fn()}
            // onRequestRemove intentionally omitted
          />,
        ),
      ).not.toThrow();
      // Clicking the close button is a silent no-op (no error, no callbacks).
      fireEvent.click(screen.getByRole('button', { name: /Close sibling/ }));
    });
  });
});
