import { describe, expect, it } from 'vitest';

import {
    coalesceDiscoveryCandidates,
    groupDiscoveryMentions,
    normalizeDiscoveryCandidateKey,
} from './phoenix-discovery';

describe('groupDiscoveryMentions', () => {
    it('collapses repeated discovery mentions by speculative key', () => {
        const candidates = groupDiscoveryMentions('Fiora moved. Fiora answered.', [
            {
                source: 'Discovery',
                surface: 'Fiora',
                kind: 'OTHER',
                confidence: 0.6,
                entityRef: { Speculative: 'fiora' },
            },
            {
                source: 'discovery',
                surface: 'Fiora',
                kind: 'OTHER',
                confidence: 0.9,
                entityRef: { speculative: 'fiora' },
            },
        ]);

        expect(candidates).toEqual([
            {
                key: 'fiora',
                token: 'Fiora',
                kind: 'OTHER',
                score: 0.9,
                count: 2,
                status: 0,
            },
        ]);
    });

    it('prefers the most common and then longer surface when grouping', () => {
        const candidates = groupDiscoveryMentions('Kai was present.', [
            {
                source: 'discovery',
                surface: 'Kai',
                kind: 'OTHER',
                confidence: 0.7,
                entityRef: { Speculative: 'kai' },
            },
            {
                source: 'discovery',
                surface: 'Kai Ember',
                kind: 'OTHER',
                confidence: 0.8,
                entityRef: { Speculative: 'kai' },
            },
            {
                source: 'discovery',
                surface: 'Kai Ember',
                kind: 'OTHER',
                confidence: 0.9,
                entityRef: { Speculative: 'kai' },
            },
        ]);

        expect(candidates[0]?.token).toBe('Kai Ember');
        expect(candidates[0]?.count).toBe(3);
        expect(candidates[0]?.score).toBe(0.9);
    });
});

describe('coalesceDiscoveryCandidates', () => {
    it('merges case variants by normalized key and accumulates count', () => {
        const merged = coalesceDiscoveryCandidates([
            { key: 'fiora', token: 'Fiora', kind: 'OTHER', score: 0.9, count: 2, status: 0 },
            { key: normalizeDiscoveryCandidateKey('FIORA'), token: 'FIORA', kind: 'OTHER', score: 0.7, count: 1, status: 0 },
        ]);

        expect(merged).toEqual([
            {
                key: 'fiora',
                token: 'Fiora',
                kind: 'OTHER',
                score: 0.9,
                count: 3,
                status: 0,
            },
        ]);
    });
});
