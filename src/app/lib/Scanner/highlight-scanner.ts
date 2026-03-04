/**
 * HighlightScanner — Calls GoKittService.scanImplicitAsync() and returns raw spans.
 * No ProseMirror knowledge. No discovery. No graph.
 */
import type { GoKittService } from '../../services/gokitt.service';
import type { DecorationSpan } from './types';

export class HighlightScanner {
    constructor(private readonly goKitt: GoKittService) { }

    /**
     * Scan text for implicit entity matches using the Aho-Corasick dictionary.
     * Returns raw spans in concatenated-text coordinates (not ProseMirror coordinates).
     */
    async scan(text: string): Promise<DecorationSpan[]> {
        if (!text || text.length === 0) return [];

        try {
            const rawSpans = await this.goKitt.scanImplicitAsync(text);
            return rawSpans ?? [];
        } catch (e) {
            console.error('[HighlightScanner] Scan error:', e);
            return [];
        }
    }
}
