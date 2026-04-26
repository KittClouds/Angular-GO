import { describe, expect, it } from 'vitest';
import { analyzeMeter, parseTargetPattern } from './meter-analysis';

describe('meter analysis', () => {
    it('counts English lyric lines with line offsets and target deltas', () => {
        const result = analyzeMeter('I waited under silent rain\nFire above the ocean', {
            language: 'en',
            targetPattern: '8 / 7',
        });

        expect(result.countedLines).toBe(2);
        expect(result.targetPattern).toEqual([8, 7]);
        expect(result.lines[0]).toMatchObject({
            lineNumber: 1,
            units: 8,
            targetUnits: 8,
            delta: 0,
            status: 'clean',
        });
        expect(result.lines[1].tokens[0]).toMatchObject({
            text: 'Fire',
            unitCount: 1,
        });
        expect(result.lines[1].warnings).toContain('ambiguous pronunciation: 1 or 2');
        expect(result.lines[1].from).toBe(27);
    });

    it('counts Japanese kana morae including sokuon, n, and long vowel marks', () => {
        const result = analyzeMeter('がっこうへいこう\nきぼうのうた', { language: 'ja' });

        expect(result.lines[0]).toMatchObject({
            units: 8,
            unitKind: 'mora',
            confidence: 0.99,
            status: 'clean',
        });
        expect(result.lines[1].units).toBe(6);
    });

    it('flags kanji lines for reading review instead of pretending certainty', () => {
        const result = analyzeMeter('希望の歌を歌う', { language: 'ja' });

        expect(result.lines[0]).toMatchObject({
            units: 3,
            status: 'review',
        });
        expect(result.lines[0].warnings).toContain('kanji needs a reading before mora count is authoritative');
    });

    it('skips blank stanza separators but preserves logical line numbers', () => {
        const result = analyzeMeter('first line\n\nsecond line');

        expect(result.totalLines).toBe(3);
        expect(result.countedLines).toBe(2);
        expect(result.lines[1].lineNumber).toBe(3);
        expect(result.lines[1].stanzaIndex).toBe(1);
    });

    it('parses compact target patterns safely', () => {
        expect(parseTargetPattern('7-7-8-6')).toEqual([7, 7, 8, 6]);
        expect(parseTargetPattern('0 / 99 / 12')).toEqual([12]);
    });
});
