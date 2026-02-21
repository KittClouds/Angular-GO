/**
 * RLM Orchestrator Service
 *
 * Thin Angular wrapper around the Go workspace sandbox.
 * Replaces the 4 CozoDB-dependent services (rlm-loop, query-runner,
 * workspace-ops, retrieval) with ~100 lines that delegate everything
 * to WASM via GoKitt.chatProcessWithWorkspace.
 */

import { Injectable, inject, signal } from '@angular/core';
import { GoKittService } from '../../../services/gokitt.service';

// ============================================================================
// Types (mirror Go's ActivationResult + ToolResult)
// ============================================================================

export interface ToolCallResult {
    tool: string;
    ok: boolean;
    data?: unknown;
    error?: string;
    lat_ms: number;
}

export interface ActivationResult {
    /** Whether the workspace actually fired */
    triggered: boolean;
    /** Why it fired (keyword overlap score vs. threshold) */
    miss_reason?: string;
    /** Tools that were called */
    tool_calls?: ToolCallResult[];
    /** Compact summary of resurfaced context */
    summary?: string;
    /** The full observation that was injected into OMRecord */
    new_observation?: string;
    /** Error from the Go side, if any */
    error?: string;
}

// ============================================================================
// Service
// ============================================================================

@Injectable({ providedIn: 'root' })
export class RlmOrchestratorService {
    private readonly goKitt = inject(GoKittService);

    /** True while a workspace activation is in-flight */
    readonly isActivating = signal(false);

    /** The most recent activation result */
    readonly lastActivation = signal<ActivationResult | null>(null);

    /**
     * Run the OM loop for a thread, then check for miss signal.
     * If miss fires, workspace activates: searches notes/episodes,
     * injects resurfaced context back into OMRecord observations.
     *
     * Fire-and-forget safe — returns the activation result but
     * callers can ignore it for normal chat flow.
     *
     * @param threadId   The chat thread ID (source of OM record)
     * @param scopeId    Narrative/world ID for episode search scope
     * @param userPrompt The incoming user message (miss-signal query)
     */
    async processWithWorkspace(
        threadId: string,
        scopeId: string,
        userPrompt: string
    ): Promise<ActivationResult> {
        if (!this.goKitt.isReady) {
            console.warn('[RlmOrchestrator] GoKitt not ready, skipping workspace');
            return { triggered: false };
        }

        this.isActivating.set(true);

        try {
            const raw = await this.goKitt.chatProcessWithWorkspace(threadId, scopeId, userPrompt);

            const result: ActivationResult = JSON.parse(raw);
            this.lastActivation.set(result);

            if (result.triggered) {
                console.log(
                    `[RlmOrchestrator] Workspace activated. Reason: ${result.miss_reason}`,
                    `Tools: ${result.tool_calls?.length ?? 0}`,
                    `Summary: ${result.summary?.slice(0, 80)}…`
                );
            }

            return result;
        } catch (err) {
            const error = err instanceof Error ? err.message : String(err);
            console.error('[RlmOrchestrator] processWithWorkspace error:', error);
            const result: ActivationResult = { triggered: false, error };
            this.lastActivation.set(result);
            return result;
        } finally {
            this.isActivating.set(false);
        }
    }

    /**
     * Retrieve the current observational memory context for a thread.
     * This is the same data the LLM system prompt injects.
     */
    async getContext(threadId: string): Promise<string> {
        if (!this.goKitt.isReady) return '';
        try {
            const raw = await this.goKitt.chatGetContext(threadId);
            return raw;
        } catch {
            return '';
        }
    }
}
