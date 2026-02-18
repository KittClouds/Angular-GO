import { Injectable, signal, inject, OnDestroy } from '@angular/core';
import { Subject, Subscription, debounceTime } from 'rxjs';
import { RagWorkerService } from './rag-worker.service';

// ============================================================================
// CozoDB Stubs - To be reimplemented
// ============================================================================

interface RaptorPayload {
    text: string;
    sourceId: string;
    startIndex: number;
    endIndex: number;
    metadata: { title: string };
}

const RAPTOR_QUERIES = {
    upsertNodes: 'STUB: upsertNodes - CozoDB removed'
};

// Stub CozoService for future reimplementation
@Injectable({ providedIn: 'root' })
class CozoService {
    async run(_query: string, _params: Record<string, unknown>): Promise<{ ok: boolean }> {
        console.warn('[CozoService] Stub called - CozoDB removed');
        return { ok: false };
    }
}

export interface EmbeddingJob {
    noteId: string;
    narrativeId: string;
    title: string;
    content: string;
    markedDirtyAt: number;
}

export type EmbeddingStatus = 'idle' | 'queued' | 'embedding' | 'complete' | 'error';

@Injectable({ providedIn: 'root' })
export class EmbeddingQueueService implements OnDestroy {
    private ragWorker = inject(RagWorkerService);
    private cozo = inject(CozoService);

    // Configuration
    private readonly IDLE_DEBOUNCE_MS = 10000; // 10 seconds
    private readonly CHUNK_SIZE = 1024; // tokens approx

    // State
    private dirtyNotes = new Map<string, EmbeddingJob>();
    private queue: EmbeddingJob[] = [];
    private processing = signal(false);

    // Status signals
    readonly queueLength = signal(0);
    readonly currentJob = signal<EmbeddingJob | null>(null);
    readonly statusMap = signal<Map<string, EmbeddingStatus>>(new Map());

    // Debounce trigger
    private editSubject = new Subject<{ noteId: string; narrativeId: string; title: string; content: string }>();
    private editSubscription: Subscription;

    constructor() {
        this.editSubscription = this.editSubject.pipe(
            debounceTime(this.IDLE_DEBOUNCE_MS)
        ).subscribe(edit => {
            this.flushDirtyNote(edit.noteId);
        });

        console.log('[EmbeddingQueue] Initialized with 10s debounce');
    }

    ngOnDestroy() {
        this.editSubscription?.unsubscribe();
    }

    markDirty(noteId: string, narrativeId: string, title: string, content: string): void {
        const job: EmbeddingJob = {
            noteId,
            narrativeId,
            title,
            content,
            markedDirtyAt: Date.now()
        };

        this.dirtyNotes.set(noteId, job);
        this.updateStatus(noteId, 'queued');
        this.editSubject.next({ noteId, narrativeId, title, content });
        console.log(`[EmbeddingQueue] Note ${noteId} marked dirty`);
    }

    private flushDirtyNote(noteId: string): void {
        const job = this.dirtyNotes.get(noteId);
        if (!job) return;

        this.dirtyNotes.delete(noteId);
        this.queue.push(job);
        this.queueLength.set(this.queue.length);

        console.log(`[EmbeddingQueue] Note ${noteId} flushed to queue. Queue size: ${this.queue.length}`);

        if (!this.processing()) {
            this.processQueue();
        }
    }

    flushAll(): void {
        for (const [noteId, job] of this.dirtyNotes) {
            this.queue.push(job);
            this.updateStatus(noteId, 'queued');
        }
        this.dirtyNotes.clear();
        this.queueLength.set(this.queue.length);

        console.log(`[EmbeddingQueue] Flushed all. Queue size: ${this.queue.length}`);

        if (!this.processing() && this.queue.length > 0) {
            this.processQueue();
        }
    }

