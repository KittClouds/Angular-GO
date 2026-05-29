import type {
    GraphModelV2Atom,
    GraphModelV2FactFamily,
    GraphModelV2ProjectionEdge,
    GraphModelV2RelationFact,
    GraphModelV2Snapshot,
    GraphModelV2StyleTag,
} from './graph-model-v2';
import type { GraphRebuildScopeKind, GraphRebuildSnapshot } from './graph-rebuild-snapshot';

export interface GraphModelV2OverGraphExport {
    schemaVersion: 'phoenix-graph-model-v2-overgraph/v1';
    sourceSnapshotId: string;
    sourceModelSchemaVersion: GraphModelV2Snapshot['schemaVersion'];
    builtAt: number;
    scope: GraphModelV2OverGraphScope;
    graphBatch: GraphModelV2KernelMutationBatch;
    summary: GraphModelV2OverGraphSummary;
}

export interface GraphModelV2OverGraphScope {
    kind: GraphRebuildScopeKind;
    scopeId: string;
    scopeKey: string;
    noteIds: string[];
}

export interface GraphModelV2OverGraphSummary {
    atomVertices: number;
    factVertices: number;
    roleEdges: number;
    projectionEdges: number;
    candidateEdges: number;
    assertedEdges: number;
    droppedProjectionEdges: number;
    styleTags: number;
}

export interface GraphModelV2KernelMutationBatch {
    layer: 'asserted';
    scope: { kind: 'projection'; scopeKey: string };
    recordedAt: number;
    vertices: GraphModelV2KernelVertex[];
    edges: GraphModelV2KernelEdge[];
}

export interface GraphModelV2KernelVertex {
    id: string;
    kind: string;
    class: GraphModelV2KernelVertexClass;
    labels: string[];
    weight: number;
    value: Record<string, unknown>;
    attributes: Record<string, unknown>;
    temporal: Record<string, never>;
    provenance: GraphModelV2KernelProvenance;
    entityId?: string;
    searchChunkId?: string;
    documentId?: string;
    noteId?: string;
    narrativeId?: string;
    folderId?: string;
    folderPath?: string;
    chapterId?: number;
    chapters: number[];
    boundaryId?: number;
    boundaryOrdinal?: number;
    boundaryKind?: string;
    boundaryOrdinals: number[];
    entityFacet?: GraphModelV2KernelEntityFacet;
    calendarFacet?: Record<string, unknown>;
}

export interface GraphModelV2KernelEdge {
    sourceId: string;
    targetId: string;
    edgeType: string;
    relationClass: GraphModelV2KernelRelationClass;
    weight: number;
    attributes: Record<string, unknown>;
    data?: Record<string, unknown>;
    documentId?: string;
    noteId?: string;
    narrativeId?: string;
    folderId?: string;
    folderPath?: string;
    layer: 'asserted' | 'candidate';
    temporal: Record<string, never>;
    provenance: GraphModelV2KernelProvenance;
    resolutionFacet?: Record<string, unknown>;
}

export interface GraphModelV2KernelProvenance {
    resolver?: string;
    source?: string;
    confidence?: number;
    evidenceRefs: string[];
}

export interface GraphModelV2KernelEntityFacet {
    canonicalEntityId?: string;
    surface?: string;
    entityKind?: string;
}

type GraphModelV2KernelVertexClass =
    | 'document'
    | 'chunk'
    | 'entity'
    | 'mention'
    | 'timeAnchor'
    | 'memory'
    | 'state'
    | 'event'
    | 'generic';

type GraphModelV2KernelRelationClass =
    | 'structural'
    | 'semantic'
    | 'temporal'
    | 'memory'
    | 'narrative'
    | 'candidate'
    | 'custom';

