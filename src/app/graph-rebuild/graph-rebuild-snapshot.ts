import type { EntityOccurrence } from '../lib/dexie/db';
import type { RegisteredEntity } from '../lib/registry';

export type GraphRebuildScopeKind = 'global' | 'folder' | 'narrative' | 'note' | 'multiNote';
export type GraphRebuildAnchorSource = EntityOccurrence['source'] | 'accepted_suggestion';
export type GraphRebuildEdgeType = string;
export type GraphRebuildEmbeddingTargetKind = string;
export type GraphRebuildAdjudicationStatus = 'accepted' | 'review' | 'rejected';

export interface GraphRebuildChunk {
    id: string;
    noteId: string;
    start: number;
    end: number;
    ordinal: number;
    source: 'dynamic-chunking' | 'note-block' | 'note-fallback' | 'anchor-derived';
    textHash?: string;
}

export interface GraphRebuildMention {
    id: string;
    noteId: string;
    chunkId?: string;
    surface: string;
    sourceStart: number;
    sourceEnd: number;
    source: GraphRebuildAnchorSource;
    confidence: number;
    entityId?: string;
    status: 'candidate' | 'accepted' | 'dropped';
}

export interface GraphRebuildEntityAnchor extends GraphRebuildMention {
    entityId: string;
    status: 'accepted';
    generation: number;
}

export interface GraphRebuildNode {
    id: string;
    entityId: string;
    label: string;
    kind: string;
    aliases: string[];
    anchorIds: string[];
    noteIds: string[];
    totalMentions: number;
}

export interface GraphRebuildEdge {
    id: string;
    sourceId: string;
    targetId: string;
    type: GraphRebuildEdgeType;
    weight: number;
    confidence: number;
    evidenceAnchorIds: string[];
    scopeKeys: string[];
    noteIds: string[];
}

export interface GraphRebuildRelationship {
    id: string;
    sourceEntityId: string;
    targetEntityId: string;
    relationType: string;
    evidenceAnchorIds: string[];
    confidence: number;
    status: GraphRebuildAdjudicationStatus;
    adjudicationSource: string;
    adjudicationScore: number;
    rationale: string;
    decisionEvidence: string[];
}

export interface GraphRebuildRelationshipHint {
    sourceId: string;
    targetId: string;
    relationType?: string;
    status: GraphRebuildAdjudicationStatus;
    confidence: number;
    source: string;
    evidence?: string[];
}

export interface GraphRebuildEvent {
    id: string;
    noteId: string;
    chunkId?: string;
    label: string;
    entityIds: string[];
    evidenceAnchorIds: string[];
    confidence: number;
}

export interface GraphRebuildEpisode {
    id: string;
    noteId: string;
    eventIds: string[];
    entityIds: string[];
    label: string;
}

export interface GraphRebuildTemporalEdge {
    id: string;
    sourceId: string;
    targetId: string;
    relationType: string;
    evidenceIds: string[];
    confidence: number;
}

export interface GraphRebuildCausalEdge extends GraphRebuildTemporalEdge {}

export interface GraphRebuildMemoryState {
    id: string;
    entityId: string;
    noteId?: string;
    key: string;
    value: string;
    evidenceIds: string[];
}

export interface GraphRebuildEmbeddingTarget {
    id: string;
    kind: GraphRebuildEmbeddingTargetKind;
    sourceId: string;
    noteId?: string;
    chunkId?: string;
    entityId?: string;
    label: string;
    text: string;
    evidenceIds: string[];
}

export interface GraphRebuildEmbeddingVector {
    targetId: string;
    modelId: string;
    dims: number;
    generation: number;
}

export interface GraphRebuildProjectionRef {
    targetId: string;
    manifold: 'hybrid' | 'hopf' | 'lorentz' | 'product' | 'hyperbolic';
    projectionId: string;
}

export interface GraphRebuildDropReasons {
    missingEntity: number;
    invalidSpan: number;
    duplicateAnchor: number;
    singletonBucket: number;
    missingChunk: number;
}

export type GraphRebuildResolutionSuggestionKind =
    | 'ambiguous_surface'
    | 'kind_conflict'
    | 'possible_alias'
    | 'possible_duplicate'
    | 'possible_split';

export interface GraphRebuildResolutionSuggestion {
    id: string;
    kind: GraphRebuildResolutionSuggestionKind;
    surface: string;
    noteId?: string;
    sourceStart?: number;
    sourceEnd?: number;
    entityIds: string[];
    status: 'review';
    rationale: string;
}

export interface GraphRebuildResolutionCounters {
    resolvedById: number;
    resolvedByLabel: number;
    resolvedByAlias: number;
    ambiguousSurfaces: number;
    kindConflicts: number;
    possibleAliases: number;
    droppedDuplicateSpans: number;
}

