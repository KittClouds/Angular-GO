// src/app/api/navigation-api.ts
// Navigation API - handles note/entity navigation from anywhere in the app
// Derived from reference_impl/src/api/navigation-api.ts

import type { Note } from './types';
import { smartGraphRegistry } from '../lib/registry';

// =============================================================================
// NAVIGATION API INTERFACE
// =============================================================================

export interface NavigationApi {
    /** Navigate to a note by ID */
    navigateToNoteById(noteId: string): void;

    /** Navigate to a note by title (searches for match) */
    navigateToNoteByTitle(title: string): void;

    /** Navigate to an entity by label (finds linked note) */
    navigateToEntityByLabel(label: string): void;

    /** Get current note ID */
    getCurrentNoteId(): string | null;

    /** Register a navigation handler (called by Index.tsx/EditorComponent) */
    onNavigate(handler: NavigateHandler): () => void;
}

export type NavigateHandler = (noteId: string) => void;

// =============================================================================
// DEFAULT IMPLEMENTATION
// =============================================================================

class DefaultNavigationApi implements NavigationApi {
    private handlers: Set<NavigateHandler> = new Set();
    private currentNoteId: string | null = null;
    private notes: Note[] = [];

    navigateToNoteById(noteId: string): void {
        console.log('[NavigationApi] Navigate to note by ID:', noteId);
        this.currentNoteId = noteId;
        this.notifyHandlers(noteId);
    }

    navigateToNoteByTitle(title: string): void {
        console.log('[NavigationApi] Navigate to note by title:', title);

        // Search in injected notes
        const note = this.findNoteByTitle(title);
        if (note) {
            this.navigateToNoteById(note.id);
        } else {
            console.warn(`[NavigationApi] Note not found: "${title}"`);
            // Could trigger "create note?" flow here
        }
    }

    navigateToEntityByLabel(label: string): void {
        console.log('[NavigationApi] Navigate to entity by label:', label);

        // First, check registry for entity
        const entity = smartGraphRegistry.findEntityByLabel(label);
        if (entity) {
            // If entity has a linked note, navigate to it
            if (entity.firstNote) {
                this.navigateToNoteById(entity.firstNote);
                return;
            }
            // Otherwise, find note with matching title/label
            const note = this.notes.find(n =>
                n.title.toLowerCase() === label.toLowerCase() ||
                (n.isEntity && n.entityKind && n.title.toLowerCase() === label.toLowerCase()) // Fallback: entityLabel logic is tricky if missing
            );
            if (note) {
                this.navigateToNoteById(note.id);
                return;
            }
        }

        // Fallback: try title match
        this.navigateToNoteByTitle(label);
    }

    getCurrentNoteId(): string | null {
        return this.currentNoteId;
    }

    onNavigate(handler: NavigateHandler): () => void {
        this.handlers.add(handler);
        return () => this.handlers.delete(handler);
    }

    /** Inject current notes state (called by app when notes change) */
    setNotes(notes: Note[]): void {
        this.notes = notes;
    }

    /** Set current note ID (called by app when note changes) */
    setCurrentNoteId(noteId: string | null): void {
        this.currentNoteId = noteId;
    }

    private notifyHandlers(noteId: string): void {
        this.handlers.forEach(handler => {
            try {
                handler(noteId);
            } catch (err) {
                console.error('[NavigationApi] Handler error:', err);
            }
        });
    }

    private findNoteByTitle(title: string): Note | null {
        const normalized = title.toLowerCase().trim();

        // Exact match
        const exact = this.notes.find(n => n.title.toLowerCase().trim() === normalized);
        if (exact) return exact;

        // Partial match fallback
        const partial = this.notes.find(n => n.title.toLowerCase().includes(normalized));
        return partial || null;
    }
}

// =============================================================================
// SINGLETON
// =============================================================================

const _instance = new DefaultNavigationApi();

export function getNavigationApi(): NavigationApi & {
    setNotes: (notes: Note[]) => void;
    setCurrentNoteId: (id: string | null) => void;
} {
    return _instance;
}
