export type AtlasCapabilityFamily =
    | 'surface'
    | 'entity'
    | 'graph'
    | 'semantic'
    | 'reasoning'
    | 'manifold'
    | 'retrieval'
    | 'visualization';

export type AtlasCapabilityCost =
    | 'Very low'
    | 'Low'
    | 'Low-Med'
    | 'Medium'
    | 'Med-High'
    | 'High'
    | 'Very high'
    | 'Render';

export type AtlasCapabilityMutationPolicy =
    | 'read-only'
    | 'dirty-only'
    | 'force rebuild'
    | 'model warm'
    | 'native-only'
    | 'not wired';

export type AtlasCapabilityUiCoverage = 'wired' | 'partial' | 'sleeping';
export type AtlasPresetPolicy = 'dirty-only' | 'force' | 'read-only';

export type AtlasGraphTargetId =
    | 'mention'
    | 'evidence'
    | 'surface'
    | 'kernel'
    | 'relation'
    | 'temporal'
    | 'eventIdentity'
    | 'memoryState'
    | 'causal'
    | 'semanticAtlas'
    | 'semanticCandidate'
    | 'galaxy';

export type AtlasPresetId = 'fastScan' | 'fullAtlas' | 'semanticAtlas' | 'deepReasoning' | 'visualizationOnly';
export type AtlasRecipeId =
    | 'textGraph'
    | 'semanticGraph'
    | 'adjudicatedSemanticGraph'
    | 'runNer'
    | 'fastTextGraph'
    | 'fullTextGraph'
    | 'semanticAtlas'
    | 'warmFullIndexStack'
    | 'visualizeCurrentGraph';

export type AtlasModelLaneId =
    | 'dynamicNer'
    | 'coOccurrence'
    | 'semanticEmbedding'
    | 'nli'
    | 'manifoldProjection';

export type AtlasCapabilityId =
    | 'dynamicSurface'
    | 'dynamicChunking'
    | 'dynamicNer'
    | 'mentionGraph'
    | 'evidenceGraph'
    | 'surfaceGraph'
    | 'assertedKernel'
    | 'relationGraph'
    | 'temporalGraph'
    | 'eventIdentity'
    | 'memoryState'
    | 'causalGraph'
    | 'semanticEmbedding'
    | 'semanticAtlas'
    | 'semanticCandidate'
    | 'nliAdjudication'
    | 'hybridManifold'
    | 'hopfProjection'
    | 'lorentzForest'
    | 'retrievalWalk'
    | 'galaxyVisualization';

export type AtlasCapabilityLayerId =
    | 'textSurface'
    | 'entityMention'
    | 'graphCommit'
    | 'reasoningGraphs'
    | 'semanticAdjudication'
    | 'manifoldGeometry'
    | 'retrievalVisualization';

export const ATLAS_GRAPH_BUILD_RECIPE_IDS: AtlasRecipeId[] = [
    'textGraph',
    'semanticGraph',
    'adjudicatedSemanticGraph',
];

export interface AtlasCapability {
    id: AtlasCapabilityId;
    label: string;
    family: AtlasCapabilityFamily;
    description: string;
    cost: AtlasCapabilityCost;
    subsystems: number;
    statusSource: string;
    backendRoute: string;
    inputs: string[];
    outputs: string[];
    dependencies: AtlasCapabilityId[];
    skips: AtlasCapabilityId[];
    mutationPolicy: AtlasCapabilityMutationPolicy;
    uiCoverage: AtlasCapabilityUiCoverage;
    runnable: boolean;
    modelLaneId?: AtlasModelLaneId;
    graphTargetId?: AtlasGraphTargetId;
    graphTargetLabel?: string;
    stageSummaryKeys?: string[];
    testRefs: string[];
    docRefs: string[];
}

export interface AtlasCapabilityLayer {
    id: AtlasCapabilityLayerId;
    label: string;
    description: string;
    capabilityIds: AtlasCapabilityId[];
}

export interface AtlasCapabilityRecipeDefinition {
    id: AtlasRecipeId;
    label: string;
    subtitle: string;
    description: string;
    actionLabel: string;
    icon: string;
    primary?: boolean;
    outputLabel: string;
    mutationPolicy: AtlasCapabilityMutationPolicy;
    cost: AtlasCapabilityCost;
    backendRoute: string;
    dependencyChain: AtlasCapabilityId[];
    requiredCapabilities: AtlasCapabilityId[];
    optionalCapabilities: AtlasCapabilityId[];
    skippedCapabilities: AtlasCapabilityId[];
    requiredLanes: AtlasModelLaneId[];
    optionalLanes: AtlasModelLaneId[];
    skippedLanes: AtlasModelLaneId[];
}

export interface AtlasCapabilityPresetDefinition {
    id: AtlasPresetId;
    label: string;
    desc: string;
    target: AtlasGraphTargetId;
    policy: AtlasPresetPolicy;
    stages: string[];
}

export const ATLAS_MODEL_LANE_LABELS: Record<AtlasModelLaneId, string> = {
    dynamicNer: 'Dynamic NER',
    coOccurrence: 'Co-occurrence',
    semanticEmbedding: 'Semantic Embedding',
    nli: 'NLI',
    manifoldProjection: 'Manifold Projection',
};

