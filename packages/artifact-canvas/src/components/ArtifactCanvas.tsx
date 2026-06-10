import * as React from 'react';
import type { ArtifactCanvasProps, ReviewMarker } from '../types.js';
import { renderMarkdown } from '../renderer/renderer.js';
import { CommentAffordance } from '../overlays/CommentAffordance.js';

/**
 * ArtifactCanvas — the composed review surface (Phase 3).
 *
 * Data flow (spec D2/D6): reads content via `FileAdapter.read`, lists markers via
 * `MarkerAdapter.list`, and subscribes to `FileAdapter.watch` (the only subscription). When the
 * file changes it re-renders and auto re-lists markers. It emits comment *intent* via
 * `onAddComment(line)` and never calls `MarkerAdapter.add` itself (the host does the input +
 * write-back). `themeAdapter` is accepted but NOT used for rendering (spec D4, Model A — theming
 * is CSS-variable driven; `resolve()`/`onChange` are for #863's canvas).
 *
 * Errors from the adapter calls the component makes are caught, logged, and surfaced via the
 * optional `onError` prop; the component never throws out of an event handler, and a failed
 * `list()` leaves the prior markers in place (spec D2).
 */
export function ArtifactCanvas(props: ArtifactCanvasProps): React.ReactElement {
  const { uri, fileAdapter, markerAdapter, onAddComment, onError } = props;

  const [content, setContent] = React.useState<string>('');
  const [markers, setMarkers] = React.useState<ReviewMarker[]>([]);
  const [activeLine, setActiveLine] = React.useState<number | null>(null);
  const bodyRef = React.useRef<HTMLDivElement>(null);

  const report = React.useCallback(
    (err: unknown) => {
      console.error('[artifact-canvas]', err);
      onError?.(err);
    },
    [onError],
  );

  // Request-versioning: out-of-order async resolutions must never apply stale state — a slow
  // initial read() or an older list() must not overwrite a newer watch update (iter-2 Codex).
  // Each load (initial read or a watch change) takes a monotonically increasing seq; results are
  // applied only while their seq is still the latest.
  const seqRef = React.useRef(0);
  // Warn-once dedup for out-of-range stale markers, so a noisy watch doesn't spam warnings
  // across reloads (deferred #4 AC: "dropped … and warned once"). iter-3 Codex.
  const warnedRef = React.useRef(new Set<string>());

  // Apply content + markers for one load, guarded by `seq`. Out-of-range markers are dropped +
  // warned (deferred #4: ignore, not clamp/hard-error); a failed list() keeps the prior markers.
  const applyLoad = React.useCallback(
    async (text: string, seq: number) => {
      if (seq !== seqRef.current) return; // superseded by a newer load
      setContent(text);
      try {
        const list = await markerAdapter.list(uri);
        if (seq !== seqRef.current) return; // a newer load won the race — discard these markers
        const lineCount = text.length === 0 ? 0 : text.split('\n').length;
        setMarkers(
          list.filter((m) => {
            const ok = m.line >= 0 && m.line < lineCount;
            if (!ok) {
              const key = `${m.line}|${m.author}|${m.text}`;
              if (!warnedRef.current.has(key)) {
                warnedRef.current.add(key);
                console.warn(
                  `[artifact-canvas] dropping out-of-range marker @line ${m.line} (document has ${lineCount} lines)`,
                );
              }
            }
            return ok;
          }),
        );
      } catch (err) {
        if (seq !== seqRef.current) return;
        report(err); // keep prior markers on failure
      }
    },
    [markerAdapter, uri, report],
  );

  // Initial read + the single watch subscription (spec D2/D6).
  React.useEffect(() => {
    let disposed = false;
    const initialSeq = (seqRef.current += 1);
    void (async () => {
      try {
        const text = await fileAdapter.read(uri);
        if (disposed) return;
        await applyLoad(text, initialSeq);
      } catch (err) {
        if (!disposed) report(err);
      }
    })();

    let sub: { dispose(): void } = { dispose: () => {} };
    try {
      sub = fileAdapter.watch(uri, (newContent) => {
        if (disposed) return;
        const watchSeq = (seqRef.current += 1); // each change is a newer load
        void applyLoad(newContent, watchSeq); // auto re-list on change (D6)
      });
    } catch (err) {
      // A synchronous failure setting up the subscription must not throw out of the effect (D2).
      report(err);
    }

    return () => {
      disposed = true;
      sub.dispose(); // idempotent per the Disposable contract (spec D2)
    };
  }, [fileAdapter, uri, applyLoad, report]);

  const html = React.useMemo(() => renderMarkdown(content), [content]);

  // Decorate the rendered (innerHTML) DOM after each render: make blocks keyboard-focusable and
  // mark lines that carry a ReviewMarker (v1 minimal marker rendering — deferred #4; #863 adds
  // polished inline markers + the canvas minimap).
  React.useEffect(() => {
    const root = bodyRef.current;
    if (!root) return;
    const byLine = new Map<number, ReviewMarker[]>();
    for (const m of markers) {
      const arr = byLine.get(m.line) ?? [];
      arr.push(m);
      byLine.set(m.line, arr);
    }
    root.querySelectorAll<HTMLElement>('[data-line]').forEach((el) => {
      el.tabIndex = 0; // keyboard-reachable (accessibility AC)
      const line = Number(el.getAttribute('data-line'));
      const ms = byLine.get(line);
      if (ms && ms.length > 0) {
        el.classList.add('codev-canvas-has-marker');
        el.setAttribute('title', ms.map((m) => `${m.author}: ${m.text}`).join('\n'));
      } else {
        el.classList.remove('codev-canvas-has-marker');
        el.removeAttribute('title');
      }
    });
  }, [html, markers]);

  const lineFromEvent = (target: EventTarget | null): number | null => {
    const el = (target as HTMLElement | null)?.closest?.('[data-line]') as HTMLElement | null;
    if (!el) return null;
    const n = Number(el.getAttribute('data-line'));
    return Number.isNaN(n) ? null : n;
  };

  // Markers on the currently-active (hovered/focused) line — surfaced author + text via the
  // overlay (deferred #4: minimal v1 marker rendering; #863 adds polished inline markers).
  const activeMarkers = activeLine === null ? [] : markers.filter((m) => m.line === activeLine);

  return React.createElement(
    'div',
    { className: 'codev-artifact-canvas', onMouseLeave: () => setActiveLine(null) },
    React.createElement('div', {
      ref: bodyRef,
      className: 'codev-artifact-canvas-body',
      onMouseOver: (e: React.MouseEvent) => {
        const l = lineFromEvent(e.target);
        if (l !== null) setActiveLine(l);
      },
      onFocus: (e: React.FocusEvent) => {
        const l = lineFromEvent(e.target);
        if (l !== null) setActiveLine(l);
      },
      onKeyDown: (e: React.KeyboardEvent) => {
        if (e.key === 'Enter' || e.key === ' ') {
          const l = lineFromEvent(e.target);
          if (l !== null) {
            e.preventDefault();
            onAddComment(l); // intent only (D6)
          }
        }
      },
      dangerouslySetInnerHTML: { __html: html },
    }),
    activeLine !== null
      ? React.createElement(
          'div',
          { className: 'codev-canvas-overlay' },
          React.createElement(CommentAffordance, { line: activeLine, onActivate: onAddComment }),
          activeMarkers.length > 0
            ? React.createElement(
                'ul',
                {
                  className: 'codev-canvas-marker-list',
                  'aria-label': `Comments on line ${activeLine + 1}`,
                },
                activeMarkers.map((m, i) =>
                  React.createElement(
                    'li',
                    { key: String(i), className: 'codev-canvas-marker' },
                    React.createElement('span', { className: 'codev-canvas-marker-author' }, m.author),
                    `: ${m.text}`,
                  ),
                ),
              )
            : null,
        )
      : null,
  );
}
