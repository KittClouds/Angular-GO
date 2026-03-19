import { describe, expect, it } from 'vitest';

import { filterCachedEntitySpans } from './pretty-text-cache';

describe('filterCachedEntitySpans', () => {
    const registry = {
        getEntityById: (id: string) => (id === 'entity-1' ? { id } : null),
        findEntityByLabel: (label: string) => (label === 'Brooklyn' ? { id: 'entity-1', label } : null),
    };

    it('drops cached entity spans for deleted entities and keeps valid spans', () => {
        const spans = [
            { type: 'entity_implicit', from: 0, to: 8, label: 'Brooklyn', entityId: 'entity-1' },
            { type: 'entity_implicit', from: 10, to: 15, label: 'Ghost', entityId: 'ghost-1' },
            { type: 'analytics_highlight', from: 20, to: 25, label: 'cadence' as const },
        ] as any;

        expect(filterCachedEntitySpans(spans, registry as any)).toEqual([
            spans[0],
            spans[2],
        ]);
    });

    it('keeps label-resolved spans even when the cached entity id is missing', () => {
        const spans = [
            { type: 'entity_implicit', from: 0, to: 8, label: 'Brooklyn', entityId: '' },
        ] as any;

        expect(filterCachedEntitySpans(spans, registry as any)).toEqual(spans);
    });
});
