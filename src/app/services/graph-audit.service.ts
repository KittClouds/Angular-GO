import { Injectable, inject } from '@angular/core';

import type { PhoenixGraphDeltaBinaryResult } from './phoenix-wasm.service';
import { PhoenixStoreService } from './phoenix-store.service';
import { PhoenixUiApiService } from './phoenix-ui-api.service';
import {
    type GraphAuditBucket,
    type GraphAuditDuplicateEdgeSample,
    type GraphAuditEdgeSample,
    type GraphAuditNodeSample,
    type GraphAuditScope,
    type GraphAuditSnapshot,
    type GraphAuditStaleDocumentSample,
} from './graph-audit.model';

type GraphRow = Record<string, unknown>;
type AuditNode = GraphAuditNodeSample & { owned: boolean };
type AuditEdge = GraphAuditEdgeSample;

const DOCUMENT_ID_PATTERN = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi;

const EMPTY_AUDIT: Omit<GraphAuditSnapshot, 'updatedAt'> = {
    notes: 0,
    registryEntities: 0,
    registryEdges: 0,
    graphNodes: 0,
    graphEdges: 0,
    liveDocuments: 0,
    indexedDocuments: 0,
    staleDocuments: 0,
    staleDocumentIds: [],
    staleDocumentSamples: [],
    orphanEdges: 0,
    duplicateEdges: 0,
    nodeKinds: [],
    edgeTypes: [],
    sampleNodes: [],
    sampleEdges: [],
    orphanEdgeSamples: [],
    duplicateEdgeSamples: [],
};

@Injectable({ providedIn: 'root' })
export class GraphAuditService {
    private readonly phoenix = inject(PhoenixUiApiService);
    private readonly store = inject(PhoenixStoreService);

