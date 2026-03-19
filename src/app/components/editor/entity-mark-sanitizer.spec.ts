import { describe, expect, it } from 'vitest';

import { sanitizeEntityMarksInDocJson } from './entity-mark-sanitizer';

describe('sanitizeEntityMarksInDocJson', () => {
    const lookup = {
        hasEntityId: (id: string) => id === 'entity-1',
        hasEntityLabel: (label: string) => label === 'Brooklyn',
    };

    it('removes stale entity marks and preserves unrelated marks', () => {
        const input = {
            type: 'doc',
            content: [
                {
                    type: 'paragraph',
                    content: [
                        {
                            type: 'text',
                            text: 'Brooklyn',
                            marks: [
                                { type: 'entity', attrs: { id: 'ghost-1', label: 'Ghost' } },
                                { type: 'strong' },
                            ],
                        },
                    ],
                },
            ],
        };

        const result = sanitizeEntityMarksInDocJson(input, lookup);

        expect(result.changed).toBe(true);
        expect((result.content as any).content[0].content[0].marks).toEqual([{ type: 'strong' }]);
    });

    it('keeps valid entity marks resolved by label or id', () => {
        const input = {
            type: 'doc',
            content: [
                {
                    type: 'paragraph',
                    content: [
                        {
                            type: 'text',
                            text: 'Brooklyn',
                            marks: [
                                { type: 'entity', attrs: { id: '', label: 'Brooklyn' } },
                            ],
                        },
                    ],
                },
            ],
        };

        const result = sanitizeEntityMarksInDocJson(input, lookup);

        expect(result.changed).toBe(false);
        expect(result.content).toBe(input);
    });
});
