import { describe, expect, it } from 'vitest';

import { createUtf8ByteRangeConverter } from './text-offsets';

const encoder = new TextEncoder();

describe('createUtf8ByteRangeConverter', () => {
    it('keeps ASCII ranges unchanged', () => {
        const text = 'Kai moved fast.';
        const converter = createUtf8ByteRangeConverter(text);
        const range = converter.toUtf16Range({ start: 0, end: 3 });

        expect(range).toEqual({ from: 0, to: 3 });
        expect(converter.slice({ start: 0, end: 3 })).toBe('Kai');
    });

    it('converts UTF-8 byte ranges to UTF-16 code unit ranges', () => {
        const text = 'Iriane’s words still hung. Kai moved.';
        const byteRange = utf8RangeOf(text, 'Kai');
        const converter = createUtf8ByteRangeConverter(text);
        const range = converter.toUtf16Range(byteRange);

        expect(range).toEqual({
            from: text.indexOf('Kai'),
            to: text.indexOf('Kai') + 'Kai'.length,
        });
        expect(converter.slice(byteRange)).toBe('Kai');
    });

    it('handles astral-plane characters before the match', () => {
        const text = 'A🙂B Rowan answered.';
        const byteRange = utf8RangeOf(text, 'Rowan');
        const converter = createUtf8ByteRangeConverter(text);

        expect(converter.slice(byteRange)).toBe('Rowan');
        expect(converter.toUtf16Range(byteRange)).toEqual({
            from: text.indexOf('Rowan'),
            to: text.indexOf('Rowan') + 'Rowan'.length,
        });
    });
});

function utf8RangeOf(text: string, target: string): { start: number; end: number } {
    const start = text.indexOf(target);
    if (start < 0) {
        throw new Error(`Target "${target}" not found.`);
    }
    const end = start + target.length;
    return {
        start: encoder.encode(text.slice(0, start)).length,
        end: encoder.encode(text.slice(0, end)).length,
    };
}
