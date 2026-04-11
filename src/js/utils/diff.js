/**
 * oja/diff.js
 * Text and JSON diffing — pure, no DOM dependency.
 *
 * ─── Text diff ────────────────────────────────────────────────────────────────
 *
 *   import { diff, diffLines, diffWords, renderDiff } from '../utils/diff.js';
 *
 *   // Character-level diff
 *   diff('cat', 'cut');
 *   // → [{ type: 'keep', value: 'c' }, { type: 'remove', value: 'a' },
 *   //    { type: 'add', value: 'u' }, { type: 'keep', value: 't' }]
 *
 *   // Line-level diff (most useful for documents)
 *   diffLines('line1\nline2\nline3', 'line1\nchanged\nline3');
 *   // → [{ type: 'keep', value: 'line1\n' },
 *   //    { type: 'remove', value: 'line2\n' },
 *   //    { type: 'add', value: 'changed\n' },
 *   //    { type: 'keep', value: 'line3' }]
 *
 *   // Word-level diff
 *   diffWords('the cat sat', 'the dog sat');
 *
 *   // Render to HTML (with context lines)
 *   const html = renderDiff(diffLines(oldText, newText), { context: 3 });
 *
 * ─── JSON diff ────────────────────────────────────────────────────────────────
 *
 *   import { diffJson } from '../utils/diff.js';
 *
 *   diffJson({ a: 1, b: 2 }, { a: 1, b: 3, c: 4 });
 *   // → [
 *   //     { path: 'b', type: 'change', from: 2, to: 3 },
 *   //     { path: 'c', type: 'add',    value: 4 },
 *   //   ]
 *
 * ─── Unified diff string ──────────────────────────────────────────────────────
 *
 *   import { unifiedDiff } from '../utils/diff.js';
 *
 *   unifiedDiff(oldText, newText, { context: 3, fileA: 'before', fileB: 'after' });
 *   // → standard unified diff string (--- before / +++ after)
 */

// Myers sequence diff (character or token level)

/**
 * Core Myers diff algorithm.
 * Returns edit script as [{ type: 'keep'|'add'|'remove', value }].
 *
 * @param {any[]} a  — source sequence
 * @param {any[]} b  — target sequence
 * @returns {{ type: string, value: any }[]}
 */
export function diffSequence(a, b) {
    const n = a.length, m = b.length;

    if (n === 0) return b.map(v => ({ type: 'add',    value: v }));
    if (m === 0) return a.map(v => ({ type: 'remove', value: v }));

    const max   = n + m;
    const off   = max;           // offset so k can be negative index
    const v     = new Int32Array(2 * max + 2);
    const trace = [];            // v snapshots for backtracking

    let found = false;
    outer: for (let d = 0; d <= max; d++) {
        // Save a copy of v before this round
        trace.push(v.slice());

        for (let k = -d; k <= d; k += 2) {
            let x;
            if (k === -d || (k !== d && v[k - 1 + off] < v[k + 1 + off])) {
                x = v[k + 1 + off];      // move down (insert from b)
            } else {
                x = v[k - 1 + off] + 1;  // move right (delete from a)
            }

            let y = x - k;
            while (x < n && y < m && a[x] === b[y]) { x++; y++; } // diagonal

            v[k + off] = x;

            if (x >= n && y >= m) { found = true; break outer; }
        }
    }

    // Backtrack through trace to produce the edit script
    const edits = [];
    let x = n, y = m;

    for (let d = trace.length - 1; d >= 0; d--) {
        const snap = trace[d];
        const k    = x - y;

        let prevK;
        if (k === -d || (k !== d && snap[k - 1 + off] < snap[k + 1 + off])) {
            prevK = k + 1; // came from above → insert b[y-1]
        } else {
            prevK = k - 1; // came from left  → delete a[x-1]
        }

        const prevX = snap[prevK + off];
        const prevY = prevX - prevK;

        // Diagonal (keep) segment
        while (x > prevX + (k !== prevK ? 0 : 1) && y > prevY + (k !== prevK ? 0 : 1) &&
               x > 0 && y > 0 && a[x - 1] === b[y - 1]) {
            edits.push({ type: 'keep', value: a[x - 1] });
            x--; y--;
        }

        if (d === 0) break;

        if (prevK === k + 1) {
            // Came from above: insert b[prevY] (which becomes b[y-1] after we step)
            if (y > prevY) {
                edits.push({ type: 'add', value: b[y - 1] });
                y--;
            }
        } else {
            // Came from left: delete a[prevX] (which becomes a[x-1])
            if (x > prevX) {
                edits.push({ type: 'remove', value: a[x - 1] });
                x--;
            }
        }
    }

    return edits.reverse();
}

