import { describe, expect, it } from 'vitest';

import {
    buildGraphSignalTruthIndex,
    buildGraphSignalTruthSummary,
    graphSignalTruthCounters,
    graphTruthForEntityLinkSuggestion,
} from './graph-rebuild-signal-truth';
import type { GraphRebuildSnapshot } from './graph-rebuild-snapshot';

describe('graph signal truth contract', () => {
    it('classifies targets from canonical admission and adjudication state', () => {
        const snapshot = snapshotWithSignals();
        const index = buildGraphSignalTruthIndex(snapshot);

        expect(index.get('embed:note:note-1')?.status).toBe('accepted');
        expect(index.get('embed:chunk:chunk-1')?.status).toBe('accepted');
        expect(index.get('embed:entity:kai')?.status).toBe('accepted');
        expect(index.get('embed:anchor:anchor-1')?.status).toBe('evidence');
        expect(index.get('embed:graph-fact:rel-accepted')?.status).toBe('accepted');
        expect(index.get('embed:graph-fact:rel-review')?.status).toBe('review');
        expect(index.get('embed:graph-fact:rel-rejected')?.status).toBe('hidden');
        expect(index.get('embed:weak:co')?.status).toBe('evidence');
        expect(index.get('embed:deferred:raw')?.status).toBe('deferred');
    });

    it('summarizes review suggestions separately from target truth', () => {
        const summary = buildGraphSignalTruthSummary(snapshotWithSignals());
        const counters = graphSignalTruthCounters(snapshotWithSignals());

        expect(summary.targetAccepted).toBe(4);
        expect(summary.targetReview).toBe(1);
        expect(summary.targetEvidence).toBe(2);
        expect(summary.targetDeferred).toBe(1);
        expect(summary.targetHidden).toBe(1);
        expect(counters).toEqual(expect.objectContaining({
            graphTruthAccepted: 5,
            graphTruthReview: 5,
            graphTruthEvidence: 2,
            graphTruthDeferred: 1,
            graphTruthHidden: 3,
            suggestionReview: 3,
        }));
    });

    it('hides rejected entity-link suggestions under the same contract', () => {
        const record = graphTruthForEntityLinkSuggestion({
            id: 'entity-link:bad',
            surface: 'bad',
            normalizedSurface: 'bad',
            decision: 'reject',
            status: 'review',
            confidence: 0.2,
            rerankScore: 0.1,
            competingEntityIds: [],
            evidenceIds: [],
            rerankSignals: [],
            rationale: ['not enough evidence'],
        });

        expect(record).toMatchObject({
            status: 'hidden',
            kind: 'entity_link_suggestion',
            reason: 'not enough evidence',
        });
    });
});

function snapshotWithSignals(): GraphRebuildSnapshot {
    return {
        schemaVersion: 'phoenix-graph-rebuild/v1',
        id: 'snapshot-truth',
        source: 'phoenix-graph-rebuild',
        scopeKind: 'global',
        scopeId: 'global',
        noteIds: ['note-1'],
        builtAt: 1,
        chunks: [],
        mentions: [],
        entityAnchors: [],
        relationships: [
            relationship('rel-accepted', 'accepted'),
            relationship('rel-review', 'review'),
            relationship('rel-rejected', 'rejected'),
        ],
        events: [],
        episodes: [],
        temporalEdges: [],
        causalEdges: [],
        memoryState: [],
        embeddingTargets: [
            target('embed:note:note-1', 'note', 'note-1', 'document_spine'),
            target('embed:chunk:chunk-1', 'chunk', 'chunk-1', 'chunk_spine'),
            target('embed:entity:kai', 'entity', 'kai', 'entity_anchor'),
            target('embed:anchor:anchor-1', 'anchor', 'anchor-1', 'anchor_evidence'),
            target('embed:graph-fact:rel-accepted', 'graphFact', 'rel-accepted', 'relationship_fact'),
            target('embed:graph-fact:rel-review', 'graphFact', 'rel-review', 'relationship_fact'),
            target('embed:graph-fact:rel-rejected', 'graphFact', 'rel-rejected', 'relationship_fact'),
            target('embed:weak:co', 'graphFact', 'co', 'cooccurrence_weak'),
            { ...target('embed:deferred:raw', 'anchor', 'raw', 'anchor_evidence'), admissionStatus: 'deferred', deferReason: 'stage disabled' },
        ],
        embeddingVectors: [],
        projectionRefs: [],
        nodes: [],
        edges: [],
        graphAwareLinkSuggestions: [{
            id: 'graph-link:review',
            kind: 'bridge_review',
            sourceEntityId: 'kai',
            targetEntityId: 'hazel',
            suggestedRelationType: 'co_occurs_with',
            status: 'review',
            confidence: 0.8,
            semanticStatus: 'review',
            structuralRole: 'bridge',
            rationale: ['bridge candidate'],
            evidenceIds: [],
        }],
        entityLinkSuggestions: [{
            id: 'entity-link:review',
            surface: 'Kai',
            normalizedSurface: 'kai',
            candidateEntityId: 'kai',
            decision: 'same_entity',
            status: 'review',
            confidence: 0.9,
            rerankScore: 0.8,
            competingEntityIds: [],
            evidenceIds: [],
            rerankSignals: [],
            rationale: ['same label'],
        }, {
            id: 'entity-link:hidden',
            surface: 'Unknown',
            normalizedSurface: 'unknown',
            decision: 'reject',
            status: 'review',
            confidence: 0.1,
            rerankScore: 0,
            competingEntityIds: [],
            evidenceIds: [],
            rerankSignals: [],
            rationale: ['bad match'],
        }],
        resolutionSuggestions: [{
            id: 'resolution:review',
            kind: 'possible_alias',
            surface: 'K.',
            entityIds: ['kai'],
            status: 'review',
            rationale: 'alias candidate',
        }],
        counters: {} as any,
    };
}

function target(id: string, kind: string, sourceId: string, lane: any) {
    return {
        id,
        kind,
        sourceId,
        label: id,
        text: `${id} confidence:0.8`,
        evidenceIds: ['evidence-1'],
        lane,
        admissionStatus: 'admitted' as const,
    };
}

function relationship(id: string, status: 'accepted' | 'review' | 'rejected') {
    return {
        id,
        sourceEntityId: 'kai',
        targetEntityId: 'hazel',
        relationType: 'knows',
        evidenceAnchorIds: [],
        confidence: 0.82,
        status,
        adjudicationSource: 'test',
        adjudicationScore: 0.82,
        rationale: `${status} relation`,
        decisionEvidence: [],
    };
}
