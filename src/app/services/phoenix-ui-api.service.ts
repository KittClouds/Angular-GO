import { Injectable, inject } from '@angular/core';

import type { DecorationSpan, EntityKind } from '../lib/Scanner/types';
import {
    type PhoenixDiscoveryCandidate,
    groupDiscoveryMentions,
} from '../lib/phoenix/phoenix-discovery';
import { getLearnedAliasesByEntityId } from '../lib/entity-learning/entity-feedback';
import { createUtf8ByteRangeConverter } from '../lib/text-offsets';
import { matchLiteralPatterns, type PhoenixLiteralPattern } from '../lib/search/phoenix-literal-matcher';
import {
    type PhoenixLineSearchHit,
    type PhoenixLineSearchScope,
} from '../lib/search/phoenix-line-search';
import { PhoenixBackendService } from './phoenix-backend.service';
import { PhoenixStoreService } from './phoenix-store.service';
import type { PhoenixGraphDeltaBinaryResult } from './phoenix-wasm.service';

export interface ProvenanceContext {
    vaultId?: string;
    worldId: string;
    parentPath?: string;
    folderType?: string;
}

export interface SearchScope {
    noteId?: string;
    worldId?: string;
    narrativeId?: string;
    folderId?: string;
    folderPath?: string;
}

export interface KnowledgeGraphNode {
    id: string;
    kind: string;
    label: string;
    props?: Record<string, unknown>;
}

export interface KnowledgeGraphEdge {
    source: string;
    target: string;
    relation: string;
    weight: number;
    props?: Record<string, unknown>;
}

export interface KnowledgeGraphData {
    nodes: Record<string, KnowledgeGraphNode>;
    edges: KnowledgeGraphEdge[];
}

type NoteIngestInput = {
    id: string;
    title: string;
    text: string;
    narrativeId?: string;
    folderPath?: string;
    version?: number;
};

type DictionaryEntry = {
    id: string;
    label: string;
    kind: string;
    aliases: string[];
};

type PhoenixSearchResult = {
    DocID: string;
    Score: number;
    ChunkID: string;
    LineNumber?: number;
    Snippet?: string;
    LineHits?: PhoenixLineSearchHit[];
};

const DOCUMENT_ID_PATTERN = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi;

@Injectable({ providedIn: 'root' })
export class PhoenixUiApiService {
    private readonly phoenix = inject(PhoenixBackendService);
    private readonly store = inject(PhoenixStoreService);

    private ready = false;
    private readyPromise: Promise<void> | null = null;
    private readonly readyCallbacks = new Set<() => void>();

    private mainSessionId: string | null = null;
    private dictionary: DictionaryEntry[] = [];
    private knowledgeGraph: KnowledgeGraphData = { nodes: {}, edges: [] };

    get isReady(): boolean {
        return this.ready;
    }

    get runtimeTarget(): string {
        return this.phoenix.target;
    }

    invalidateKnowledgeGraphCache(): void {
        this.knowledgeGraph = { nodes: {}, edges: [] };
    }

    async rebuildRuntimeIndexes(reason = 'ui-rebuild'): Promise<any> {
        await this.loadRuntime();
        const result = await this.phoenix.rebuild({ reason });
        this.invalidateKnowledgeGraphCache();
        await this.hydrateWithEntitiesInternal();
        this.store.markDerivedDirty();
        await this.store.triggerSnapshot();
        if (typeof window !== 'undefined') {
            window.dispatchEvent(new CustomEvent('phoenix-projection-invalidated'));
        }
        return result;
    }

    onReady(callback: () => void): void {
        if (this.ready) {
            callback();
            return;
        }
        this.readyCallbacks.add(callback);
    }

    async loadRuntime(): Promise<void> {
        if (this.readyPromise) {
            return this.readyPromise;
        }

        this.readyPromise = this.initialize().catch((error) => {
            this.readyPromise = null;
            throw error;
        });
        return this.readyPromise;
    }

    async loadWasm(): Promise<void> {
        if (this.phoenix.target === 'native') {
            throw new Error('PhoenixUiApiService.loadWasm() is disabled in native desktop. Use loadRuntime().');
        }
        await this.loadRuntime();
    }

    async hydrateWithEntities(): Promise<void> {
        await this.loadRuntime();
        await this.hydrateWithEntitiesInternal();
    }

    private async hydrateWithEntitiesInternal(): Promise<void> {
        const entities = (await this.store.listEntities()).map((entity) => ({
            id: entity.id,
            label: entity.label,
            kind: entity.kind,
            aliases: entity.aliases || [],
        }));
        await this.rebuildDictionary(entities);
    }

