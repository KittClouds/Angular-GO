export type AtlasManifoldMode = 'hybrid' | 'hopf' | 'lorentz';
export type ManifoldProjectionSource =
    | 'real_snapshot_vectors'
    | 'local_preview_vectors'
    | 'hopf_preview_fallback'
    | 'semantic_atlas_rows'
    | 'synthetic_debug_vectors';

export type PhoenixMachineManifoldStatus = 'idle' | 'loading' | 'ready' | 'stale' | 'error';

export interface ManifoldCapabilities {
    ann: boolean;
    anchors: boolean;
    fibers: boolean;
    phase: boolean;
    cones: boolean;
}

export interface ManifoldAtlasSnapshot<TPayload> {
    manifold: AtlasManifoldMode;
    geometryVersion: string;
    sourceLabel: string;
    capabilities: ManifoldCapabilities;
    payload: TPayload;
}

export interface IcoCellRecord {
    cellId: string;
    resolution: number;
    parentCellId?: string | null;
    childrenCellIds: string[];
    centerVector: [number, number, number];
    normalVector: [number, number, number];
    neighborCellIds: string[];
    areaWeight: number;
    density: number;
    anchorIds: string[];
    geometryVersion: string;
}

export interface IcoChartRecord {
    chartId: string;
    centerCellId: string;
    memberCellIds: string[];
    resolution: number;
    dominantContexts: string[];
    anchorCount: number;
    density: number;
    boundaryCells: string[];
    geometryVersion: string;
}

export interface IcoSeamRecord {
    fromCell: string;
    toCell: string;
    sharedEdge: string[];
    normalDelta: number;
    chartA: string;
    chartB: string;
    seamCost: number;
    compatibilityScore: number;
    obstructionCount: number;
    geometryVersion: string;
}

export interface IcoNeighborRingsRecord {
    cellId: string;
    ring1: string[];
    ring2: string[];
    ring3: string[];
    geometryVersion: string;
}

export interface IcoConeTraceStepRecord {
    cellId: string;
    neighborRing: number;
    axisAlignment: number;
    apertureThreshold: number;
    chartStitchScore: number;
    accepted: boolean;
    reason: string;
}

export interface IcoConeTraceRecord {
    coneId: string;
    apexCell: string;
    axisVector: [number, number, number];
    apertureCos: number;
    maxRing: number;
    acceptedCellIds: string[];
    rejectedCellIds: string[];
    steps: IcoConeTraceStepRecord[];
    geometryVersion: string;
}

export interface AnchorProjectionRecord {
    anchorId: string;
    primaryCellId: string;
    secondaryCellIds: string[];
    cellDistance: number;
    boundaryScore: number;
    projectionVersion: string;
    geometryVersion: string;
}

export type LorentzTreeKind =
    | 'identity'
    | 'relationship'
    | 'location'
    | 'event'
    | 'temporal'
    | 'causal'
    | 'mechanical'
    | 'emotional'
    | 'political'
    | 'evidence'
    | 'provenance'
    | 'contradiction'
    | 'abstraction'
    | 'species'
    | 'powerSystem'
    | 'documentStructure';

export type LorentzQueryMode =
    | 'anchorSearch'
    | 'directLookup'
    | 'hierarchicalExpansion'
    | 'crossHierarchySynthesis'
    | 'contradiction';

export interface LorentzForestCacheStatus {
    geometryVersion: string;
    cacheKey: string;
    cachePath: string;
    exists: boolean;
    byteLen: number;
    mmap: boolean;
    rebuilt: boolean;
}

export interface LorentzTreeRecord {
    treeId: string;
    treeKind: LorentzTreeKind | string;
    label: string;
    rootNodeId?: string | null;
    geometryVersion: string;
}

export interface LorentzMembershipRecord {
    treeId: string;
    nodeId: string;
    parentNodeId?: string | null;
    level: number;
    localRank: number;
    pathKey: string;
    branchWeight: number;
    confidence: number;
    sourceCount: number;
    geometryVersion: string;
}

export interface LorentzForestSnapshot {
    nodes: Array<{
        id: string;
        label: string;
        sourceType: string;
        vector: number[];
        geometryVersion?: string;
        preview?: string;
        kind?: string;
    }>;
    edges: Array<{
        id: string;
        sourceId: string;
        targetId: string;
        type: string;
        confidence: number;
    }>;
    trees: LorentzTreeRecord[];
    memberships: LorentzMembershipRecord[];
}

export interface LorentzForestCacheRequest {
    scope?: Record<string, unknown>;
    limit?: number;
}

export interface LorentzForestBuildRequest extends LorentzForestCacheRequest {
    force?: boolean;
    includeSnapshot?: boolean;
}

export interface LorentzForestBuildResponse {
    geometryVersion: string;
    sourceLabel: string;
    cache: LorentzForestCacheStatus;
    nodeCount: number;
    treeCount: number;
    membershipCount: number;
    snapshot?: LorentzForestSnapshot | null;
}

export interface LorentzForestQueryRequest extends LorentzForestCacheRequest {
    force?: boolean;
    queryVector?: number[];
    queryNodeId?: string;
    treeKinds?: Array<LorentzTreeKind | string>;
    treeIds?: string[];
    targetLevel?: number;
    mode?: LorentzQueryMode | string;
    topK?: number;
}

export interface LorentzForestQueryHit {
    candidateId: string;
    nodeId: string;
    label: string;
    treeId?: string | null;
    treeKind?: LorentzTreeKind | string | null;
    pathKey?: string | null;
    score: number;
    hyperbolicDistance: number;
    geometrySimilarity: number;
    hierarchyAlignment: number;
    confidence: number;
}

export interface LorentzForestQueryResponse {
    geometryVersion: string;
    cache: LorentzForestCacheStatus;
    queryPoint: [number, number, number, number, number];
    hits: LorentzForestQueryHit[];
}

export interface ManifoldTopologyPayload {
    projectionSource?: ManifoldProjectionSource | string;
    cells?: IcoCellRecord[];
    charts?: IcoChartRecord[];
    seams?: IcoSeamRecord[];
    neighborRings?: IcoNeighborRingsRecord[];
    coneTraces?: IcoConeTraceRecord[];
    anchorProjections?: AnchorProjectionRecord[];
    lorentzTrees?: LorentzTreeRecord[];
    lorentzMemberships?: LorentzMembershipRecord[];
    lorentzCache?: LorentzForestCacheStatus | null;
}

export const HYBRID_MANIFOLD_CAPABILITIES: ManifoldCapabilities = {
    ann: true,
    anchors: false,
    fibers: false,
    phase: false,
    cones: false,
};

export const HOPF_MANIFOLD_CAPABILITIES: ManifoldCapabilities = {
    ann: true,
    anchors: true,
    fibers: true,
    phase: true,
    cones: true,
};

export const LORENTZ_MANIFOLD_CAPABILITIES: ManifoldCapabilities = {
    ann: false,
    anchors: false,
    fibers: false,
    phase: false,
    cones: true,
};
