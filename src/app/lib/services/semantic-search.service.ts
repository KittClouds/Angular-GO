import { Injectable, signal, inject } from '@angular/core';
import { ScopeService } from './scope.service';
import { EmbeddingQueueService } from './embedding-queue.service';
import { RagWorkerService } from './rag-worker.service';
import { CozoService } from '../cozo/cozo.service';
import { RAPTOR_QUERIES } from '../cozo/schema/layer3-raptor';

/**
 * Semantic Search Service
 * 
 * High-level search interface bridging UI, CozoDB, and RAG Worker.
 */

export interface SearchResult {
    noteId: string;
    noteTitle: string;
    chunkText: string;
    score: number;
    chunkIndex: number;
    narrativeId?: string;
}

export interface SearchConfig {
    k: number;           // Number of results
    ef: number;          // HNSW ef parameter
    mode: 'leaves' | 'collapsed';
    scoped: boolean;     // Filter by current narrative
}

const DEFAULT_CONFIG: SearchConfig = {
    k: 10,
    ef: 100,
    mode: 'leaves',
    scoped: true
};

@Injectable({ providedIn: 'root' })
export class SemanticSearchService {
    private scopeService = inject(ScopeService);
    private embeddingQueue = inject(EmbeddingQueueService);
    private ragWorker = inject(RagWorkerService);
    private cozo = inject(CozoService);

    // State
    readonly isSearching = signal(false);
    readonly lastResults = signal<SearchResult[]>([]);
    readonly lastSearchTime = signal(0);
    readonly isModelLoaded = this.ragWorker.isModelLoaded;
    readonly modelDimension = this.ragWorker.modelDimension;

    constructor() {
        console.log('[SemanticSearch] Service initialized');
    }

    /**
     * Initialize the RAG worker
     */
    async initializeWorker(): Promise<void> {
        return this.ragWorker.initialize();
    }

    /**
     * Search for similar content
     */
    async search(query: string, config: Partial<SearchConfig> = {}): Promise<SearchResult[]> {
        const cfg = { ...DEFAULT_CONFIG, ...config };
        const startTime = performance.now();

        this.isSearching.set(true);

        try {
            // Get current scope
            const scope = this.scopeService.activeScope();
            const narrativeId = cfg.scoped ? scope.narrativeId : undefined;

            console.log(`[SemanticSearch] Searching: "${query}" | k=${cfg.k} | mode=${cfg.mode} | narrative=${narrativeId || 'global'}`);

            // Step 1: Embed the query using RAG worker
            const queryEmbedding = await this.embedQuery(query);

            // Step 2: Search CozoDB HNSW
            const results = await this.searchHnsw(queryEmbedding, cfg, narrativeId);

            this.lastResults.set(results);
            this.lastSearchTime.set(Math.round(performance.now() - startTime));

            console.log(`[SemanticSearch] Found ${results.length} results in ${this.lastSearchTime()}ms`);
            return results;

        } catch (err) {
            console.error('[SemanticSearch] Search failed:', err);
            return [];
        } finally {
            this.isSearching.set(false);
        }
    }

    /**
     * Embed a query string using the RAG worker
     */
    private async embedQuery(text: string): Promise<Float32Array> {
        return this.ragWorker.embed(text);
    }

    /**
     * Search CozoDB HNSW index
     */
    private async searchHnsw(
        queryEmbedding: Float32Array,
        config: SearchConfig,
        narrativeId?: string
    ): Promise<SearchResult[]> {
        const queryVec = Array.from(queryEmbedding);

        // Determine which Datalog query to use
        let cozoQuery = '';
        const params: any = {
            query: queryVec,
            k: config.k,
            ef: config.ef
        };

        if (config.mode === 'leaves') {
            if (narrativeId) {
                cozoQuery = RAPTOR_QUERIES.searchLeavesScoped;
                params.narrative_id = narrativeId;
            } else {
                cozoQuery = RAPTOR_QUERIES.searchLeaves;
            }
        } else {
            // Collapsed mode (leaves + clusters)
            if (narrativeId) {
                cozoQuery = RAPTOR_QUERIES.searchCollapsedScoped;
                params.narrative_id = narrativeId;
            } else {
                cozoQuery = RAPTOR_QUERIES.searchCollapsed;
            }
        }

        console.log(`[SemanticSearch] Executing Cozo query (scoped: ${!!narrativeId})`);

        try {
            console.log(`[SemanticSearch] Query: ${cozoQuery}`);
            console.log(`[SemanticSearch] Params:`, JSON.stringify(params));

            const response = await this.cozo.run(cozoQuery, params);
            console.log('[SemanticSearch] Raw Cozo Response:', JSON.stringify(response));

            if (!response || !response.headers || !response.rows) {
                return [];
            }

            // Map table headers to indices
            const cols = response.headers;
            const idxNodeId = cols.indexOf('node_id');
            const idxDistance = cols.indexOf('distance');
            const idxPayload = cols.indexOf('payload');

            if (idxNodeId === -1 || idxPayload === -1) {
                console.warn('[SemanticSearch] Missing columns in Cozo response', cols);
                return [];
            }

            // Map rows to results
            return response.rows.map(row => {
                const payload = row[idxPayload];
                // Safely parse payload if it's a string (though Cozo client might parse JSON cols automatically)
                const data = typeof payload === 'string' ? JSON.parse(payload) : payload;

                return {
                    noteId: data.sourceId || '',
                    noteTitle: data.metadata?.title || 'Unknown Note',
                    chunkText: data.text || '',
                    score: 1.0 - (row[idxDistance] as number), // Convert distance to similarity score
                    chunkIndex: data.startIndex || 0,
                    narrativeId
                };
            });

        } catch (err) {
            console.error('[SemanticSearch] CozoDB query error:', err);
            return [];
        }
    }

    /**
     * Get stats about indexed content
     */
    async getStats(): Promise<{ notes: number; chunks: number }> {
        // Simple count query for raptor_nodes
        // We count leaves (level=0) as chunks
        const query = `
            ?[count] := count(
                *raptor_nodes{level},
                level == 0
            )
        `;

        try {
            const res = await this.cozo.run(query);
            const chunks = (res && res.rows && res.rows[0]) ? (res.rows[0][0] as number) : 0;
            return { notes: 0, chunks }; // Notes count would require join or separate tracking
        } catch (e) {
            console.warn('[SemanticSearch] Stats query failed', e);
            return { notes: 0, chunks: 0 };
        }
    }

    /**
     * Index a batch of notes (triggers embedding queue)
     */
    async indexNotes(notes: Array<{ id: string; narrativeId: string; title: string; content: string }>): Promise<void> {
        console.log(`[SemanticSearch] Queuing ${notes.length} notes for embedding`);
        for (const note of notes) {
            this.embeddingQueue.markDirty(note.id, note.narrativeId, note.title, note.content);
        }
        this.embeddingQueue.flushAll();
    }

    dispose(): void {
        this.ragWorker.dispose();
    }
}