    private async processQueue(): Promise<void> {
        if (this.processing() || this.queue.length === 0) return;

        this.processing.set(true);

        while (this.queue.length > 0) {
            const job = this.queue.shift()!;
            this.queueLength.set(this.queue.length);
            this.currentJob.set(job);
            this.updateStatus(job.noteId, 'embedding');

            console.log(`[EmbeddingQueue] Processing: ${job.noteId} (${job.title})`);

            try {
                await this.embedNote(job);
                this.updateStatus(job.noteId, 'complete');
                console.log(`[EmbeddingQueue] Complete: ${job.noteId}`);
            } catch (err) {
                console.error(`[EmbeddingQueue] Error embedding ${job.noteId}:`, err);
                this.updateStatus(job.noteId, 'error');
            }
        }

        this.currentJob.set(null);
        this.processing.set(false);
        console.log('[EmbeddingQueue] Queue processing complete');
    }

    private async embedNote(job: EmbeddingJob): Promise<void> {
        if (!job.content.trim()) return;

        // Initialize worker if needed
        await this.ragWorker.initialize();

        // 1. Chunk content
        const chunks = this.chunkText(job.content, this.CHUNK_SIZE);
        console.log(`[EmbeddingQueue] Embedding ${chunks.length} chunks for "${job.title}"`);

        // 2. Embed each chunk
        const raptorNodes: any[] = [];
        const timestamp = Date.now();

        // Note: We could parallelize `Promise.all` but sequential is safer for worker memory for now
        for (let i = 0; i < chunks.length; i++) {
            const chunkText = chunks[i];
            const embedding = await this.ragWorker.embed(chunkText);
            const embeddingArray = Array.from(embedding);

            // Create RaptorNode (Leaf)
            const nodeId = `leaf_${job.noteId}_${i}`;
            const payload: RaptorPayload = {
                text: chunkText,
                sourceId: job.noteId,
                startIndex: i, // Simple index for now, ideally char offset
                endIndex: i + chunkText.length,
                metadata: { title: job.title }
            };

            // Matches Cozo schema columns:
            // node_id, narrative_id, level, embedding, payload, children, created_at
            raptorNodes.push([
                nodeId,
                job.narrativeId,
                0, // Level 0 = Leaf
                embeddingArray,
                payload, // Cozo client handles object->JSON
                [], // No children for leaves
                timestamp
            ]);
        }

        // 3. Persist to CozoDB
        if (raptorNodes.length > 0) {
            try {
                await this.cozo.run(RAPTOR_QUERIES.upsertNodes, { nodes: raptorNodes });
                console.log(`[EmbeddingQueue] Persisted ${raptorNodes.length} nodes to CozoDB`);
            } catch (e) {
                console.error('[EmbeddingQueue] Cozo upsert failed:', e);
                throw e;
            }
        }
    }

    private chunkText(text: string, maxChars: number): string[] {
        const chunks: string[] = [];
        let start = 0;
        while (start < text.length) {
            let end = Math.min(start + maxChars, text.length);
            if (end < text.length) {
                const paragraphBreak = text.lastIndexOf('\n\n', end);
                const sentenceBreak = text.lastIndexOf('. ', end);
                if (paragraphBreak > start + maxChars / 2) {
                    end = paragraphBreak + 2;
                } else if (sentenceBreak > start + maxChars / 2) {
                    end = sentenceBreak + 2;
                }
            }
            chunks.push(text.slice(start, end).trim());
            start = end;
        }
        return chunks.filter(c => c.length > 0);
    }

    private updateStatus(noteId: string, status: EmbeddingStatus): void {
        this.statusMap.update(map => {
            const newMap = new Map(map);
            newMap.set(noteId, status);
            return newMap;
        });
    }

    getStatus(noteId: string): EmbeddingStatus {
        return this.statusMap().get(noteId) || 'idle';
    }

    hasPendingWork(): boolean {
        return this.queue.length > 0 || this.dirtyNotes.size > 0 || this.processing();
    }
}