    async rebuildDictionary(
        entities: Array<{ id: string; label: string; kind: string; aliases?: string[] }>,
    ): Promise<void> {
        const learnedAliases = await getLearnedAliasesByEntityId().catch((error) => {
            console.warn('[PhoenixUiApi] Learned aliases unavailable:', error);
            return new Map<string, string[]>();
        });

        this.dictionary = entities
            .map((entity) => {
                const labelKey = entity.label.trim().toLocaleLowerCase();
                const seen = new Set<string>();
                const aliases: string[] = [];
                for (const alias of [...(entity.aliases || []), ...(learnedAliases.get(entity.id) || [])]) {
                    const cleaned = String(alias || '').trim().replace(/\s+/g, ' ');
                    const aliasKey = cleaned.toLocaleLowerCase();
                    if (!cleaned || aliasKey === labelKey || seen.has(aliasKey)) {
                        continue;
                    }
                    seen.add(aliasKey);
                    aliases.push(cleaned);
                }
                return {
                    id: entity.id,
                    label: entity.label,
                    kind: entity.kind,
                    aliases,
                };
            })
            .sort((left, right) => {
                const leftLen = Math.max(left.label.length, ...left.aliases.map((alias) => alias.length), 0);
                const rightLen = Math.max(right.label.length, ...right.aliases.map((alias) => alias.length), 0);
                return rightLen - leftLen || left.label.localeCompare(right.label);
            });
    }

    async hydrateNotes(
        notes: Array<{
            id: string;
            text: string;
            title?: string;
            version?: number;
            narrativeId?: string;
            folderPath?: string;
        }>,
    ): Promise<{ success: boolean; error?: string }> {
        await this.loadRuntime();
        const sessionId = await this.ensureMainSession();
        const documents = notes.map((note) => this.noteInputToDocument({
            id: note.id,
            title: note.title || note.id,
            text: note.text || '',
            narrativeId: note.narrativeId || undefined,
            folderPath: note.folderPath || undefined,
            version: note.version,
        }));

        if (!documents.length) {
            return { success: true };
        }

        await this.ingestDocumentsIntoSession(sessionId, documents);
        return { success: true };
    }

    async upsertNote(
        id: string,
        text: string,
        version?: number,
        meta?: { title?: string; narrativeId?: string; folderPath?: string },
    ): Promise<{ success: boolean; error?: string }> {
        await this.loadRuntime();
        const note = await this.resolveNoteIngestInput(id, text, version, meta);
        await this.ingestNoteInputs([note], await this.ensureMainSession());
        return { success: true };
    }

    async indexNote(id: string, text: string, scope?: SearchScope): Promise<void> {
        await this.loadRuntime();
        const note = await this.resolveNoteIngestInput(id, text, undefined, {
            narrativeId: scope?.narrativeId,
            folderPath: scope?.folderPath,
        });
        await this.ingestNoteInputs([note], await this.ensureMainSession());
    }

    async search(query: string, limit = 20): Promise<any[]> {
        return this.searchScoped(query, limit);
    }

    async semanticSearch(query: string, limit = 20, scope?: SearchScope): Promise<any[]> {
        await this.loadRuntime();
        if (!query.trim()) {
            return [];
        }

        try {
            const sessionId = await this.ensureMainSession();
            const result = await this.phoenix.query({
                sessionId,
                query,
                scope: this.toPhoenixScope(scope),
                targets: ['chunks', 'semantic'],
                limit,
                temporal: null,
            });

            return (result.chunkHits || []).map((hit: { chunkId: string; score: number }) => ({
                DocID: chunkIdToDocumentId(hit.chunkId),
                Score: hit.score,
                ChunkID: hit.chunkId,
            }));
        } catch (error) {
            console.warn('[PhoenixUiApi] Semantic search failed.', error);
            return [];
        }
    }

    async searchScoped(query: string, limit = 20, scope?: SearchScope): Promise<any[]> {
        await this.loadRuntime();
        if (!query.trim()) {
            return [];
        }

        const byNote = new Map<string, PhoenixSearchResult>();
        const lineHits = await this.store.lineSearch(query, {
            limit: Math.max(limit * 4, limit),
            before: 1,
            after: 1,
            scope: this.toLineSearchScope(scope),
        });
        for (const hit of lineHits) {
            mergeSearchResult(byNote, {
                DocID: hit.noteId,
                Score: hit.score,
                ChunkID: `${hit.noteId}:line:${hit.lineNumber}`,
                LineNumber: hit.lineNumber,
                Snippet: hit.lineText,
                LineHits: [hit],
            });
        }

        try {
            const sessionId = await this.ensureMainSession();
            const result = await this.phoenix.query({
                sessionId,
                query,
                scope: this.toPhoenixScope(scope),
                targets: ['chunks'],
                limit,
                temporal: null,
            });

            for (const hit of result.chunkHits || []) {
                const noteId = chunkIdToDocumentId(hit.chunkId);
                mergeSearchResult(byNote, {
                    DocID: noteId,
                    Score: hit.score,
                    ChunkID: hit.chunkId,
                });
            }
        } catch (error) {
            console.warn('[PhoenixUiApi] Semantic search failed; returning line-search results.', error);
        }

        return Array.from(byNote.values()).sort((left, right) => right.Score - left.Score).slice(0, limit);
    }

