import { describe, expect, it } from 'vitest';

import { extractProjectedText, remapSpans, remapSpansPermissive, type TextSegment } from './prosemirror-bridge';

describe('remapSpans', () => {
    it('aligns text-node segments to the canonical analytics projection', () => {
        const doc = {
            content: { size: 30 },
            textBetween: () => 'Hello\n\nworld',
            descendants: (callback: (node: { isText?: boolean; text?: string }, pos: number) => void) => {
                callback({ isText: true, text: 'Hello' }, 1);
                callback({ isText: true, text: 'world' }, 10);
            },
        };

        const projected = extractProjectedText(doc);

        expect(projected.text).toBe('Hello\n\nworld');
        expect(projected.segments).toEqual([
            { pmPos: 1, concatStart: 0, length: 5, text: 'Hello' },
            { pmPos: 10, concatStart: 7, length: 5, text: 'world' },
        ]);
    });

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
            highlightKind: 'sentence_variation',
            analyticsPaletteKey: '7-15',
        }], segments);

        expect(mapped).toHaveLength(1);
        expect(mapped[0].from).toBe(11);
        expect(mapped[0].to).toBe(16);
        expect(mapped[0].highlightKind).toBe('sentence_variation');
        expect(mapped[0].analyticsPaletteKey).toBe('7-15');
    });

    it('keeps analytics highlights that cross text segments when using the permissive remapper', () => {
        const segments: TextSegment[] = [
            { pmPos: 5, concatStart: 0, length: 5, text: 'hello' },
            { pmPos: 11, concatStart: 5, length: 6, text: ' world' },
        ];

        const mapped = remapSpansPermissive([{
            type: 'analytics_highlight',
            from: 0,
            to: 11,
            label: 'hello world',
            matchedText: 'hello world',
            highlightKind: 'sentence_variation',
            analyticsPaletteKey: '2-6',
        }], segments);

        expect(mapped.spans).toHaveLength(1);
        expect(mapped.crossed).toBe(1);
        expect(mapped.spans[0].from).toBe(5);
        expect(mapped.spans[0].to).toBe(17);
    });

    it('keeps an entity mention that starts at the document boundary and crosses split text nodes', () => {
        const segments: TextSegment[] = [
            { pmPos: 1, concatStart: 0, length: 2, text: 'Ae' },
            { pmPos: 3, concatStart: 2, length: 3, text: 'lla' },
            { pmPos: 6, concatStart: 5, length: 8, text: ' waited' },
        ];

        const strict = remapSpans([{
            type: 'entity_implicit',
            from: 0,
            to: 5,
            label: 'Aella',
            kind: 'CHARACTER',
            entityId: 'entity-aella',
        }], segments);
        const permissive = remapSpansPermissive([{
            type: 'entity_implicit',
            from: 0,
            to: 5,
            label: 'Aella',
            kind: 'CHARACTER',
            entityId: 'entity-aella',
        }], segments);

        expect(strict).toEqual([]);
        expect(permissive.spans).toHaveLength(1);
        expect(permissive.crossed).toBe(1);
        expect(permissive.spans[0]).toMatchObject({
            from: 1,
            to: 6,
            label: 'Aella',
            entityId: 'entity-aella',
        });
    });
});
