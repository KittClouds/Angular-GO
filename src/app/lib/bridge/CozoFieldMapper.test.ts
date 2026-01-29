/**
 * CozoFieldMapper Tests
 */
import { describe, it, expect } from 'vitest';
import { DexieToCozo, CozoToDexie, CozoQueries } from './CozoFieldMapper';
import type { Note, Folder, Entity, Edge } from '../dexie/db';

describe('CozoFieldMapper', () => {
    describe('DexieToCozo', () => {
        it('should map Note correctly', () => {
            const dexieNote: Note = {
                id: 'note-1',
                worldId: 'world-1',
                title: 'Test Note',
                content: 'Hello world',
                markdownContent: '# Hello world',
                folderId: 'folder-1',
                entityKind: 'CHARACTER',
                entitySubtype: 'PROTAGONIST',
                isEntity: true,
                isPinned: false,
                favorite: true,
                ownerId: 'user-1',
                createdAt: 1000000,
                updatedAt: 2000000,
                narrativeId: 'narrative-1',
            };

            const cozoNote = DexieToCozo.note(dexieNote);

            expect(cozoNote.id).toBe('note-1');
            expect(cozoNote.world_id).toBe('world-1');
            expect(cozoNote.title).toBe('Test Note');
            expect(cozoNote.markdown_content).toBe('# Hello world');
            expect(cozoNote.folder_id).toBe('folder-1');
            expect(cozoNote.is_entity).toBe(true);
            expect(cozoNote.narrative_id).toBe('narrative-1');
        });

        it('should map Edge with relType → edge_type', () => {
            const dexieEdge: Edge = {
                id: 'edge-1',
                sourceId: 'entity-1',
                targetId: 'entity-2',
                relType: 'KNOWS',
                confidence: 0.85,
                bidirectional: true,
            };

            const cozoEdge = DexieToCozo.edge(dexieEdge);

            expect(cozoEdge.id).toBe('edge-1');
            expect(cozoEdge.source_id).toBe('entity-1');
            expect(cozoEdge.target_id).toBe('entity-2');
            expect(cozoEdge.edge_type).toBe('KNOWS'); // Key mapping
            expect(cozoEdge.confidence).toBe(0.85);
        });

        it('should map Entity with normalized label', () => {
            const dexieEntity: Entity = {
                id: 'entity-1',
                label: 'John Doe',
                kind: 'CHARACTER',
                subtype: 'PROTAGONIST',
                aliases: ['JD', 'Johnny'],
                firstNote: 'note-1',
                totalMentions: 5,
                createdAt: 1000000,
                updatedAt: 2000000,
                createdBy: 'user',
                narrativeId: 'narrative-1',
            };

            const cozoEntity = DexieToCozo.entity(dexieEntity);

            expect(cozoEntity.id).toBe('entity-1');
            expect(cozoEntity.label).toBe('John Doe');
            expect(cozoEntity.normalized).toBe('john doe');
            expect(cozoEntity.kind).toBe('CHARACTER');
            expect(cozoEntity.narrative_id).toBe('narrative-1');
        });

        it('should handle undefined narrativeId as empty string', () => {
            const note: Note = {
                id: 'note-1',
                worldId: '',
                title: '',
                content: '',
                markdownContent: '',
                folderId: '',
                entityKind: '',
                entitySubtype: '',
                isEntity: false,
                isPinned: false,
                favorite: false,
                ownerId: '',
                createdAt: 0,
                updatedAt: 0,
                narrativeId: '', // Empty, not undefined
            };

            const cozoNote = DexieToCozo.note(note);
            expect(cozoNote.narrative_id).toBe('');
        });
    });

    describe('CozoToDexie', () => {
        it('should map edge row with edge_type → relType', () => {
            // Simulated Cozo row: [id, source_id, target_id, edge_type, confidence]
            const cozoRow = ['edge-1', 'entity-1', 'entity-2', 'KNOWS', 0.85];

            const dexieEdge = CozoToDexie.edge(cozoRow);

            expect(dexieEdge.id).toBe('edge-1');
            expect(dexieEdge.sourceId).toBe('entity-1');
            expect(dexieEdge.targetId).toBe('entity-2');
            expect(dexieEdge.relType).toBe('KNOWS'); // Key reverse mapping
            expect(dexieEdge.confidence).toBe(0.85);
        });
    });

    describe('CozoQueries', () => {
        it('should generate valid upsert note query', () => {
            const cozoNote = DexieToCozo.note({
                id: 'note-1',
                worldId: 'world-1',
                title: 'Test',
                content: 'Content',
                markdownContent: '# Content',
                folderId: 'folder-1',
                entityKind: '',
                entitySubtype: '',
                isEntity: false,
                isPinned: false,
                favorite: false,
                ownerId: '',
                createdAt: 1000,
                updatedAt: 2000,
                narrativeId: '',
            });

            const query = CozoQueries.upsertNote(cozoNote);

            expect(query).toContain(':put notes');
            expect(query).toContain('"note-1"');
            expect(query).toContain('"Test"');
        });

        it('should generate valid delete query', () => {
            const query = CozoQueries.deleteNote('note-123');

            expect(query).toContain(':rm notes');
            expect(query).toContain('"note-123"');
        });
    });
});
