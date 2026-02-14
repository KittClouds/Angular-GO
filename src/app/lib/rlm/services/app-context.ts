/**
 * AppContext - Live application state for RLM observe step
 *
 * The RLM observe step is blind to the live application state. This type
 * provides the context of what the user is currently focused on - the open note,
 * its folder hierarchy, and relevant entities.
 *
 * This grounds the first observation in the user's current context rather than
 * starting from a blank query.
 */

/**
 * Snapshot of an entity relevant to the current context.
 */
export interface EntitySnapshot {
    /** Entity ID */
    id: string;
    /** Display label */
    label: string;
    /** Entity kind (person, place, thing, etc.) */
    kind: string;
    /** Optional subtype for more specific categorization */
    subtype: string | null;
}

/**
 * Live application context for RLM reasoning.
 *
 * Populated by the Orchestrator before starting an RLM loop by reading
 * from NoteEditorStore and running Cozo queries for folder path and entities.
 */
export interface AppContext {
    /** ID of the currently open note (null if no note open) */
    activeNoteId: string | null;
    /** Title of the active note */
    activeNoteTitle: string | null;
    /** First 500 chars of markdown content for context */
    activeNoteSnippet: string | null;
    /** World ID (from note or global scope) */
    worldId: string;
    /** Narrative/vault ID if the note belongs to one */
    narrativeId: string | null;
    /** Folder ID containing the active note */
    folderId: string | null;
    /** Folder path from root to current folder (e.g., ["Characters", "Protagonists"]) */
    folderPath: string[];
    /** Entities mentioned in or relevant to the open note */
    nearbyEntities: EntitySnapshot[];
}

/**
 * Factory function to create an empty AppContext.
 * Used as fallback when no note is open.
 */
export function emptyAppContext(worldId: string = ''): AppContext {
    return {
        activeNoteId: null,
        activeNoteTitle: null,
        activeNoteSnippet: null,
        worldId,
        narrativeId: null,
        folderId: null,
        folderPath: [],
        nearbyEntities: [],
    };
}

/**
 * Check if AppContext has an active note.
 */
export function hasActiveNote(ctx: AppContext): boolean {
    return ctx.activeNoteId !== null;
}

/**
 * Get a human-readable context summary for logging/debugging.
 */
export function summarizeAppContext(ctx: AppContext): string {
    const parts: string[] = [];

    if (ctx.activeNoteTitle) {
        parts.push(`note: "${ctx.activeNoteTitle}"`);
    }
    if (ctx.folderPath.length > 0) {
        parts.push(`folder: ${ctx.folderPath.join(' > ')}`);
    }
    if (ctx.narrativeId) {
        parts.push(`vault: ${ctx.narrativeId}`);
    }
    if (ctx.nearbyEntities.length > 0) {
        parts.push(`entities: ${ctx.nearbyEntities.length}`);
    }

    return parts.length > 0 ? parts.join(', ') : 'no active context';
}