    async snapshot(scope: GraphAuditScope = {}): Promise<GraphAuditSnapshot> {
        const liveNotes = await this.liveNotes(scope).catch(() => null);
        const fallbackNotes = liveNotes ? liveNotes.length : await this.store.countNotes().catch(() => 0);
        const liveDocumentIds = new Set((liveNotes || []).map((note) => this.text(note['id'])).filter(Boolean));
        const changedDocuments = this.shouldLimitDocuments(scope)
            ? Array.from(liveDocumentIds)
            : Array.from(scope.noteIds || []);
        const [registryEntities, registryEdges, delta] = await Promise.all([
            this.store.listEntities().catch(() => []),
            this.store.listAllEdges().catch(() => []),
            this.phoenix.knowledgeGraphDelta(
                { folderId: scope.folderId, narrativeId: scope.narrativeId },
                changedDocuments,
            ).catch(() => emptyDelta()),
        ]);

        const hasLiveTruth = liveNotes !== null;
        const notes = liveNotes ? liveNotes.length : fallbackNotes;
        const liveDocuments = liveNotes ? liveDocumentIds.size : notes;
        const allNodes = this.deltaNodes(delta);
        const allEdges = this.deltaEdges(delta);
        const staleSamples: GraphAuditStaleDocumentSample[] = [];
        const graphDocumentIds = new Set<string>();
        const staleDocumentIds = new Set<string>();

        for (const node of allNodes) {
            this.collectDocumentRefs({
                ids: graphDocumentIds,
                staleIds: staleDocumentIds,
                samples: staleSamples,
                liveDocumentIds,
                hasLiveTruth,
                relation: 'graph_vertices',
                rowId: node.id,
                kind: node.kind,
                fields: [
                    ['document_id', node.documentId],
                    ['note_id', node.noteId],
                    ['id', node.id],
                ],
            });
        }
        for (const edge of allEdges) {
            this.collectDocumentRefs({
                ids: graphDocumentIds,
                staleIds: staleDocumentIds,
                samples: staleSamples,
                liveDocumentIds,
                hasLiveTruth,
                relation: 'graph_edges',
                rowId: `${edge.sourceId}->${edge.targetId}`,
                kind: edge.edgeType,
                fields: [
                    ['document_id', edge.documentId],
                    ['note_id', edge.noteId],
                    ['source_id', edge.sourceId],
                    ['target_id', edge.targetId],
                ],
            });
        }

        const liveNodes = hasLiveTruth
            ? allNodes.filter((node) => !node.owned || !this.hasStaleRef(node, liveDocumentIds))
            : allNodes;
        const liveEdges = hasLiveTruth
            ? allEdges.filter((edge) => !this.hasStaleRef(edge, liveDocumentIds))
            : allEdges;

        if (!liveNodes.length && !liveEdges.length) {
            return {
                ...EMPTY_AUDIT,
                notes,
                liveDocuments,
                registryEntities: registryEntities.length,
                registryEdges: registryEdges.length,
                indexedDocuments: hasLiveTruth
                    ? Array.from(graphDocumentIds).filter((id) => liveDocumentIds.has(id)).length
                    : graphDocumentIds.size,
                staleDocuments: staleDocumentIds.size,
                staleDocumentIds: Array.from(staleDocumentIds).sort(),
                staleDocumentSamples: staleSamples.slice(0, 8),
                updatedAt: Date.now(),
            };
        }

        const nodeIds = new Set(liveNodes.map((node) => node.id).filter(Boolean));
        const nodeKinds = new Map<string, number>();
        for (const node of liveNodes) this.bump(nodeKinds, node.kind || 'unknown');

        const edgeTypes = new Map<string, number>();
        const duplicateSeen = new Set<string>();
        const duplicates = new Map<string, GraphAuditDuplicateEdgeSample>();
        const orphanSamples: GraphAuditEdgeSample[] = [];
        let orphanEdges = 0;
        let duplicateEdges = 0;

        for (const edge of liveEdges) {
            this.bump(edgeTypes, edge.edgeType);
            if (!nodeIds.has(edge.sourceId) || !nodeIds.has(edge.targetId)) {
                orphanEdges += 1;
                if (orphanSamples.length < 8) orphanSamples.push(edge);
            }
            const duplicateKey = `${edge.sourceId}\u0000${edge.targetId}\u0000${edge.edgeType}`;
            if (duplicateSeen.has(duplicateKey)) {
                duplicateEdges += 1;
                const current = duplicates.get(duplicateKey);
                if (current) {
                    current.count += 1;
                } else if (duplicates.size < 8) {
                    duplicates.set(duplicateKey, {
                        key: duplicateKey,
                        count: 2,
                        sourceId: edge.sourceId,
                        targetId: edge.targetId,
                        edgeType: edge.edgeType,
                    });
                }
            } else {
                duplicateSeen.add(duplicateKey);
            }
        }

        return {
            notes,
            registryEntities: registryEntities.length,
            registryEdges: registryEdges.length,
            graphNodes: liveNodes.length,
            graphEdges: liveEdges.length,
            liveDocuments,
            indexedDocuments: hasLiveTruth
                ? Array.from(graphDocumentIds).filter((id) => liveDocumentIds.has(id)).length
                : graphDocumentIds.size,
            staleDocuments: staleDocumentIds.size,
            staleDocumentIds: Array.from(staleDocumentIds).sort(),
            staleDocumentSamples: staleSamples.slice(0, 8),
            orphanEdges,
            duplicateEdges,
            nodeKinds: this.buckets(nodeKinds),
            edgeTypes: this.buckets(edgeTypes),
            sampleNodes: liveNodes.slice(0, 16).map(({ owned: _owned, ...node }) => node),
            sampleEdges: liveEdges.slice(0, 16),
            orphanEdgeSamples: orphanSamples,
            duplicateEdgeSamples: Array.from(duplicates.values()),
            updatedAt: Date.now(),
        };
    }

    private shouldLimitDocuments(scope: GraphAuditScope): boolean {
        return Boolean(scope.noteIds?.length || scope.folderId || scope.narrativeId);
    }

    private deltaNodes(delta: PhoenixGraphDeltaBinaryResult): AuditNode[] {
        const nodes: AuditNode[] = [];
        for (const chunk of delta.chunks || []) {
            nodes.push({
                id: chunk.vertexId,
                label: chunk.chunkId || chunk.vertexId,
                kind: 'leaf',
                noteId: chunk.noteId || chunk.documentId,
                documentId: chunk.documentId,
                folderId: '',
                owned: true,
            });
        }
        for (const node of delta.nodes || []) {
            nodes.push({
                id: node.nodeId,
                label: node.label || node.entityId || node.nodeId,
                kind: node.kind || 'unknown',
                noteId: node.documentId || '',
                documentId: node.documentId || '',
                folderId: '',
                owned: this.isDocumentOwnedKind(node.kind),
            });
        }
        return nodes.filter((node) => node.id);
    }

