import { Injectable, inject } from '@angular/core';
import { NoteEditorStore } from '../../store/note-editor.store';
import { RetrievalService } from './retrieval.service';
import { ScopeService } from '../../services/scope.service';
import { AppContext, emptyAppContext, EntitySnapshot } from './app-context';

/**
 * AppContextProvider Service
 * 
 * Responsible for assembling the live execution context for the RLM loop.
 * It reads the current state of the application (active note, folder, scope)
 * and queries the graph/retrieval service to populate the context window.
 */
@Injectable({
    providedIn: 'root'
})
export class AppContextProviderService {
    private noteStore: NoteEditorStore;
    private retrieval: RetrievalService;
    private scopeService: ScopeService;

    constructor(
        noteStore?: NoteEditorStore,
        retrieval?: RetrievalService,
        scopeService?: ScopeService
    ) {
        this.noteStore = noteStore || inject(NoteEditorStore);
        this.retrieval = retrieval || inject(RetrievalService);
        this.scopeService = scopeService || inject(ScopeService);
    }

    /**
     * Build the current application context snapshot.
     * This is the "Grounding" step for the RLM.
     */
    async getCurrentContext(): Promise<AppContext> {
        const activeNote = this.noteStore.currentNote();
        const activeScope = this.scopeService.activeScope();

        // 1. If no note is open, return empty context grounded in current scope
        if (!activeNote) {
            return emptyAppContext(activeScope.narrativeId || activeScope.id);
        }

        // 2. Gather context data
        const folderId = activeNote.folderId;
        const narrativeId = activeNote.narrativeId || activeScope.narrativeId || null;

        // 3. Parallel fetch of graph context
        const [folderPath, nearbyEntities] = await Promise.all([
            // Breadcrumbs: Folder Hierarchy
            this.retrieval.getFolderAncestors(folderId),

            // Entities: Neighbors or Scope-based
            this.resolveNearbyEntities(activeNote.id, activeNote.isEntity, narrativeId)
        ]);

        // 4. Assemble the context
        return {
            activeNoteId: activeNote.id,
            activeNoteTitle: activeNote.title,
            // Take first 500 chars for immediate context (cheap token usage)
            activeNoteSnippet: activeNote.markdownContent.slice(0, 500),

            worldId: activeNote.worldId,
            narrativeId: narrativeId,
            folderId: folderId,

            folderPath: folderPath,
            nearbyEntities: nearbyEntities,
        };
    }

    /**
     * Strategy for selecting relevant entities:
     * - If Note is an Entity: Get direct graph neighbors (1-hop)
     * - If Note is in Narrative: Get entities in that narrative
     * - Fallback: Empty list
     */
    private async resolveNearbyEntities(
        noteId: string,
        isEntity: boolean,
        narrativeId: string | null
    ): Promise<EntitySnapshot[]> {
        // Mode A: Entity Note - Graph Expansion
        if (isEntity) {
            // content-centric graph expansion
            // If the note IS an entity, its ID is the entity ID
            return this.retrieval.getEntityNeighbors(noteId);
        }

        // Mode B: Narrative Note - Scope Retrieval
        if (narrativeId) {
            return this.retrieval.getEntitiesByNarrative(narrativeId);
        }

        // Mode C: World Building / General - Fallback
        return [];
    }
}