    async lineSearch(query: string, limit = 50, scope?: SearchScope): Promise<PhoenixLineSearchHit[]> {
        await this.loadRuntime();
        return this.store.lineSearch(query, {
            limit,
            before: 1,
            after: 1,
            scope: this.toLineSearchScope(scope),
        });
    }

    async scan(text: string, provenance?: ProvenanceContext): Promise<any> {
        await this.loadRuntime();
        if (!this.dictionary.length) {
            await this.hydrateWithEntitiesInternal();
        }
        const scan = await this.phoenix.scan({
            text,
            scope: this.toPhoenixScope({ folderPath: provenance?.parentPath }),
            sessionId: 'phoenix-ui-scan',
            resolverSeed: this.buildResolverSeed({ folderPath: provenance?.parentPath }),
        });
        const structure = await this.phoenix.buildStructure({ text, scan });
        const graph = buildGraphFromScanResult(text, scan, structure);
        return {
            ...scan,
            structure,
            graph: {
                Nodes: graph.nodes,
                Edges: graph.edges,
            },
            timing_us: 0,
        };
    }

    async scanDiscovery(text: string): Promise<PhoenixDiscoveryCandidate[]> {
        await this.loadRuntime();
        if (!this.dictionary.length) {
            await this.hydrateWithEntitiesInternal();
        }
        const scan = await this.phoenix.scan({
            text,
            scope: {},
            sessionId: 'phoenix-ui-discovery',
            resolverSeed: this.buildResolverSeed(),
        });

        const mentions = normalizeScanMentions(text, Array.isArray(scan?.mentions) ? scan.mentions : []);
        return groupDiscoveryMentions(text, mentions);
    }

    async scanImplicitAsync(text: string): Promise<DecorationSpan[]> {
        return this.scanEntityMentionsAsync(text);
    }

    async scanEntityMentionsAsync(text: string, scope?: SearchScope): Promise<DecorationSpan[]> {
        await this.loadRuntime();
        if (!this.dictionary.length) {
            await this.hydrateWithEntities();
        }
        const resolverSeed = this.buildResolverSeed(scope);
        if (!text || !resolverSeed.length) {
            return [];
        }
        const scan = await this.phoenix.scan({
            text,
            scope: this.toPhoenixScope(scope),
            sessionId: 'phoenix-ui-entity-scan',
            resolverSeed,
        });
        return knownMentionsToSpans(text, Array.isArray(scan?.mentions) ? scan.mentions : [], this.dictionary);
    }

    async analyzeText(text: string): Promise<any> {
        await this.loadRuntime();
        return this.phoenix.analyzeText(text);
    }

    async knowledgeInit(): Promise<{ success: boolean; message?: string; error?: string }> {
        await this.loadRuntime();
        await this.refreshKnowledgeGraph();
        return { success: true, message: 'Phoenix knowledge graph ready' };
    }

    async knowledgeLoad(): Promise<{ success: boolean; message?: string; error?: string }> {
        await this.loadRuntime();
        await this.refreshKnowledgeGraph();
        return { success: true, message: 'Phoenix knowledge graph loaded' };
    }

    async knowledgeSync(): Promise<{ success: boolean; message?: string; error?: string }> {
        await this.loadRuntime();
        await this.refreshKnowledgeGraph();
        return { success: true, message: 'Phoenix knowledge graph synced' };
    }

    async knowledgeSave(): Promise<{ success: boolean; message?: string; error?: string }> {
        await this.loadRuntime();
        return { success: true, message: 'Phoenix graph is already persisted' };
    }

    async knowledgeAddNode(node: {
        id: string;
        kind: string;
        label?: string;
        props?: Record<string, unknown>;
    }): Promise<{ success: boolean; message?: string; error?: string }> {
        await this.loadRuntime();
        await this.phoenix.storeCommand('graph:upsertNode', {
            id: node.id,
            kind: node.kind,
            label: node.label || node.id,
            props: node.props || {},
        });
        await this.refreshKnowledgeGraph();
        return { success: true };
    }

    async knowledgeAddEdge(edge: {
        source: string;
        target: string;
        relation: string;
        weight?: number;
        props?: Record<string, unknown>;
    }): Promise<{ success: boolean; message?: string; error?: string }> {
        await this.loadRuntime();
        await this.phoenix.storeCommand('graph:upsertEdge', {
            source: edge.source,
            target: edge.target,
            edgeType: edge.relation,
            weight: edge.weight ?? 1,
            props: edge.props || {},
        });
        await this.refreshKnowledgeGraph();
        return { success: true };
    }

