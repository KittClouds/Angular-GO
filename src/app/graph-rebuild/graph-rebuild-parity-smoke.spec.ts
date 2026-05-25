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

    it('keeps the Kai and Rowan story pass conservative before linker models', () => {
        const text = [
            'Kai held Tempest gaze while Baton Rouge made the room too loud.',
            'Rowan came to stand behind Hazel as Allied Table opened the packet.',
            'Kai Rowan refused to let the command turn into ownership.',
        ].join(' ');
        const kaiStart = text.indexOf('Kai');
        const rowanStart = text.indexOf('Rowan');
        const alliedStart = text.indexOf('Allied Table');
        const batonStart = text.indexOf('Baton Rouge');
        const snapshot = buildGraphRebuildSnapshot({
            scopeKind: 'note',
            scopeId: 'note:kai-rowan',
            noteIds: ['kai-rowan'],
            entities: [
                registeredEntity('e-kai-rowan', 'Kai Rowan', 'CHARACTER', ['Kai']),
                registeredEntity('e-rowan', 'Rowan', 'CHARACTER', []),
                registeredEntity('e-hazel', 'Hazel', 'CHARACTER', []),
                registeredEntity('e-tempest', 'Tempest', 'CHARACTER', []),
                registeredEntity('e-allied-table', 'Allied Table', 'ORGANIZATION', []),
                registeredEntity('e-baton-rouge', 'Baton Rouge', 'LOCATION', []),
            ],
            chunks: [{ id: 'kai-rowan:chunk:0', noteId: 'kai-rowan', start: 0, end: text.length, ordinal: 0, source: 'dynamic-chunking' }],
            occurrences: [
                occurrence('kai-rowan', 'missing-kai', 'Kai', 'LOCATION', kaiStart, kaiStart + 3, 'machine_suggestion'),
                occurrence('kai-rowan', 'e-kai-rowan', 'Kai', 'CHARACTER', kaiStart, kaiStart + 3, 'dictionary_match'),
                occurrence('kai-rowan', 'e-rowan', 'Rowan', 'CHARACTER', rowanStart, rowanStart + 5, 'dictionary_match'),
                occurrence('kai-rowan', 'missing-allied', 'Allied Table', 'LOCATION', alliedStart, alliedStart + 12, 'machine_suggestion'),
                occurrence('kai-rowan', 'missing-baton', 'Baton Rouge', 'LOCATION', batonStart, batonStart + 11, 'machine_suggestion'),
            ],
            candidateCount: 5,
            noteTexts: { 'kai-rowan': text },
            builtAt: 20,
        });

        expect(snapshot.nodes.map((node) => node.id)).toEqual(expect.arrayContaining(['e-kai-rowan', 'e-rowan', 'e-allied-table', 'e-baton-rouge']));
        expect(snapshot.counters.dropReasons.duplicateAnchor).toBe(1);
        expect(snapshot.counters.dropReasons.missingEntity).toBe(0);
        expect(snapshot.counters.resolution).toMatchObject({
            resolvedById: 2,
            resolvedByAlias: 1,
            resolvedByLabel: 2,
            kindConflicts: 2,
            droppedDuplicateSpans: 1,
        });
        expect(snapshot.resolutionSuggestions?.map((row) => row.kind)).toEqual(expect.arrayContaining(['possible_alias', 'kind_conflict']));
        expect(snapshot.counters.entityLinking).toMatchObject({
            candidateMentions: 1,
        });
        expect(snapshot.counters.entityLinkSuggestions).toBeGreaterThan(0);
        expect(snapshot.counters.entityLinking?.autoConfirmable).toBe(0);
    });

    it('smokes deterministic pre-linking over docs/shortrun.md baseline text', () => {
        const text = readFileSync(new URL('../../../docs/shortrun.md', import.meta.url), 'utf8').slice(0, 24000);
        const occurrences = [
            ...surfaceOccurrences(text, 'shortrun', 'e-ryan', 'Ryan', 'CHARACTER', 'dictionary_match', 2),
            ...surfaceOccurrences(text, 'shortrun', 'missing-quicksave', 'Quicksave', 'CHARACTER', 'machine_suggestion', 2),
            ...surfaceOccurrences(text, 'shortrun', 'missing-new-rome', 'New Rome', 'LOCATION', 'machine_suggestion', 2),
            ...surfaceOccurrences(text, 'shortrun', 'missing-renesco', 'Renesco', 'CHARACTER', 'machine_suggestion', 2),
            ...surfaceOccurrences(text, 'shortrun', 'missing-dynamis', 'Dynamis', 'ORGANIZATION', 'machine_suggestion', 2),
            ...surfaceOccurrences(text, 'shortrun', 'missing-rust-town', 'Rust Town', 'LOCATION', 'machine_suggestion', 2),
        ];
        const snapshot = buildGraphRebuildSnapshot({
            scopeKind: 'note',
            scopeId: 'note:shortrun',
            noteIds: ['shortrun'],
            entities: [
                registeredEntity('e-ryan', 'Ryan', 'CHARACTER', ['Quicksave']),
                registeredEntity('e-new-rome', 'New Rome', 'LOCATION', []),
                registeredEntity('e-renesco', 'Renesco', 'CHARACTER', []),
                registeredEntity('e-dynamis', 'Dynamis', 'ORGANIZATION', []),
                registeredEntity('e-rust-town', 'Rust Town', 'LOCATION', []),
            ],
            chunks: [{ id: 'shortrun:chunk:0', noteId: 'shortrun', start: 0, end: text.length, ordinal: 0, source: 'dynamic-chunking' }],
            occurrences,
            candidateCount: occurrences.length,
            noteTexts: { shortrun: text },
            builtAt: 21,
        });

        expect(occurrences.length).toBeGreaterThanOrEqual(8);
        expect(snapshot.counters.dropReasons.missingEntity).toBe(0);
        expect(snapshot.counters.acceptedAnchors).toBe(occurrences.length);
        expect(snapshot.counters.resolution?.resolvedByAlias).toBeGreaterThan(0);
        expect(snapshot.counters.resolution?.resolvedByLabel).toBeGreaterThan(0);
        expect(snapshot.nodes.map((node) => node.id)).toEqual(expect.arrayContaining(['e-ryan', 'e-new-rome', 'e-renesco', 'e-dynamis', 'e-rust-town']));
        expect(kindCounts(snapshot.embeddingTargets.map((target) => target.kind)).graphFact).toBeGreaterThan(0);
        expect(snapshot.counters.entityLinkSuggestions).toBeGreaterThanOrEqual(0);
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

function registeredEntity(id: string, label: string, kind: string, aliases: string[]): RegisteredEntity {
    return {
        id,
        label,
        kind: kind as RegisteredEntity['kind'],
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

function occurrence(
    noteId: string,
    entityId: string,
    surface: string,
    entityKind: string,
    sourceStart: number,
    sourceEnd: number,
    source: EntityOccurrence['source'],
): EntityOccurrence {
    return {
        id: `${noteId}:${entityId}:${sourceStart}:${sourceEnd}:${source}`,
        noteId,
        entityId,
        entityLabel: surface,
        entityKind,
        sourceStart,
        sourceEnd,
        surface,
        source,
        confidence: 0.9,
        excerpt: surface,
        generation: 1,
        createdAt: 1,
        updatedAt: 1,
    };
}

function surfaceOccurrences(
    text: string,
    noteId: string,
    entityId: string,
    surface: string,
    entityKind: string,
    source: EntityOccurrence['source'],
    limit: number,
): EntityOccurrence[] {
    const out: EntityOccurrence[] = [];
    let from = 0;
    while (out.length < limit) {
        const index = text.indexOf(surface, from);
        if (index < 0) break;
        out.push(occurrence(noteId, entityId, surface, entityKind, index, index + surface.length, source));
        from = index + surface.length;
    }
    return out;
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
