import { describe, expect, it } from 'vitest';

import { AppOrchestrator } from './app-orchestrator';

describe('AppOrchestrator', () => {
    it('keeps ready state true after background work begins', () => {
        const orchestrator = new AppOrchestrator();

        orchestrator.completePhase('runtime_load');
        orchestrator.completePhase('registry');
        orchestrator.completePhase('runtime_hydrate');
        orchestrator.completePhase('ready');

        expect(orchestrator.currentPhase()).toBe('background');
        expect(orchestrator.isReady()).toBe(true);
        expect(orchestrator.isRuntimeReady()).toBe(true);
        expect(orchestrator.isRegistryReady()).toBe(true);
    });

    it('advances phases in the same order the app boots them', () => {
        const orchestrator = new AppOrchestrator();

        orchestrator.completePhase('runtime_load');
        expect(orchestrator.currentPhase()).toBe('registry');

        orchestrator.completePhase('registry');
        expect(orchestrator.currentPhase()).toBe('runtime_hydrate');
    });
});