    async knowledgeGetNode(id: string): Promise<any> {
        await this.ensureKnowledgeGraph();
        return this.knowledgeGraph.nodes[id] || null;
    }

    async knowledgeGetChildren(id: string, relation?: string): Promise<any[]> {
        await this.ensureKnowledgeGraph();
        return this.knowledgeGraph.edges
            .filter((edge) => edge.source === id && (!relation || edge.relation === relation))
            .map((edge) => this.knowledgeGraph.nodes[edge.target])
            .filter(Boolean);
    }

    async knowledgeGetParents(id: string, relation?: string): Promise<any[]> {
        await this.ensureKnowledgeGraph();
        return this.knowledgeGraph.edges
            .filter((edge) => edge.target === id && (!relation || edge.relation === relation))
            .map((edge) => this.knowledgeGraph.nodes[edge.source])
            .filter(Boolean);
    }

    async knowledgeGetAncestors(id: string, relation?: string, maxDepth = -1): Promise<any[]> {
        return this.walkKnowledgeGraph(id, 'parents', relation, maxDepth);
    }

    async knowledgeGetDescendants(id: string, relation?: string, maxDepth = -1): Promise<any[]> {
        return this.walkKnowledgeGraph(id, 'children', relation, maxDepth);
    }

    async knowledgeGetNeighborhood(id: string): Promise<any[]> {
        await this.ensureKnowledgeGraph();
        const neighbors = new Map<string, KnowledgeGraphNode>();
        for (const edge of this.knowledgeGraph.edges) {
            if (edge.source === id && this.knowledgeGraph.nodes[edge.target]) {
                neighbors.set(edge.target, this.knowledgeGraph.nodes[edge.target]);
            }
            if (edge.target === id && this.knowledgeGraph.nodes[edge.source]) {
                neighbors.set(edge.source, this.knowledgeGraph.nodes[edge.source]);
            }
        }
        return Array.from(neighbors.values());
    }

    async knowledgeGetGraph(): Promise<KnowledgeGraphData> {
        await this.ensureKnowledgeGraph();
        return this.knowledgeGraph;
    }

    async knowledgeGraphDelta(
        scope?: SearchScope,
        changedDocuments: readonly string[] = [],
        includeCandidateGraph = false,
    ): Promise<PhoenixGraphDeltaBinaryResult> {
        await this.loadRuntime();
        const sessionId = await this.ensureMainSession();
        return this.phoenix.graphDelta({
            sessionId,
            scope: this.toPhoenixScope(scope),
            changedDocuments: Array.from(new Set(changedDocuments.filter(Boolean))),
            limit: null,
            sinceCommit: null,
            includeCandidateGraph,
        });
    }

    async systemCreateSession(config: Record<string, unknown> = {}): Promise<{ sessionId: string }> {
        await this.loadRuntime();
        const label = typeof config['label'] === 'string' ? String(config['label']) : 'phoenix-ui-session';
        const scope = this.toPhoenixScope(config['scope'] as SearchScope | undefined);
        const response = await this.phoenix.createSession(label, scope);
        return { sessionId: String(response?.sessionId || '') };
    }

    async systemIngest<T = any>(sessionId: string, request: Record<string, unknown>): Promise<T> {
        await this.loadRuntime();
        const result = await (this.phoenix.ingest({ sessionId, ...request }) as Promise<T>);
        this.store.markDerivedDirty();
        return result;
    }

    async systemSearch<T = any>(sessionId: string, request: Record<string, unknown>): Promise<T> {
        await this.loadRuntime();
        return this.phoenix.query({ sessionId, ...request }) as Promise<T>;
    }

    async systemCommit<T = any>(sessionId: string, request: Record<string, unknown> = {}): Promise<T> {
        await this.loadRuntime();
        return this.phoenix.commit(sessionId, request) as Promise<T>;
    }

    async systemGetState<T = any>(sessionId: string): Promise<T> {
        await this.loadRuntime();
        return this.phoenix.sessionState(sessionId) as Promise<T>;
    }

    async systemGetStats<T = any>(sessionId: string): Promise<T> {
        await this.loadRuntime();
        return this.phoenix.sessionStats(sessionId) as Promise<T>;
    }

    async systemClose(sessionId: string): Promise<{ success: boolean; error?: string }> {
        await this.loadRuntime();
        await this.phoenix.storeCommand('session:close', { sessionId });
        return { success: true };
    }

