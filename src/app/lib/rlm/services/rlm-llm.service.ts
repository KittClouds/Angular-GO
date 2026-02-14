/**
 * RLM LLM Service
 *
 * Thin wrapper over OpenRouterService for RLM-internal reasoning calls
 * (plan and evaluate steps). Reuses the chat API key but allows a
 * separate model selection via the `rlm:model` Dexie setting.
 */

import { Injectable, inject, signal, computed } from '@angular/core';
import { OpenRouterService, type OpenRouterMessage } from '../../services/openrouter.service';
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
    private openRouter: OpenRouterService;

    /** Currently selected RLM model ID */
    private _model = signal<string>(getSetting<string>(RLM_MODEL_KEY, DEFAULT_RLM_MODEL));

    readonly model = this._model.asReadonly();

    /** True when the underlying OpenRouter service has a valid API key */
    readonly isConfigured = computed(() => !!this.openRouter.getApiKey());

    constructor(openRouter?: OpenRouterService) {
        this.openRouter = openRouter || inject(OpenRouterService);
    }

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
     *
     * Constructs a user message and delegates to OpenRouterService.chat().
     * The system prompt is prepended by OpenRouter internally.
     */
    async complete(systemPrompt: string, userPrompt: string): Promise<string> {
        if (!this.isConfigured()) {
            throw new Error('[RlmLlm] OpenRouter API key not configured');
        }

        const messages: OpenRouterMessage[] = [
            { role: 'user', content: userPrompt },
        ];

        // OpenRouterService.chat(messages, systemPrompt?) — 2 args
        return this.openRouter.chat(messages, systemPrompt);
    }

    /**
     * Structured JSON completion with Zod validation.
     *
     * Appends a JSON instruction to the system prompt, parses the
     * response, and validates it against the given Zod schema.
     *
     * Handles models that wrap JSON in fenced code blocks (```json ... ```).
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

    /**
     * Strip fenced code blocks and surrounding whitespace so we get pure JSON.
     */
    private extractJSON(raw: string): string {
        let s = raw.trim();
        // Strip ```json ... ``` wrappers
        const fenced = s.match(/^```(?:json)?\s*([\s\S]*?)```$/);
        if (fenced) {
            s = fenced[1].trim();
        }
        return s;
    }
}
