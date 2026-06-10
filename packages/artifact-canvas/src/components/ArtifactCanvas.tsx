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

  // List markers for the given text, dropping out-of-range markers (spec: deferred #4 policy —
  // ignore + warn; chosen over clamp/hard-error). On failure, keep the prior markers.
  const listMarkers = React.useCallback(
    async (text: string) => {
      try {
        const list = await markerAdapter.list(uri);
        const lineCount = text.length === 0 ? 0 : text.split('\n').length;
        const valid = list.filter((m) => {
          const ok = m.line >= 0 && m.line < lineCount;
          if (!ok) {
            console.warn(
              `[artifact-canvas] dropping out-of-range marker @line ${m.line} (document has ${lineCount} lines)`,
            );
          }
          return ok;
        });
        setMarkers(valid);
      } catch (err) {
        report(err);
      }
    },
    [markerAdapter, uri, report],
  );

  // Initial read + the single watch subscription (spec D2/D6).
  React.useEffect(() => {
    let disposed = false;
    void (async () => {
      try {
        const text = await fileAdapter.read(uri);
        if (disposed) return;
        setContent(text);
        await listMarkers(text);
      } catch (err) {
        report(err);
      }
    })();

    const sub = fileAdapter.watch(uri, (newContent) => {
      if (disposed) return;
      setContent(newContent);
      void listMarkers(newContent); // auto re-list on change (D6)
    });

    return () => {
      disposed = true;
      sub.dispose(); // idempotent per the Disposable contract (spec D2)
    };
  }, [fileAdapter, uri, listMarkers, report]);

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

  return React.createElement(
    'div',
    { className: 'codev-artifact-canvas' },
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
      ? React.createElement(CommentAffordance, { line: activeLine, onActivate: onAddComment })
      : null,
  );
}
