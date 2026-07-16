import type React from 'react';
import type { Tab } from '../hooks/useTabs.js';

/**
 * Spec 761: a small tab strip shown inside the left pane of the dashboard
 * when more than one architect is registered. Reuses the same `tab` and
 * `tab-active` CSS classes as the right-pane `TabBar` for visual consistency.
 *
 * Spec 786 Phase 4: sibling architect tabs now render a close button. The
 * close click fires `onRequestRemove(name)` so the parent (`App.tsx`) can open
 * a confirmation modal. Direct removal isn't fired from here — the modal is
 * non-blocking per OQ-G's resolution. `main` is non-closable (the tab object's
 * `closable: false` controls the X render).
 */
interface ArchitectTabStripProps {
  tabs: Tab[];
  activeTabId: string;
  onSelectTab: (id: string) => void;
  /**
   * Spec 786 Phase 4: invoked when the user clicks a sibling tab's close
   * button. Receives the architect's name (from `tab.architectName`). The
   * parent owns the confirmation modal and the remove RPC call.
   */
  onRequestRemove?: (name: string) => void;
}

export function ArchitectTabStrip({ tabs, activeTabId, onSelectTab, onRequestRemove }: ArchitectTabStripProps) {
  function handleClose(e: React.MouseEvent | React.KeyboardEvent, tab: Tab) {
    e.stopPropagation();
    e.preventDefault();
    if (!tab.architectName || !onRequestRemove) return;
    onRequestRemove(tab.architectName);
  }

  return (
    <div className="architect-tab-strip tab-bar" role="tablist" aria-label="Architect tabs">
      {tabs.map(tab => (
        <button
          key={tab.id}
          role="tab"
          aria-selected={tab.id === activeTabId}
          className={`tab ${tab.id === activeTabId ? 'tab-active' : ''}`}
          onClick={() => onSelectTab(tab.id)}
          title={tab.label}
        >
          <span className="tab-label">{tab.label}</span>
          {tab.closable && (
            <span
              className="tab-close"
              onClick={(e) => handleClose(e, tab)}
              role="button"
              aria-label={`Close ${tab.label}`}
              tabIndex={0}
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                  handleClose(e, tab);
                }
              }}
            >
              {/* aria-hidden on the visible glyph so it doesn't leak into
                  the parent tab button's accessible name. The span itself
                  has role=button + aria-label for assistive tech. */}
              <span aria-hidden="true">&times;</span>
            </span>
          )}
        </button>
      ))}
    </div>
  );
}
