import '@angular/compiler';
import {
    Injector,
    createEnvironmentInjector,
    runInInjectionContext,
    type EnvironmentInjector,
} from '@angular/core';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { RetrievalWorkbenchStateService } from './retrieval-workbench-state.service';

describe('RetrievalWorkbenchStateService', () => {
    let injector: EnvironmentInjector;
    let service: RetrievalWorkbenchStateService;

    beforeEach(() => {
        injector = createEnvironmentInjector([], Injector.create({ providers: [] }));
        service = runInInjectionContext(injector, () => new RetrievalWorkbenchStateService());
    });

    afterEach(() => injector.destroy());

    it('keeps lexical retrieval always enabled', () => {
        service.setLane('lexical', false);

        expect(service.lanes().lexical).toBe(true);
        expect(service.activeLanes()).toContain('lexical');
    });

    it('records graph focus requests for the graph page companion view', () => {
        service.requestGraphFocus({
            query: 'Aella',
            scope: 'global',
            noteId: 'note-1',
            title: 'Scene',
        });

        expect(service.graphFocus()).toMatchObject({
            query: 'Aella',
            scope: 'global',
            noteId: 'note-1',
            title: 'Scene',
        });
        expect(service.graphFocus()?.requestedAt).toBeGreaterThan(0);
    });

    it('shares the graph lens mode between retrieval and atlas surfaces', () => {
        service.setGraphLensMode('note');

        expect(service.graphLensMode()).toBe('note');
    });
});
