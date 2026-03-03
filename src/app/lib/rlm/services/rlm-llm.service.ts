/**
 * RLM LLM Service
 *
 * Thin wrapper over GoChatService for RLM-internal reasoning calls
 * (plan and evaluate steps). Reuses the Go OpenRouter pipeline so
 * there is a single LLM path in the application.
 */

import { Injectable, inject, signal, computed } from '@angular/core';
import { GoChatService } from '../../services/go-chat.service';
import { getSetting, setSetting } from '../../dexie/settings.service';
import type { ZodSchema, ZodError } from 'zod';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const RLM_MODEL_KEY = 'rlm:model';
const DEFAULT_RLM_MODEL = 'z-ai/glm-4.5-air:free';

// ---------------------------------------------------------------------------
// Service
// ---------------------------------------------------------------------------

@Injectable({ providedIn: 'root' })
export class RlmLlmService {
    private goChatService = inject(GoChatService);

    /** Currently selected RLM model ID */
    private _model = signal<string>(getSetting<string>(RLM_MODEL_KEY, DEFAULT_RLM_MODEL));

    readonly model = this._model.asReadonly();

    /** True when the Go OpenRouter config has been saved (has an API key) */
    readonly isConfigured = computed(() => {
        const cfg = getSetting<{ apiKey?: string } | null>('openrouter:config', null);
        return !!cfg?.apiKey;
    });

    // -------------------------------------------------------------------------
    // Configuration
    // -------------------------------------------------------------------------

    /** Persist a new model choice for RLM reasoning. */
    setModel(modelId: string): void {
        this._model.set(modelId);
        setSetting(RLM_MODEL_KEY, modelId);
    }

    /** Get the active model ID. */
    getModel(): string {
        return this._model();
    }

    // -------------------------------------------------------------------------
    // LLM Calls
    // -------------------------------------------------------------------------

    /**
     * Non-streaming completion for plan / evaluate steps.
     * Collects all chunks from the Go stream and returns the full response.
     */
    async complete(systemPrompt: string, userPrompt: string): Promise<string> {
        if (!this.isConfigured()) {
            throw new Error('[RlmLlm] Go OpenRouter not configured — set API key in AI Chat settings');
        }

        return new Promise<string>((resolve, reject) => {
            this.goChatService.streamChat(
                [{ role: 'user', content: userPrompt }],
                {
                    onChunk: () => { /* Streaming — we collect on complete */ },
                    onComplete: (full) => resolve(full),
                    onError: (err) => reject(err),
                },
                systemPrompt
            );
        });
    }

    /**
     * Structured JSON completion with Zod validation.
     */
    async completeJSON<T>(
        systemPrompt: string,
        userPrompt: string,
        schema: ZodSchema<T>,
    ): Promise<T> {
        const jsonSystemPrompt =
            systemPrompt +
            '\n\nIMPORTANT: Respond ONLY with valid JSON matching the requested schema. No surrounding text.';

        const raw = await this.complete(jsonSystemPrompt, userPrompt);
        const cleaned = this.extractJSON(raw);

        try {
            const parsed: unknown = JSON.parse(cleaned);
            return schema.parse(parsed) as T;
        } catch (err) {
            const zodErr = err as ZodError;
            throw new Error(
                `[RlmLlm] JSON parse/validation failed: ${zodErr.message ?? String(err)}\nRaw: ${raw.slice(0, 500)}`,
            );
        }
    }

    // -------------------------------------------------------------------------
    // Helpers
    // -------------------------------------------------------------------------

    private extractJSON(raw: string): string {
        let s = raw.trim();
        const fenced = s.match(/^```(?:json)?\s*([\s\S]*?)```$/);
        if (fenced) {
            s = fenced[1].trim();
        }
        return s;
    }
}
