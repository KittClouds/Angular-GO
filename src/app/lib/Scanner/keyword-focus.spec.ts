import { describe, expect, it } from 'vitest';

import type { TextSegment } from './prosemirror-bridge';
import { createKeywordFocusSpans, parseSearchHighlightTerms } from './keyword-focus';

describe('createKeywordFocusSpans', () => {
    it('matches whole words case-insensitively', () => {
        const segments: TextSegment[] = [{
            pmPos: 5,
            concatStart: 0,
            length: 20,
            text: 'Said said SAID still',
        }];

        const spans = createKeywordFocusSpans(segments, ['said']);

        expect(spans).toHaveLength(3);
        expect(spans.map(span => span.matchedText)).toEqual(['Said', 'said', 'SAID']);
        expect(spans.every(span => span.type === 'keyword_focus')).toBe(true);
    });

    it('does not match substrings inside larger words', () => {
        const segments: TextSegment[] = [{
            pmPos: 0,
            concatStart: 0,
            length: 28,
            text: 'rail railroad said said-like',
        }];

        const spans = createKeywordFocusSpans(segments, ['rail', 'said']);

        expect(spans.map(span => span.matchedText)).toEqual(['rail', 'said']);
    });

    it('matches quoted phrases as a single keyword focus span', () => {
        const segments: TextSegment[] = [{
            pmPos: 3,
            concatStart: 0,
            length: 33,
            text: 'The red gold storm found Kai.',
        }];

        const spans = createKeywordFocusSpans(segments, ['red gold']);

        expect(spans).toHaveLength(1);
        expect(spans[0].matchedText).toBe('red gold');
        expect(spans[0].from).toBe(7);
        expect(spans[0].to).toBe(15);
    });
});

describe('parseSearchHighlightTerms', () => {
    it('normalizes whitespace-separated terms', () => {
        expect(parseSearchHighlightTerms('  Kai   hand  ')).toEqual(['kai', 'hand']);
    });

    it('keeps quoted phrases together', () => {
        expect(parseSearchHighlightTerms('"red gold" Kai')).toEqual(['red gold', 'kai']);
    });

    it('treats unclosed quotes as a trailing term', () => {
        expect(parseSearchHighlightTerms('"red gold')).toEqual(['red gold']);
    });

    it('deduplicates repeated terms', () => {
        expect(parseSearchHighlightTerms('Kai kai "red gold" "red gold"')).toEqual(['kai', 'red gold']);
    });
});
