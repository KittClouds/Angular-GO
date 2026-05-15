import { describe, expect, it } from 'vitest';

import {
    ATLAS_CAPABILITY_LAYERS,
    ATLAS_CAPABILITY_RECIPES,
    ATLAS_CAPABILITY_REGISTRY,
    ATLAS_MODEL_LANE_LABELS,
    type AtlasGraphTargetId,
} from './atlas-capability.model';

describe('atlas capability registry', () => {
    it('keeps every graph target visible in the central capability registry', () => {
        const graphTargets = new Set(
            ATLAS_CAPABILITY_REGISTRY
                .map((capability) => capability.graphTargetId)
                .filter((id): id is AtlasGraphTargetId => !!id),
        );

        expect([...graphTargets].sort()).toEqual([
            'causal',
            'eventIdentity',
            'evidence',
            'galaxy',
            'kernel',
            'memoryState',
            'mention',
            'relation',
            'semanticAtlas',
            'semanticCandidate',
            'surface',
            'temporal',
        ].sort());
    });

    it('groups all capabilities into layered pipeline sections exactly once', () => {
        const layerIds = ATLAS_CAPABILITY_LAYERS.flatMap((layer) => layer.capabilityIds);
        const registryIds = ATLAS_CAPABILITY_REGISTRY.map((capability) => capability.id);

        expect(new Set(layerIds).size).toBe(layerIds.length);
        expect(layerIds.sort()).toEqual(registryIds.sort());
    });

    it('documents the causal graph as non-runnable until a safe build binding exists', () => {
        const sleeping = ATLAS_CAPABILITY_REGISTRY.filter((capability) => capability.uiCoverage === 'sleeping');

        expect(sleeping.map((capability) => capability.id)).toEqual([
            'causalGraph',
        ]);
        expect(sleeping.every((capability) => !capability.runnable)).toBe(true);
        expect(sleeping.every((capability) => capability.mutationPolicy === 'native-only')).toBe(true);
    });

    it('requires every recipe to expose dependencies, skips, outputs, cost, and mutation policy', () => {
        for (const recipe of ATLAS_CAPABILITY_RECIPES) {
            expect(recipe.outputLabel.length).toBeGreaterThan(0);
            expect(recipe.backendRoute.length).toBeGreaterThan(0);
            expect(recipe.cost.length).toBeGreaterThan(0);
            expect(recipe.mutationPolicy.length).toBeGreaterThan(0);
            expect(recipe.dependencyChain.length + recipe.optionalCapabilities.length + recipe.skippedCapabilities.length).toBeGreaterThan(0);
        }
    });

    it('keeps model lane labels in the same registry used by recipe plans', () => {
        expect(Object.keys(ATLAS_MODEL_LANE_LABELS).sort()).toEqual([
            'coOccurrence',
            'dynamicNer',
            'manifoldProjection',
            'nli',
            'semanticEmbedding',
        ].sort());
    });
});
