import { describe, expect, it } from 'vitest';

import { remapSpans, type TextSegment } from './prosemirror-bridge';

describe('remapSpans', () => {
    it('maps analytics highlight ranges into prose mirror coordinates', () => {
        const segments: TextSegment[] = [
            { pmPos: 5, concatStart: 0, length: 11, text: 'hello world' },
        ];

        const mapped = remapSpans([{
            type: 'analytics_highlight',
            from: 6,
            to: 11,
            label: 'world',
            matchedText: 'world',
            highlightKind: 'cadence',
        }], segments);

        expect(mapped).toHaveLength(1);
        expect(mapped[0].from).toBe(11);
        expect(mapped[0].to).toBe(16);
        expect(mapped[0].highlightKind).toBe('cadence');
    });
});