    async systemRun<T = any>(request: Record<string, unknown>): Promise<T> {
        await this.loadRuntime();
        const created = typeof request['sessionId'] === 'string' ? null : await this.systemCreateSession({});
        const sessionId = typeof request['sessionId'] === 'string' ? String(request['sessionId']) : created!.sessionId;
        const result: Record<string, unknown> = { sessionId };

        try {
            if (request['ingest']) {
                result['ingest'] = await this.systemIngest(sessionId, request['ingest'] as Record<string, unknown>);
            }
            if (request['search']) {
                result['search'] = await this.systemSearch(sessionId, request['search'] as Record<string, unknown>);
            }
            if (request['commit']) {
                result['commit'] = await this.systemCommit(sessionId, request['commit'] as Record<string, unknown>);
            }
            if (request['state']) {
                result['state'] = await this.systemGetState(sessionId);
            }
            if (request['stats']) {
                result['stats'] = await this.systemGetStats(sessionId);
            }
        } finally {
            if (created) {
                try {
                    await this.systemClose(created.sessionId);
                } catch (error) {
                    console.warn('[PhoenixUiApi] Failed to close disposable Phoenix session:', error);
                }
            }
        }

        return result as T;
    }

    private async initialize(): Promise<void> {
        const startedAt = Date.now();
        console.log('[PhoenixUiApi] initialize:start');
        console.log('[PhoenixUiApi] initialize:store.initialize:start');
        await this.store.initialize();
        console.log(`[PhoenixUiApi] initialize:store.initialize:complete (${Date.now() - startedAt}ms)`);
        console.log('[PhoenixUiApi] initialize:ensureMainSession:start');
        await this.ensureMainSession();
        console.log(`[PhoenixUiApi] initialize:ensureMainSession:complete (${Date.now() - startedAt}ms)`);
        if (!this.dictionary.length) {
            console.log('[PhoenixUiApi] initialize:hydrateWithEntities:start');
            await this.hydrateWithEntitiesInternal();
            console.log(`[PhoenixUiApi] initialize:hydrateWithEntities:complete (${Date.now() - startedAt}ms)`);
        }
        this.ready = true;
        const readyCallbacks = Array.from(this.readyCallbacks);
        this.readyCallbacks.clear();
        queueMicrotask(() => {
            if (typeof window !== 'undefined') {
                window.dispatchEvent(new CustomEvent('phoenix-ready'));
                window.dispatchEvent(new CustomEvent('gokitt-ready'));
            }
            for (const callback of readyCallbacks) {
                try {
                    callback();
                } catch (error) {
                    console.error('[PhoenixUiApi] Ready callback failed:', error);
                }
            }
        });
        console.log(`[PhoenixUiApi] initialize:complete (${Date.now() - startedAt}ms)`);
    }

    private async ensureMainSession(): Promise<string> {
        if (this.mainSessionId) {
            return this.mainSessionId;
        }
        const response = await this.phoenix.createSession('phoenix-ui-main', {});
        this.mainSessionId = String(response?.sessionId || '');
        return this.mainSessionId;
    }

    private async ingestNoteInputs(notes: NoteIngestInput[], sessionId: string): Promise<void> {
        await this.ingestDocumentsIntoSession(
            sessionId,
            notes.map((note) => this.noteInputToDocument(note)),
        );
    }

    private async ingestDocumentsIntoSession(
        sessionId: string,
        documents: Array<{
            documentId: string;
            noteId: string;
            title: string;
            text: string;
            scope: Record<string, unknown>;
        }>,
    ): Promise<void> {
        if (!documents.length) {
            return;
        }
        await this.phoenix.ingest({
            sessionId,
            documents,
            commit: false,
        });
        this.store.markDerivedDirty();
    }

    private noteInputToDocument(note: NoteIngestInput): {
        documentId: string;
        noteId: string;
        title: string;
        text: string;
        scope: Record<string, unknown>;
    } {
        return {
            documentId: note.id,
            noteId: note.id,
            title: note.title || note.id,
            text: note.text || '',
            scope: this.toPhoenixScope({
                narrativeId: note.narrativeId,
                folderPath: note.folderPath,
            }),
        };
    }

    private async resolveNoteIngestInput(
        id: string,
        text: string,
        version?: number,
        meta?: { title?: string; narrativeId?: string; folderPath?: string },
    ): Promise<NoteIngestInput> {
        if (meta?.title && (meta?.narrativeId !== undefined || meta?.folderPath !== undefined)) {
            return {
                id,
                title: meta.title || id,
                text,
                narrativeId: meta.narrativeId || undefined,
                folderPath: meta.folderPath || undefined,
                version,
            };
        }

        const header = await this.store.getNoteHeader(id);
        return {
            id,
            title: meta?.title || header?.title || id,
            text,
            narrativeId: meta?.narrativeId ?? header?.narrativeId ?? undefined,
            folderPath: meta?.folderPath ?? header?.folderId ?? undefined,
            version,
        };
    }

