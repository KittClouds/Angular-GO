import { Injectable, inject } from '@angular/core';
import { GoogleGenAIService } from '../lib/services/google-genai.service';
import { OpenRouterService } from '../lib/services/openrouter.service';
import { RlmLoopService, RlmLlmService, type RLMContext, formatRlmContext } from '../lib/rlm';
import { NoteEditorStore } from '../lib/store/note-editor.store';
import { RetrievalService } from '../lib/rlm/services/retrieval.service';
import { type AppContext, type EntitySnapshot } from '../lib/rlm/services/app-context';

/**
 * OrchestratorService - Context gathering for chat via RLM.
 * 
 * Uses the graph-native Recursive Language Model (RLM) loop to:
 * 1. Observe context from FTS/Vector/Graph
 * 2. Plan reasoning steps
 * 3. Execute queries and mutations
 * 4. Evaluate results and recurse if needed
 * 
 * Now includes AppContext - live application state (open note, folder path, nearby entities)
 * to ground the RLM observe step in the user's current context.
 */
@Injectable({ providedIn: 'root' })
export class OrchestratorService {
    private googleGenAi: GoogleGenAIService;
    private openRouter: OpenRouterService;
    private rlmService: RlmLoopService;
    private rlmLlm: RlmLlmService;
    private noteEditorStore: NoteEditorStore;
    private retrievalService: RetrievalService;

    constructor(
        googleGenAi?: GoogleGenAIService,
        openRouter?: OpenRouterService,
        rlmService?: RlmLoopService,
        rlmLlm?: RlmLlmService,
        noteEditorStore?: NoteEditorStore,
        retrievalService?: RetrievalService
    ) {
        this.googleGenAi = googleGenAi || inject(GoogleGenAIService);
        this.openRouter = openRouter || inject(OpenRouterService);
        this.rlmService = rlmService || inject(RlmLoopService);
        this.rlmLlm = rlmLlm || inject(RlmLlmService);
        this.noteEditorStore = noteEditorStore || inject(NoteEditorStore);
        this.retrievalService = retrievalService || inject(RetrievalService);
    }

    /**
     * Gather live application context for RLM grounding.
     * 
     * Snapshots:
     * - Active note ID, title, and snippet
     * - Folder path (ancestor chain)
     * - World/narrative IDs
     * - Nearby entities (from narrative scope + entity neighbors)
     * 
     * @param narrativeId Optional narrative scope override
     * @returns AppContext object with live state
     */
    private async gatherAppContext(narrativeId?: string): Promise<AppContext | undefined> {
        const activeNoteId = this.noteEditorStore.activeNoteId();
        const currentNote = this.noteEditorStore.currentNote();

        // No active note - return minimal context
        if (!activeNoteId || !currentNote) {
            return undefined;
        }

        // Extract snippet from note content (first 200 chars of markdown)
        const snippet = currentNote.markdownContent
            ?.slice(0, 200)
            ?.replace(/\n/g, ' ')
            ?.trim() ?? null;

        // Determine world/narrative IDs
        const worldId = currentNote.worldId ?? '';
        const effectiveNarrativeId = narrativeId ?? currentNote.narrativeId ?? null;
        const folderId = currentNote.folderId ?? null;

        // Get folder path (ancestors)
        let folderPath: string[] = [];
        if (folderId) {
            try {
                folderPath = await this.retrievalService.getFolderAncestors(folderId);
            } catch (err) {
                console.warn('[Orchestrator] Failed to get folder ancestors:', err);
            }
        }

        // Get nearby entities
        let nearbyEntities: EntitySnapshot[] = [];
        if (effectiveNarrativeId) {
            try {
                nearbyEntities = await this.retrievalService.getEntitiesByNarrative(effectiveNarrativeId, 10);
            } catch (err) {
                console.warn('[Orchestrator] Failed to get nearby entities:', err);
            }
        }

        return {
            activeNoteId,
            activeNoteTitle: currentNote.title ?? null,
            activeNoteSnippet: snippet,
            worldId,
            narrativeId: effectiveNarrativeId,
            folderId,
            folderPath,
            nearbyEntities,
        };
    }

    /**
     * Orchestrates context gathering for chat responses using RLM.
     * 
     * @param userPrompt The user's chat message
     * @param threadId The current chat thread ID
     * @param narrativeId (Optional) Narrative scope
     * @returns Context string containing RLM reasoning and results
     */
    async orchestrate(userPrompt: string, threadId: string, narrativeId: string = ''): Promise<string> {
        if (!userPrompt.trim()) return '';

        // Graceful degradation: require at least one LLM provider
        if (!this.openRouter.getApiKey()) {
            console.warn('[Orchestrator] No OpenRouter API key — skipping RLM loop');
            return '';
        }

        console.log(`[Orchestrator] Starting RLM loop for thread ${threadId}`);
        const startTime = Date.now();

        // unique workspace for this reasoning episode
        const workspaceId = `ws_${threadId}_${Date.now()}`;

        // Gather live app context before starting RLM loop
        let appContext: AppContext | undefined;
        try {
            appContext = await this.gatherAppContext(narrativeId || undefined);
            if (appContext) {
                console.log(`[Orchestrator] AppContext gathered: note=${appContext.activeNoteTitle}, entities=${appContext.nearbyEntities.length}`);
            }
        } catch (err) {
            console.warn('[Orchestrator] Failed to gather AppContext:', err);
        }

        const ctx: Partial<RLMContext> = {
            workspaceId,
            threadId,
            narrativeId,
            initialPrompt: userPrompt,
            maxDepth: 2, // Cost-safe default: 2 recursive calls max
            appContext, // Live application context for grounding
        };

        try {
            const result = await this.rlmService.run(ctx);

            if (!result.ok) {
                console.warn('[Orchestrator] RLM loop failed:', result.error);
                return '';
            }

            const latMs = Date.now() - startTime;
            console.log(`[Orchestrator] RLM loop completed in ${latMs}ms`, result);

            // Format context for the LLM
            return formatRlmContext(result, workspaceId);



        } catch (err) {
            console.error('[Orchestrator] Detailed error running RLM:', err);
            return '';
        }
    }
}
