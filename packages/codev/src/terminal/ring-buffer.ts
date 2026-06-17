/**
 * Fixed-size circular buffer for storing terminal output lines.
 * Used for reconnection replay — stores last N lines in memory.
 */

export class RingBuffer {
  private buffer: string[];
  private head: number = 0;
  private count: number = 0;
  private seq: number = 0; // monotonically increasing sequence number
  private partial: string = ''; // incomplete line from previous pushData call

  constructor(private readonly capacity: number = 1000) {
    this.buffer = new Array(capacity);
  }

  /** Push a complete line into the buffer. Returns the assigned sequence number. */
  push(line: string): number {
    const index = (this.head + this.count) % this.capacity;
    this.buffer[index] = line;
    if (this.count < this.capacity) {
      this.count++;
    } else {
      this.head = (this.head + 1) % this.capacity;
    }
    return ++this.seq;
  }

  /**
   * Push raw data, splitting on newlines. Handles partial lines across
   * chunk boundaries: if data doesn't end with \n, the trailing fragment
   * is held and prepended to the next pushData call.
   *
   * Scans only the incoming `data` for newlines (never re-splits the whole
   * accumulated `partial + data`), so per-call work is O(|data|) rather than
   * O(|partial|) — the O(n²) re-scan that pegged Tower's CPU on no-newline
   * full-screen-TUI streams (Issue #1047). The `partial` is kept whole and
   * unbounded so a reconnection replay faithfully reconstructs the screen: a
   * TUI in the alternate screen buffer encodes its state in the cumulative
   * byte stream from the alt-screen-enter onward, so truncating the front
   * would corrupt the replay (the app won't repaint on a same-size reconnect).
   *
   * Returns last sequence number.
   */
  pushData(data: string): number {
    let start = 0;
    let nl = data.indexOf('\n');
    while (nl !== -1) {
      // Complete line = held partial (if any) + this segment up to the newline.
      this.push(this.partial + data.slice(start, nl));
      this.partial = '';
      start = nl + 1;
      nl = data.indexOf('\n', start);
    }

    // Remainder has no newline — append to the partial (cons-string, O(|data|)).
    if (start < data.length) {
      this.partial += data.slice(start);
    }
    return this.seq;
  }

  /** Get all stored lines in order, including any incomplete trailing line. */
  getAll(): string[] {
    const result: string[] = [];
    for (let i = 0; i < this.count; i++) {
      result.push(this.buffer[(this.head + i) % this.capacity]);
    }
    if (this.partial) {
      result.push(this.partial);
    }
    return result;
  }

  /**
   * Get lines starting from a given sequence number (for resume).
   *
   * Note (#1047): `seq` advances only on completed (newline-terminated) lines.
   * A full-screen TUI emits no newlines, so for such a session `seq` stays at
   * whatever the last real line was and a client that is caught up to it gets
   * `[]` here — the in-progress `partial` (the current screen) is NOT replayed
   * on a delta resume. That gap is covered by the client's post-connect repaint
   * nudge, which forces the app to redraw on (re)connect (see
   * `terminal-adapter.ts`). True byte-granular resume for no-newline streams was
   * considered and deliberately descoped (it would require a byte-addressable
   * seq and breaks the existing line-based wire contract); the nudge makes it
   * unnecessary for correctness.
   */
  getSince(sinceSeq: number): string[] {
    const linesAvailable = this.count;
    const oldestSeq = this.seq - linesAvailable + 1;
    const startSeq = Math.max(sinceSeq + 1, oldestSeq);
    if (startSeq > this.seq) return [];

    const skip = startSeq - oldestSeq;
    const result: string[] = [];
    for (let i = skip; i < this.count; i++) {
      result.push(this.buffer[(this.head + i) % this.capacity]);
    }
    if (this.partial) {
      result.push(this.partial);
    }
    return result;
  }

  /** Current sequence number (last written). */
  get currentSeq(): number {
    return this.seq;
  }

  /** Number of lines currently stored. */
  get size(): number {
    return this.count;
  }

  /** Bytes held in the incomplete-line partial (observability, #1047). */
  get partialBytes(): number {
    return this.partial.length;
  }

  /** Clear the buffer and release memory. */
  clear(): void {
    this.buffer = [];
    this.head = 0;
    this.count = 0;
    this.partial = '';
    // Don't reset seq — it should be monotonic
  }
}
