import { Injectable, inject } from '@angular/core';
import { NoteEditorStore } from '../../store/note-editor.store';
import { ScopeService } from '../../services/scope.service';
import { AppContext, emptyAppContext, EntitySnapshot } from './app-context';

/**
 * AppContextProviderService
 *
 * Assembles live Angular app state into a snapshot for RLM prompt grounding.
 * RetrievalService dependency removed — graph queries now live in Go WASM.
 * Folder ancestors and entity neighbors return empty until a dedicated
 * storeListEdges / storeGetAncestors WASM hook is wired.
 */
@Injectable({ providedIn: 'root' })
export class AppContextProviderService {
    private readonly noteStore = inject(NoteEditorStore);
    private readonly scopeService = inject(ScopeService);

    /**
     * Build the current application context snapshot.
     * This is the "Grounding" step for the RLM.
     */
    async getCurrentContext(): Promise<AppContext> {
        const activeNote = this.noteStore.currentNote();
        const activeScope = this.scopeService.activeScope();

        if (!activeNote) {
            return emptyAppContext(activeScope.narrativeId || activeScope.id);
        }

        const narrativeId = activeNote.narrativeId ?? activeScope.narrativeId ?? null;

        return {
            activeNoteId: activeNote.id,
            activeNoteTitle: activeNote.title,
            activeNoteSnippet: activeNote.markdownContent.slice(0, 500),
            worldId: activeNote.worldId,
            narrativeId,
            folderId: activeNote.folderId,
            // Folder path and entity graph require dedicated GoKitt store APIs.
            // These will be wired when the folder/entity WASM tools are added.
            folderPath: [],
            nearbyEntities: [],
        };
    }
}
