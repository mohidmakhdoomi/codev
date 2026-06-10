import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react';
import * as React from 'react';
import { ArtifactCanvas } from '../ArtifactCanvas.js';
import type { ReviewMarker } from '../../types.js';

afterEach(cleanup);

/**
 * Stub host (spec D3/D6 + text-as-source-of-truth): file + marker adapters share one text store.
 * `markerAdapter.add` serializes a positional `<!-- REVIEW(@author): text -->` INTO the text and
 * notifies the watcher; `list` derives markers from the current text. This exercises the round-trip
 * *through text*, not an in-memory side store.
 */
function makeHost(initial: string) {
  let text = initial;
  const watchers: Array<(c: string) => void> = [];
  const parse = (t: string): ReviewMarker[] => {
    const out: ReviewMarker[] = [];
    t.split('\n').forEach((ln, i) => {
      const m = ln.match(/<!--\s*REVIEW\(@([^)]+)\):\s*(.*?)\s*-->/);
      // #857 convention: a REVIEW comment annotates the line ABOVE it (it's written on the next
      // line). So the marker's logical line is i-1 — the content block the reviewer commented on.
      if (m && i > 0) out.push({ author: m[1], line: i - 1, text: m[2], raw: ln.trim() });
    });
    return out;
  };
  const fileAdapter = {
    read: vi.fn(async () => text),
    watch: vi.fn((_uri: string, cb: (c: string) => void) => {
      watchers.push(cb);
      return { dispose: vi.fn(() => { const i = watchers.indexOf(cb); if (i >= 0) watchers.splice(i, 1); }) };
    }),
  };
  const markerAdapter = {
    list: vi.fn(async () => parse(text)),
    add: vi.fn(async (_uri: string, line: number, body: string, author: string) => {
      const lines = text.split('\n');
      lines.splice(line + 1, 0, `<!-- REVIEW(@${author}): ${body} -->`);
      text = lines.join('\n');
      watchers.forEach((cb) => cb(text));
    }),
  };
  const themeAdapter = {
    resolve: vi.fn((tok: string) => (tok === '--codev-canvas-foreground' ? '#111111' : '')),
    onChange: vi.fn(() => ({ dispose: vi.fn() })),
  };
  return { text: () => text, watchers, fileAdapter, markerAdapter, themeAdapter };
}

