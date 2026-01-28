import { Injectable, inject, signal, computed } from '@angular/core';
import { GoKittService } from './gokitt.service';
import { NoteEditorStore } from '../lib/store/note-editor.store';
import { v4 as uuidv4 } from 'uuid';

export interface NerSuggestion {
    id: string;
    label: string;
    kind: string;
    confidence: number;
    context?: string;
}

@Injectable({
    providedIn: 'root'
})
export class NerService {
    private goKitt = inject(GoKittService);
    private noteStore = inject(NoteEditorStore);

    // State
    readonly suggestions = signal<NerSuggestion[]>([]);
    readonly fstEnabled = signal<boolean>(true);
    readonly isAnalyzing = signal<boolean>(false);

    // Current note content
    private currentText = '';

    analyzeNote(text: string) {
        if (!this.fstEnabled()) {
            console.log('[NerService] FST disabled, skipping analysis');
            return;
        }

        this.currentText = text;
        this.isAnalyzing.set(true);
        console.log(`[NerService] Analyzing text (${text.length} chars)`);

        try {
            // Using GoKitt WASM
            // scanDiscovery returns: { token, score, status, kind }
            const rawSuggestions = this.goKitt.scanDiscovery(text);
            console.log('[NerService] Raw suggestions from GoKitt:', rawSuggestions);

            // Handle null/empty results
            if (!rawSuggestions || !Array.isArray(rawSuggestions)) {
                console.log('[NerService] No suggestions returned');
                this.suggestions.set([]);
                return;
            }

            const mapped: NerSuggestion[] = rawSuggestions.map((s: any) => ({
                id: uuidv4(),
                label: s.token || s.Token || 'Unknown', // Go returns 'token'
                kind: s.kind || s.Kind || 'UNKNOWN',
                confidence: s.score || s.Score || 0.8, // Go returns 'score'
                context: s.snippet
            }));

            console.log(`[NerService] Mapped ${mapped.length} suggestions:`, mapped);

            // Filter out extremely low confidence if needed
            this.suggestions.set(mapped);
        } catch (e) {
            console.error('[NerService] Analysis failed', e);
            this.suggestions.set([]);
        } finally {
            this.isAnalyzing.set(false);
        }
    }

    async acceptSuggestion(id: string) {
        const suggestion = this.suggestions().find(s => s.id === id);
        if (!suggestion) return;

        // Perform replacement in the text
        // We construct the bracket syntax: [KIND|Label]
        const replacement = `[${suggestion.kind}|${suggestion.label}]`;

        // Update the note content via the store
        // We need to fetch the current content from the store or track it
        const currentNote = this.noteStore.currentNote(); // Assuming this is available or we subscribe
        if (currentNote) {
            // Simple replaceAll for now (Refine later for specific occurrence)
            // Note: This is destructive if simply doing generic replace on the whole body
            // ideally we replace the specific instance provided by 'context' or index
            // But for MVP:

            // We'll rely on the editor to handle this if possible, otherwise:
            // This is complex. React implementation might have used ProseMirror commands?
            // "onAccept" in React reference might have just done text replacement.

            // Let's assume we replace the first occurrence or all?
            // "useNotesStore" in React impl suggests full update.
            // Let's try to get current content.

            // Note: noteStore might not expose raw content directly if it's in Editor
            // For now, let's just log implementation
            console.log('[NerService] Accepting:', replacement);

            // Remove from list
            this.suggestions.update(list => list.filter(s => s.id !== id));

            // TODO: dispatch update to editor
            // this.noteStore.updateContent(updatedText); 
        }
    }

    async rejectSuggestion(id: string) {
        this.suggestions.update(list => list.filter(s => s.id !== id));
    }

    toggleFst(enabled: boolean) {
        this.fstEnabled.set(enabled);
        if (!enabled) {
            this.suggestions.set([]);
        }
    }
}
