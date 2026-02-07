import { Injectable, inject, signal } from '@angular/core';
import { GoKittService } from './gokitt.service';
import { NoteEditorStore } from '../lib/store/note-editor.store';
import { smartGraphRegistry } from '../lib/registry';
import { OpenRouterService } from '../lib/services/openrouter.service';
import { v4 as uuidv4 } from 'uuid';

export interface NerSuggestion {
    id: string;
    label: string;
    kind: string;
    confidence: number;
    context?: string;
    llmEnhanced?: boolean;      // Was this refined by LLM?
    llmReasoning?: string;      // LLM explanation for the classification
}

interface LlmEntityResult {
    label: string;
    kind: string;
    confidence: number;
    reasoning: string;
    isValid: boolean;
}

@Injectable({
    providedIn: 'root'
})
export class NerService {
    private goKitt = inject(GoKittService);
    private noteStore = inject(NoteEditorStore);
    private openRouter = inject(OpenRouterService);

    constructor() {
        // Init from localStorage
        if (typeof localStorage !== 'undefined') {
            const stored = localStorage.getItem('ner_fst_enabled');
            if (stored !== null) {
                const enabled = stored === 'true';
                this.fstEnabled.set(enabled);
                _globalFstEnabled = enabled;
            }
            const llmStored = localStorage.getItem('ner_llm_enabled');
            if (llmStored !== null) {
                this.llmEnabled.set(llmStored === 'true');
            }
        }
    }

    // State
    readonly suggestions = signal<NerSuggestion[]>([]);
    readonly fstEnabled = signal<boolean>(true);
    readonly llmEnabled = signal<boolean>(true);  // LLM enhancement toggle
    readonly isAnalyzing = signal<boolean>(false);
    readonly isLlmProcessing = signal<boolean>(false);

    private currentText = '';

    // -------------------------------------------------------------------------
    // Main Analysis Pipeline
    // -------------------------------------------------------------------------

    async analyzeNote(text: string) {
        if (!this.fstEnabled()) {
            console.log('[NerService] FST disabled, skipping analysis');
            return;
        }

        this.currentText = text;
        this.isAnalyzing.set(true);
        console.log(`[NerService] Analyzing text (${text.length} chars)`);

        try {
            // Step 1: GoKitt unsupervised NER
            const rawSuggestions = this.goKitt.scanDiscovery(text);
            console.log('[NerService] Raw suggestions from GoKitt:', rawSuggestions);

            if (!rawSuggestions || !Array.isArray(rawSuggestions)) {
                console.log('[NerService] No suggestions returned');
                this.suggestions.set([]);
                return;
            }

            // Map GoKitt results
            let mapped: NerSuggestion[] = rawSuggestions.map((s: any) => ({
                id: uuidv4(),
                label: s.token || s.Token || 'Unknown',
                kind: s.kind || s.Kind || 'UNKNOWN',
                confidence: s.score || s.Score || 0.8,
                context: s.snippet,
                llmEnhanced: false,
            }));

            // Filter known entities
            const filtered = mapped.filter(s => {
                const isKnown = smartGraphRegistry.isRegisteredEntity(s.label);
                const raw = rawSuggestions.find((r: any) => (r.token || r.Token) === s.label);
                const isPromoted = raw && (raw.status === 1 || raw.Status === 1);
                return !isKnown && !isPromoted;
            });

            console.log(`[NerService] Mapped ${mapped.length}, Filtered to ${filtered.length}`);

            // Set initial suggestions
            this.suggestions.set(filtered);
            this.isAnalyzing.set(false);

            // Step 2: LLM enhancement (async, non-blocking)
            if (this.llmEnabled() && this.openRouter.isConfigured() && filtered.length > 0) {
                this.enhanceWithLlm(filtered, text);
            }
        } catch (e) {
            console.error('[NerService] Analysis failed', e);
            this.suggestions.set([]);
            this.isAnalyzing.set(false);
        }
    }

    // -------------------------------------------------------------------------
    // LLM Enhancement
    // -------------------------------------------------------------------------

    private async enhanceWithLlm(candidates: NerSuggestion[], noteText: string) {
        if (!this.openRouter.isConfigured()) return;

        this.isLlmProcessing.set(true);
        console.log('[NerService] Enhancing with LLM...');

        try {
            const prompt = this.buildLlmPrompt(candidates, noteText);

            let result = '';
            await this.openRouter.streamChat(
                [{ role: 'user', content: prompt }],
                {
                    onChunk: (chunk) => { result += chunk; },
                    onComplete: (fullResponse) => {
                        const enhanced = this.parseLlmResponse(fullResponse, candidates);
                        this.suggestions.set(enhanced);
                        this.isLlmProcessing.set(false);
                        console.log('[NerService] LLM enhancement complete');
                    },
                    onError: (error) => {
                        console.error('[NerService] LLM enhancement failed:', error);
                        this.isLlmProcessing.set(false);
                    },
                },
                this.getLlmSystemPrompt()
            );
        } catch (e) {
            console.error('[NerService] LLM enhancement error:', e);
            this.isLlmProcessing.set(false);
        }
    }