    private buildResolverSeed(scope?: SearchScope): Array<Record<string, unknown>> {
        const seedScope = this.toPhoenixScope(scope);
        const entities = this.dictionary.length
            ? this.dictionary
            : [];

        return entities
            .filter(entity => entity.id && entity.label)
            .map(entity => ({
                entityId: entity.id,
                canonicalName: entity.label,
                aliases: entity.aliases || [],
                kind: toRustEntityKind(entity.kind),
                gender: null,
                number: null,
                scope: seedScope,
            }));
    }

    private toPhoenixScope(scope?: SearchScope | Record<string, unknown>): Record<string, unknown> {
        if (!scope) {
            return {};
        }
        const scopeRecord = scope as Record<string, unknown>;
        return {
            narrativeId: typeof scopeRecord['narrativeId'] === 'string' ? scopeRecord['narrativeId'] : undefined,
            folderPath: typeof scopeRecord['folderPath'] === 'string' ? scopeRecord['folderPath'] : undefined,
            worldId: typeof scopeRecord['worldId'] === 'string' ? scopeRecord['worldId'] : undefined,
            folderId: typeof scopeRecord['folderId'] === 'string' ? scopeRecord['folderId'] : undefined,
        };
    }

    private toLineSearchScope(scope?: SearchScope | Record<string, unknown>): PhoenixLineSearchScope | undefined {
        const normalized = this.toPhoenixScope(scope);
        const lineScope: PhoenixLineSearchScope = {
            noteId: typeof (scope as Record<string, unknown> | undefined)?.['noteId'] === 'string'
                ? String((scope as Record<string, unknown>)['noteId'])
                : undefined,
            worldId: typeof normalized['worldId'] === 'string' ? normalized['worldId'] : undefined,
            narrativeId: typeof normalized['narrativeId'] === 'string' ? normalized['narrativeId'] : undefined,
            folderId: typeof normalized['folderId'] === 'string' ? normalized['folderId'] : undefined,
            folderPath: typeof normalized['folderPath'] === 'string' ? normalized['folderPath'] : undefined,
        };
        return Object.values(lineScope).some(Boolean) ? lineScope : undefined;
    }

    private async ensureKnowledgeGraph(): Promise<void> {
        if (Object.keys(this.knowledgeGraph.nodes).length || this.knowledgeGraph.edges.length) {
            return;
        }
        await this.refreshKnowledgeGraph();
    }

    private async refreshKnowledgeGraph(): Promise<void> {
        const delta = await this.knowledgeGraphDelta();
        const nextGraph = graphDeltaToKnowledgeGraph(delta);
        const graphNodes: Record<string, KnowledgeGraphNode> = { ...nextGraph.nodes };
        const graphEdges: KnowledgeGraphEdge[] = [...nextGraph.edges];

        if (!Object.keys(graphNodes).length) {
            const entityRows = await this.store.listEntities();
            for (const entity of entityRows) {
                graphNodes[entity.id] = {
                    id: entity.id,
                    kind: entity.kind,
                    label: entity.label,
                    props: { narrativeId: entity.narrativeId || '' },
                };
            }
        }

        if (!graphEdges.length) {
            const edgeRowsFallback = await this.store.listAllEdges();
            for (const edge of edgeRowsFallback) {
                graphEdges.push({
                    source: edge.sourceId,
                    target: edge.targetId,
                    relation: edge.relType,
                    weight: edge.confidence,
                    props: {},
                });
            }
        }

        this.knowledgeGraph = {
            nodes: graphNodes,
            edges: graphEdges,
        };
    }

    private async walkKnowledgeGraph(
        startId: string,
        direction: 'children' | 'parents',
        relation?: string,
        maxDepth = -1,
    ): Promise<any[]> {
        await this.ensureKnowledgeGraph();
        const results = new Map<string, KnowledgeGraphNode>();
        const queue: Array<{ id: string; depth: number }> = [{ id: startId, depth: 0 }];
        const seen = new Set<string>([startId]);

        while (queue.length) {
            const current = queue.shift();
            if (!current) {
                continue;
            }

            const matches = this.knowledgeGraph.edges.filter((edge) => {
                if (relation && edge.relation !== relation) {
                    return false;
                }
                return direction === 'children' ? edge.source === current.id : edge.target === current.id;
            });

            for (const edge of matches) {
                const nextId = direction === 'children' ? edge.target : edge.source;
                if (seen.has(nextId)) {
                    continue;
                }
                seen.add(nextId);
                const node = this.knowledgeGraph.nodes[nextId];
                if (node) {
                    results.set(nextId, node);
                }
                if (maxDepth < 0 || current.depth + 1 < maxDepth) {
                    queue.push({ id: nextId, depth: current.depth + 1 });
                }
            }
        }

        return Array.from(results.values());
    }
}

