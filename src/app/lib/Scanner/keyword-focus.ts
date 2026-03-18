import type { DecorationSpan } from './types';
import type { TextSegment } from './prosemirror-bridge';

function escapeRegex(text: string): string {
    return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export function normalizeKeyword(keyword: string): string {
    return keyword.trim().toLowerCase();
}

export function parseSearchHighlightTerms(query: string): string[] {
    const terms: string[] = [];
    let current = '';
    let inQuote = false;

    const pushCurrent = () => {
        const normalized = normalizeKeyword(current);
        if (normalized) {
            terms.push(normalized);
        }
        current = '';
    };

    for (const char of query) {
        if (char === '"') {
            if (inQuote) {
                pushCurrent();
                inQuote = false;
            } else {
                pushCurrent();
                inQuote = true;
            }
            continue;
        }

        if (!inQuote && /\s/.test(char)) {
            pushCurrent();
            continue;
        }

        current += char;
    }

    pushCurrent();

    return [...new Set(terms)];
}

export function createKeywordFocusSpans(
    segments: TextSegment[],
    keywords: string[],
): DecorationSpan[] {
    const normalizedKeywords = [...new Set(
        keywords
            .map(normalizeKeyword)
            .filter(Boolean)
    )];

    if (normalizedKeywords.length === 0) {
        return [];
    }

    const spans: DecorationSpan[] = [];

    for (const seg of segments) {
        for (const keyword of normalizedKeywords) {
            const regex = new RegExp(`(^|[^\\w'-])(${escapeRegex(keyword)})(?=$|[^\\w'-])`, 'gi');
            let match: RegExpExecArray | null;

            while ((match = regex.exec(seg.text)) !== null) {
                const matchedText = match[2];
                const startOffset = match.index + match[1].length;
                const endOffset = startOffset + matchedText.length;

                spans.push({
                    type: 'keyword_focus',
                    from: seg.pmPos + startOffset,
                    to: seg.pmPos + endOffset,
                    label: keyword,
                    matchedText,
                });
            }
        }
    }

    spans.sort((a, b) => a.from - b.from || a.to - b.to);
    return spans;
}
