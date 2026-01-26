// src/app/lib/embeddings/pipeline/queue.ts

import type { EmbeddingJob } from './types';

/**
 * Priority queue for embedding jobs
 */
export class EmbeddingQueue {
    private highPriority: EmbeddingJob[] = [];
    private normalPriority: EmbeddingJob[] = [];
    private lowPriority: EmbeddingJob[] = [];
    private processing = new Set<string>();

    enqueue(job: EmbeddingJob): void {
        // Deduplicate by nodeId
        if (this.processing.has(job.nodeId)) {
            return;
        }

        // Remove existing job for same node if present
        this.remove(job.nodeId);

        // Add to appropriate queue
        switch (job.priority) {
            case 'high':
                this.highPriority.push(job);
                break;
            case 'normal':
                this.normalPriority.push(job);
                break;
            case 'low':
                this.lowPriority.push(job);
                break;
        }
    }

    dequeue(): EmbeddingJob | null {
        // Process in priority order
        const job =
            this.highPriority.shift() ||
            this.normalPriority.shift() ||
            this.lowPriority.shift();

        if (job) {
            this.processing.add(job.nodeId);
        }

        return job || null;
    }

    complete(nodeId: string): void {
        this.processing.delete(nodeId);
    }

    remove(nodeId: string): void {
        this.highPriority = this.highPriority.filter(j => j.nodeId !== nodeId);
        this.normalPriority = this.normalPriority.filter(j => j.nodeId !== nodeId);
        this.lowPriority = this.lowPriority.filter(j => j.nodeId !== nodeId);
    }

    size(): number {
        return this.highPriority.length + this.normalPriority.length + this.lowPriority.length;
    }

    isProcessing(nodeId: string): boolean {
        return this.processing.has(nodeId);
    }

    clear(): void {
        this.highPriority = [];
        this.normalPriority = [];
        this.lowPriority = [];
        this.processing.clear();
    }

    getStats() {
        return {
            high: this.highPriority.length,
            normal: this.normalPriority.length,
            low: this.lowPriority.length,
            processing: this.processing.size,
            total: this.size(),
        };
    }
}