// Public diff functions

/**
 * Character-level diff of two strings.
 * @param {string} a
 * @param {string} b
 * @returns {{ type: string, value: string }[]}
 */
export function diff(a, b) {
    return diffSequence(a.split(''), b.split(''));
}

/**
 * Line-level diff — the most useful for document comparison.
 * @param {string} a
 * @param {string} b
 * @returns {{ type: string, value: string }[]}
 */
export function diffLines(a, b) {
    const splitLines = s => {
        const lines = [];
        let i = 0;
        while (i < s.length) {
            const nl = s.indexOf('\n', i);
            if (nl === -1) { lines.push(s.slice(i)); break; }
            lines.push(s.slice(i, nl + 1));
            i = nl + 1;
        }
        return lines;
    };
    return diffSequence(splitLines(a), splitLines(b));
}

/**
 * Word-level diff.
 * @param {string} a
 * @param {string} b
 * @returns {{ type: string, value: string }[]}
 */
export function diffWords(a, b) {
    // Split on word boundaries, preserving whitespace tokens
    const tokenise = s => s.match(/\S+|\s+/g) || [];
    return diffSequence(tokenise(a), tokenise(b));
}

// JSON structural diff

/**
 * Structural diff of two plain objects / arrays.
 * Returns a flat list of changes — does NOT recurse into arrays (treats them
 * as atomic values to avoid complex array-diff edge cases).
 *
 * Each change:
 *   { path: string, type: 'add'|'remove'|'change', value?, from?, to? }
 *
 * @param {any} a  — original
 * @param {any} b  — modified
 * @param {string} [_prefix] — internal path prefix for recursion
 * @returns {Object[]}
 */
export function diffJson(a, b, _prefix = '') {
    const changes = [];

    if (a === b) return changes;

    // Primitive or array — treat as atomic
    if (typeof a !== 'object' || typeof b !== 'object' ||
        a === null || b === null ||
        Array.isArray(a) || Array.isArray(b)) {
        if (a === undefined) {
            changes.push({ path: _prefix, type: 'add',    value: b });
        } else if (b === undefined) {
            changes.push({ path: _prefix, type: 'remove', value: a });
        } else {
            changes.push({ path: _prefix, type: 'change', from: a, to: b });
        }
        return changes;
    }

    const keys = new Set([...Object.keys(a), ...Object.keys(b)]);

    for (const key of keys) {
        const path = _prefix ? `${_prefix}.${key}` : key;
        const av   = a[key];
        const bv   = b[key];

        if (!(key in a)) {
            changes.push({ path, type: 'add',    value: bv });
        } else if (!(key in b)) {
            changes.push({ path, type: 'remove', value: av });
        } else if (av !== bv) {
            if (typeof av === 'object' && typeof bv === 'object' &&
                av !== null && bv !== null &&
                !Array.isArray(av) && !Array.isArray(bv)) {
                changes.push(...diffJson(av, bv, path));
            } else {
                changes.push({ path, type: 'change', from: av, to: bv });
            }
        }
    }

    return changes;
}

// Render helpers