export const ATLAS_CAPABILITY_REGISTRY: AtlasCapability[] = [
    {
        id: 'dynamicSurface',
        label: 'Dynamic Text Surface',
        family: 'surface',
        description: 'Native surface compile over notes: normalized text, token tables, sentences, clauses, phrases, quotes, and speaker cues.',
        cost: 'Low',
        subsystems: 3,
        statusSource: 'machine.stage.surface + AtlasRichScanResult.stageSummaries.surface',
        backendRoute: 'atlas_rich_scan.surface / phoenix-chunker / phoenix-types::SurfaceDocument',
        inputs: ['scope notes', 'plain text'],
        outputs: ['tokens', 'sentences', 'clauses', 'surface units'],
        dependencies: [],
        skips: [],
        mutationPolicy: 'dirty-only',
        uiCoverage: 'wired',
        runnable: true,
        stageSummaryKeys: ['surface', 'dynamicSurface'],
        testRefs: ['atlas-command-status.model.spec.ts'],
        docRefs: ['rust/phoenix/crates/phoenix-types/src/deterministic.rs', 'rust/phoenix/crates/phoenix-chunker/src/lib.rs'],
    },
    {
        id: 'dynamicChunking',
        label: 'Dynamic Chunking',
        family: 'surface',
        description: 'Sentence-aware chunk/lens production used by text graph commits and semantic atlas sidecars.',
        cost: 'Low',
        subsystems: 3,
        statusSource: 'AtlasRichScanResult.lensChunkCounts + runtime chunk defaults',
        backendRoute: 'atlas_rich_scan.surface / phoenix-chunker::sentence',
        inputs: ['surface units', 'sentence boundaries'],
        outputs: ['lens chunks', 'chunk ids', 'leaf candidates'],
        dependencies: ['dynamicSurface'],
        skips: [],
        mutationPolicy: 'dirty-only',
        uiCoverage: 'wired',
        runnable: true,
        stageSummaryKeys: ['surface', 'chunking'],
        testRefs: ['atlas-command-status.model.spec.ts'],
        docRefs: ['rust/phoenix/crates/phoenix-chunker/src/sentence.rs'],
    },
    {
        id: 'dynamicNer',
        label: 'Dynamic NER',
        family: 'entity',
        description: 'BI-small dynamic NER candidate pass plus review lane hydration for selected scope text and Atlas surface suggestions.',
        cost: 'Medium',
        subsystems: 4,
        statusSource: 'NerService.providerStatuses.dynamic_ner + AtlasRichScanResult.candidateSuggestions',
        backendRoute: 'NerService.runDynamicScan / phoenix-dynamic-ner',
        inputs: ['plain text', 'surface chunks'],
        outputs: ['candidate entities', 'review suggestions'],
        dependencies: ['dynamicSurface'],
        skips: [],
        mutationPolicy: 'model warm',
        uiCoverage: 'wired',
        runnable: true,
        modelLaneId: 'dynamicNer',
        stageSummaryKeys: ['dynamicNer', 'surface'],
        testRefs: ['atlas-model-recipe.model.spec.ts', 'search-panel.component.spec.ts'],
        docRefs: ['rust-native/phoenix/crates/phoenix-dynamic-ner/src/lib.rs', 'src/app/services/ner.service.ts'],
    },
    {
        id: 'mentionGraph',
        label: 'Mention / Co-occurrence Graph',
        family: 'entity',
        description: 'Mention spans, normalized surfaces, resolver links, and co-occurrence edges used by the text graph path.',
        cost: 'Very low',
        subsystems: 2,
        statusSource: 'machine.stage.evidenceGraph + graph audit node/edge counts',
        backendRoute: 'atlas_rich_scan.evidenceGraph / phoenix-machine mention detection',
        inputs: ['surface chunks', 'dynamic NER candidates'],
        outputs: ['mentions', 'resolver links', 'local mention edges'],
        dependencies: ['dynamicSurface', 'dynamicChunking', 'dynamicNer'],
        skips: [],
        mutationPolicy: 'dirty-only',
        uiCoverage: 'wired',
        runnable: true,
        modelLaneId: 'coOccurrence',
        graphTargetId: 'mention',
        graphTargetLabel: 'Mention Graph',
        stageSummaryKeys: ['evidenceGraph', 'mentionGraph', 'graph-delta'],
        testRefs: ['search-panel.model.spec.ts'],
        docRefs: ['rust-native/phoenix/crates/phoenix-machine/src/lib.rs'],
    },
    {
        id: 'evidenceGraph',
        label: 'Evidence Graph',
        family: 'graph',
        description: 'Mention candidates, evidence edges, fusion decisions, and graph patch operations for committed graph deltas.',
        cost: 'Low',
        subsystems: 3,
        statusSource: 'graph audit graphEdges + AtlasRichScanResult.graphDeltaCounts',
        backendRoute: 'atlas_rich_scan.evidenceGraph / phoenix-store-overgraph',
        inputs: ['mentions', 'surface chunks'],
        outputs: ['evidence edges', 'graph patch ops'],
        dependencies: ['mentionGraph'],
        skips: [],
        mutationPolicy: 'dirty-only',
        uiCoverage: 'wired',
        runnable: true,
        graphTargetId: 'evidence',
        graphTargetLabel: 'Evidence Graph',
        stageSummaryKeys: ['evidenceGraph', 'graph-delta'],
        testRefs: ['atlas-command-status.model.spec.ts', 'search-panel.model.spec.ts'],
        docRefs: ['src/app/services/graph-audit.service.ts'],
    },
    {
        id: 'surfaceGraph',
        label: 'Surface Graph',
        family: 'graph',
        description: 'Document, chunk, entity, mention, and local topology layer that feeds asserted kernel commits.',
        cost: 'Low-Med',
        subsystems: 4,
        statusSource: 'graph audit nodeKinds.leaf/chunk + committed graph counts',
        backendRoute: 'atlas_rich_scan.evidenceGraph / overgraph surface topology',
        inputs: ['surface units', 'mentions', 'evidence edges'],
        outputs: ['document nodes', 'chunk nodes', 'mention topology'],
        dependencies: ['dynamicChunking', 'evidenceGraph'],
        skips: [],
        mutationPolicy: 'dirty-only',
        uiCoverage: 'wired',
        runnable: true,
        graphTargetId: 'surface',
        graphTargetLabel: 'Surface Graph',
        stageSummaryKeys: ['surfaceGraph', 'overgraph'],
        testRefs: ['search-panel.model.spec.ts'],
        docRefs: ['src/app/services/phoenix-ui-api.service.ts'],
    },
    {
        id: 'assertedKernel',
        label: 'Asserted Kernel',
        family: 'graph',
        description: 'Committed graph layer for durable entities, claims, states, events, and evidence-backed kernel edges.',
        cost: 'Medium',
        subsystems: 6,
        statusSource: 'machine.stage.overgraph + graph audit graphNodes/graphEdges',
        backendRoute: 'atlas_rich_scan.overgraph / phoenix-store-overgraph',
        inputs: ['surface graph', 'evidence graph'],
        outputs: ['committed vertices', 'kernel edges', 'audit snapshot'],
        dependencies: ['surfaceGraph', 'evidenceGraph'],
        skips: [],
        mutationPolicy: 'dirty-only',
        uiCoverage: 'wired',
        runnable: true,
        graphTargetId: 'kernel',
        graphTargetLabel: 'Asserted Kernel',
        stageSummaryKeys: ['overgraph', 'assertedKernel'],
        testRefs: ['atlas-command-status.model.spec.ts'],
        docRefs: ['src/app/services/phoenix-machine-control.service.ts', 'rust-native/phoenix/crates/phoenix-store-overgraph/src/graph_topology.rs'],
    },
    {
        id: 'relationGraph',
        label: 'Relation Graph',
        family: 'reasoning',
        description: 'Read-only native candidate-edge probe for entity-to-entity relation rows after graph commit; full relation extraction remains outside Search Panel recipes.',
        cost: 'Medium',
        subsystems: 6,
        statusSource: 'AtlasRichScanResult.relationCandidateCount + relation sidecar stores',
        backendRoute: 'PhoenixBackendService.storeCommand relation:list(graph_candidate_edges)',
        inputs: ['asserted kernel', 'mentions', 'sentence syntax'],
        outputs: ['candidate edge rows', 'relation probe samples'],
        dependencies: ['assertedKernel'],
        skips: [],
        mutationPolicy: 'read-only',
        uiCoverage: 'partial',
        runnable: true,
        graphTargetId: 'relation',
        graphTargetLabel: 'Relation Graph',
        stageSummaryKeys: ['relations', 'relationGraph'],
        testRefs: ['atlas-command-status.model.spec.ts'],
        docRefs: ['rust-native/phoenix/crates/phoenix-store-native-core/src/scope_runtime.rs'],
    },
    {
        id: 'temporalGraph',
        label: 'Temporal Graph',
        family: 'reasoning',
        description: 'Read-only native graph edge probe for active-during temporal rows; temporal extraction/review batches are not exposed as a Search Panel run recipe yet.',
        cost: 'Med-High',
        subsystems: 7,
        statusSource: 'PhoenixBackendService.storeCommand relation:list(graph_edges edge_type=active_during)',
        backendRoute: 'PhoenixBackendService.storeCommand relation:list(graph_edges, edge_type=active_during)',
        inputs: ['graph_edges relation', 'active_during edge type'],
        outputs: ['temporal edge rows', 'probe samples'],
        dependencies: ['eventIdentity'],
        skips: [],
        mutationPolicy: 'read-only',
        uiCoverage: 'partial',
        runnable: true,
        graphTargetId: 'temporal',
        graphTargetLabel: 'Temporal Graph',
        stageSummaryKeys: ['temporal', 'timeBinding'],
        testRefs: ['atlas-capability.model.spec.ts'],
        docRefs: ['rust-native/phoenix/crates/phoenix-temporal-post/src/api.rs', 'rust-native/phoenix/crates/phoenix-temporal-post/src/normalize.rs'],
    },
    {
        id: 'eventIdentity',
        label: 'Event Identity',
        family: 'reasoning',
        description: 'Read-only native semantic prototype probe for event-like nodes; canonical event identity resolution is not exposed as a Search Panel run recipe yet.',
        cost: 'Med-High',
        subsystems: 7,
        statusSource: 'PhoenixBackendService.storeCommand relation:list(semantic_node_prototypes node_kind=event)',
        backendRoute: 'PhoenixBackendService.storeCommand relation:list(semantic_node_prototypes, node_kind=event)',
        inputs: ['semantic_node_prototypes relation', 'event node kind'],
        outputs: ['event prototype rows', 'probe samples'],
        dependencies: ['relationGraph'],
        skips: [],
        mutationPolicy: 'read-only',
        uiCoverage: 'partial',
        runnable: true,
        graphTargetId: 'eventIdentity',
        graphTargetLabel: 'Event Identity',
        stageSummaryKeys: ['eventIdentity'],
        testRefs: ['atlas-capability.model.spec.ts'],
        docRefs: ['rust/phoenix/crates/phoenix-types/src/deterministic.rs', 'rust-native/phoenix/crates/phoenix-store-native-core/src/scope_runtime.rs'],
    },
    {
        id: 'memoryState',
        label: 'Memory / State',
        family: 'reasoning',
        description: 'Read-only native memories relation probe for durable memory rows; state schema extraction and continuity mutation passes are not exposed as Search Panel recipes yet.',
        cost: 'High',
        subsystems: 8,
        statusSource: 'PhoenixBackendService.storeCommand relation:list(memories)',
        backendRoute: 'PhoenixBackendService.storeCommand relation:list(memories)',
        inputs: ['memories relation'],
        outputs: ['memory rows', 'probe samples'],
        dependencies: ['eventIdentity', 'temporalGraph'],
        skips: [],
        mutationPolicy: 'read-only',
        uiCoverage: 'partial',
        runnable: true,
        graphTargetId: 'memoryState',
        graphTargetLabel: 'Memory / State',
        stageSummaryKeys: ['memory', 'stateSchema'],
        testRefs: ['atlas-capability.model.spec.ts'],
        docRefs: ['rust/phoenix/crates/phoenix-types/src/deterministic.rs', 'rust-native/phoenix/crates/phoenix-state-schema-post/src/lib.rs'],
    },
    {
        id: 'causalGraph',
        label: 'Causal Graph',
        family: 'reasoning',
        description: 'Cause/effect chains, invalidations, motivation links, causal candidates, causal links, and causal memory cards.',
        cost: 'High',
        subsystems: 9,
        statusSource: 'CausalScopeSidecar + CausalCandidate/CausalLink records',
        backendRoute: 'PhoenixCausalPatchStore / causal substrate runtime',
        inputs: ['semantic nodes', 'temporal graph', 'state transitions'],
        outputs: ['causal candidates', 'causal links', 'review cards'],
        dependencies: ['eventIdentity', 'temporalGraph', 'memoryState'],
        skips: [],
        mutationPolicy: 'native-only',
        uiCoverage: 'sleeping',
        runnable: false,
        graphTargetId: 'causal',
        graphTargetLabel: 'Causal Graph',
        stageSummaryKeys: ['causal', 'causality'],
        testRefs: ['atlas-capability.model.spec.ts'],
        docRefs: ['rust/phoenix/crates/phoenix-types/src/deterministic.rs', 'rust-native/phoenix/crates/phoenix-store-native-core/src/scope_runtime.rs'],
    },
    {
        id: 'semanticEmbedding',
        label: 'Semantic Embedding',
        family: 'semantic',
        description: 'Local embedding model warm/index lane for leaf, entity-context, and lens vectors.',
        cost: 'High',
        subsystems: 5,
        statusSource: 'PhoenixMachineVectorStatus + AtlasRichScanResult.embeddingCounts',
        backendRoute: 'Phoenix native Rust semantic runner / atlas_rich_scan.embeddings',
        inputs: ['committed graph', 'surface text'],
        outputs: ['leaf vectors', 'entity vectors', 'lens vectors'],
        dependencies: ['assertedKernel'],
        skips: [],
        mutationPolicy: 'model warm',
        uiCoverage: 'wired',
        runnable: true,
        modelLaneId: 'semanticEmbedding',
        stageSummaryKeys: ['embeddings', 'semanticEmbedding'],
        testRefs: ['atlas-model-recipe.model.spec.ts', 'search-panel.component.spec.ts'],
        docRefs: ['src/app/services/phoenix-ui-api.service.ts', 'rust-native/phoenix'],
    },
    {
        id: 'semanticAtlas',
        label: 'Semantic Atlas Sidecar',
        family: 'semantic',
        description: 'Hierarchy, surface candidates, leaf/entity-context embeddings, and candidate relation output under the rich scan budget.',
        cost: 'High',
        subsystems: 8,
        statusSource: 'AtlasRichScanResult.embeddingCounts + graphDeltaCounts',
        backendRoute: 'atlas_rich_scan.embeddings',
        inputs: ['asserted kernel', 'embedding model'],
        outputs: ['semantic sidecar rows', 'embedding atlas vectors'],
        dependencies: ['assertedKernel', 'semanticEmbedding'],
        skips: [],
        mutationPolicy: 'dirty-only',
        uiCoverage: 'wired',
        runnable: true,
        graphTargetId: 'semanticAtlas',
        graphTargetLabel: 'Embedding Atlas',
        stageSummaryKeys: ['embeddings', 'semanticAtlas'],
        testRefs: ['atlas-command-status.model.spec.ts', 'atlas-model-recipe.model.spec.ts'],
        docRefs: ['src/app/services/phoenix-ui-api.service.ts', 'src/app/services/atlas-scan-coordinator.service.ts'],
    },
    {
        id: 'semanticCandidate',
        label: 'Semantic Candidate Graph',
        family: 'semantic',
        description: 'ANN/hybrid-space candidate semantic edges and relation candidates emitted by the Semantic Atlas dirty-only scan and ready for adjudication.',
        cost: 'Very high',
        subsystems: 10,
        statusSource: 'AtlasRichScanResult.graphDeltaCounts.candidateEdges + relationCandidateCount',
        backendRoute: 'AtlasScanCoordinatorService.runRichEmbeddingScan(includeSemanticAtlas=true) / semantic:refreshCandidateGraphEdges',
        inputs: ['semantic atlas vectors', 'hybrid manifold', 'relation candidates'],
        outputs: ['candidate semantic edges', 'candidate relation edges'],
        dependencies: ['semanticAtlas', 'hybridManifold'],
        skips: [],
        mutationPolicy: 'dirty-only',
        uiCoverage: 'partial',
        runnable: true,
        graphTargetId: 'semanticCandidate',
        graphTargetLabel: 'Semantic Candidate',
        stageSummaryKeys: ['semanticCandidate', 'candidateRelations'],
        testRefs: ['atlas-command-status.model.spec.ts'],
        docRefs: ['src/app/services/phoenix-ui-api.service.ts'],
    },
    {
        id: 'nliAdjudication',
        label: 'NLI Adjudication',
        family: 'semantic',
        description: 'ModernBERT NLI lane that lists native candidate-edge judgment inputs, classifies entailment/neutral/contradiction, and applies native judgments.',
        cost: 'High',
        subsystems: 5,
        statusSource: 'NliWorkerService model state + semantic:listNliJudgmentInputs',
        backendRoute: 'semantic:listNliJudgmentInputs → NliWorkerService.classifyStream → semantic:applyNliJudgments',
        inputs: ['semantic candidates', 'text pairs'],
        outputs: ['candidate-edge NLI judgments', 'entailment scores', 'contradiction flags'],
        dependencies: ['semanticCandidate'],
        skips: [],
        mutationPolicy: 'native-only',
        uiCoverage: 'partial',
        runnable: true,
        modelLaneId: 'nli',
        stageSummaryKeys: ['nli', 'adjudication'],
        testRefs: ['atlas-model-recipe.model.spec.ts'],
        docRefs: ['src/app/lib/services/nli-worker.service.ts', 'src/app/lib/nli/nli-utils.spec.ts'],
    },
    {
        id: 'hybridManifold',
        label: 'Hybrid Manifold',
        family: 'manifold',
        description: 'Hybrid vector topology sidecar for semantic atlas rows and graph projection support.',
        cost: 'High',
        subsystems: 6,
        statusSource: 'PhoenixMachineManifoldStatusMap.hybrid',
        backendRoute: 'manifoldSnapshot(hybrid) / phoenix-hyperbolic',
        inputs: ['semantic atlas vectors'],
        outputs: ['hybrid topology', 'ANN projection hints'],
        dependencies: ['semanticAtlas'],
        skips: [],
        mutationPolicy: 'read-only',
        uiCoverage: 'wired',
        runnable: true,
        modelLaneId: 'manifoldProjection',
        stageSummaryKeys: ['hybrid'],
        testRefs: ['atlas-command-status.model.spec.ts'],
        docRefs: ['rust-native/phoenix/crates/phoenix-hyperbolic/src/hybrid_space.rs', 'src/app/services/manifold-atlas.types.ts'],
    },
    {
        id: 'hopfProjection',
        label: 'Hopf Projection',
        family: 'manifold',
        description: 'Hopf/S3 projection lane for semantic atlas visualization and phase/fiber analysis.',
        cost: 'High',
        subsystems: 6,
        statusSource: 'PhoenixMachineManifoldStatusMap.hopf',
        backendRoute: 'manifoldSnapshot(hopf) / phoenix-hyperbolic',
        inputs: ['semantic atlas vectors'],
        outputs: ['Hopf fibers', 'phase projection'],
        dependencies: ['semanticAtlas'],
        skips: [],
        mutationPolicy: 'read-only',
        uiCoverage: 'wired',
        runnable: true,
        modelLaneId: 'manifoldProjection',
        stageSummaryKeys: ['hopf'],
        testRefs: ['atlas-command-status.model.spec.ts'],
        docRefs: ['rust-native/phoenix/crates/phoenix-hyperbolic/src/sphere.rs', 'src/app/services/manifold-atlas.types.ts'],
    },
    {
        id: 'lorentzForest',
        label: 'Lorentz Forest',
        family: 'manifold',
        description: 'Hyperbolic forest over identity, relationship, location, event, temporal, causal, evidence, contradiction, and abstraction trees.',
        cost: 'Very high',
        subsystems: 9,
        statusSource: 'PhoenixMachineManifoldStatusMap.lorentz + LorentzForestBuildResponse',
        backendRoute: 'lorentzForestBuild / LorentzForestQuery',
        inputs: ['semantic atlas vectors', 'graph target kinds'],
        outputs: ['Lorentz trees', 'memberships', 'hierarchical query hits'],
        dependencies: ['semanticAtlas', 'semanticCandidate'],
        skips: [],
        mutationPolicy: 'read-only',
        uiCoverage: 'partial',
        runnable: true,
        modelLaneId: 'manifoldProjection',
        stageSummaryKeys: ['lorentz', 'lorentzForest'],
        testRefs: ['atlas-command-status.model.spec.ts'],
        docRefs: ['src/app/services/manifold-atlas.types.ts'],
    },
    {
        id: 'retrievalWalk',
        label: 'Retrieval / Triverse Walk',
        family: 'retrieval',
        description: 'Query-time lexical, semantic, graph, entity, and evidence lanes over committed graph and sidecars.',
        cost: 'Low-Med',
        subsystems: 5,
        statusSource: 'RetrievalWorkbenchStateService.activeLanes',
        backendRoute: 'PhoenixUiApi.searchScoped / graph walk read path',
        inputs: ['query text', 'selected lanes'],
        outputs: ['ranked results', 'source lane labels'],
        dependencies: ['assertedKernel'],
        skips: [],
        mutationPolicy: 'read-only',
        uiCoverage: 'wired',
        runnable: true,
        stageSummaryKeys: ['retrieval'],
        testRefs: ['search-panel.component.spec.ts'],
        docRefs: ['src/app/services/retrieval-workbench-state.service.ts'],
    },
    {
        id: 'galaxyVisualization',
        label: 'Galaxy Visualization',
        family: 'visualization',
        description: 'Read-only projection/render graph from the current kernel snapshot and graph lens focus.',
        cost: 'Render',
        subsystems: 4,
        statusSource: 'graph lens focus + graph audit snapshot',
        backendRoute: 'Blueprint graph tab / graph atlas preview',
        inputs: ['committed kernel snapshot', 'graph focus'],
        outputs: ['galaxy scene', 'render graph'],
        dependencies: ['assertedKernel'],
        skips: [],
        mutationPolicy: 'read-only',
        uiCoverage: 'wired',
        runnable: true,
        graphTargetId: 'galaxy',
        graphTargetLabel: 'Galaxy View',
        stageSummaryKeys: ['galaxy', 'visualization'],
        testRefs: ['search-panel.component.spec.ts'],
        docRefs: ['src/app/components/blueprint-hub/tabs/graph-tab/graph-atlas-preview/graph-atlas-preview.component.ts'],
    },
];

