import { Injectable, signal } from '@angular/core';
import { GoKittService } from './gokitt.service';

/**
 * KnowledgeService
 * 
 * High-level service for interacting with the GoKitt Knowledge Graph.
 * Go-native in-memory graph with SQLite persistence.
 * 
 * Capabilities:
 * - Persistent Graph Storage (SQLite backed)
 * - Thread-safe Traversal (Parents, Children, Ancestors, Descendants)
 * - Neighborhood Queries
 */
@Injectable({
    providedIn: 'root'
})
export class KnowledgeService {
    // Signals for reactive UI updates
    readonly graphStats = signal<{ nodes: number; edges: number }>({ nodes: 0, edges: 0 });
    readonly isReady = signal<boolean>(false);

    constructor(private gokitt: GoKittService) {
        // Initialize when GoKitt is ready
        this.gokitt.onReady(() => {
            console.log('[KnowledgeService] GoKitt ready (waiting for explicit init)');
        });
    }

    /**
     * Initialize the graph and load data from persistence.
     * Safe to call multiple times — will retry if previous attempt failed.
     */
    async init(): Promise<void> {
        if (this.isReady()) return;

        try {
            // 1. Init in-memory graph
            const initRes = await this.gokitt.knowledgeInit();
            if (!initRes.success) throw new Error(initRes.error || 'knowledgeInit returned success=false');

            // 2. Load from SQLite
            console.log('[KnowledgeService] 📂 Loading graph from SQLite...');
            const loadRes = await this.gokitt.knowledgeLoad();

            if (loadRes.error) {
                throw new Error(loadRes.error);
            }

            // SuccessResult in Go returns { success: true, message: "..." }
            console.log(`[KnowledgeService] ✅ ${loadRes.message || 'Graph loaded'}`);

            this.isReady.set(true);

            // TODO: Update stats signal
        } catch (e) {
            console.error('[KnowledgeService] Initialization failed:', e);
            // Don't set isReady — allows retry on next call
        }
    }

    /**
     * Force save the current in-memory graph to SQLite
     */
    async save(): Promise<void> {
        try {
            const res = await this.gokitt.knowledgeSave();
            if (!res.success) throw new Error(res.error);
            console.log('[KnowledgeService] ✅ Graph saved to SQLite.');
        } catch (e) {
            console.error('[KnowledgeService] Save failed:', e);
        }
    }

    // =========================================================================
    // Node / Edge Mutation
    // =========================================================================

    async addNode(id: string, kind: string, label?: string, props?: Record<string, any>): Promise<void> {
        await this.gokitt.knowledgeAddNode({ id, kind, label, props });
    }

    async addEdge(source: string, target: string, relation: string, weight = 1.0, props?: Record<string, any>): Promise<void> {
        await this.gokitt.knowledgeAddEdge({ source, target, relation, weight, props });
    }

    // =========================================================================
    // Traversal API
    // =========================================================================

    async getNode(id: string): Promise<any> {
        return this.gokitt.knowledgeGetNode(id);
    }

    async getChildren(id: string, relation?: string): Promise<any[]> {
        return this.gokitt.knowledgeGetChildren(id, relation);
    }

    async getParents(id: string, relation?: string): Promise<any[]> {
        return this.gokitt.knowledgeGetParents(id, relation);
    }

    /**
     * Get all descendants (recursive children graph)
     * @param id Root node ID
     * @param relation Optional relation filter (e.g. "CONTAINS")
     * @param maxDepth Default -1 (infinite)
     */
    async getDescendants(id: string, relation?: string, maxDepth = -1): Promise<any[]> {
        return this.gokitt.knowledgeGetDescendants(id, relation, maxDepth);
    }

    /**
     * Get all ancestors (recursive parents graph)
     * @param id Leaf node ID
     * @param relation Optional relation filter (e.g. "CONTAINS")
     * @param maxDepth Default -1 (infinite)
     */
    async getAncestors(id: string, relation?: string, maxDepth = -1): Promise<any[]> {
        return this.gokitt.knowledgeGetAncestors(id, relation, maxDepth);
    }

    /**
     * Get local neighborhood (1-hop in and out)
     */
    async getNeighborhood(id: string): Promise<any[]> {
        return this.gokitt.knowledgeGetNeighborhood(id);
    }

    /**
     * Get the entire knowledge graph for visualization
     */
    async getGraph(): Promise<{ nodes: any; edges: any[] }> {
        return this.gokitt.knowledgeGetGraph();
    }
}