export interface GraphRebuildCounters {
    entities: number;
    aliases: number;
    candidates: number;
    mentions: number;
    acceptedAnchors: number;
    chunks: number;
    relationshipCandidates: number;
    relationships: number;
    acceptedRelationships: number;
    reviewRelationships: number;
    rejectedRelationships: number;
    events: number;
    episodes: number;
    temporalEdges: number;
    causalEdges: number;
    memoryState: number;
    embeddingTargets: number;
    embeddingVectors: number;
    projectionRefs: number;
    nodes: number;
    edges: number;
    dropReasons: GraphRebuildDropReasons;
    resolution?: GraphRebuildResolutionCounters;
}

export interface GraphRebuildSnapshot {
    schemaVersion: 'phoenix-graph-rebuild/v1';
    id: string;
    source: 'phoenix-graph-rebuild';
    scopeKind: GraphRebuildScopeKind;
    scopeId: string;
    noteIds: string[];
    builtAt: number;
    chunks: GraphRebuildChunk[];
    mentions: GraphRebuildMention[];
    entityAnchors: GraphRebuildEntityAnchor[];
    relationships: GraphRebuildRelationship[];
    events: GraphRebuildEvent[];
    episodes: GraphRebuildEpisode[];
    temporalEdges: GraphRebuildTemporalEdge[];
    causalEdges: GraphRebuildCausalEdge[];
    memoryState: GraphRebuildMemoryState[];
    embeddingTargets: GraphRebuildEmbeddingTarget[];
    embeddingVectors: GraphRebuildEmbeddingVector[];
    projectionRefs: GraphRebuildProjectionRef[];
    nodes: GraphRebuildNode[];
    edges: GraphRebuildEdge[];
    counters: GraphRebuildCounters;
    resolutionSuggestions?: GraphRebuildResolutionSuggestion[];
}

export type GraphIndexPolicy = 'delta' | 'force';
export type GraphIndexRunStatus = 'blocked' | 'running' | 'completed' | 'failed';
export type GraphIndexStageStatus = 'blocked' | 'skipped' | 'running' | 'completed' | 'failed';
export type GraphIndexProjectionMode = 'hybrid' | 'hopf' | 'lorentz' | 'product';

export interface GraphIndexRunScope {
    kind: GraphRebuildScopeKind;
    scopeId: string;
    label: string;
    noteIds: string[];
}

export interface GraphIndexModelSelection {
    dynamicNerId: 'dynamic_ner';
    embeddingModelId: string;
    embeddingModelLabel: string;
    embeddingDimensionLabel: string;
    nliModelId: string;
}

export interface GraphIndexRunRequest {
    scope: GraphIndexRunScope;
    policy: GraphIndexPolicy;
    modelSelection: GraphIndexModelSelection;
    entities: RegisteredEntity[];
}

export interface GraphIndexModelReadiness {
    id: 'dynamicNer' | 'semanticEmbedding' | 'nli';
    label: string;
    status: 'idle' | 'warming' | 'running' | 'ready' | 'error';
    detail: string;
}

export interface GraphIndexStageReceipt {
    id: string;
    label: string;
    status: GraphIndexStageStatus;
    startedAt: number;
    completedAt: number;
    durationMs: number;
    outputCount: number;
    counters: Record<string, number>;
    message: string;
}

export interface GraphIndexProjectionReceipt {
    mode: GraphIndexProjectionMode;
    status: 'synced' | 'stale' | 'error' | 'skipped';
    startedAt: number;
    completedAt: number;
    durationMs: number;
    targetCount: number;
    vectorCount: number;
    message: string;
}

export interface GraphIndexRunReceipt {
    schemaVersion: 'phoenix-graph-index-run/v1';
    id: string;
    scope: GraphIndexRunScope;
    policy: GraphIndexPolicy;
    delta: boolean;
    status: GraphIndexRunStatus;
    modelSelection: GraphIndexModelSelection;
    modelReadiness: GraphIndexModelReadiness[];
    startedAt: number;
    completedAt: number;
    durationMs: number;
    stageReceipts: GraphIndexStageReceipt[];
    projectionReceipts: GraphIndexProjectionReceipt[];
    snapshotId?: string;
    counters: GraphRebuildCounters;
    dropReasons: GraphRebuildDropReasons;
    message: string;
}

export interface GraphRebuildCandidate {
    label: string;
    kind: string;
    aliases?: string[];
    confidence?: number;
}

export interface BuildGraphRebuildSnapshotInput {
    scopeKind: GraphRebuildScopeKind;
    scopeId: string;
    noteIds?: string[];
    entities: RegisteredEntity[];
    occurrences: EntityOccurrence[];
    chunks?: GraphRebuildChunk[];
    relationshipHints?: GraphRebuildRelationshipHint[];
    noteTexts?: Record<string, string>;
    candidateCount?: number;
    builtAt?: number;
}