export const ATLAS_CAPABILITY_LAYERS: AtlasCapabilityLayer[] = [
    {
        id: 'textSurface',
        label: 'Text Surface',
        description: 'Sentence split, dynamic chunking, token, phrase, and clause structure.',
        capabilityIds: ['dynamicSurface', 'dynamicChunking'],
    },
    {
        id: 'entityMention',
        label: 'Entity + Mention Intelligence',
        description: 'Dynamic NER, mentions, aliases, review lanes, and co-occurrence edges.',
        capabilityIds: ['dynamicNer', 'mentionGraph'],
    },
    {
        id: 'graphCommit',
        label: 'Graph Commit',
        description: 'Mention, evidence, surface, and asserted kernel graph commits.',
        capabilityIds: ['evidenceGraph', 'surfaceGraph', 'assertedKernel'],
    },
    {
        id: 'reasoningGraphs',
        label: 'Reasoning Graphs',
        description: 'Relation, temporal, event identity, memory/state, and causal graph passes.',
        capabilityIds: ['relationGraph', 'temporalGraph', 'eventIdentity', 'memoryState', 'causalGraph'],
    },
    {
        id: 'semanticAdjudication',
        label: 'Semantic + Adjudication',
        description: 'Embedding sidecar, semantic candidates, and NLI adjudication lane.',
        capabilityIds: ['semanticEmbedding', 'semanticAtlas', 'semanticCandidate', 'nliAdjudication'],
    },
    {
        id: 'manifoldGeometry',
        label: 'Manifold / Geometry',
        description: 'Hybrid, Hopf, and Lorentz projection/forest sidecars.',
        capabilityIds: ['hybridManifold', 'hopfProjection', 'lorentzForest'],
    },
    {
        id: 'retrievalVisualization',
        label: 'Retrieval / Visualization',
        description: 'Triverse graph walk, ranking, and galaxy render graph.',
        capabilityIds: ['retrievalWalk', 'galaxyVisualization'],
    },
];

