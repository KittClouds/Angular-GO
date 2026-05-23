import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

import { buildGraphRebuildSnapshot } from './graph-rebuild-builder';
import type {
    GraphRebuildChunk,
    GraphRebuildScopeKind,
    GraphRebuildSnapshot,
} from './graph-rebuild-snapshot';
import type { EntityOccurrence } from '../lib/dexie/db';
import type { RegisteredEntity } from '../lib/registry';

interface ParityFixture {
    noteId: string;
    scopeKind: GraphRebuildScopeKind;
    scopeId: string;
    builtAt: number;
    text: string;
    entities: FixtureEntity[];
    chunks: GraphRebuildChunk[];
    occurrences: FixtureOccurrence[];
    expected: StructuralDigest;
}

interface FixtureEntity {
    id: string;
    label: string;
    kind: string;
    aliases: string[];
}

interface FixtureOccurrence {
    entityId: string;
    entityLabel: string;
    entityKind: string;
    surface: string;
    sourceStart: number;
    sourceEnd: number;
    source: string;
    confidence: number;
}

interface RelationshipDigest {
    id: string;
    relationType: string;
    status: string;
}

interface StructuralDigest {
    relationships: RelationshipDigest[];
    eventCount: number;
    memoryStateCount: number;
    embeddingTargetKindCounts: Record<string, number>;
}

describe('Phoenix graph rebuild parity smoke', () => {
    it('matches the shared Rust/Angular structural fixture', () => {
        const fixture = loadFixture();
        const snapshot = buildGraphRebuildSnapshot({
            scopeKind: fixture.scopeKind,
            scopeId: fixture.scopeId,
            noteIds: [fixture.noteId],
            entities: fixture.entities.map(toRegisteredEntity),
            chunks: fixture.chunks,
            occurrences: fixture.occurrences.map((occurrence) => toOccurrence(fixture.noteId, occurrence)),
            candidateCount: fixture.occurrences.length,
            noteTexts: { [fixture.noteId]: fixture.text },
            builtAt: fixture.builtAt,
        });

        expect(structuralDigest(snapshot)).toEqual(fixture.expected);
    });
});

function loadFixture(): ParityFixture {
    const raw = readFileSync(new URL('./fixtures/graph-rebuild-parity-smoke.json', import.meta.url), 'utf8');
    return JSON.parse(raw) as ParityFixture;
}

function toRegisteredEntity(entity: FixtureEntity): RegisteredEntity {
    return {
        id: entity.id,
        label: entity.label,
        kind: entity.kind as RegisteredEntity['kind'],
        aliases: entity.aliases,
        firstNote: 'parity-note',
        mentionsByNote: new Map(),
        totalMentions: 0,
        lastSeenDate: new Date(1),
        createdAt: new Date(1),
        createdBy: 'user',
        registeredAt: 1,
    };
}

function toOccurrence(noteId: string, occurrence: FixtureOccurrence): EntityOccurrence {
    return {
        id: `${noteId}:${occurrence.entityId}:${occurrence.sourceStart}:${occurrence.sourceEnd}:${occurrence.source}`,
        noteId,
        entityId: occurrence.entityId,
        entityLabel: occurrence.entityLabel,
        entityKind: occurrence.entityKind,
        sourceStart: occurrence.sourceStart,
        sourceEnd: occurrence.sourceEnd,
        surface: occurrence.surface,
        source: occurrence.source as EntityOccurrence['source'],
        confidence: occurrence.confidence,
        excerpt: occurrence.surface,
        generation: 1,
        createdAt: 1,
        updatedAt: 1,
    };
}

function structuralDigest(snapshot: GraphRebuildSnapshot): StructuralDigest {
    return {
        relationships: snapshot.relationships
            .map((relationship) => ({
                id: relationship.id,
                relationType: relationship.relationType,
                status: relationship.status,
            }))
            .sort((left, right) => left.id.localeCompare(right.id)),
        eventCount: snapshot.events.length,
        memoryStateCount: snapshot.memoryState.length,
        embeddingTargetKindCounts: kindCounts(snapshot.embeddingTargets.map((target) => target.kind)),
    };
}

function kindCounts(kinds: string[]): Record<string, number> {
    const counts = new Map<string, number>();
    for (const kind of kinds) counts.set(kind, (counts.get(kind) || 0) + 1);
    return Object.fromEntries([...counts.entries()].sort(([left], [right]) => left.localeCompare(right)));
}
