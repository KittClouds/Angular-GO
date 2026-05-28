import { describe, expect, it } from 'vitest';

import { buildGraphRebuildEdgeJudgmentPlan, edgeJudgmentPlanCounters } from './graph-rebuild-edge-type-judgment-plan';
import type { GraphRebuildSnapshot } from './graph-rebuild-snapshot';

describe('graph rebuild edge type judgment plan', () => {
    it('plans one GLiClass model across edge and story-label roles', () => {
        const snapshot = {
            relationships: [
                relationship('r1', 'family_or_house_tie', 'accepted'),
                relationship('r2', 'observes', 'review'),
                relationship('r3', 'noise', 'rejected'),
            ],
            temporalEdges: [{ id: 't1' }, { id: 't2' }],
            causalEdges: [{ id: 'c1' }],
            events: [{ id: 'e1' }],
            memoryState: [{ id: 'm1' }],
        } as unknown as GraphRebuildSnapshot;

        const plan = buildGraphRebuildEdgeJudgmentPlan(snapshot);
        expect(plan.modelId).toBe('knowledgator/gliclass-instruct-base-v1.0');
        expect(plan.roles.map((row) => row.role)).toEqual([
            'relationship_type',
            'temporal_relation',
            'causal_relation',
            'story_signal',
        ]);
        expect(plan.candidateCount).toBe(8);
        expect(edgeJudgmentPlanCounters(plan)).toMatchObject({
            relationshipTypeCandidates: 2,
            temporalRelationCandidates: 2,
            causalRelationCandidates: 1,
            storySignalCandidates: 3,
            plannedModelCalls: 8,
        });
    });
});

function relationship(id: string, relationType: string, status: string): unknown {
    return {
        id,
        relationType,
        status,
    };
}