const TEXT_GRAPH_CHAIN: AtlasCapabilityId[] = [
    'dynamicSurface',
    'dynamicChunking',
    'mentionGraph',
    'evidenceGraph',
    'surfaceGraph',
    'assertedKernel',
];

const RUN_NER_CHAIN: AtlasCapabilityId[] = ['dynamicSurface', 'dynamicNer'];

const REASONING_CAPABILITIES: AtlasCapabilityId[] = [
    'relationGraph',
    'temporalGraph',
    'eventIdentity',
    'memoryState',
    'causalGraph',
];

const SEMANTIC_CAPABILITIES: AtlasCapabilityId[] = [
    'semanticEmbedding',
    'semanticAtlas',
    'semanticCandidate',
    'nliAdjudication',
];

const MANIFOLD_CAPABILITIES: AtlasCapabilityId[] = ['hybridManifold', 'hopfProjection', 'lorentzForest'];

export const ATLAS_CAPABILITY_RECIPES: AtlasCapabilityRecipeDefinition[] = [
    {
        id: 'textGraph',
        label: 'Text Graph',
        subtitle: 'no model warm',
        description: 'Build the deterministic surface, mention, evidence, and committed graph path for the selected documents.',
        actionLabel: 'Build Text Graph',
        icon: 'lucideZap',
        primary: true,
        outputLabel: 'committed text graph',
        mutationPolicy: 'dirty-only',
        cost: 'Low-Med',
        backendRoute: 'atlas_rich_scan(includeSemanticAtlas=false)',
        dependencyChain: TEXT_GRAPH_CHAIN,
        requiredCapabilities: TEXT_GRAPH_CHAIN,
        optionalCapabilities: ['dynamicNer', 'hybridManifold', 'galaxyVisualization'],
        skippedCapabilities: ['semanticEmbedding', 'semanticAtlas', 'semanticCandidate', 'nliAdjudication', ...REASONING_CAPABILITIES],
        requiredLanes: [],
        optionalLanes: ['dynamicNer', 'manifoldProjection'],
        skippedLanes: ['semanticEmbedding', 'nli'],
    },
    {
        id: 'semanticGraph',
        label: 'Semantic Graph',
        subtitle: 'embedding sidecar',
        description: 'Build the selected documents through the text graph path and semantic atlas sidecar.',
        actionLabel: 'Build Semantic Graph',
        icon: 'lucideSparkles',
        primary: true,
        outputLabel: 'graph + vectors',
        mutationPolicy: 'dirty-only',
        cost: 'High',
        backendRoute: 'load embedding -> atlas_rich_scan(includeSemanticAtlas=true)',
        dependencyChain: [...TEXT_GRAPH_CHAIN, 'semanticEmbedding', 'semanticAtlas', 'semanticCandidate'],
        requiredCapabilities: [...TEXT_GRAPH_CHAIN, 'semanticEmbedding', 'semanticAtlas'],
        optionalCapabilities: ['dynamicNer', 'semanticCandidate', 'hybridManifold', 'galaxyVisualization'],
        skippedCapabilities: ['nliAdjudication', ...REASONING_CAPABILITIES],
        requiredLanes: ['semanticEmbedding'],
        optionalLanes: ['dynamicNer', 'manifoldProjection'],
        skippedLanes: ['nli'],
    },
    {
        id: 'adjudicatedSemanticGraph',
        label: 'Adjudicated Semantic Graph',
        subtitle: 'embedding + NLI',
        description: 'Build semantic graph candidates, then apply native NLI judgments to candidate edges.',
        actionLabel: 'Build Adjudicated Graph',
        icon: 'lucideMicrochip',
        outputLabel: 'judged candidate graph',
        mutationPolicy: 'dirty-only',
        cost: 'Very high',
        backendRoute: 'semantic graph -> semantic:listNliJudgmentInputs -> semantic:applyNliJudgments',
        dependencyChain: [...TEXT_GRAPH_CHAIN, 'semanticEmbedding', 'semanticAtlas', 'semanticCandidate', 'nliAdjudication'],
        requiredCapabilities: [...TEXT_GRAPH_CHAIN, 'semanticEmbedding', 'semanticAtlas', 'semanticCandidate', 'nliAdjudication'],
        optionalCapabilities: ['dynamicNer', 'hybridManifold', 'galaxyVisualization'],
        skippedCapabilities: REASONING_CAPABILITIES,
        requiredLanes: ['semanticEmbedding', 'nli'],
        optionalLanes: ['dynamicNer', 'manifoldProjection'],
        skippedLanes: [],
    },
    {
        id: 'runNer',
        label: 'Run NER',
        subtitle: 'selected scope',
        description: 'Scan the selected Atlas scope for dynamic entity candidates while keeping graph mutation off.',
        actionLabel: 'Run NER',
        icon: 'lucideCpu',
        outputLabel: 'candidate entities',
        mutationPolicy: 'model warm',
        cost: 'Medium',
        backendRoute: 'NerService.runDynamicScan',
        dependencyChain: RUN_NER_CHAIN,
        requiredCapabilities: ['dynamicNer'],
        optionalCapabilities: ['mentionGraph'],
        skippedCapabilities: [...TEXT_GRAPH_CHAIN.filter((id) => !['dynamicSurface', 'mentionGraph'].includes(id)), ...SEMANTIC_CAPABILITIES, ...MANIFOLD_CAPABILITIES, ...REASONING_CAPABILITIES],
        requiredLanes: ['dynamicNer'],
        optionalLanes: ['coOccurrence'],
        skippedLanes: ['semanticEmbedding', 'nli', 'manifoldProjection'],
    },
    {
        id: 'fastTextGraph',
        label: 'Fast Text Graph',
        subtitle: 'dirty-only, no embeddings',
        description: 'Dirty-only dynamic surface, chunking, NER/co-occurrence, evidence graph, and graph commit.',
        actionLabel: 'Run Fast Text Graph',
        icon: 'lucideZap',
        primary: true,
        outputLabel: 'vertices + evidence edges',
        mutationPolicy: 'dirty-only',
        cost: 'Low-Med',
        backendRoute: 'atlas_rich_scan(includeSemanticAtlas=false, policy=dirty-only)',
        dependencyChain: TEXT_GRAPH_CHAIN,
        requiredCapabilities: TEXT_GRAPH_CHAIN,
        optionalCapabilities: ['dynamicNer'],
        skippedCapabilities: [...SEMANTIC_CAPABILITIES, ...MANIFOLD_CAPABILITIES, ...REASONING_CAPABILITIES],
        requiredLanes: [],
        optionalLanes: [],
        skippedLanes: ['dynamicNer', 'coOccurrence', 'semanticEmbedding', 'nli', 'manifoldProjection'],
    },
    {
        id: 'fullTextGraph',
        label: 'Full Text Graph',
        subtitle: 'force, no embeddings',
        description: 'Force rebuild the deterministic text graph path from current scope data without embeddings.',
        actionLabel: 'Run Full Text Graph',
        icon: 'lucideLayers',
        outputLabel: 'fresh committed graph',
        mutationPolicy: 'force rebuild',
        cost: 'Medium',
        backendRoute: 'atlas_rich_scan(includeSemanticAtlas=false, policy=force)',
        dependencyChain: TEXT_GRAPH_CHAIN,
        requiredCapabilities: TEXT_GRAPH_CHAIN,
        optionalCapabilities: ['dynamicNer'],
        skippedCapabilities: [...SEMANTIC_CAPABILITIES, ...MANIFOLD_CAPABILITIES, ...REASONING_CAPABILITIES],
        requiredLanes: [],
        optionalLanes: [],
        skippedLanes: ['dynamicNer', 'coOccurrence', 'semanticEmbedding', 'nli', 'manifoldProjection'],
    },
    {
        id: 'semanticAtlas',
        label: 'Semantic Atlas',
        subtitle: 'embeddings on',
        description: 'Run the rich scan with text graph dependencies, embedding sidecars, and semantic candidate output.',
        actionLabel: 'Index Semantic Atlas',
        icon: 'lucideSparkles',
        primary: true,
        outputLabel: 'vectors + candidate links',
        mutationPolicy: 'dirty-only',
        cost: 'High',
        backendRoute: 'atlas_rich_scan(includeSemanticAtlas=true, policy=dirty-only)',
        dependencyChain: [...TEXT_GRAPH_CHAIN, 'semanticEmbedding', 'semanticAtlas', 'semanticCandidate'],
        requiredCapabilities: [...TEXT_GRAPH_CHAIN, 'semanticEmbedding', 'semanticAtlas'],
        optionalCapabilities: ['dynamicNer', 'semanticCandidate', ...MANIFOLD_CAPABILITIES],
        skippedCapabilities: ['nliAdjudication', ...REASONING_CAPABILITIES],
        requiredLanes: ['semanticEmbedding'],
        optionalLanes: ['dynamicNer', 'manifoldProjection'],
        skippedLanes: ['nli'],
    },
    {
        id: 'warmFullIndexStack',
        label: 'Warm Full Index Stack',
        subtitle: 'no graph mutation',
        description: 'Load embedding, BI-small Dynamic NER, and NLI model lanes only; graph state is not mutated.',
        actionLabel: 'Warm Full Index Stack',
        icon: 'lucideMicrochip',
        outputLabel: 'ready model sidecars',
        mutationPolicy: 'model warm',
        cost: 'High',
        backendRoute: 'model warm only: native semantic runner + dynamic NER + NLI worker',
        dependencyChain: ['dynamicNer', 'semanticEmbedding', 'nliAdjudication'],
        requiredCapabilities: ['dynamicNer', 'semanticEmbedding', 'nliAdjudication'],
        optionalCapabilities: ['mentionGraph'],
        skippedCapabilities: ['evidenceGraph', 'surfaceGraph', 'assertedKernel', ...REASONING_CAPABILITIES, ...MANIFOLD_CAPABILITIES, 'semanticAtlas', 'semanticCandidate', 'retrievalWalk', 'galaxyVisualization'],
        requiredLanes: ['dynamicNer', 'semanticEmbedding', 'nli'],
        optionalLanes: ['coOccurrence'],
        skippedLanes: ['manifoldProjection'],
    },
    {
        id: 'visualizeCurrentGraph',
        label: 'Visualize Current Graph',
        subtitle: 'read-only',
        description: 'Open the current graph lens and galaxy snapshot without warming models or mutating data.',
        actionLabel: 'Visualize Current Graph',
        icon: 'lucideSearch',
        outputLabel: 'current snapshot view',
        mutationPolicy: 'read-only',
        cost: 'Render',
        backendRoute: 'graph lens / galaxy view read path',
        dependencyChain: ['assertedKernel', 'galaxyVisualization'],
        requiredCapabilities: [],
        optionalCapabilities: ['hybridManifold', 'hopfProjection', 'lorentzForest', 'retrievalWalk', 'galaxyVisualization'],
        skippedCapabilities: ['dynamicNer', 'mentionGraph', 'evidenceGraph', 'semanticEmbedding', 'semanticAtlas', 'semanticCandidate', 'nliAdjudication', ...REASONING_CAPABILITIES],
        requiredLanes: [],
        optionalLanes: ['manifoldProjection'],
        skippedLanes: ['dynamicNer', 'coOccurrence', 'semanticEmbedding', 'nli'],
    },
];

