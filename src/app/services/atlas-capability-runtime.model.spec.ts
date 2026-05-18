import { describe, expect, it } from 'vitest';

import type {
    AtlasCapabilityRuntimeBinding,
    AtlasRecipeExecutionPlan,
} from './atlas-capability-runtime.model';

describe('atlas capability runtime model', () => {
    it('allows executable recipe plans to represent entity-anchored text graph scans', () => {
        const plan: AtlasRecipeExecutionPlan = {
            id: 'textGraph',
            label: 'Text Graph',
            description: 'Dirty-only text graph scan with required entity anchors',
            actionLabel: 'Build Text Graph',
            requiredCapabilities: ['dynamicSurface', 'dynamicChunking', 'dynamicNer', 'mentionGraph', 'evidenceGraph', 'surfaceGraph', 'assertedKernel'],
            optionalCapabilities: [],
            skippedCapabilities: ['semanticEmbedding', 'semanticAtlas', 'semanticCandidate', 'nliAdjudication'],
            dependencyChain: ['dynamicSurface', 'dynamicChunking', 'dynamicNer', 'mentionGraph', 'evidenceGraph', 'surfaceGraph', 'assertedKernel'],
            requiredModels: [{
                id: 'dynamicNer',
                laneId: 'dynamicNer',
                label: 'BI-small Dynamic NER',
                provider: 'dynamic_ner',
                service: 'NerService.warmProvider(dynamic_ner)',
                required: true,
                readiness: 'ready',
                statusLabel: 'ready',
            }],
            optionalModels: [],
            requiredServices: [{
                id: 'rich-text-graph',
                label: 'Rich text graph scan',
                service: 'AtlasScanCoordinatorService.runRichEmbeddingScan',
                backendRoute: 'atlas_rich_scan_json',
                ready: true,
            }],
            operations: [{
                kind: 'dynamicNerScan',
                service: 'NerService.runDynamicScan',
                policy: 'read-only',
            }, {
                kind: 'richTextGraphScan',
                service: 'AtlasScanCoordinatorService.runRichEmbeddingScan',
                policy: 'dirty-only',
            }],
            skips: ['semanticEmbedding', 'semanticAtlas', 'semanticCandidate', 'nliAdjudication'],
            expectedOutputs: [
                { key: 'graphDeltaCounts', label: 'graph delta counts', source: 'AtlasRichScanResult.graphDeltaCounts' },
            ],
            outputLabel: 'vertices + evidence edges',
            mutationPolicy: 'dirty-only',
            runPolicy: 'dirty-only',
            cost: 'Low-Med',
            backendRoute: 'AtlasScanCoordinatorService.runRichEmbeddingScan(includeSemanticAtlas=false, policy=dirty-only)',
            runnable: true,
            requiredLanes: ['dynamicNer'],
            optionalLanes: [],
            skippedLanes: ['semanticEmbedding', 'nli', 'manifoldProjection'],
        };

        expect(plan.requiredModels.map((model) => model.id)).toEqual(['dynamicNer']);
        expect(plan.operations.map((operation) => operation.kind)).toEqual(['dynamicNerScan', 'richTextGraphScan']);
        expect(plan.backendRoute).toContain('includeSemanticAtlas=false');
    });

    it('allows native reasoning probes to expose read-only runtime contracts', () => {
        const binding: AtlasCapabilityRuntimeBinding = {
            capabilityId: 'causalGraph',
            runnable: true,
            operationKind: 'nativeStoreProbe',
            requiredModels: [],
            requiredServices: [{
                id: 'native-store-probe',
                label: 'Causal graph causal-link edge probe',
                service: 'PhoenixBackendService.storeCommand',
                backendRoute: 'relation:list(graph_edges)',
                ready: true,
            }],
            mutationPolicy: 'read-only',
            runPolicy: 'read-only',
            readinessProbe: {
                label: 'Causal graph causal-link edge probe',
                status: 'ready',
                source: 'PhoenixBackendService.storeCommand',
                detail: 'read-only relation:list probe for graph_edges',
            },
            outputProbe: {
                label: 'Read-only native store rows',
                source: 'relation:list(graph_edges)',
                detail: 'Causal graph causal-link edge probe; no mutation',
                lastValue: null,
            },
        };

        expect(binding.runnable).toBe(true);
        expect(binding.operationKind).toBe('nativeStoreProbe');
        expect(binding.requiredServices[0].ready).toBe(true);
    });
});
