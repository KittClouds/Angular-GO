import { describe, expect, it } from 'vitest';

import {
    buildAtlasModelLaneViews,
    buildAtlasRecipeLifecycle,
    getAtlasModelRecipePlan,
    laneListLabel,
} from './atlas-model-recipe.model';

describe('atlas model recipe model', () => {
    it('keeps text graph recipes model-free without semantic, NER, or NLI warm lanes', () => {
        for (const recipeId of ['fastTextGraph', 'fullTextGraph'] as const) {
            const plan = getAtlasModelRecipePlan(recipeId);

            expect(plan.requiredLanes).toEqual([]);
            expect(plan.skippedLanes).toContain('dynamicNer');
            expect(plan.skippedLanes).toContain('coOccurrence');
            expect(plan.skippedLanes).toContain('semanticEmbedding');
            expect(plan.skippedLanes).toContain('nli');
            expect(plan.outputLabel).toMatch(/graph|vertices/i);
        }
    });

    it('marks Semantic Atlas as embedding-backed and NER/NLI-free for required warm lanes', () => {
        const plan = getAtlasModelRecipePlan('semanticAtlas');

        expect(plan.requiredLanes).toEqual(['semanticEmbedding']);
        expect(plan.optionalLanes).toContain('dynamicNer');
        expect(plan.optionalLanes).toContain('manifoldProjection');
        expect(plan.skippedLanes).toEqual(['nli']);
        expect(plan.actionLabel).toBe('Index Semantic Atlas');
        expect(plan.dependencyChain).toContain('semanticCandidate');
        expect(plan.mutationPolicy).toBe('dirty-only');
    });

    it('keeps warm stack as a no-mutation model readiness recipe', () => {
        const plan = getAtlasModelRecipePlan('warmFullIndexStack');

        expect(plan.requiredLanes).toEqual(['dynamicNer', 'semanticEmbedding', 'nli']);
        expect(plan.outputLabel).toBe('ready model sidecars');
    });

    it('does not require model lanes for visualization', () => {
        const plan = getAtlasModelRecipePlan('visualizeCurrentGraph');

        expect(plan.requiredLanes).toEqual([]);
        expect(plan.skippedLanes).toEqual(['dynamicNer', 'coOccurrence', 'semanticEmbedding', 'nli']);
    });

    it('normalizes model lane status into readable command-center lanes', () => {
        const lanes = buildAtlasModelLaneViews({
            dynamicNerStatus: 'warming',
            coOccurrenceReady: true,
            coOccurrenceLoading: false,
            vectorStatus: 'loading',
            semanticReady: false,
            semanticDetail: 'MDBR Leaf 384d',
            nliInitialized: false,
            nliProcessing: true,
            nliModelId: null,
            manifoldStatuses: { hybrid: 'ready', hopf: 'stale', lorentz: 'idle' },
        });

        expect(lanes.map((lane) => [lane.id, lane.status])).toEqual([
            ['dynamicNer', 'warming'],
            ['coOccurrence', 'ready'],
            ['semanticEmbedding', 'warming'],
            ['nli', 'running'],
            ['manifoldProjection', 'idle'],
        ]);
    });

    it('renders deterministic lifecycle step states', () => {
        const steps = buildAtlasRecipeLifecycle('run', ['scope', 'warm'], null);

        expect(steps.map((step) => [step.id, step.status])).toEqual([
            ['scope', 'ready'],
            ['warm', 'ready'],
            ['run', 'running'],
            ['refresh', 'idle'],
        ]);
    });

    it('formats lane lists without bare identifiers', () => {
        expect(laneListLabel(['dynamicNer', 'semanticEmbedding'])).toBe('Dynamic NER / Semantic Embedding');
        expect(laneListLabel([])).toBe('none');
    });
});