export const ATLAS_CAPABILITY_PRESETS: AtlasCapabilityPresetDefinition[] = [
    {
        id: 'fastScan',
        label: 'Fast Scan',
        desc: 'Run the native Atlas surface and evidence graph pipeline on dirty scope data.',
        target: 'evidence',
        policy: 'dirty-only',
        stages: ['Surface scan', 'Mention graph', 'Evidence graph'],
    },
    {
        id: 'fullAtlas',
        label: 'Full Atlas',
        desc: 'Update dirty notes through the committed graph lane.',
        target: 'kernel',
        policy: 'dirty-only',
        stages: ['Surface scan', 'Evidence graph', 'Asserted kernel', 'OverGraph commit'],
    },
    {
        id: 'semanticAtlas',
        label: 'Embedding Atlas Scan',
        desc: 'Build the rich graph: hierarchy, surface candidates, backend embeddings, and candidate relations.',
        target: 'semanticAtlas',
        policy: 'dirty-only',
        stages: ['Surface scan', 'Leaf embeddings', 'Entity context vectors', 'Candidate relations'],
    },
    {
        id: 'deepReasoning',
        label: 'Deep Reasoning',
        desc: 'Force rebuild for richer temporal, memory, and causal passes.',
        target: 'causal',
        policy: 'force',
        stages: ['Full rebuild', 'Temporal', 'Event identity', 'Memory/state', 'Causal review'],
    },
    {
        id: 'visualizationOnly',
        label: 'Visualization Only',
        desc: 'Open the graph view without mutating backend state.',
        target: 'galaxy',
        policy: 'read-only',
        stages: ['Load snapshot', 'Compile galaxy scene'],
    },
];

export function atlasCapabilityById(id: AtlasCapabilityId): AtlasCapability {
    return ATLAS_CAPABILITY_REGISTRY.find((capability) => capability.id === id) || ATLAS_CAPABILITY_REGISTRY[0];
}

export function atlasRecipeDefinitionById(id: AtlasRecipeId): AtlasCapabilityRecipeDefinition {
    return ATLAS_CAPABILITY_RECIPES.find((recipe) => recipe.id === id) || ATLAS_CAPABILITY_RECIPES[0];
}

export function capabilityLabel(id: AtlasCapabilityId): string {
    return atlasCapabilityById(id).label;
}

export function capabilityListLabel(ids: AtlasCapabilityId[]): string {
    return ids.length ? ids.map(capabilityLabel).join(' → ') : 'none';
}

export function laneLabelFromRegistry(id: AtlasModelLaneId): string {
    return ATLAS_MODEL_LANE_LABELS[id];
}
