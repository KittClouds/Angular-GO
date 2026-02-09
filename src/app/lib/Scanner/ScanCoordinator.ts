/**
 * ScanCoordinator - Orchestrates hybrid entity-event and delta scanning
 * 
 * The brain of the scanning system:
 * - Receives entity decorations (no blocking)
 * - EntityEventBus waits for punctuation/idle
 * - DeltaScanner computes minimal payload
 * - KittCore WASM does relationship extraction
 * - GraphRegistry receives new relationships
 */

import { EntityEventBus, type ScanRequest } from './EntityEventBus';
import { DeltaScanner } from './DeltaScanner';
import type { DecorationSpan } from './types';
import type { KittCoreService, EntitySpan, ExtractedRelation } from '../kittcore';

// =============================================================================
// TYPES
// =============================================================================

export interface ScanCoordinatorConfig {
    kittCore: Pick<KittCoreService, 'scan' | 'extractRelations'>;
    graphRegistry: {
        upsertRelationship: (rel: any) => void;
        registerEntity: (label: string, kind: any, noteId: string, options?: any) => any;
        findEntityByLabel?: (label: string) => any | null;
    };
    onNewRelations?: (relations: ExtractedRelation[]) => void;
    idleTimeoutMs?: number;
}

export interface ScanCoordinatorStats {
    entityEventsReceived: number;
    scansTriggered: number;
    relationsExtracted: number;
    errors: number;
}

// =============================================================================
// IMPLEMENTATION
// =============================================================================

export class ScanCoordinator {
    private config: ScanCoordinatorConfig;
    private eventBus: EntityEventBus;
    private deltaScanner: DeltaScanner;
    private recentScans: Map<string, number> = new Map(); // noteId -> timestamp
    private stats: ScanCoordinatorStats = {
        entityEventsReceived: 0,
        scansTriggered: 0,
        relationsExtracted: 0,
        errors: 0,
    };
    private disposed = false;

    constructor(config: ScanCoordinatorConfig) {
        this.config = config;

        // Wire up EntityEventBus
        this.eventBus = new EntityEventBus({
            onScanRequest: (req) => this.handleScanRequest(req),
            idleTimeoutMs: config.idleTimeoutMs,
        });

        // Wire up DeltaScanner
        this.deltaScanner = new DeltaScanner({
            wasmScan: async (payload) => {
                // For now, use extractRelations since it takes entities
                const entities: EntitySpan[] = payload.entities.map(e => ({
                    id: e.id,
                    label: e.label,
                    start: 0, // Position not needed for relation extraction
                    end: 0,
                }));
                const relations = await this.config.kittCore.extractRelations(
                    payload.content ?? '',
                    entities
                );
                return { relations };
            },
        });
    }

    // =========================================================================
    // PUBLIC API - Called from editor/highlighter
    // =========================================================================

    /**
     * Called when an entity is decorated in the editor.
     * This is in the hot path - must be instant.
     */
    onEntityDecoration(span: DecorationSpan, noteId: string): void {
        if (this.disposed) return;
        this.stats.entityEventsReceived++;

        // Register entity immediately for UI updates
        // Don't await - fire and forget
        // GUARD: Skip if already registered to prevent infinite loop
        // (dictionary-rebuilt → rescan → onEntityDecoration → registerEntity → notify → dictionary-rebuilt)
        if (span.type === 'entity' || span.type === 'entity_ref' || span.type === 'entity_implicit') {
            const label = span.label || '';
            // Check if already registered (sync check, no events)
            const alreadyKnown = this.config.graphRegistry.findEntityByLabel?.(label);
            if (!alreadyKnown) {
                this.config.graphRegistry.registerEntity(
                    label,
                    span.kind,
                    noteId,
                    { source: 'extraction' }
                );
            }
        } else if (span.type === 'relationship' || span.type === 'predicate') {
            // Handle Relationship Spans from Regex Scanner
            if (span.sourceEntity && span.targetEntity && span.label) {
                this.config.graphRegistry.upsertRelationship({
                    source: span.sourceEntity,
                    target: span.targetEntity,
                    type: span.label, // or span.verb
                    sourceNote: noteId
                });
            }
        }

        this.eventBus.onEntityDetected(span, noteId);
    }

    /**
     * Called on keystroke.
     */
    onKeystroke(char: string, cursorPos: number, contextText: string, noteId: string): void {
        if (this.disposed) return;
        this.eventBus.onKeystroke(char, cursorPos, contextText);
    }

    /**
     * Called when document content changes (for delta tracking).
     */
    onDocumentChange(noteId: string, content: string): void {
        // Just tracking - actual scan happens via entity events
    }

    /**
     * Called when a note is opened - triggers full scan.
     */
    async onNoteOpen(noteId: string, content: string, entities: DecorationSpan[]): Promise<void> {
        console.log(`[ScanCoordinator] onNoteOpen: noteId=${noteId}, contentLen=${content?.length ?? 'undefined'}, entities=${entities.length}`);
        if (this.disposed) return;

        // Skip if recently scanned
        const lastScan = this.recentScans.get(noteId);
        if (lastScan && Date.now() - lastScan < 1000) {
            return;
        }

        try {
            const entitySpans: EntitySpan[] = entities.map(e => ({
                id: e.entityId ?? e.label,
                label: e.label ?? '',
                start: e.from,
                end: e.to,
            }));

            await this.config.kittCore.scan(content, entitySpans);
            this.recentScans.set(noteId, Date.now());
        } catch (err) {
            console.error('[ScanCoordinator] Full scan error:', err);
            this.stats.errors++;
        }
    }

    /**
     * Get stats
     */
    getStats(): ScanCoordinatorStats {
        return { ...this.stats };
    }

    /**
     * Cleanup
     */
    dispose(): void {
        this.disposed = true;
        this.eventBus.dispose();
    }

    // =========================================================================
    // PRIVATE
    // =========================================================================

    private async handleScanRequest(request: ScanRequest): Promise<void> {
        if (this.disposed) return;

        // Guard: Skip scan if no text provided (idle flush without context)
        if (!request.sentenceText || request.sentenceText.length === 0) {
            // Expected during idle flushes without content context
            return;
        }

        try {
            this.stats.scansTriggered++;

            const entitySpans: EntitySpan[] = request.entities.map(e => ({
                id: e.entityId ?? e.label,
                label: e.label ?? '',
                start: e.from,
                end: e.to,
            }));

            const relations = await this.config.kittCore.extractRelations(
                request.sentenceText,
                entitySpans
            );

            if (relations.length > 0) {
                this.stats.relationsExtracted += relations.length;

                // Upsert to graph
                for (const rel of relations) {
                    this.config.graphRegistry.upsertRelationship(rel);
                }

                // Emit callback
                this.config.onNewRelations?.(relations);
            }
        } catch (err) {
            console.error('[ScanCoordinator] Scan error:', err);
            this.stats.errors++;
        }
    }
}
