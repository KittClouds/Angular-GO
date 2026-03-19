import { Injectable, inject, signal } from '@angular/core';
import { GoKittService } from './gokitt.service';
import { NoteEditorStore } from '../lib/store/note-editor.store';
import { smartGraphRegistry } from '../lib/registry';
import { getSetting, setSetting } from '../lib/dexie/settings.service';
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

@Injectable({
    providedIn: 'root'
})
export class NerService {
    private goKitt = inject(GoKittService);
    private noteStore = inject(NoteEditorStore);

    constructor() {
        // Init from Dexie settings
        const stored = getSetting<string | null>('ner_fst_enabled', null);
        if (stored !== null) {
            const enabled = stored === 'true';
            this.fstEnabled.set(enabled);
            _globalFstEnabled = enabled;
        }
    }

    // State
    readonly suggestions = signal<NerSuggestion[]>([]);
    readonly fstEnabled = signal<boolean>(true);
    readonly isAnalyzing = signal<boolean>(false);

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
            const rawSuggestions = await this.goKitt.scanDiscovery(text);
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

            // Set suggestions — Go WASM pipeline is the source of truth
            this.suggestions.set(filtered);
            this.isAnalyzing.set(false);
        } catch (e) {
            console.error('[NerService] Analysis failed', e);
            this.suggestions.set([]);
            this.isAnalyzing.set(false);
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
        setSetting('ner_fst_enabled', String(enabled));
        if (!enabled) {
            this.suggestions.set([]);
        }
        _globalFstEnabled = enabled;
        window.dispatchEvent(new CustomEvent('fst-toggle', { detail: { enabled } }));
    }
}

// Global accessor for non-Angular code
let _globalFstEnabled = true;
{
    const stored = getSetting<string | null>('ner_fst_enabled', null);
    if (stored !== null) {
        _globalFstEnabled = stored === 'true';
    }
}

export function isFstEnabled(): boolean {
    return _globalFstEnabled;
}
