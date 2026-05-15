import { Injectable, signal } from '@angular/core';

export interface SemanticIndexNote {
    id: string;
    narrativeId: string;
    title: string;
    content: string;
}

/**
 * Explicit semantic sidecar controls for the search panel.
 * Retrieval and embedding execution are owned by Phoenix native search/graph
 * paths; this shim keeps old UI state calls inert.
 */
@Injectable({ providedIn: 'root' })
export class SemanticSearchService {
    // The semantic sidecar is native Rust-owned. This service only preserves
    // legacy UI state so old callers do not spin up browser/cloud embeddings.
    readonly isIndexing = signal(false);
    readonly lastIndexedCount = signal(0);
    readonly lastIndexTime = signal(0);
    readonly isModelLoaded = signal(false);
    readonly modelDimension = signal(0);

    async initializeWorker(): Promise<void> {
        this.isModelLoaded.set(true);
    }

    async indexNotes(notes: SemanticIndexNote[]): Promise<void> {
        const startedAt = performance.now();
        this.isIndexing.set(true);

        try {
            this.lastIndexedCount.set(notes.length);
            this.lastIndexTime.set(Math.round(performance.now() - startedAt));
        } finally {
            this.isIndexing.set(false);
        }
    }

    hasPendingWork(): boolean {
        return false;
    }

    dispose(): void {
        this.isModelLoaded.set(false);
        this.modelDimension.set(0);
    }
}
