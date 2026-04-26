import { describe, expect, it } from 'vitest';

import { entityOccurrenceIndexTestHooks } from './entity-occurrence-index';
import { entityOccurrenceRowsTestHooks, type EntitySignalRow } from './entity-occurrence-rows';
import type { EntityOccurrence } from '../dexie/db';

describe('entity occurrence index', () => {
    it('extracts explicit entity marks with stable ids from ProseMirror JSON', () => {
        const doc = {
            type: 'doc',
            content: [
                {
                    type: 'paragraph',
                    content: [
                        {
                            type: 'text',
                            text: 'Aella',
                            marks: [
                                {
                                    type: 'entity',
                                    attrs: {
                                        id: 'entity-aella',
                                        label: 'Aella',
                                        kind: 'CHARACTER',
                                    },
                                },
                            ],
                        },
                        { type: 'text', text: ' waited.' },
                    ],
                },
            ],
        };

        const result = entityOccurrenceIndexTestHooks.extractNoteTextAndExplicitMarks(doc);

        expect(result.text).toBe('Aella waited.');
        expect(result.explicit).toEqual([
            {
                from: 0,
                to: 5,
                surface: 'Aella',
                attrs: { id: 'entity-aella', label: 'Aella', kind: 'CHARACTER' },
            },
        ]);
    });

    it('keeps the manual tag when a dictionary match overlaps it', () => {
        const text = 'Aella waited.';
        const manual = occurrence('manual_tag', 0, 5, 1);
        const machine = occurrence('dictionary_match', 0, 5, 0.98);

        const selected = entityOccurrenceIndexTestHooks.selectBestOccurrences([machine, manual], text);

        expect(selected).toHaveLength(1);
        expect(selected[0].source).toBe('manual_tag');
    });

    it('groups footer rows by entity-signal tab semantics', () => {
        const breakdown = entityOccurrenceRowsTestHooks.buildBreakdown([
            row('manual_tag'),
            row('dictionary_match'),
            row('machine_evidence'),
            row('machine_suggestion'),
        ]);

        expect(breakdown).toEqual({
            tagged: 1,
            matched: 1,
            evidence: 1,
            suggested: 1,
            total: 4,
        });
    });
});

function occurrence(
    source: EntityOccurrence['source'],
    sourceStart: number,
    sourceEnd: number,
    confidence: number,
): EntityOccurrence {
    return {
        id: `note-1:entity-aella:${sourceStart}:${sourceEnd}:${source}`,
        noteId: 'note-1',
        entityId: 'entity-aella',
        entityLabel: 'Aella',
        entityKind: 'CHARACTER',
        targetNoteId: 'entity-note-1',
        sourceStart,
        sourceEnd,
        surface: 'Aella',
        source,
        confidence,
        excerpt: 'Aella waited.',
        worldId: '',
        narrativeId: 'narrative-1',
        folderId: 'folder-1',
        generation: 1,
        createdAt: 1,
        updatedAt: 1,
    };
}

function row(method: EntitySignalRow['method']): EntitySignalRow {
    return {
        id: method,
        title: method,
        badgeLabel: method,
        excerpt: method,
        locationLabel: method,
        sourceNoteId: 'note-1',
        targetEntityId: 'entity-aella',
        method,
        confidence: 1,
        updatedAt: 1,
        direction: 'note_entity',
    };
}
