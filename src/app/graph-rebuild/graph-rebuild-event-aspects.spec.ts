import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

import { buildGraphRebuildSnapshot } from './graph-rebuild-builder';
import { dynamicChunksForNote } from './graph-rebuild.service';
import type { EntityOccurrence } from '../lib/dexie/db';
import type { RegisteredEntity } from '../lib/registry';

describe('Graph rebuild deterministic event aspects', () => {
    it('adds UMR-style aspect hints without a classifier', () => {
        const text = [
            'Kai planned to inspect Red Mesa because Hazel warned him.',
            'The tower keeps selecting returnees every sunset while Rowan watched the roads shift.',
        ].join(' ');
        const secondStart = text.indexOf('The tower');
        const snapshot = buildGraphRebuildSnapshot({
            scopeKind: 'note',
            scopeId: 'note:aspect',
            noteIds: ['note-1'],
            entities: [
                entity('e-kai', 'Kai'),
                entity('e-hazel', 'Hazel'),
                entity('e-rowan', 'Rowan'),
                entity('e-tower', 'tower', 'LOCATION'),
            ],
            chunks: [
                { id: 'note-1:block:0', noteId: 'note-1', start: 0, end: secondStart - 1, ordinal: 0, source: 'note-block' },
                { id: 'note-1:block:1', noteId: 'note-1', start: secondStart, end: text.length, ordinal: 1, source: 'note-block' },
            ],
            occurrences: occurrencesFor('note-1', text, [
                ['e-kai', 'Kai'],
                ['e-hazel', 'Hazel'],
                ['e-rowan', 'Rowan'],
                ['e-tower', 'tower'],
            ]),
            candidateCount: 4,
            noteTexts: { 'note-1': text },
            builtAt: 10,
        });

        expect(snapshot.events.map((event) => [event.id, event.aspect?.kind, event.aspect?.completion])).toEqual([
            ['event:note-1:0:warning_event', 'endeavor', 'planned'],
            ['event:note-1:1:process_event', 'habitual', 'ongoing'],
        ]);
        expect(snapshot.counters.eventAspects).toBe(2);
        expect(snapshot.embeddingTargets.find((target) => target.id === 'embed:event:event:note-1:1:process_event')?.text)
            .toContain('aspect:habitual completion:ongoing');
    });

    it('CLI-smokes aspect hints over shortrun and mother2 passages', () => {
        const shortrun = readFileSync(new URL('../../../docs/shortrun.md', import.meta.url), 'utf8').slice(0, 18000);
        const mother2 = readFileSync(new URL('../../../docs/mother2.md', import.meta.url), 'utf8').slice(0, 18000);
        const shortSnapshot = snapshotForDoc('shortrun', shortrun, [
            ['e-ryan', 'Ryan', 'CHARACTER'],
            ['e-new-rome', 'New Rome', 'LOCATION'],
            ['e-dynamis', 'Dynamis', 'NETWORK'],
        ]);
        const motherSnapshot = snapshotForDoc('mother2', mother2, [
            ['e-zorian', 'Zorian', 'CHARACTER'],
            ['e-matriarch', 'matriarch', 'CHARACTER'],
            ['e-cyoria', 'Cyoria', 'LOCATION'],
            ['e-xvim', 'Xvim', 'CHARACTER'],
        ]);
        const aspects = [...shortSnapshot.events, ...motherSnapshot.events].flatMap((event) => event.aspect ? [event.aspect] : []);

        expect(aspects.length).toBeGreaterThan(0);
        expect(new Set(aspects.map((aspect) => aspect.kind)).size).toBeGreaterThan(1);
        expect(aspects.every((aspect) => aspect.confidence >= 0.58)).toBe(true);
    });
});

function snapshotForDoc(id: string, text: string, rows: Array<[string, string, string]>) {
    const entities = rows.map(([entityId, label, kind]) => entity(entityId, label, kind));
    return buildGraphRebuildSnapshot({
        scopeKind: 'note',
        scopeId: `note:${id}`,
        noteIds: [id],
        entities,
        chunks: dynamicChunksForNote({ id, markdownContent: text, content: '' }),
        occurrences: occurrencesFor(id, text, rows.map(([entityId, label]) => [entityId, label])),
        candidateCount: rows.length,
        noteTexts: { [id]: text },
        builtAt: 20,
    });
}

function entity(id: string, label: string, kind = 'CHARACTER'): RegisteredEntity {
    return {
        id,
        label,
        kind: kind as any,
        aliases: [],
        firstNote: `${id}-note`,
        mentionsByNote: new Map(),
        totalMentions: 0,
        lastSeenDate: new Date(1),
        createdAt: new Date(1),
        createdBy: 'user',
        registeredAt: 1,
    };
}

function occurrencesFor(noteId: string, text: string, rows: Array<[string, string]>): EntityOccurrence[] {
    const out: EntityOccurrence[] = [];
    for (const [entityId, surface] of rows) {
        let offset = 0;
        while (out.filter((row) => row.entityId === entityId).length < 10) {
            const index = text.indexOf(surface, offset);
            if (index < 0) break;
            out.push(occurrence(noteId, entityId, surface, index, index + surface.length));
            offset = index + surface.length;
        }
    }
    return out;
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
