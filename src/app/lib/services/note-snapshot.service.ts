import { Injectable, inject } from '@angular/core';
import { db } from '../dexie/db';
import type { Note, NoteSnapshot, NoteSnapshotReason } from '../dexie/db';
import { NotesService } from '../dexie/notes.service';

export interface CreateNoteSnapshotRequest {
    note: Note;
    content: string;
    markdownContent: string;
    reason: NoteSnapshotReason;
}

@Injectable({
    providedIn: 'root',
})
export class NoteSnapshotService {
    private readonly notesService = inject(NotesService);

    async listSnapshots(noteId: string): Promise<NoteSnapshot[]> {
        const snapshots = await db.noteSnapshots.where('noteId').equals(noteId).toArray();
        return snapshots.sort((a, b) => b.createdAt - a.createdAt);
    }

    async createSnapshot(request: CreateNoteSnapshotRequest): Promise<NoteSnapshot> {
        const markdownHash = hashText(request.markdownContent);
        const latest = (await this.listSnapshots(request.note.id))[0];
        if (latest?.markdownHash === markdownHash && latest.reason === request.reason) {
            return latest;
        }

        const createdAt = Date.now();
        const snapshot: NoteSnapshot = {
            id: createSnapshotId(),
            noteId: request.note.id,
            title: request.note.title || 'Untitled Note',
            content: request.content,
            markdownContent: request.markdownContent,
            markdownHash,
            reason: request.reason,
            worldId: request.note.worldId || '',
            folderId: request.note.folderId || '',
            narrativeId: request.note.narrativeId || '',
            entityKind: request.note.entityKind || '',
            entitySubtype: request.note.entitySubtype || '',
            isEntity: request.note.isEntity || false,
            ownerId: request.note.ownerId || '',
            createdAt,
        };

        await db.noteSnapshots.put(snapshot);
        return snapshot;
    }

    async restoreAsCopy(snapshot: NoteSnapshot): Promise<string> {
        return this.notesService.createNote({
            worldId: snapshot.worldId,
            title: `${snapshot.title} (${formatSnapshotStamp(snapshot.createdAt)})`,
            content: snapshot.content,
            markdownContent: snapshot.markdownContent,
            folderId: snapshot.folderId,
            entityKind: snapshot.entityKind,
            entitySubtype: snapshot.entitySubtype,
            isEntity: snapshot.isEntity,
            isPinned: false,
            favorite: false,
            ownerId: snapshot.ownerId,
            narrativeId: snapshot.narrativeId,
        });
    }
}

export function formatSnapshotStamp(timestamp: number): string {
    const date = new Date(timestamp);
    const pad = (value: number) => value.toString().padStart(2, '0');
    return [
        date.getFullYear(),
        pad(date.getMonth() + 1),
        pad(date.getDate()),
    ].join('-') + ` ${pad(date.getHours())}${pad(date.getMinutes())}`;
}

function createSnapshotId(): string {
    if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
        return crypto.randomUUID();
    }
    return `note-snapshot-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

function hashText(text: string): string {
    let hash = 0x811c9dc5;
    for (let i = 0; i < text.length; i++) {
        hash ^= text.charCodeAt(i);
        hash = Math.imul(hash, 0x01000193);
    }
    return (hash >>> 0).toString(16).padStart(8, '0');
}
