import { Injectable, inject } from '@angular/core';
import { RlmOrchestratorService } from '../lib/rlm';
import { GoKittService } from './gokitt.service';
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
 * OrchestratorService - workspace-aware context gathering for chat.
 *
 * The CozoDB-based RLM loop is gone. This service now:
 * 1. Gathers live app context (active note, folder path, entities).
 * 2. Delegates to RlmOrchestratorService.processWithWorkspace which
 *    runs the OM miss-signal check and, if fired, resurfaces context
 *    from notes/episodes via Go WASM tools.
 * 3. Returns the new observation string for injection into the LLM prompt.
 */
@Injectable({ providedIn: 'root' })
export class OrchestratorService {
    private readonly orchestrator = inject(RlmOrchestratorService);
    private readonly goKitt = inject(GoKittService);
    private readonly noteEditorStore = inject(NoteEditorStore);

    /**
     * Orchestrates context gathering for a chat message using the
     * Go workspace sandbox. Miss signal drives workspace activation.
     *
     * @param userPrompt  The user's full chat message text
     * @param threadId    Active chat thread ID
     * @param narrativeId Narrative/world scope for episode search
     * @returns New observation string injected into OM (empty if no miss)
     */
    async orchestrate(userPrompt: string, threadId: string, narrativeId = ''): Promise<string> {
        if (!userPrompt.trim()) return '';

        const scopeId = narrativeId || this.deriveScopeId();

        try {
            const result = await this.orchestrator.processWithWorkspace(
                threadId,
                scopeId,
                userPrompt
            );

            if (result.error) {
                console.warn('[Orchestrator] Workspace error:', result.error);
                return '';
            }

            if (result.triggered && result.new_observation) {
                console.log(
                    `[Orchestrator] Workspace activated - injecting ${result.new_observation.length} chars of context`
                );
                return result.new_observation;
            }

            return '';
        } catch (err) {
            console.error('[Orchestrator] orchestrate error:', err);
            return '';
        }
    }

    /**
     * Get the OM context block for the current thread (for system prompts).
     * Returns empty string if no context or service not ready.
     */
    async getContext(threadId: string): Promise<string> {
        return this.orchestrator.getContext(threadId);
    }

    // =========================================================================
    // App context helpers (previously RetrievalService)
    // =========================================================================

    /**
     * Derive a scope ID from the active note's narrative context.
     * Falls back to an empty string (world-level scope).
     */
    private deriveScopeId(): string {
        const note = this.noteEditorStore.currentNote();
        return note?.narrativeId ?? '';
    }

    /**
     * Build a lightweight app context snapshot for display purposes
     * (no longer used in the core RLM path, kept for UI grounding).
     */
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
            // Folder ancestors and nearby entities require store queries;
            // return empty until a dedicated GoKitt store API is wired.
            folderPath: [],
            nearbyEntities: [],
        };
    }
}

