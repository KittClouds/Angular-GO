/**
 * DeltaScanner - Computes document deltas for incremental WASM scanning
 * 
 * Part of the hybrid scanning architecture:
 * - Tracks document content per note
 * - Computes minimal diff on changes
 * - Sends only new/changed content to WASM
 */

import type { EntitySpan, ExtractedRelation } from '../../lib/kittcore';

// =============================================================================
// TYPES
// =============================================================================

export interface DocumentDelta {
    inserts: { pos: number; text: string }[];
    deletes: { from: number; to: number }[];
}

export interface WasmScanPayload {
    noteId: string;
    isFullScan: boolean;
    content?: string;
    delta?: DocumentDelta;
    entities: EntitySpan[];
    newEntities?: EntitySpan[];
}

export interface DeltaScanResult {
    newRelations: ExtractedRelation[];
    stats: {
        deltaSize: number;
        scanTimeMs: number;
    };
}

export interface NoteState {
    content: string;
    hash: string;
    entityIds: Set<string>;
    lastScanTime: number;
    stats: {
        totalScans: number;
        fullScans: number;
        deltaScans: number;
    };
}

export interface DeltaScannerConfig {
    wasmScan: (payload: WasmScanPayload) => Promise<{ relations: ExtractedRelation[] }>;
}

export interface ScanOptions {
    force?: boolean;
}

// =============================================================================
// IMPLEMENTATION
// =============================================================================

export class DeltaScanner {
    private config: DeltaScannerConfig;
    private noteStates: Map<string, NoteState> = new Map();

    constructor(config: DeltaScannerConfig) {
        this.config = config;
    }

    // =========================================================================
    // PUBLIC API
    // =========================================================================

    async scan(
        noteId: string,
        content: string,
        entities: EntitySpan[],
        options?: ScanOptions
    ): Promise<DeltaScanResult> {
        const hash = this.fastHash(content);
        const existingState = this.noteStates.get(noteId);

        // Check if we need to scan
        if (!options?.force && existingState && existingState.hash === hash) {
            return { newRelations: [], stats: { deltaSize: 0, scanTimeMs: 0 } };
        }

        const startTime = Date.now();
        let payload: WasmScanPayload;
        let isFullScan = true;

        if (!existingState || options?.force) {
            // First scan or forced - full content
            payload = {
                noteId,
                isFullScan: true,
                content,
                entities,
            };
        } else {
            // Incremental - compute delta
            const delta = this.computeDelta(existingState.content, content);
            const newEntities = entities.filter(e => !existingState.entityIds.has(e.id || e.label));

            payload = {
                noteId,
                isFullScan: false,
                delta,
                entities,
                newEntities,
            };
            isFullScan = false;
        }

        // Call WASM
        const result = await this.config.wasmScan(payload);

        // Update state
        const stats = existingState?.stats ?? { totalScans: 0, fullScans: 0, deltaScans: 0 };
        stats.totalScans++;
        if (isFullScan) {
            stats.fullScans++;
        } else {
            stats.deltaScans++;
        }

        this.noteStates.set(noteId, {
            content,
            hash,
            entityIds: new Set(entities.map(e => e.id || e.label)),
            lastScanTime: Date.now(),
            stats,
        });

        const scanTimeMs = Date.now() - startTime;
        const deltaSize = payload.delta
            ? payload.delta.inserts.reduce((acc, i) => acc + i.text.length, 0) +
            payload.delta.deletes.length
            : content.length;

        return {
            newRelations: result.relations,
            stats: { deltaSize, scanTimeMs },
        };
    }

    getStats(noteId: string): NoteState['stats'] | null {
        return this.noteStates.get(noteId)?.stats ?? null;
    }

    clearNote(noteId: string): void {
        this.noteStates.delete(noteId);
    }

    // =========================================================================
    // PRIVATE
    // =========================================================================

    private fastHash(content: string): string {
        // Simple hash for quick comparison
        let hash = 0;
        for (let i = 0; i < content.length; i++) {
            const char = content.charCodeAt(i);
            hash = ((hash << 5) - hash) + char;
            hash = hash & hash;
        }
        return hash.toString(36);
    }

    private computeDelta(oldContent: string, newContent: string): DocumentDelta {
        const delta: DocumentDelta = { inserts: [], deletes: [] };

        // Simple diff: find common prefix and suffix
        let prefixLen = 0;
        while (
            prefixLen < oldContent.length &&
            prefixLen < newContent.length &&
            oldContent[prefixLen] === newContent[prefixLen]
        ) {
            prefixLen++;
        }

        let oldSuffixStart = oldContent.length;
        let newSuffixStart = newContent.length;
        while (
            oldSuffixStart > prefixLen &&
            newSuffixStart > prefixLen &&
            oldContent[oldSuffixStart - 1] === newContent[newSuffixStart - 1]
        ) {
            oldSuffixStart--;
            newSuffixStart--;
        }

        // What was deleted
        if (oldSuffixStart > prefixLen) {
            delta.deletes.push({ from: prefixLen, to: oldSuffixStart });
        }

        // What was inserted
        if (newSuffixStart > prefixLen) {
            delta.inserts.push({
                pos: prefixLen,
                text: newContent.slice(prefixLen, newSuffixStart),
            });
        }

        return delta;
    }
}
