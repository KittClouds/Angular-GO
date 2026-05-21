import type { EntityOccurrence } from '../lib/dexie/db';
import type { RegisteredEntity } from '../lib/registry';

export type GraphRebuildScopeKind = 'global' | 'narrative' | 'note' | 'multiNote';
export type GraphRebuildAnchorSource = EntityOccurrence['source'] | 'accepted_suggestion';
export type GraphRebuildEdgeType = 'anchored-cooccurrence' | 'relationship' | 'temporal' | 'causal';
export type GraphRebuildEmbeddingTargetKind = 'note' | 'chunk' | 'entity' | 'anchor' | 'graphFact';

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
    manifold: 'hybrid' | 'hopf' | 'lorentz' | 'hyperbolic';
    projectionId: string;
}

export interface GraphRebuildDropReasons {
    missingEntity: number;
    invalidSpan: number;
    duplicateAnchor: number;
    singletonBucket: number;
    missingChunk: number;
}

export interface GraphRebuildCounters {
    entities: number;
    aliases: number;
    candidates: number;
    mentions: number;
    acceptedAnchors: number;
    chunks: number;
    relationships: number;
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
    candidateCount?: number;
    builtAt?: number;
}