export function buildGraphModelV2OverGraphExport(snapshot: GraphRebuildSnapshot): GraphModelV2OverGraphExport {
    const model = snapshot.graphModelV2;
    if (!model) throw new Error('Graph model v2 sidecar is required before building the OverGraph export.');

    const scopeKey = graphModelV2OverGraphScopeKey(snapshot.scopeKind, snapshot.scopeId);
    const styleByTarget = styleTagsByTarget(model.styleTags);
    const factById = new Map<string, GraphModelV2RelationFact>();
    for (const fact of model.facts) factById.set(fact.id, fact);

    const vertices: GraphModelV2KernelVertex[] = new Array(model.atoms.length + model.facts.length);
    let vertexIndex = 0;
    for (const atom of model.atoms) vertices[vertexIndex++] = atomVertex(atom, styleByTarget.get(atom.id) || []);
    for (const fact of model.facts) vertices[vertexIndex++] = factVertex(fact, styleByTarget.get(fact.id) || []);

    const edges: GraphModelV2KernelEdge[] = [];
    edges.length = model.roles.length + model.projectionEdges.length;
    let edgeIndex = 0;
    for (const role of model.roles) {
        const fact = factById.get(role.factId);
        edges[edgeIndex++] = roleEdge(role.factId, role.targetAtomId, role.role, role.confidence, fact);
    }

    let droppedProjectionEdges = 0;
    for (const edge of model.projectionEdges) {
        if (edge.projectionKind === 'factRole') {
            droppedProjectionEdges += 1;
            continue;
        }
        edges[edgeIndex++] = projectionEdge(edge, factById.get(edge.sourceFactId || ''));
    }
    edges.length = edgeIndex;

    vertices.sort((left, right) => left.id.localeCompare(right.id));
    edges.sort((left, right) =>
        left.sourceId.localeCompare(right.sourceId)
        || left.targetId.localeCompare(right.targetId)
        || left.edgeType.localeCompare(right.edgeType)
    );

    let candidateEdges = 0;
    for (const edge of edges) if (edge.layer === 'candidate') candidateEdges += 1;

    return {
        schemaVersion: 'phoenix-graph-model-v2-overgraph/v1',
        sourceSnapshotId: snapshot.id,
        sourceModelSchemaVersion: model.schemaVersion,
        builtAt: model.builtAt,
        scope: {
            kind: snapshot.scopeKind,
            scopeId: snapshot.scopeId,
            scopeKey,
            noteIds: snapshot.noteIds,
        },
        graphBatch: {
            layer: 'asserted',
            scope: { kind: 'projection', scopeKey },
            recordedAt: model.builtAt,
            vertices,
            edges,
        },
        summary: {
            atomVertices: model.atoms.length,
            factVertices: model.facts.length,
            roleEdges: model.roles.length,
            projectionEdges: edges.length - model.roles.length,
            candidateEdges,
            assertedEdges: edges.length - candidateEdges,
            droppedProjectionEdges,
            styleTags: model.styleTags.length,
        },
    };
}

export function graphModelV2OverGraphScopeKey(kind: GraphRebuildScopeKind, scopeId: string): string {
    return `graph-model-v2:${kind}:${scopeId || '__global__'}`;
}

function atomVertex(atom: GraphModelV2Atom, styleTags: GraphModelV2StyleTag[]): GraphModelV2KernelVertex {
    return baseVertex({
        id: atom.id,
        kind: `graphModelV2Atom:${atom.kind}`,
        className: atomClass(atom.kind),
        label: atom.label,
        evidenceIds: atom.evidenceIds,
        noteId: atom.noteId,
        chunkId: atom.chunkId,
        entityId: atom.kind === 'entity' || atom.kind === 'concept' ? atom.sourceId : undefined,
        entityKind: atom.entityKind,
        attributes: {
            graphModelV2: {
                targetType: 'atom',
                atomKind: atom.kind,
                sourceId: atom.sourceId,
                styleTags: compactStyleTags(styleTags),
            },
        },
    });
}

function factVertex(fact: GraphModelV2RelationFact, styleTags: GraphModelV2StyleTag[]): GraphModelV2KernelVertex {
    return baseVertex({
        id: fact.id,
        kind: `graphModelV2Fact:${fact.family}`,
        className: fact.family === 'memory' ? 'memory' : 'generic',
        label: fact.relationType,
        evidenceIds: fact.evidenceIds,
        attributes: {
            graphModelV2: {
                targetType: 'fact',
                family: fact.family,
                relationType: fact.relationType,
                lane: fact.lane,
                status: fact.status,
                sourceRecordId: fact.sourceRecordId,
                styleTags: compactStyleTags(styleTags),
            },
        },
        confidence: fact.confidence,
    });
}

function baseVertex(input: {
    id: string;
    kind: string;
    className: GraphModelV2KernelVertexClass;
    label: string;
    evidenceIds: string[];
    attributes: Record<string, unknown>;
    confidence?: number;
    noteId?: string;
    chunkId?: string;
    entityId?: string;
    entityKind?: string;
}): GraphModelV2KernelVertex {
    return {
        id: input.id,
        kind: input.kind,
        class: input.className,
        labels: input.label ? [input.label] : [],
        weight: weightMillis(input.confidence ?? 0.72),
        value: { label: input.label },
        attributes: input.attributes,
        temporal: {},
        provenance: { source: 'graph-model-v2', confidence: input.confidence, evidenceRefs: input.evidenceIds },
        entityId: input.entityId,
        searchChunkId: input.chunkId,
        documentId: input.noteId,
        noteId: input.noteId,
        chapters: [],
        boundaryOrdinals: [],
        entityFacet: input.entityId ? {
            canonicalEntityId: input.entityId,
            surface: input.label,
            entityKind: input.entityKind,
        } : undefined,
    };
}

