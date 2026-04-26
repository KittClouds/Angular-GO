import { Injectable, inject, signal } from '@angular/core';

import { EmbeddingQueueService } from './embedding-queue.service';
import { RagWorkerService } from './rag-worker.service';

export interface SemanticIndexNote {
    id: string;
    narrativeId: string;
    title: string;
    content: string;
}

/**
 * Explicit semantic sidecar controls for the search panel.
 * Retrieval is owned by Phoenix search/graph paths; this service only loads the
 * local embedding worker and warms embeddings when the user asks for it.
 */
@Injectable({ providedIn: 'root' })
export class SemanticSearchService {
    private readonly embeddingQueue = inject(EmbeddingQueueService);
    private readonly ragWorker = inject(RagWorkerService);

    readonly isIndexing = signal(false);
    readonly lastIndexedCount = signal(0);
    readonly lastIndexTime = signal(0);
    readonly isModelLoaded = this.ragWorker.isModelLoaded;
    readonly modelDimension = this.ragWorker.modelDimension;

    async initializeWorker(): Promise<void> {
        return this.ragWorker.initialize();
    }

    async indexNotes(notes: SemanticIndexNote[]): Promise<void> {
        const startedAt = performance.now();
        this.isIndexing.set(true);

        try {
            for (const note of notes) {
                this.embeddingQueue.markDirty(
                    note.id,
                    note.narrativeId || 'global',
                    note.title,
                    note.content,
                );
            }
            this.embeddingQueue.flushAll();
            this.lastIndexedCount.set(notes.length);
            this.lastIndexTime.set(Math.round(performance.now() - startedAt));
        } finally {
            this.isIndexing.set(false);
        }
    }

    hasPendingWork(): boolean {
        return this.embeddingQueue.hasPendingWork();
    }

    dispose(): void {
        this.ragWorker.dispose();
    }
}