describe('ArtifactCanvas (Phase 3)', () => {
  it('renders content from FileAdapter and lists markers', async () => {
    const host = makeHost('# Title\n\nA paragraph.');
    render(<ArtifactCanvas uri="x" {...host} onAddComment={vi.fn()} />);
    await waitFor(() => expect(document.querySelector('h1')).not.toBeNull());
    expect(host.fileAdapter.read).toHaveBeenCalledWith('x');
    expect(host.markerAdapter.list).toHaveBeenCalled();
  });

  it('hover shows the "+" affordance; clicking emits onAddComment with the 0-based line (scenario 2)', async () => {
    const host = makeHost('# Title\n\nA paragraph.');
    const onAddComment = vi.fn();
    render(<ArtifactCanvas uri="x" {...host} onAddComment={onAddComment} />);
    const p = await waitFor(() => {
      const el = document.querySelector('p[data-line]');
      if (!el) throw new Error('no paragraph yet');
      return el as HTMLElement;
    });
    fireEvent.mouseOver(p);
    const plus = await screen.findByRole('button', { name: /add comment on line/i });
    fireEvent.click(plus);
    expect(onAddComment).toHaveBeenCalledWith(Number(p.getAttribute('data-line')));
    // The package must NOT write the marker itself (D6 intent-only / invariant scenario 6).
    expect(host.markerAdapter.add).not.toHaveBeenCalled();
  });

  it('is keyboard-activatable: Enter on a focused block emits onAddComment (accessibility AC)', async () => {
    const host = makeHost('A paragraph.');
    const onAddComment = vi.fn();
    render(<ArtifactCanvas uri="x" {...host} onAddComment={onAddComment} />);
    const p = await waitFor(() => {
      const el = document.querySelector('p[data-line]');
      if (!el) throw new Error('no paragraph yet');
      return el as HTMLElement;
    });
    expect(p.tabIndex).toBe(0); // focusable
    fireEvent.keyDown(p, { key: 'Enter' });
    expect(onAddComment).toHaveBeenCalledWith(0);
  });

  it('round-trips a marker through text: host add → watch → re-list → marker renders (scenario 3)', async () => {
    const host = makeHost('A paragraph.'); // line 0, no markers
    const onAddComment = vi.fn((line: number) => {
      // Host glue: collect text + write back via MarkerAdapter.add (which serializes into the file text).
      void host.markerAdapter.add('x', line, 'please clarify', 'reviewer');
    });
    render(<ArtifactCanvas uri="x" {...host} onAddComment={onAddComment} />);
    const p = await waitFor(() => {
      const el = document.querySelector('p[data-line]');
      if (!el) throw new Error('no paragraph yet');
      return el as HTMLElement;
    });
    fireEvent.mouseOver(p);
    fireEvent.click(await screen.findByRole('button', { name: /add comment on line/i }));
    expect(host.markerAdapter.add).toHaveBeenCalled();
    // After the host writes + the watcher fires, the component re-lists and renders the marker.
    await waitFor(() => expect(document.querySelector('.codev-canvas-has-marker')).not.toBeNull());
    expect(host.text()).toContain('<!-- REVIEW(@reviewer): please clarify -->'); // proves text round-trip
  });

  it('drops out-of-range markers (line >= doc length) and warns (deferred #4)', async () => {
    const host = makeHost('one line only');
    host.markerAdapter.list = vi.fn(async () => [
      { author: 'a', line: 99, text: 'stale', raw: '' } as ReviewMarker,
    ]);
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    render(<ArtifactCanvas uri="x" {...host} onAddComment={vi.fn()} />);
    await waitFor(() => expect(document.querySelector('[data-line]')).not.toBeNull());
    expect(document.querySelector('.codev-canvas-has-marker')).toBeNull(); // not rendered
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });

  it('surfaces adapter errors via onError and does not throw; failed list keeps prior markers (D2)', async () => {
    const host = makeHost('A paragraph.');
    host.markerAdapter.list = vi.fn(async () => { throw new Error('list boom'); });
    const onError = vi.fn();
    const err = vi.spyOn(console, 'error').mockImplementation(() => {});
    render(<ArtifactCanvas uri="x" {...host} onAddComment={vi.fn()} onError={onError} />);
    await waitFor(() => expect(onError).toHaveBeenCalled());
    expect(document.querySelector('p[data-line]')).not.toBeNull(); // still rendered, no throw
    err.mockRestore();
  });

  it('disposes the watch subscription on unmount; later emits do not throw (scenario 9)', async () => {
    const host = makeHost('A paragraph.');
    const { unmount } = render(<ArtifactCanvas uri="x" {...host} onAddComment={vi.fn()} />);
    await waitFor(() => expect(document.querySelector('p[data-line]')).not.toBeNull());
    const disposable = host.fileAdapter.watch.mock.results[0].value as { dispose: ReturnType<typeof vi.fn> };
    unmount();
    expect(disposable.dispose).toHaveBeenCalled();
    expect(() => host.watchers.forEach((cb) => cb('changed'))).not.toThrow();
  });
});

describe('ThemeAdapter contract (D4 Model A, scenario 4 — not on the v1 render path)', () => {
  it('resolve() returns the host value and onChange returns a disposable that fires', () => {
    let fired = false;
    const theme = {
      resolve: (tok: string) => (tok === '--codev-canvas-accent' ? '#0969da' : ''),
      onChange: (h: () => void) => { h(); return { dispose: () => {} }; }, // simulate a theme switch
    };
    expect(theme.resolve('--codev-canvas-accent')).toBe('#0969da');
    const sub = theme.onChange(() => { fired = true; });
    expect(fired).toBe(true);
    expect(typeof sub.dispose).toBe('function');
    sub.dispose(); // idempotent no-op
  });
});