function buildGraphFromScanResult(text: string, scan: any, structure: any): {
    nodes: Record<string, { id: string; label: string; kind: string }>;
    edges: Array<{ Source: string; Target: string; Relation: string }>;
} {
    const nodes: Record<string, { id: string; label: string; kind: string }> = {};
    const mentionByKey = new Map<string, { id: string; label: string; kind: string }>();
    const rangeConverter = createUtf8ByteRangeConverter(text);
    const slice = (range: any) => rangeConverter.slice(range);
    const mentions = Array.isArray(scan?.mentions) ? scan.mentions : [];

    for (const mention of mentions) {
        const key = mentionKey(mention, slice);
        if (!key) {
            continue;
        }
        const label = String(mention?.surface || slice(mention?.range) || key);
        const kind = String(mention?.kind || 'UNKNOWN');
        const node = { id: key, label, kind };
        nodes[key] = node;
        mentionByKey.set(key, node);
    }

    const edges: Array<{ Source: string; Target: string; Relation: string }> = [];
    const relations = Array.isArray(structure?.relations) ? structure.relations : [];
    for (const relation of relations) {
        const source = frameSlotToNodeId(relation?.subject, mentionByKey, slice);
        const target = frameSlotToNodeId(relation?.object || relation?.recipient, mentionByKey, slice);
        if (!source || !target) {
            continue;
        }
        edges.push({
            Source: source,
            Target: target,
            Relation: String(relation?.relationType || relation?.lemma || 'RELATED_TO'),
        });
    }

    return { nodes, edges };
}

function frameSlotToNodeId(
    slot: any,
    mentionByKey: Map<string, { id: string; label: string; kind: string }>,
    sliceRange: (range: any) => string,
): string | null {
    if (!slot) {
        return null;
    }
    const entityRef = slot?.entityRef;
    if (typeof entityRef === 'string' && mentionByKey.has(entityRef)) {
        return entityRef;
    }
    if (entityRef && typeof entityRef === 'object') {
        if (typeof entityRef.Known === 'string') return entityRef.Known;
        if (typeof entityRef.known === 'string') return entityRef.known;
        if (typeof entityRef.Speculative === 'string') return entityRef.Speculative;
        if (typeof entityRef.speculative === 'string') return entityRef.speculative;
    }
    const label = sliceRange(slot?.range);
    return label || null;
}

function mentionKey(mention: any, sliceRange: (range: any) => string): string | null {
    const entityRef = mention?.entityRef;
    if (entityRef && typeof entityRef === 'object') {
        if (typeof entityRef.Known === 'string') return entityRef.Known;
        if (typeof entityRef.known === 'string') return entityRef.known;
        if (typeof entityRef.Speculative === 'string') return entityRef.Speculative;
        if (typeof entityRef.speculative === 'string') return entityRef.speculative;
    }
    return String(mention?.surface || sliceRange(mention?.range) || '').trim() || null;
}

function mergeSearchResult(results: Map<string, PhoenixSearchResult>, next: PhoenixSearchResult): void {
    const current = results.get(next.DocID);
    if (!current) {
        results.set(next.DocID, next);
        return;
    }
    current.Score = Math.max(current.Score, next.Score);
    if (next.LineNumber !== undefined && current.LineNumber === undefined) {
        current.LineNumber = next.LineNumber;
        current.Snippet = next.Snippet;
    }
    if (next.Score >= current.Score) {
        current.ChunkID = next.ChunkID;
    }
    if (next.LineHits?.length) {
        current.LineHits = [...(current.LineHits || []), ...next.LineHits];
    }
}

function knownMentionsToSpans(
    text: string,
    mentions: any[],
    dictionary: DictionaryEntry[],
): DecorationSpan[] {
    const byId = new Map(dictionary.map(entity => [entity.id, entity]));
    const rangeConverter = createUtf8ByteRangeConverter(text);
    const spans: DecorationSpan[] = [];
    for (const mention of mentions) {
        const entityId = entityIdFromRef(mention?.entityRef ?? mention?.entity_ref);
        if (!entityId) {
            continue;
        }
        const entity = byId.get(entityId);
        if (!entity) {
            continue;
        }
        const range = rangeConverter.toUtf16Range(mention?.range);
        if (!range || range.from >= range.to || range.to > text.length) {
            continue;
        }
        const source = String(mention?.source || '').toLocaleLowerCase();
        spans.push({
            type: 'entity_implicit',
            from: range.from,
            to: range.to,
            label: entity.label,
            kind: entity.kind as EntityKind,
            target: entity.label,
            matchedText: String(mention?.surface || rangeConverter.slice(mention?.range)),
            entityId,
            resolved: true,
            matchSource: source || 'known',
            confidence: Number(mention?.confidence || 0),
        });
    }
    for (const span of dictionaryLiteralSpans(text, dictionary)) {
        if (spans.some((existing) => spansOverlap(existing, span))) {
            continue;
        }
        spans.push(span);
    }
    return spans.sort((left, right) => left.from - right.from || left.to - right.to);
}