/**
 * Render a diff result as an HTML string with context lines.
 * Unchanged lines beyond `context` are collapsed with a "…N lines…" marker.
 *
 *   Out.to('#preview').html(renderDiff(diffLines(old, new), { context: 3 }));
 *
 * @param {{ type: string, value: string }[]} hunks — result of diffLines()
 * @param {Object} [options]
 * @param {number} [options.context=3]  — unchanged lines to show around changes
 * @returns {string} HTML
 */
export function renderDiff(hunks, options = {}) {
    const { context = 3 } = options;

    const esc = s => String(s)
        .replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');

    // Determine which keep-lines are near a change
    const changed = new Set();
    hunks.forEach((h, i) => { if (h.type !== 'keep') changed.add(i); });

    const visible = new Set();
    for (const ci of changed) {
        for (let i = Math.max(0, ci - context); i <= Math.min(hunks.length - 1, ci + context); i++) {
            visible.add(i);
        }
    }

    let html  = '<div class="oja-diff">';
    let skipped = 0;

    hunks.forEach((hunk, i) => {
        if (!visible.has(i)) {
            skipped++;
            return;
        }
        if (skipped > 0) {
            html += `<div class="oja-diff-skip">… ${skipped} unchanged line${skipped === 1 ? '' : 's'} …</div>`;
            skipped = 0;
        }

        const cls  = hunk.type === 'add'    ? 'oja-diff-add'
                   : hunk.type === 'remove' ? 'oja-diff-remove'
                   : 'oja-diff-keep';
        const sign = hunk.type === 'add'    ? '+'
                   : hunk.type === 'remove' ? '−'
                   : ' ';

        html += `<div class="${cls}"><span class="oja-diff-sign">${sign}</span><span class="oja-diff-text">${esc(hunk.value)}</span></div>`;
    });

    if (skipped > 0) {
        html += `<div class="oja-diff-skip">… ${skipped} unchanged line${skipped === 1 ? '' : 's'} …</div>`;
    }

    html += '</div>';
    return html;
}

/**
 * Generate a standard unified diff string.
 *
 * @param {string} a
 * @param {string} b
 * @param {Object} [options]
 * @param {number} [options.context=3]
 * @param {string} [options.fileA='a']
 * @param {string} [options.fileB='b']
 * @returns {string}
 */
export function unifiedDiff(a, b, options = {}) {
    const { context = 3, fileA = 'a', fileB = 'b' } = options;
    const hunks = diffLines(a, b);

    const aLines = a.split('\n');
    const bLines = b.split('\n');

    // Build position tracking
    let aLine = 1, bLine = 1;
    const chunks = [];
    let chunk = null;
    let keepSince = 0;

    const flushChunk = () => { if (chunk) { chunks.push(chunk); chunk = null; } };

    hunks.forEach((h, i) => {
        if (h.type === 'keep') {
            keepSince++;
            if (keepSince > context * 2 + 1) { flushChunk(); }
            else if (chunk) chunk.lines.push(' ' + h.value.replace(/\n$/, ''));
            aLine++; bLine++;
        } else {
            if (!chunk) {
                // Backfill context
                const ctxStart = Math.max(0, i - context);
                chunk = { aStart: aLine, bStart: bLine, lines: [] };
                for (let j = ctxStart; j < i; j++) {
                    if (hunks[j].type === 'keep') chunk.lines.push(' ' + hunks[j].value.replace(/\n$/, ''));
                }
            }
            keepSince = 0;
            if (h.type === 'remove') { chunk.lines.push('-' + h.value.replace(/\n$/, '')); aLine++; }
            if (h.type === 'add')    { chunk.lines.push('+' + h.value.replace(/\n$/, '')); bLine++; }
        }
    });
    flushChunk();

    if (!chunks.length) return '';

    const lines = [`--- ${fileA}`, `+++ ${fileB}`];
    for (const ch of chunks) {
        const aCount = ch.lines.filter(l => l[0] !== '+').length;
        const bCount = ch.lines.filter(l => l[0] !== '-').length;
        lines.push(`@@ -${ch.aStart},${aCount} +${ch.bStart},${bCount} @@`);
        lines.push(...ch.lines);
    }

    return lines.join('\n');
}
