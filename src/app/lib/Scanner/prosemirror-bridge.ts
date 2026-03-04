/**
 * ProseMirrorBridge — Pure functions for converting between ProseMirror docs and flat text.
 * No GoKitt dependency. No async. No side effects.
 */
import type { DecorationSpan } from './types';
import { createSelector } from './anchor-utils';

// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────

export interface ProseMirrorDoc {
    descendants: (callback: (node: { isText?: boolean; text?: string }, pos: number) => void) => void;
}

/** A contiguous text segment with its ProseMirror position offset */
export interface TextSegment {
    /** ProseMirror position of this node */
    pmPos: number;
    /** Offset within the concatenated text */
    concatStart: number;
    /** Length of this text segment */
    length: number;
    /** Raw text content */
    text: string;
}

/** Result of extracting text from a ProseMirror document */
export interface ExtractedText {
    /** Full concatenated text */
    text: string;
    /** Segment map for position remapping */
    segments: TextSegment[];
    /** Node batch for discovery (text + pos pairs) */
    nodeBatch: Array<{ text: string; pos: number }>;
}

// ─────────────────────────────────────────────────────────────────────────────
// Functions
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Extract all text content from a ProseMirror document.
 * Returns the concatenated text and a segment map for position remapping.
 */
export function extractText(doc: ProseMirrorDoc): ExtractedText {
    const segments: TextSegment[] = [];
    const nodeBatch: Array<{ text: string; pos: number }> = [];
    let fullText = '';

    doc.descendants((node, pos) => {
        if (node.isText && node.text) {
            segments.push({
                pmPos: pos,
                concatStart: fullText.length,
                length: node.text.length,
                text: node.text,
            });
            nodeBatch.push({ text: node.text, pos });
            fullText += node.text;
        }
    });

    return { text: fullText, segments, nodeBatch };
}

/**
 * Convert a flat text string from a ProseMirror document.
 */
export function docContent(doc: ProseMirrorDoc): string {
    let text = '';
    doc.descendants((node) => {
        if (node.isText && node.text) {
            text += node.text;
        }
    });
    return text;
}

/**
 * Remap raw spans (in concatenated text coordinates) to ProseMirror document coordinates.
 * Drops spans that cross segment boundaries or are out of bounds.
 */
export function remapSpans(
    rawSpans: DecorationSpan[],
    segments: TextSegment[]
): DecorationSpan[] {
    const result: DecorationSpan[] = [];

    for (const span of rawSpans) {
        if (span.from >= span.to) continue;

        // Find the segment containing the span start
        const startSeg = segments.find(
            s => span.from >= s.concatStart && span.from < s.concatStart + s.length
        );
        if (!startSeg) continue;

        // Skip spans that cross segment boundaries
        if (span.to > startSeg.concatStart + startSeg.length) continue;

        const localFrom = span.from - startSeg.concatStart;
        const localTo = span.to - startSeg.concatStart;

        result.push({
            ...span,
            from: startSeg.pmPos + localFrom,
            to: startSeg.pmPos + localTo,
            selector: span.selector || createSelector(startSeg.text, localFrom, localTo),
        });
    }

    return result;
}

/**
 * Remap raw spans allowing cross-segment spans (for scanForSpansAsync).
 * Returns mapped spans plus counts of dropped/crossed spans.
 */
export function remapSpansPermissive(
    rawSpans: DecorationSpan[],
    segments: TextSegment[]
): { spans: DecorationSpan[]; dropped: number; crossed: number } {
    const result: DecorationSpan[] = [];
    let dropped = 0;
    let crossed = 0;

    for (const span of rawSpans) {
        if (span.from >= span.to) continue;

        const startSeg = segments.find(
            s => span.from >= s.concatStart && span.from < s.concatStart + s.length
        );
        const endIndex = span.to - 1;
        const endSeg = segments.find(
            s => endIndex >= s.concatStart && endIndex < s.concatStart + s.length
        );

        if (!startSeg || !endSeg) {
            dropped++;
            continue;
        }

        if (startSeg !== endSeg) {
            crossed++;
        }

        const pmFrom = startSeg.pmPos + (span.from - startSeg.concatStart);
        const pmTo = endSeg.pmPos + (span.to - endSeg.concatStart);

        result.push({
            ...span,
            from: pmFrom,
            to: pmTo,
        });
    }

    return { spans: result, dropped, crossed };
}
