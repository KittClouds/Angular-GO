import { describe, expect, it } from 'vitest';

import { buildGraphRebuildDeltaPostProcessPlan, deltaPostProcessPlanCounters } from './graph-rebuild-delta-postprocess-plan';
import type { GraphRebuildSnapshot } from './graph-rebuild-snapshot';

describe('graph rebuild delta postprocess plan', () => {
    it('marks local refresh, relink, and replan dirty when no snapshot exists', () => {
        const plan = buildGraphRebuildDeltaPostProcessPlan({
            policy: 'delta',
            docs: [{ id: 'note-1', plainText: 'Kai met Hazel.' }],
            entities: [{ id: 'entity-kai', label: 'Kai', kind: 'CHARACTER' }],
            cachedSnapshot: null,
            fingerprintMatched: false,
        });

        expect(deltaPostProcessPlanCounters(plan)).toMatchObject({
            fullReplanRoute: 1,
            projectionOnlyRoute: 0,
            localEntityFactRefreshDirty: 1,
            localEntityFactRefreshUnits: 1,
            entityRelinkDirty: 1,
            entityRelinkUnits: 1,
            targetReplanDirty: 1,
            projectionOnlyDirty: 0,
        });
    });

    it('routes a matched snapshot to projection-only instead of pretending work is needed', () => {
        const snapshot = {
            noteIds: ['note-1'],
            chunks: [{ noteId: 'note-1', textHash: hash('Kai met Hazel.') }],
            nodes: [{ entityId: 'entity-kai', label: 'Kai', kind: 'CHARACTER', aliases: [] }],
            embeddingGraphPostProcess: { schemaVersion: 'phoenix-embedding-graph-postprocess/v1' },
        } as unknown as GraphRebuildSnapshot;

        const plan = buildGraphRebuildDeltaPostProcessPlan({
            policy: 'delta',
            docs: [{ id: 'note-1', plainText: 'Kai met Hazel.' }],
            entities: [{ id: 'entity-kai', label: 'Kai', kind: 'CHARACTER', aliases: [] }],
            cachedSnapshot: snapshot,
            fingerprintMatched: true,
        });

        expect(deltaPostProcessPlanCounters(plan)).toMatchObject({
            fullReplanRoute: 0,
            projectionOnlyRoute: 1,
            localEntityFactRefreshDirty: 0,
            entityRelinkDirty: 0,
            targetReplanDirty: 0,
            projectionOnlyDirty: 1,
        });
    });
});

function hash(value: string): string {
    let out = 2166136261;
    for (let index = 0; index < value.length; index += 1) {
        out ^= value.charCodeAt(index);
        out = Math.imul(out, 16777619);
    }
    return (out >>> 0).toString(16).padStart(8, '0');
}