    private getLlmSystemPrompt(): string {
        return `You are a Named Entity Recognition expert analyzing text for a world-building/fiction writing application.

Your task is to evaluate entity candidates and:
1. Confirm or reject each candidate as a valid named entity
2. Suggest the most appropriate entity type
3. Provide a confidence score (0.0 to 1.0)
4. Brief reasoning for your decision

Entity types: CHARACTER, LOCATION, FACTION, EVENT, CONCEPT, ITEM, CREATURE, NPC

Respond in JSON format only:
{
  "entities": [
    {"label": "...", "kind": "...", "confidence": 0.95, "reasoning": "...", "isValid": true/false}
  ]
}`;
    }

    private buildLlmPrompt(candidates: NerSuggestion[], noteText: string): string {
        const candidateList = candidates.map(c => `- "${c.label}" (current guess: ${c.kind}, score: ${c.confidence.toFixed(2)})`).join('\n');

        // Truncate note text if too long
        const maxContext = 2000;
        const context = noteText.length > maxContext
            ? noteText.slice(0, maxContext) + '...[truncated]'
            : noteText;

        return `Analyze these entity candidates from a world-building document:

CANDIDATES:
${candidateList}

DOCUMENT CONTEXT:
${context}

Evaluate each candidate. Return JSON with your analysis.`;
    }

    private parseLlmResponse(response: string, original: NerSuggestion[]): NerSuggestion[] {
        try {
            // Extract JSON from response (handle markdown code blocks)
            let jsonStr = response;
            const jsonMatch = response.match(/```(?:json)?\s*([\s\S]*?)```/);
            if (jsonMatch) {
                jsonStr = jsonMatch[1];
            }

            const parsed = JSON.parse(jsonStr);
            const llmEntities: LlmEntityResult[] = parsed.entities || [];

            // Merge LLM results with original candidates
            return original.map(candidate => {
                const llmResult = llmEntities.find(e =>
                    e.label.toLowerCase() === candidate.label.toLowerCase()
                );

                if (llmResult) {
                    return {
                        ...candidate,
                        kind: llmResult.kind || candidate.kind,
                        confidence: llmResult.confidence || candidate.confidence,
                        llmEnhanced: true,
                        llmReasoning: llmResult.reasoning,
                    };
                }
                return candidate;
            }).filter(c => {
                // Remove candidates that LLM marked as invalid
                const llmResult = llmEntities.find(e =>
                    e.label.toLowerCase() === c.label.toLowerCase()
                );
                return !llmResult || llmResult.isValid !== false;
            });
        } catch (e) {
            console.warn('[NerService] Failed to parse LLM response:', e);
            return original;
        }
    }

    // -------------------------------------------------------------------------
    // Suggestion Actions
    // -------------------------------------------------------------------------

    async acceptSuggestion(id: string) {
        const suggestion = this.suggestions().find(s => s.id === id);
        if (!suggestion) return;

        const replacement = `[${suggestion.kind}|${suggestion.label}]`;
        console.log('[NerService] Accepting:', replacement);

        // Remove from suggestions
        this.suggestions.update(list => list.filter(s => s.id !== id));

        // Register in smart graph
        const currentNote = this.noteStore.currentNote();
        const noteId = currentNote?.id || 'unknown';
        smartGraphRegistry.registerEntity(
            suggestion.label,
            suggestion.kind as any,
            noteId,
            { source: 'user' }
        );
    }

    async rejectSuggestion(id: string) {
        this.suggestions.update(list => list.filter(s => s.id !== id));
    }

    // -------------------------------------------------------------------------
    // Toggle Controls
    // -------------------------------------------------------------------------

    toggleFst(enabled: boolean) {
        this.fstEnabled.set(enabled);
        if (typeof localStorage !== 'undefined') {
            localStorage.setItem('ner_fst_enabled', String(enabled));
        }
        if (!enabled) {
            this.suggestions.set([]);
        }
        _globalFstEnabled = enabled;
        window.dispatchEvent(new CustomEvent('fst-toggle', { detail: { enabled } }));
    }

    toggleLlm(enabled: boolean) {
        this.llmEnabled.set(enabled);
        if (typeof localStorage !== 'undefined') {
            localStorage.setItem('ner_llm_enabled', String(enabled));
        }
    }
}

// Global accessor for non-Angular code
let _globalFstEnabled = true;
if (typeof localStorage !== 'undefined') {
    const stored = localStorage.getItem('ner_fst_enabled');
    if (stored !== null) {
        _globalFstEnabled = stored === 'true';
    }
}

export function isFstEnabled(): boolean {
    return _globalFstEnabled;
}
