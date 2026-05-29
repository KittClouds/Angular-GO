import { describe, expect, it } from 'vitest';

import type { EntityOccurrence } from '../lib/dexie/db';
import type { RegisteredEntity } from '../lib/registry';
import { buildGraphRebuildSnapshot } from './graph-rebuild-builder';

describe('graph model v2 foundation', () => {
    it('keeps roots as lanes while moving relation colors into fact tags', () => {
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
                occurrence('note-1', 'e-rift', 'Rift', 29, 33),
                occurrence('note-1', 'e-hazel', 'Hazel', 42, 47),
            ],
            noteTexts: {
                'note-1': 'Kai approved the packet with Rift because Hazel warned Kai. Diamond rank was confirmed.',
            },
            builtAt: 10,
        });
        const model = snapshot.graphModelV2;

        expect(model?.schemaVersion).toBe('phoenix-graph-model/v2');
        expect(model?.sourceSnapshotId).toBe(snapshot.id);
        expect(model?.atoms.some((atom) => String(atom.kind) === 'cooccurrence')).toBe(false);
        expect(model?.atoms.some((atom) => String(atom.kind) === 'relationship')).toBe(false);
        expect(model?.laneRoots.map((lane) => lane.lane)).toEqual(expect.arrayContaining([
            'document_spine',
            'chunk_spine',
            'entity_anchor',
            'relationship_fact',
            'cooccurrence_weak',
            'anchor_evidence',
        ]));

        const cooccurrenceFacts = model?.facts.filter((fact) => fact.family === 'cooccurrence') || [];
        expect(cooccurrenceFacts).toHaveLength(3);
        expect(cooccurrenceFacts.every((fact) => fact.lane === 'cooccurrence_weak')).toBe(true);
        expect(cooccurrenceFacts.every((fact) => fact.status === 'review')).toBe(true);

        const approvedFact = model?.facts.find((fact) => fact.family === 'approval');
        expect(approvedFact).toMatchObject({
            lane: 'relationship_fact',
            status: 'accepted',
            relationType: 'approves_or_accepts',
        });
        expect(model?.styleTags).toEqual(expect.arrayContaining([
            expect.objectContaining({ targetId: approvedFact?.id, targetType: 'fact', tagKind: 'relationFamily', value: 'approval' }),
            expect.objectContaining({ targetId: 'atom:entity:e-kai', targetType: 'atom', tagKind: 'entityFamily', value: 'CHARACTER' }),
        ]));
    });

    it('represents transfer as a role-bearing fact and keeps binary edges as projections', () => {
        const snapshot = buildGraphRebuildSnapshot({
            scopeKind: 'note',
            scopeId: 'note:transfer',
            noteIds: ['note-1'],
            entities: [
                entity('e-kai', 'Kai', []),
                entity('e-hazel', 'Hazel', []),
            ],
            chunks: [
                { id: 'note-1:block:0', noteId: 'note-1', start: 0, end: 60, ordinal: 0, source: 'note-block' },
            ],
            occurrences: [
                occurrence('note-1', 'e-kai', 'Kai', 0, 3),
                occurrence('note-1', 'e-hazel', 'Hazel', 9, 14),
            ],
            noteTexts: {
                'note-1': 'Kai gave Hazel the map at dawn.',
            },
            builtAt: 12,
        });
        const model = snapshot.graphModelV2;
        const transfer = model?.facts.find((fact) => fact.family === 'transfer');

        expect(transfer).toMatchObject({
            relationType: 'transfers_or_receives',
            lane: 'relationship_fact',
            status: 'accepted',
        });
        expect(model?.roles.filter((role) => role.factId === transfer?.id).map((role) => role.role).sort()).toEqual([
            'evidence',
            'evidence',
            'source',
            'target',
        ]);
        expect(model?.counters.hyperedgeFacts).toBeGreaterThan(0);
        expect(model?.projectionEdges).toEqual(expect.arrayContaining([
            expect.objectContaining({
                edgeType: 'transfers_or_receives',
                projectionKind: 'legacyBinary',
            }),
            expect.objectContaining({
                sourceFactId: transfer?.id,
                edgeType: 'role:source',
                projectionKind: 'factRole',
            }),
        ]));
    });
});

function entity(id: string, label: string, aliases: string[], kind = 'CHARACTER'): RegisteredEntity {
    return {
        id,
        label,
        kind: kind as any,
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
