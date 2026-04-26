import { describe, expect, it } from 'vitest';

import {
    classifyEntityMark,
    classifyExplicitEntityAttrs,
    sanitizeEntityMarksInDocJson,
    stripDerivedEntityMarksInDocJson,
} from './entity-mark-sanitizer';

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

    it('classifies valid explicit entity marks by id and label', () => {
        expect(classifyExplicitEntityAttrs({ id: 'entity-1', label: 'Ghost' }, lookup)).toBe('valid');
        expect(classifyExplicitEntityAttrs({ id: '', label: 'Brooklyn' }, lookup)).toBe('valid');
    });

    it('classifies stale and legacy derived explicit entity attrs', () => {
        expect(classifyExplicitEntityAttrs({ id: 'ghost-1', label: 'Ghost' }, lookup)).toBe('stale');
        expect(classifyExplicitEntityAttrs({ type: 'entity_implicit', id: 'entity-1', label: 'Kai' }, lookup)).toBe('derived');
    });

    it('removes derived implicit marks from legacy and dedicated shapes', () => {
        const input = {
            type: 'doc',
            content: [
                {
                    type: 'paragraph',
                    content: [
                        {
                            type: 'text',
                            text: 'Kai',
                            marks: [
                                { type: 'entity', attrs: { type: 'entity_implicit', id: 'entity-1', label: 'Kai' } },
                                { type: 'entity_implicit', attrs: { id: 'entity-1', label: 'Kai' } },
                                { type: 'emphasis' },
                            ],
                        },
                    ],
                },
            ],
        };

        const result = sanitizeEntityMarksInDocJson(input, lookup);

        expect(result.changed).toBe(true);
        expect((result.content as any).content[0].content[0].marks).toEqual([{ type: 'emphasis' }]);
    });

    it('classifies full entity marks using the shared runtime statuses', () => {
        expect(classifyEntityMark({ type: 'entity', attrs: { id: 'entity-1', label: 'Brooklyn' } }, lookup)).toBe('valid-explicit');
        expect(classifyEntityMark({ type: 'entity', attrs: { id: 'ghost-1', label: 'Ghost' } }, lookup)).toBe('stale-explicit');
        expect(classifyEntityMark({ type: 'entity', attrs: { type: 'entity_implicit', id: 'entity-1', label: 'Kai' } }, lookup)).toBe('derived-implicit');
        expect(classifyEntityMark({ type: 'strong' }, lookup)).toBe('other');
    });

    it('strips only derived implicit marks during snapshot persistence', () => {
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
                                { type: 'entity', attrs: { id: 'entity-1', label: 'Brooklyn', type: 'entity' } },
                                { type: 'entity_implicit', attrs: { id: 'entity-1', label: 'Brooklyn' } },
                            ],
                        },
                    ],
                },
            ],
        };

        const result = stripDerivedEntityMarksInDocJson(input);

        expect(result.changed).toBe(true);
        expect((result.content as any).content[0].content[0].marks).toEqual([
            { type: 'entity', attrs: { id: 'entity-1', label: 'Brooklyn', type: 'entity' } },
        ]);
    });
});
