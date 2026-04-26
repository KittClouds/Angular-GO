export interface GraphAuditScope {
    folderId?: string;
    narrativeId?: string;
    noteIds?: readonly string[];
}

export interface GraphAuditBucket {
    key: string;
    count: number;
}

export interface GraphAuditNodeSample {
    id: string;
    label: string;
    kind: string;
    noteId: string;
    documentId: string;
    folderId: string;
}

export interface GraphAuditEdgeSample {
    sourceId: string;
    targetId: string;
    edgeType: string;
    noteId: string;
    documentId: string;
    folderId: string;
}

export interface GraphAuditDuplicateEdgeSample {
    key: string;
    count: number;
    sourceId: string;
    targetId: string;
    edgeType: string;
}

export interface GraphAuditStaleDocumentSample {
    documentId: string;
    relation: 'graph_vertices' | 'graph_edges';
    field: 'document_id' | 'note_id' | 'id' | 'source_id' | 'target_id';
    rowId: string;
    kind: string;
}

export interface GraphAuditSnapshot {
    notes: number;
    registryEntities: number;
    registryEdges: number;
    graphNodes: number;
    graphEdges: number;
    liveDocuments: number;
    indexedDocuments: number;
    staleDocuments: number;
    staleDocumentIds: string[];
    staleDocumentSamples: GraphAuditStaleDocumentSample[];
    orphanEdges: number;
    duplicateEdges: number;
    nodeKinds: GraphAuditBucket[];
    edgeTypes: GraphAuditBucket[];
    sampleNodes: GraphAuditNodeSample[];
    sampleEdges: GraphAuditEdgeSample[];
    orphanEdgeSamples: GraphAuditEdgeSample[];
    duplicateEdgeSamples: GraphAuditDuplicateEdgeSample[];
    updatedAt: number;
}
