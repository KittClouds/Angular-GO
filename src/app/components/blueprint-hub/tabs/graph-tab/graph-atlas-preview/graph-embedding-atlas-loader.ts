import { db, type Note, type NoteBlockProjection } from '../../../../../lib/dexie/db';
import type { ResolvedScope } from '../../../../../lib/services/scope.service';
import { buildDocEmbeddingAtlas, buildLeafEmbeddingAtlas, type EmbeddingAtlasData } from './graph-embedding-atlas';

const MAX_NOTES = 180;
const MAX_BLOCKS = 220;

export async function loadEmbeddingAtlasForScope(scope: ResolvedScope): Promise<EmbeddingAtlasData> {
    const [notes, blocks] = await Promise.all([loadNotes(scope), loadBlocks(scope)]);
    if (blocks.length >= 6) {
        blocks.sort((a, b) => a.ordinal - b.ordinal);
        return buildLeafEmbeddingAtlas(blocks, MAX_BLOCKS);
    }
    notes.sort((a, b) => b.updatedAt - a.updatedAt);
    return buildDocEmbeddingAtlas(notes, MAX_NOTES);
}

async function loadNotes(scope: ResolvedScope): Promise<Note[]> {
    switch (scope.type) {
        case 'global':
            return db.notes.orderBy('updatedAt').reverse().limit(MAX_NOTES).toArray();
        case 'note': {
            const note = await db.notes.get(scope.selectedNoteId || scope.id);
            return note ? [note] : [];
        }
        case 'narrative':
            return db.notes.where('narrativeId').equals(scope.scopeFolderId).limit(MAX_NOTES).toArray();
        case 'act':
        case 'folder': {
            const ids = await noteIdsInFolderTree(scope.scopeFolderId);
            const notes = await db.notes.bulkGet(ids.slice(0, MAX_NOTES * 2));
            return notes.filter((note): note is Note => !!note).slice(0, MAX_NOTES);
        }
        default:
            return [];
    }
}

async function loadBlocks(scope: ResolvedScope): Promise<NoteBlockProjection[]> {
    switch (scope.type) {
        case 'global':
            return db.noteBlocks.orderBy('id').limit(MAX_BLOCKS).toArray();
        case 'note':
            return db.noteBlocks.where('noteId').equals(scope.selectedNoteId || scope.id).limit(MAX_BLOCKS).toArray();
        case 'narrative':
            return db.noteBlocks.where('narrativeId').equals(scope.scopeFolderId).limit(MAX_BLOCKS).toArray();
        case 'act':
        case 'folder': {
            const ids = await noteIdsInFolderTree(scope.scopeFolderId);
            return ids.length ? db.noteBlocks.where('noteId').anyOf(ids).limit(MAX_BLOCKS).toArray() : [];
        }
        default:
            return [];
    }
}

async function noteIdsInFolderTree(folderId: string): Promise<string[]> {
    const noteIds: string[] = [];
    const stack = [folderId];
    while (stack.length) {
        const current = stack.pop()!;
        const [notes, folders] = await Promise.all([
            db.notes.where('folderId').equals(current).toArray(),
            db.folders.where('parentId').equals(current).toArray(),
        ]);
        for (const note of notes) noteIds.push(note.id);
        for (const folder of folders) stack.push(folder.id);
    }
    return noteIds;
}
