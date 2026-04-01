import { describe, expect, it } from 'vitest';

import { analyzeText, parseContentToPlainText } from './text-analytics';

describe('text analytics prose counts', () => {
    it('treats curly-apostrophe contractions and internal hyphens as single words', () => {
        const analytics = analyzeText('Here’s I’m that’s you’re post-sleep red-gold.');

        expect(analytics.wordCount).toBe(6);
    });

    it('excludes line breaks from character count while keeping no-spaces whitespace-free', () => {
        const analytics = analyzeText('A \r\nB\tC\nD');

        expect(analytics.characterCount).toBe(6);
        expect(analytics.characterCountNoSpaces).toBe(4);
    });

    it('keeps paragraph counts tied to rendered editor blocks', () => {
        const plainText = parseContentToPlainText(JSON.stringify({
            type: 'doc',
            content: [
                {
                    type: 'heading',
                    attrs: { level: 2 },
                    content: [{ type: 'text', text: 'Beat 1' }],
                },
                { type: 'horizontal_rule' },
                {
                    type: 'paragraph',
                    content: [{ type: 'text', text: 'First paragraph.' }],
                },
                {
                    type: 'paragraph',
                    content: [{ type: 'text', text: 'Second paragraph.' }],
                },
            ],
        }));

        expect(plainText).toBe('Beat 1\n\nFirst paragraph.\n\nSecond paragraph.');
        expect(analyzeText(plainText).paragraphCount).toBe(3);
    });

    it('keeps reduced baseline prose counts aligned to rendered semantics', () => {
        const text = [
            'Absolutely. Here’s a drafted beat pass.',
            '',
            'The room’s still warm, still a little tangled.',
            '',
            'Ye’re not wrong to want structure.',
        ].join('\n');

        const analytics = analyzeText(text);

        expect(analytics.wordCount).toBe(20);
        expect(analytics.characterCount).toBe(text.replace(/[\r\n]/g, '').length);
        expect(analytics.paragraphCount).toBe(3);
        expect(analytics.sentenceCount).toBe(4);
    });

    it('still computes repetition proximity cadence and reading metrics from the same prose source', () => {
        const analytics = analyzeText('Here’s the ember-lit room. The ember-lit room waits. The ember-lit room hums.');

        expect(analytics.readingTimeMinutes * 60 + analytics.readingTimeSeconds).toBeGreaterThan(0);
        expect(analytics.speakingTimeMinutes * 60 + analytics.speakingTimeSeconds).toBeGreaterThan(0);
        expect(analytics.cadence.sentences).toHaveLength(3);
        expect(analytics.repetition.totalFlags).toBeGreaterThan(0);
        expect(analytics.proximity.totalFlags).toBeGreaterThan(0);
    });
});
