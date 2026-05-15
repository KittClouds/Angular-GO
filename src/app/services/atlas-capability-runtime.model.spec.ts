import { describe, expect, it } from 'vitest';

import type {
    AtlasCapabilityRuntimeBinding,
    AtlasRecipeExecutionPlan,
} from './atlas-capability-runtime.model';

describe('atlas capability runtime model', () => {
    it('allows executable recipe plans to represent model-free graph scans', () => {
        const plan: AtlasRecipeExecutionPlan = {
            id: 'textGraph',
            label: 'Text Graph',
            description: 'Dirty-only text graph scan',
            actionLabel: 'Build Text Graph',
            requiredCapabilities: ['dynamicSurface', 'dynamicChunking', 'mentionGraph', 'evidenceGraph', 'surfaceGraph', 'assertedKernel'],
            optionalCapabilities: ['dynamicNer'],
            skippedCapabilities: ['semanticEmbedding', 'semanticAtlas', 'semanticCandidate', 'nliAdjudication'],
            dependencyChain: ['dynamicSurface', 'dynamicChunking', 'mentionGraph', 'evidenceGraph', 'surfaceGraph', 'assertedKernel'],
            requiredModels: [],
            optionalModels: [],
            requiredServices: [{
                id: 'rich-text-graph',
                label: 'Rich text graph scan',
                service: 'AtlasScanCoordinatorService.runRichEmbeddingScan',
                backendRoute: 'atlas_rich_scan_json',
                ready: true,
            }],
            operations: [{
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
            requiredLanes: [],
            optionalLanes: [],
            skippedLanes: ['dynamicNer', 'semanticEmbedding', 'nli', 'manifoldProjection'],
        };

        expect(plan.requiredModels).toEqual([]);
        expect(plan.operations[0].kind).toBe('richTextGraphScan');
        expect(plan.backendRoute).toContain('includeSemanticAtlas=false');
    });

    it('allows blocked capability bindings to expose the exact missing runtime contract', () => {
        const binding: AtlasCapabilityRuntimeBinding = {
            capabilityId: 'causalGraph',
            runnable: false,
            operationKind: 'notWired',
            requiredModels: [],
            requiredServices: [{
                id: 'missing-runtime-binding',
                label: 'Missing runtime binding',
                service: 'not registered',
                backendRoute: 'not wired',
                ready: false,
                detail: 'No Search Panel runtime operation binding is registered.',
            }],
            mutationPolicy: 'native-only',
            runPolicy: 'native-only',
            readinessProbe: {
                label: 'Not wired',
                status: 'blocked',
                source: 'AtlasCapabilityRuntimeService',
                detail: 'No Search Panel runtime operation binding is registered.',
            },
            outputProbe: {
                label: 'No output',
                source: 'not wired',
                detail: 'runtime binding missing',
                lastValue: null,
            },
            blockedReason: 'No Search Panel runtime operation binding is registered.',
        };

        expect(binding.runnable).toBe(false);
        expect(binding.operationKind).toBe('notWired');
        expect(binding.requiredServices[0].ready).toBe(false);
    });
});
