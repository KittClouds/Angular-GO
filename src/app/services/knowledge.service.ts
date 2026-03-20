import { Injectable, signal } from '@angular/core';

import { GoKittService, type KnowledgeGraphData } from './gokitt.service';

/**
 * High-level service for interacting with the GoKitt knowledge graph.
 * The graphstore is SQLite-backed and used as the canonical visualization source.
 */
@Injectable({
    providedIn: 'root'
})
export class KnowledgeService {
    readonly graphStats = signal<{ nodes: number; edges: number }>({ nodes: 0, edges: 0 });
    readonly isReady = signal<boolean>(false);

    constructor(private gokitt: GoKittService) {
        this.gokitt.onReady(() => {
            console.log('[KnowledgeService] GoKitt ready (waiting for explicit init)');
        });
    }

    /**
     * Initialize the graphstore and hydrate it from canonical persisted artifacts.
     * Safe to call multiple times.
     */
    async init(): Promise<void> {
        if (this.isReady()) return;

        try {
            const initRes = await this.gokitt.knowledgeInit();
            if (!initRes.success) throw new Error(initRes.error || 'knowledgeInit returned success=false');

            console.log('[KnowledgeService] Loading graph from SQLite...');
            const loadRes = await this.gokitt.knowledgeLoad();
            if (!loadRes.success) throw new Error(loadRes.error || 'knowledgeLoad returned success=false');

            this.isReady.set(true);
            await this.refreshStats();
            console.log(`[KnowledgeService] ${loadRes.message || 'Graph loaded'}`);
        } catch (e) {
            console.error('[KnowledgeService] Initialization failed:', e);
        }
    }

    async ensureReady(): Promise<void> {
        if (!this.isReady()) {
            await this.init();
        }
        if (!this.isReady()) {
            throw new Error('Knowledge graph is not ready');
        }
    }

    async sync(): Promise<{ success: boolean; message?: string; error?: string }> {
        await this.ensureReady();
        const result = await this.gokitt.knowledgeSync();
        if (result.success) {
            await this.refreshStats();
        }
        return result;
    }

    async save(): Promise<void> {
        try {
            const res = await this.gokitt.knowledgeSave();
            if (!res.success) throw new Error(res.error);
            console.log('[KnowledgeService] Graph saved to SQLite.');
        } catch (e) {
            console.error('[KnowledgeService] Save failed:', e);
        }
    }

    async addNode(id: string, kind: string, label?: string, props?: Record<string, any>): Promise<void> {
        await this.gokitt.knowledgeAddNode({ id, kind, label, props });
    }

    async addEdge(source: string, target: string, relation: string, weight = 1.0, props?: Record<string, any>): Promise<void> {
        await this.gokitt.knowledgeAddEdge({ source, target, relation, weight, props });
    }

    async getNode(id: string): Promise<any> {
        await this.ensureReady();
        return this.gokitt.knowledgeGetNode(id);
    }

    async getChildren(id: string, relation?: string): Promise<any[]> {
        await this.ensureReady();
        return this.gokitt.knowledgeGetChildren(id, relation);
    }

    async getParents(id: string, relation?: string): Promise<any[]> {
        await this.ensureReady();
        return this.gokitt.knowledgeGetParents(id, relation);
    }

    async getDescendants(id: string, relation?: string, maxDepth = -1): Promise<any[]> {
        await this.ensureReady();
        return this.gokitt.knowledgeGetDescendants(id, relation, maxDepth);
    }

    async getAncestors(id: string, relation?: string, maxDepth = -1): Promise<any[]> {
        await this.ensureReady();
        return this.gokitt.knowledgeGetAncestors(id, relation, maxDepth);
    }

    async getNeighborhood(id: string): Promise<any[]> {
        await this.ensureReady();
        return this.gokitt.knowledgeGetNeighborhood(id);
    }

    async getGraph(): Promise<KnowledgeGraphData> {
        await this.ensureReady();
        const graph = await this.gokitt.knowledgeGetGraph();
        this.graphStats.set({
            nodes: Object.keys(graph.nodes || {}).length,
            edges: graph.edges?.length || 0,
        });
        return graph;
    }

    private async refreshStats(): Promise<void> {
        const graph = await this.gokitt.knowledgeGetGraph();
        this.graphStats.set({
            nodes: Object.keys(graph.nodes || {}).length,
            edges: graph.edges?.length || 0,
        });
    }
}
