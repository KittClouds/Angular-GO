/**
 * EntityEventBus - Collects entity events and triggers on punctuation/idle
 * 
 * Part of the hybrid scanning architecture:
 * - Receives entity decorations from highlighter (no blocking)
 * - Waits for sentence boundary or idle timeout
 * - Emits scan request with batched entities
 */

import type { DecorationSpan } from './types';

// =============================================================================
// TYPES
// =============================================================================

export interface EntityEvent {
    span: DecorationSpan;
    noteId: string;
    timestamp: number;
}

export interface ScanRequest {
    noteId: string;
    entities: DecorationSpan[];
    sentenceText?: string;
    trigger: 'punctuation' | 'idle' | 'note-change' | 'manual';
    timestamp: number;
}

export interface EntityEventBusConfig {
    onScanRequest: (request: ScanRequest) => void;
    idleTimeoutMs?: number;
}

// =============================================================================
// IMPLEMENTATION
// =============================================================================

export class EntityEventBus {
    private config: Required<EntityEventBusConfig>;
    private pendingEntities: Map<string, EntityEvent> = new Map();
    private processedRanges: Set<string> = new Set();
    private idleTimer: ReturnType<typeof setTimeout> | null = null;
    private currentNoteId: string | null = null;
    private disposed = false;

    constructor(config: EntityEventBusConfig) {
        this.config = {
            idleTimeoutMs: config.idleTimeoutMs ?? 500,
            onScanRequest: config.onScanRequest,
        };
    }

    // =========================================================================
    // PUBLIC API
    // =========================================================================

    get pendingCount(): number {
        return this.pendingEntities.size;
    }

    /**
     * Called when an entity is detected/decorated in the editor.
     * Does NOT trigger scanning - just queues for later.
     */
    onEntityDetected(span: DecorationSpan, noteId: string): void {
        if (this.disposed) return;

        const rangeKey = this.makeRangeKey(span, noteId);

        // Just add to pending - dedup happens at flush time with context
        this.pendingEntities.set(rangeKey, {
            span,
            noteId,
            timestamp: Date.now(),
        });

        this.currentNoteId = noteId;
        this.resetIdleTimer();
    }

    /**
     * Called on each keystroke. Checks for punctuation trigger.
     */
    onKeystroke(char: string, cursorPos: number, contextText: string): void {
        if (this.disposed) return;
        if (this.pendingEntities.size === 0) return;

        this.resetIdleTimer();

        // Check for sentence-ending punctuation
        if (this.isSentenceEnd(char)) {
            this.flush('punctuation', contextText);
        }
    }

    /**
     * Called when user switches to a different note.
     */
    onNoteChange(newNoteId: string): void {
        if (this.disposed) return;

        if (this.pendingEntities.size > 0 && this.currentNoteId !== newNoteId) {
            this.flush('note-change');
        }

        this.currentNoteId = newNoteId;
    }

    /**
     * Cleanup
     */
    dispose(): void {
        this.disposed = true;
        this.clearIdleTimer();
        this.pendingEntities.clear();
    }

    // =========================================================================
    // PRIVATE
    // =========================================================================

    private makeRangeKey(span: DecorationSpan, noteId: string): string {
        return `${noteId}:${span.from}:${span.to}:${span.label}`;
    }

    private makeProcessedKey(span: DecorationSpan, noteId: string, contextText?: string): string {
        const contextHash = contextText ? this.simpleHash(contextText) : '';
        return `${noteId}:${span.from}:${span.to}:${span.label}:${contextHash}`;
    }

    private simpleHash(s: string): string {
        let h = 0;
        for (let i = 0; i < s.length; i++) {
            h = ((h << 5) - h) + s.charCodeAt(i);
            h = h & h;
        }
        return h.toString(36);
    }

    private isSentenceEnd(char: string): boolean {
        return /[.!?]/.test(char);
    }

    private resetIdleTimer(): void {
        this.clearIdleTimer();
        this.idleTimer = setTimeout(() => {
            if (this.pendingEntities.size > 0) {
                this.flush('idle');
            }
        }, this.config.idleTimeoutMs);
    }

    private clearIdleTimer(): void {
        if (this.idleTimer) {
            clearTimeout(this.idleTimer);
            this.idleTimer = null;
        }
    }

    private flush(trigger: ScanRequest['trigger'], contextText?: string): void {
        if (this.pendingEntities.size === 0) return;

        const noteId = this.currentNoteId;
        if (!noteId) return;

        // Filter to note-specific entities that haven't been processed with this context
        const entities = Array.from(this.pendingEntities.values())
            .filter(e => e.noteId === noteId)
            .filter(e => {
                const processedKey = this.makeProcessedKey(e.span, noteId, contextText);
                return !this.processedRanges.has(processedKey);
            })
            .map(e => e.span);

        if (entities.length === 0) {
            // All entities already processed with this context - just clear pending
            for (const key of Array.from(this.pendingEntities.keys())) {
                const event = this.pendingEntities.get(key);
                if (event?.noteId === noteId) {
                    this.pendingEntities.delete(key);
                }
            }
            return;
        }

        // Mark as processed (with context so same entity + different sentence can trigger again)
        for (const [key, event] of this.pendingEntities.entries()) {
            if (event.noteId === noteId) {
                const processedKey = this.makeProcessedKey(event.span, noteId, contextText);
                this.processedRanges.add(processedKey);
            }
        }

        // Clear pending for this note
        for (const key of Array.from(this.pendingEntities.keys())) {
            const event = this.pendingEntities.get(key);
            if (event?.noteId === noteId) {
                this.pendingEntities.delete(key);
            }
        }

        this.clearIdleTimer();

        // Emit
        this.config.onScanRequest({
            noteId,
            entities,
            sentenceText: contextText,
            trigger,
            timestamp: Date.now(),
        });
    }
}
