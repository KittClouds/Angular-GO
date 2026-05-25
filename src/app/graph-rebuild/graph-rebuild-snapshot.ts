import type { EntityOccurrence } from '../lib/dexie/db';
import type { RegisteredEntity } from '../lib/registry';

export type GraphRebuildScopeKind = 'global' | 'folder' | 'narrative' | 'note' | 'multiNote';
export type GraphRebuildAnchorSource = EntityOccurrence['source'] | 'accepted_suggestion';
export type GraphRebuildEdgeType = string;
export type GraphRebuildEmbeddingTargetKind = string;
export type GraphRebuildAdjudicationStatus = 'accepted' | 'review' | 'rejected';
export type GraphRebuildChunkRole =
    | 'dialogue'
    | 'scene_action'
    | 'exposition_packet'
    | 'authority_chain'
    | 'evidence_block'
    | 'transition'
    | 'mixed';

export interface GraphRebuildChunkEntityPrior {
    surface: string;
    likelyKinds: string[];
    reason: string;
    confidence: number;
}

export interface GraphRebuildMeaningFrame {
    role: GraphRebuildChunkRole;
    splitReason: string;
    breakPressure: number;
    mergePressure: number;
    entityPriors: GraphRebuildChunkEntityPrior[];
    eventCues: string[];
    modalCues: string[];
    temporalCues: string[];
    authorityCues: string[];
    evidenceCues: string[];
    carryoverIn: string[];
    carryoverOut: string[];
}

