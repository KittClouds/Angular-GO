import { Injectable, inject } from '@angular/core';
import { NoteEditorStore } from '../lib/store/note-editor.store';

interface EntitySnapshot {
    id: string;
    label: string;
    kind: string;
    subtype: string | null;
}

interface AppContext {
    activeNoteId: string | null;
    activeNoteTitle: string | null;
    activeNoteSnippet: string | null;
    worldId: string;
    narrativeId: string | null;
    folderId: string | null;
    folderPath: string[];
    nearbyEntities: EntitySnapshot[];
}

/**
 * OrchestratorService now only provides lightweight app context snapshots.
 * Chat orchestration and tool calling live in the Go run pipeline.
 */
@Injectable({ providedIn: 'root' })
export class OrchestratorService {
    private readonly noteEditorStore = inject(NoteEditorStore);

    async getAppContext(): Promise<AppContext | undefined> {
        const note = this.noteEditorStore.currentNote();
        if (!note) return undefined;

        return {
            activeNoteId: note.id,
            activeNoteTitle: note.title ?? null,
            activeNoteSnippet: note.markdownContent?.slice(0, 200)?.replace(/\n/g, ' ')?.trim() ?? null,
            worldId: note.worldId ?? '',
            narrativeId: note.narrativeId ?? null,
            folderId: note.folderId ?? null,
            folderPath: [],
            nearbyEntities: [],
        };
    }
}
