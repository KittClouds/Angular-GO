import { describe, expect, it } from 'vitest';

import {
    buildGraphRebuildAliasResolver,
    buildGraphRebuildSnapshot,
    normalizeGraphRebuildCandidate,
} from './graph-rebuild-builder';
import type { EntityOccurrence } from '../lib/dexie/db';
import type { RegisteredEntity } from '../lib/registry';

describe('Phoenix graph rebuild builder', () => {
    it('resolves canonical Alex entities by label and alias', () => {
        const resolver = buildGraphRebuildAliasResolver([
            entity('e-kai', 'Kai', ['Captain Kai']),
            entity('e-rift', 'Rift', ['The Rift']),
        ]);

        expect(resolver.resolve(' captain kai ')?.id).toBe('e-kai');
        expect(resolver.resolve('The Rift')?.id).toBe('e-rift');
        expect(resolver.aliasCount).toBe(2);
    });

    it('normalizes NER candidates before they can feed Alex', () => {
        expect(normalizeGraphRebuildCandidate({
            label: '  Kai   Varo ',
            kind: 'character',
            aliases: ['Kai Varo', '  Captain   Kai  ', 'Captain Kai'],
            confidence: 2,
        })).toEqual({
            label: 'Kai Varo',
            kind: 'CHARACTER',
            aliases: ['Captain Kai'],
            confidence: 1,
        });
    });

    it('builds cooccurrence rows, typed facts, memory state, and embedding targets', () => {
        const snapshot = buildGraphRebuildSnapshot({
            scopeKind: 'note',
            scopeId: 'note:one',
            noteIds: ['note-1'],
            entities: [
                entity('e-kai', 'Kai', ['Captain Kai']),
                entity('e-rift', 'Rift', []),
                entity('e-hazel', 'Hazel', []),
            ],
            chunks: [
                { id: 'note-1:block:0', noteId: 'note-1', start: 0, end: 120, ordinal: 0, source: 'note-block' },
            ],
            occurrences: [
                occurrence('note-1', 'e-kai', 'Kai', 0, 3),
                occurrence('note-1', 'e-rift', 'Rift', 20, 24),
                occurrence('note-1', 'e-hazel', 'Hazel', 90, 95),
                occurrence('note-2', 'e-hazel', 'Hazel', 0, 5),
            ],
            candidateCount: 4,
            noteTexts: {
                'note-1': 'Kai approved the packet with Rift because Hazel warned Kai. Hazel stood beside Kai as Diamond rank was confirmed.',
            },
            builtAt: 10,
        });

        expect(snapshot.schemaVersion).toBe('phoenix-graph-rebuild/v1');
        expect(snapshot.nodes.map((node) => node.id).sort()).toEqual(['e-hazel', 'e-kai', 'e-rift']);
        expect(snapshot.edges.filter((edge) => edge.type === 'anchored-cooccurrence').map((edge) => [edge.sourceId, edge.targetId]).sort()).toEqual([
            ['e-hazel', 'e-kai'],
            ['e-hazel', 'e-rift'],
            ['e-kai', 'e-rift'],
        ]);
        expect(snapshot.relationships).toHaveLength(6);
        expect(snapshot.relationships.filter((row) => row.adjudicationSource === 'graph-rebuild-cooccurrence-policy')).toHaveLength(3);
        expect(snapshot.relationships.filter((row) => row.adjudicationSource === 'graph-rebuild-typed-cue-policy')).toHaveLength(3);
        expect(snapshot.relationships.map((row) => [row.relationType, row.status])).toEqual(expect.arrayContaining([
            ['co_occurs_with', 'review'],
            ['approves_or_accepts', 'accepted'],
        ]));
        expect(snapshot.counters.relationshipCandidates).toBe(6);
        expect(snapshot.counters.acceptedRelationships).toBe(3);
        expect(snapshot.counters.reviewRelationships).toBe(3);
        expect(snapshot.counters.rejectedRelationships).toBe(0);
        expect(snapshot.events.map((event) => event.id)).toEqual(['event:note-1:0:approval_event']);
        expect(snapshot.memoryState.map((state) => [state.entityId, state.key]).sort()).toEqual([
            ['e-hazel', 'rank_or_status'],
            ['e-kai', 'rank_or_status'],
            ['e-rift', 'rank_or_status'],
        ]);
        expect(kindCounts(snapshot.embeddingTargets.map((target) => target.kind))).toEqual({
            anchor: 3,
            chunk: 1,
            entity: 3,
            event: 1,
            graphFact: 6,
            memoryState: 3,
            note: 1,
        });
        expect(snapshot.counters).toMatchObject({
            entities: 3,
            aliases: 1,
            candidates: 4,
            acceptedAnchors: 3,
            chunks: 1,
            events: 1,
            episodes: 1,
            memoryState: 3,
            embeddingTargets: 18,
            nodes: 3,
            edges: 6,
        });
    });

    it('upgrades matching relationship candidates with explicit NLI hints', () => {
        const snapshot = buildGraphRebuildSnapshot({
            scopeKind: 'note',
            scopeId: 'note:one',
            noteIds: ['note-1'],
            entities: [
                entity('e-kai', 'Kai', []),
                entity('e-hazel', 'Hazel', []),
            ],
            chunks: [
                { id: 'note-1:chunk:0', noteId: 'note-1', start: 0, end: 80, ordinal: 0, source: 'dynamic-chunking' },
            ],
            occurrences: [
                occurrence('note-1', 'e-kai', 'Kai', 0, 3),
                occurrence('note-1', 'e-hazel', 'Hazel', 10, 15),
            ],
            relationshipHints: [{
                sourceId: 'entity:e-kai',
                targetId: 'entity:e-hazel',
                relationType: 'supports',
                status: 'accepted',
                confidence: 0.94,
                source: 'nli:modernbert',
                evidence: ['judgment:j-1'],
            }],
            builtAt: 12,
        });

        expect(snapshot.relationships).toHaveLength(1);
        expect(snapshot.relationships[0]).toMatchObject({
            relationType: 'supports',
            status: 'accepted',
            adjudicationSource: 'nli:modernbert',
        });
        expect(snapshot.counters.acceptedRelationships).toBe(1);
        expect(snapshot.counters.reviewRelationships).toBe(0);
    });

    it('reports exact missing upstream reasons instead of silent empty output', () => {
        const snapshot = buildGraphRebuildSnapshot({
            scopeKind: 'global',
            scopeId: 'global',
            entities: [entity('e-kai', 'Kai', [])],
            occurrences: [
                occurrence('note-1', 'missing', 'Ghost', 0, 5),
                occurrence('note-1', 'e-kai', 'Kai', 4, 4),
                occurrence('note-1', 'e-kai', 'Kai', 6, 9),
            ],
            builtAt: 11,
        });

        expect(snapshot.nodes).toHaveLength(1);
        expect(snapshot.edges).toHaveLength(0);
        expect(snapshot.counters.dropReasons).toMatchObject({
            missingEntity: 1,
            invalidSpan: 1,
            singletonBucket: 1,
        });
    });
});

function entity(id: string, label: string, aliases: string[]): RegisteredEntity {
    return {
        id,
        label,
        kind: 'CHARACTER' as any,
        aliases,
        firstNote: `${id}-note`,
        mentionsByNote: new Map(),
        totalMentions: 0,
        lastSeenDate: new Date(1),
        createdAt: new Date(1),
        createdBy: 'user',
        registeredAt: 1,
    };
}

function occurrence(noteId: string, entityId: string, surface: string, sourceStart: number, sourceEnd: number): EntityOccurrence {
    return {
        id: `${noteId}:${entityId}:${sourceStart}:${sourceEnd}`,
        noteId,
        entityId,
        entityLabel: surface,
        entityKind: 'CHARACTER',
        sourceStart,
        sourceEnd,
        surface,
        source: 'dictionary_match',
        confidence: 0.9,
        excerpt: surface,
        generation: 1,
        createdAt: 1,
        updatedAt: 1,
    };
}

function kindCounts(kinds: string[]): Record<string, number> {
    const counts = new Map<string, number>();
    for (const kind of kinds) counts.set(kind, (counts.get(kind) || 0) + 1);
    return Object.fromEntries([...counts.entries()].sort(([left], [right]) => left.localeCompare(right)));
}
