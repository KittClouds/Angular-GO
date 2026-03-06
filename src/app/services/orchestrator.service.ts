import { Injectable, inject, signal } from '@angular/core';
import { RlmOrchestratorService, type ActivationResult } from '../lib/rlm';
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
 */
@Injectable({ providedIn: 'root' })
export class OrchestratorService {
    private readonly orchestrator = inject(RlmOrchestratorService);
    private readonly goKitt = inject(GoKittService);
    private readonly noteEditorStore = inject(NoteEditorStore);

    // Exposed for UI traces (thinking/tool timeline)
    readonly lastActivation = signal<ActivationResult | null>(null);

    /**
     * Orchestrates context gathering for a chat message using the
     * Go workspace sandbox. Miss signal drives workspace activation.
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

            this.lastActivation.set(result);

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
            this.lastActivation.set({ triggered: false, error: err instanceof Error ? err.message : String(err) });
            console.error('[Orchestrator] orchestrate error:', err);
            return '';
        }
    }

    /**
     * Get the OM context block for the current thread (for system prompts).
     */
    async getContext(threadId: string): Promise<string> {
        return this.orchestrator.getContext(threadId);
    }

    /**
     * Derive a scope ID from the active note's narrative context.
     */
    private deriveScopeId(): string {
        const note = this.noteEditorStore.currentNote();
        return note?.narrativeId ?? '';
    }

    /**
     * Build a lightweight app context snapshot for display purposes.
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
            folderPath: [],
            nearbyEntities: [],
        };
    }
}