function roleEdge(
    sourceId: string,
    targetId: string,
    role: string,
    confidence: number,
    fact?: GraphModelV2RelationFact,
): GraphModelV2KernelEdge {
    const family = fact?.family || 'unknown';
    return baseEdge({
        sourceId,
        targetId,
        edgeType: `role:${role}`,
        relationClass: relationClass(family),
        confidence,
        layer: fact?.status === 'review' || fact?.status === 'rejected' ? 'candidate' : 'asserted',
        evidenceIds: fact?.evidenceIds || [],
        attributes: {
            graphModelV2: {
                edgeKind: 'factRole',
                role,
                factFamily: family,
                factStatus: fact?.status,
            },
        },
    });
}

function projectionEdge(edge: GraphModelV2ProjectionEdge, fact?: GraphModelV2RelationFact): GraphModelV2KernelEdge {
    return baseEdge({
        sourceId: edge.sourceId,
        targetId: edge.targetId,
        edgeType: edge.edgeType,
        relationClass: edge.projectionKind === 'structure' ? 'structural' : relationClass(fact?.family || edge.edgeType),
        confidence: edge.confidence,
        layer: fact?.status === 'review' || fact?.status === 'rejected' ? 'candidate' : 'asserted',
        evidenceIds: fact?.evidenceIds || [],
        attributes: {
            graphModelV2: {
                edgeKind: 'projection',
                projectionKind: edge.projectionKind,
                sourceFactId: edge.sourceFactId,
                factFamily: fact?.family,
            },
        },
    });
}

function baseEdge(input: {
    sourceId: string;
    targetId: string;
    edgeType: string;
    relationClass: GraphModelV2KernelRelationClass;
    confidence: number;
    layer: 'asserted' | 'candidate';
    evidenceIds: string[];
    attributes: Record<string, unknown>;
}): GraphModelV2KernelEdge {
    return {
        sourceId: input.sourceId,
        targetId: input.targetId,
        edgeType: input.edgeType,
        relationClass: input.relationClass,
        weight: weightMillis(input.confidence),
        attributes: input.attributes,
        layer: input.layer,
        temporal: {},
        provenance: {
            source: 'graph-model-v2',
            confidence: input.confidence,
            evidenceRefs: input.evidenceIds,
        },
    };
}

function styleTagsByTarget(styleTags: GraphModelV2StyleTag[]): Map<string, GraphModelV2StyleTag[]> {
    const byTarget = new Map<string, GraphModelV2StyleTag[]>();
    for (const tag of styleTags) {
        const bucket = byTarget.get(tag.targetId);
        if (bucket) bucket.push(tag);
        else byTarget.set(tag.targetId, [tag]);
    }
    return byTarget;
}

function compactStyleTags(tags: GraphModelV2StyleTag[]): Record<string, string[]> {
    const compact: Record<string, string[]> = {};
    for (const tag of tags) {
        const bucket = compact[tag.tagKind];
        if (bucket) bucket.push(tag.value);
        else compact[tag.tagKind] = [tag.value];
    }
    return compact;
}

function atomClass(kind: GraphModelV2Atom['kind']): GraphModelV2KernelVertexClass {
    if (kind === 'document') return 'document';
    if (kind === 'chunk') return 'chunk';
    if (kind === 'sourceSpan' || kind === 'evidenceAnchor') return 'mention';
    if (kind === 'entity' || kind === 'concept') return 'entity';
    if (kind === 'event') return 'event';
    if (kind === 'state') return 'state';
    if (kind === 'claim') return 'memory';
    if (kind === 'timeAnchor') return 'timeAnchor';
    return 'generic';
}

function relationClass(family: GraphModelV2FactFamily | string): GraphModelV2KernelRelationClass {
    if (family === 'temporal') return 'temporal';
    if (family === 'memory') return 'memory';
    if (family === 'cooccurrence') return 'candidate';
    if (family === 'causal') return 'semantic';
    if (family === 'family' || family === 'intimacy') return 'narrative';
    return 'semantic';
}

function weightMillis(confidence: number): number {
    return Math.max(1, Math.min(1000, Math.round(confidence * 1000)));
}