export interface GraphRebuildChunk {
    id: string;
    noteId: string;
    start: number;
    end: number;
    ordinal: number;
    source: 'dynamic-chunking' | 'note-block' | 'note-fallback' | 'anchor-derived';
    textHash?: string;
    role?: GraphRebuildChunkRole;
    splitReason?: string;
    meaningFrame?: GraphRebuildMeaningFrame;
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

export type GraphRebuildEventAspectKind =
    | 'state'
    | 'activity'
    | 'process'
    | 'performance'
    | 'endeavor'
    | 'habitual'
    | 'transition';

export type GraphRebuildEventCompletion =
    | 'completed'
    | 'ongoing'
    | 'planned'
    | 'attempted'
    | 'reported'
    | 'hypothetical'
    | 'unknown';

export interface GraphRebuildEventAspect {
    kind: GraphRebuildEventAspectKind;
    completion: GraphRebuildEventCompletion;
    confidence: number;
    cues: string[];
    rationale: string;
}

export interface GraphRebuildEvent {
    id: string;
    noteId: string;
    chunkId?: string;
    label: string;
    entityIds: string[];
    evidenceAnchorIds: string[];
    confidence: number;
    aspect?: GraphRebuildEventAspect;
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
    entityKind?: string;
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

export type GraphRebuildEmbeddingTaskProfile =
    | 'retrieval'
    | 'semantic_topology'
    | 'multi_task'
    | 'unknown';

export interface GraphRebuildEmbeddingProfile {
    schemaVersion: 'phoenix-embedding-profile/v1';
    modelId: string;
    modelLabel: string;
    modelFamily: string;
    dimensionLabel: string;
    nativeDimensions: number;
    selectedDimensions: number;
    taskProfile: GraphRebuildEmbeddingTaskProfile;
    vectorSource: 'signature-preview' | 'semantic-runner';
    normalized: boolean;
}

export interface GraphRebuildProjectionRef {
    targetId: string;
    manifold: 'hybrid' | 'hopf' | 'lorentz' | 'product' | 'hyperbolic';
    projectionId: string;
}

export type GraphRebuildStructuralNodeRole = 'isolated' | 'leaf' | 'connector' | 'hub' | 'bridge';
export type GraphRebuildStructuralEdgeRole = 'local' | 'backbone' | 'bridge';

export interface GraphRebuildStructuralComponent {
    id: string;
    nodeIds: string[];
    edgeIds: string[];
    size: number;
    density: number;
}

export interface GraphRebuildStructuralNode {
    entityId: string;
    role: GraphRebuildStructuralNodeRole;
    degree: number;
    componentId: string;
}

export interface GraphRebuildStructuralEdge {
    edgeId: string;
    role: GraphRebuildStructuralEdgeRole;
    sourceId: string;
    targetId: string;
    componentId: string;
}

export interface GraphRebuildStructuralPostProcess {
    schemaVersion: 'phoenix-graph-structure/v1';
    components: GraphRebuildStructuralComponent[];
    nodes: GraphRebuildStructuralNode[];
    edges: GraphRebuildStructuralEdge[];
    hubEntityIds: string[];
    bridgeEdgeIds: string[];
}

export type GraphRebuildEmbeddingClusterRole =
    | 'document_region'
    | 'entity_region'
    | 'fact_region'
    | 'event_region'
    | 'mixed_region';

export type GraphRebuildEmbeddingBackboneRole = 'local' | 'backbone' | 'bridge';

export interface GraphRebuildProductLaneFeatures {
    semanticDepth: number;
    documentDepth: number;
    relationDepth: number;
    clusterRadius: number;
    fiberPhase: number;
    confidence: number;
}

export interface GraphRebuildEmbeddingCluster {
    id: string;
    role: GraphRebuildEmbeddingClusterRole;
    targetIds: string[];
    medoidTargetId: string;
    size: number;
    density: number;
    confidence: number;
    topKinds: string[];
    outlierTargetIds: string[];
}

export interface GraphRebuildEmbeddingTargetPostProcess {
    targetId: string;
    clusterId: string;
    clusterRole: GraphRebuildEmbeddingClusterRole;
    medoidTargetId: string;
    outlierScore: number;
    hubScore: number;
    neighborCount: number;
    productLaneFeatures: GraphRebuildProductLaneFeatures;
}

export interface GraphRebuildEmbeddingBackboneEdge {
    id: string;
    sourceTargetId: string;
    targetTargetId: string;
    role: GraphRebuildEmbeddingBackboneRole;
    score: number;
    semanticScore: number;
    structuralScore: number;
    reason: string[];
}

export interface GraphRebuildEmbeddingGraphMetrics {
    clusterCount: number;
    singletonCount: number;
    largestClusterSize: number;
    largestClusterRatio: number;
    backboneEdgeCount: number;
    bridgeEdgeCount: number;
    outlierCount: number;
    maxHubScore: number;
    meanNeighborCount: number;
}

export interface GraphRebuildEmbeddingGraphPostProcess {
    schemaVersion: 'phoenix-embedding-graph-postprocess/v1';
    profile: GraphRebuildEmbeddingProfile;
    targetCount: number;
    vectorDimensions: number;
    clusters: GraphRebuildEmbeddingCluster[];
    targets: GraphRebuildEmbeddingTargetPostProcess[];
    backboneEdges: GraphRebuildEmbeddingBackboneEdge[];
    bridgeEdges: GraphRebuildEmbeddingBackboneEdge[];
    outlierTargetIds: string[];
    metrics: GraphRebuildEmbeddingGraphMetrics;
}

export type GraphRebuildLinkSuggestionKind =
    | 'bridge_review'
    | 'hub_affiliation'
    | 'backbone_promotion'
    | 'missing_triangle'
    | 'suspicious_leaf';

export interface GraphRebuildLinkSuggestion {
    id: string;
    kind: GraphRebuildLinkSuggestionKind;
    sourceEntityId: string;
    targetEntityId: string;
    suggestedRelationType: string;
    status: 'review' | 'confirmed';
    confidence: number;
    semanticStatus: GraphRebuildAdjudicationStatus | 'none';
    structuralRole: GraphRebuildStructuralEdgeRole | GraphRebuildStructuralNodeRole | 'shared_component';
    rationale: string[];
    evidenceIds: string[];
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
    structuralComponents?: number;
    structuralHubs?: number;
    structuralBridgeEdges?: number;
    embeddingClusters?: number;
    embeddingSingletonClusters?: number;
    embeddingBackboneEdges?: number;
    embeddingBridgeEdges?: number;
    embeddingOutliers?: number;
    graphAwareLinkSuggestions?: number;
    meaningFrameChunks?: number;
    eventAspects?: number;
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
    embeddingProfile?: GraphRebuildEmbeddingProfile;
    embeddingGraphPostProcess?: GraphRebuildEmbeddingGraphPostProcess;
    projectionRefs: GraphRebuildProjectionRef[];
    nodes: GraphRebuildNode[];
    edges: GraphRebuildEdge[];
    structuralPostProcess?: GraphRebuildStructuralPostProcess;
    graphAwareLinkSuggestions?: GraphRebuildLinkSuggestion[];
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
    embeddingProfile?: Partial<GraphRebuildEmbeddingProfile>;
    candidateCount?: number;
    builtAt?: number;
}