function dictionaryLiteralSpans(text: string, dictionary: DictionaryEntry[]): DecorationSpan[] {
    const patterns: Array<PhoenixLiteralPattern<DictionaryEntry>> = [];
    const seen = new Set<string>();
    for (const entity of dictionary) {
        for (const surface of [entity.label, ...(entity.aliases || [])]) {
            const normalized = String(surface || '').trim().replace(/\s+/g, ' ');
            const key = normalized.toLocaleLowerCase();
            if (!normalized || seen.has(key)) {
                continue;
            }
            seen.add(key);
            patterns.push({ text: normalized, payload: entity });
        }
    }

    return matchLiteralPatterns(text, patterns, {
        wholeWord: true,
    }).map((match) => {
        const entity = match.payload!;
        return {
            type: 'entity_implicit',
            from: match.from,
            to: match.to,
            label: entity.label,
            kind: entity.kind as EntityKind,
            target: entity.label,
            matchedText: match.text,
            entityId: entity.id,
            resolved: true,
            matchSource: 'dictionary',
            confidence: 1,
        };
    });
}

function spansOverlap(left: DecorationSpan, right: DecorationSpan): boolean {
    return left.from < right.to && right.from < left.to;
}

function entityIdFromRef(entityRef: unknown): string {
    if (typeof entityRef === 'string') {
        return entityRef;
    }
    if (entityRef && typeof entityRef === 'object') {
        const keyed = entityRef as Record<string, unknown>;
        if (typeof keyed['known'] === 'string') return keyed['known'];
        if (typeof keyed['Known'] === 'string') return keyed['Known'];
    }
    return '';
}

function toRustEntityKind(kind: string): string | null {
    switch (String(kind || '').toUpperCase()) {
        case 'CHARACTER':
            return 'character';
        case 'LOCATION':
            return 'location';
        case 'NPC':
            return 'npc';
        case 'ITEM':
            return 'item';
        case 'FACTION':
            return 'faction';
        case 'ORGANIZATION':
            return 'organization';
        case 'EVENT':
            return 'event';
        case 'CONCEPT':
            return 'concept';
        default:
            return 'other';
    }
}

function chunkIdToDocumentId(chunkId: string): string {
    const separator = chunkId.indexOf(':');
    return separator >= 0 ? chunkId.slice(0, separator) : chunkId;
}

function graphDeltaToKnowledgeGraph(delta: PhoenixGraphDeltaBinaryResult): KnowledgeGraphData {
    const nodes: Record<string, KnowledgeGraphNode> = {};
    for (const chunk of delta.chunks || []) {
        if (!chunk.vertexId) continue;
        nodes[chunk.vertexId] = {
            id: chunk.vertexId,
            kind: 'leaf',
            label: chunk.chunkId || chunk.vertexId,
            props: {
                chunkId: chunk.chunkId,
                documentId: chunk.documentId,
                noteId: chunk.noteId || chunk.documentId,
                chapterId: chunk.chapterId,
                start: chunk.start,
                end: chunk.end,
            },
        };
    }
    for (const node of delta.nodes || []) {
        if (!node.nodeId) continue;
        nodes[node.nodeId] = {
            id: node.nodeId,
            kind: node.kind || 'unknown',
            label: node.label || node.entityId || node.nodeId,
            props: {
                entityId: node.entityId,
                documentId: node.documentId,
                chapterId: node.chapterId,
                weight: node.weight,
            },
        };
    }
    const edges = (delta.edges || [])
        .map((edge) => ({
            source: edge.sourceId,
            target: edge.targetId,
            relation: edge.edgeType || 'edge',
            weight: edge.weight,
            props: {},
        }))
        .filter((edge) => edge.source && edge.target && nodes[edge.source] && nodes[edge.target]);
    return { nodes, edges };
}

function extractDocumentIds(value: string): string[] {
    if (!value) return [];
    return Array.from(value.matchAll(DOCUMENT_ID_PATTERN), (match) => match[0].toLocaleLowerCase());
}

function asRecord(value: unknown): Record<string, unknown> {
    return value && typeof value === 'object' && !Array.isArray(value)
        ? value as Record<string, unknown>
        : {};
}

function normalizeScanMentions(text: string, mentions: any[]): any[] {
    if (!mentions.length) {
        return mentions;
    }

    const rangeConverter = createUtf8ByteRangeConverter(text);
    return mentions.map((mention) => {
        const normalizedRange = rangeConverter.toUtf16Range(mention?.range);
        if (!normalizedRange) {
            return mention;
        }

        return {
            ...mention,
            range: {
                start: normalizedRange.from,
                end: normalizedRange.to,
            },
        };
    });
}

export const phoenixUiApiServiceTestHooks = {
    graphDeltaToKnowledgeGraph,
    knownMentionsToSpans,
};