    private deltaEdges(delta: PhoenixGraphDeltaBinaryResult): AuditEdge[] {
        return (delta.edges || [])
            .map((edge) => ({
                sourceId: edge.sourceId,
                targetId: edge.targetId,
                edgeType: edge.edgeType || 'edge',
                noteId: '',
                documentId: '',
                folderId: '',
            }))
            .filter((edge) => edge.sourceId && edge.targetId);
    }

    private hasStaleRef(row: GraphAuditNodeSample | GraphAuditEdgeSample, liveDocumentIds: Set<string>): boolean {
        return this.rowDocumentRefs(row).some((id) => !liveDocumentIds.has(id));
    }

    private rowDocumentRefs(row: GraphAuditNodeSample | GraphAuditEdgeSample): string[] {
        const refs = new Set<string>();
        const record = row as unknown as Record<string, string>;
        for (const field of ['documentId', 'noteId', 'id', 'sourceId', 'targetId']) {
            const value = record[field];
            if (!value) continue;
            if ((field === 'documentId' || field === 'noteId') && value) refs.add(value);
            for (const documentId of this.extractDocumentIds(value)) refs.add(documentId);
        }
        return Array.from(refs);
    }

    private collectDocumentRefs(request: {
        ids: Set<string>;
        staleIds: Set<string>;
        samples: GraphAuditStaleDocumentSample[];
        liveDocumentIds: Set<string>;
        hasLiveTruth: boolean;
        relation: 'graph_vertices' | 'graph_edges';
        rowId: string;
        kind: string;
        fields: Array<[GraphAuditStaleDocumentSample['field'], string]>;
    }): void {
        for (const [field, value] of request.fields) {
            for (const documentId of field === 'document_id' || field === 'note_id'
                ? [value].filter(Boolean)
                : this.extractDocumentIds(value)) {
                request.ids.add(documentId);
                if (!request.hasLiveTruth || request.liveDocumentIds.has(documentId)) continue;
                request.staleIds.add(documentId);
                if (request.samples.length < 32) {
                    request.samples.push({
                        documentId,
                        relation: request.relation,
                        field,
                        rowId: request.rowId,
                        kind: request.kind,
                    });
                }
            }
        }
    }

    private async liveNotes(scope: GraphAuditScope): Promise<GraphRow[]> {
        if (scope.noteIds?.length) {
            return scope.noteIds.map((id) => ({ id }));
        }
        const headers = await this.store.listNoteHeaders(scope.folderId && scope.folderId !== 'global' ? scope.folderId : undefined);
        return this.rows(headers).filter((note) => {
            if (scope.folderId && scope.folderId !== 'global' && this.text(note['folderId']) !== scope.folderId) return false;
            if (scope.narrativeId && this.text(note['narrativeId']) !== scope.narrativeId) return false;
            return true;
        });
    }

    private rows(value: unknown): GraphRow[] {
        return Array.isArray(value) ? value.filter((row): row is GraphRow => this.isRecord(row)) : [];
    }

    private isRecord(value: unknown): value is GraphRow {
        return Boolean(value && typeof value === 'object' && !Array.isArray(value));
    }

    private isDocumentOwnedKind(kind: string): boolean {
        return kind.toLocaleLowerCase() !== 'entity';
    }

    private text(value: unknown): string {
        return typeof value === 'string' ? value : value == null ? '' : String(value);
    }

    private extractDocumentIds(value: string): string[] {
        if (!value) return [];
        return Array.from(value.matchAll(DOCUMENT_ID_PATTERN), (match) => match[0]);
    }

    private bump(counts: Map<string, number>, key: string): void {
        counts.set(key, (counts.get(key) || 0) + 1);
    }

    private buckets(counts: Map<string, number>): GraphAuditBucket[] {
        return Array.from(counts, ([key, count]) => ({ key, count }))
            .sort((left, right) => right.count - left.count || left.key.localeCompare(right.key));
    }
}

function emptyDelta(): PhoenixGraphDeltaBinaryResult {
    return {
        sessionId: '',
        chunks: [],
        nodes: [],
        edges: [],
        diagnostics: [],
    };
}
