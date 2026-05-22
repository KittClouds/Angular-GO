// @vitest-environment jsdom
import '@angular/compiler';
import {
    Injector,
    createEnvironmentInjector,
    runInInjectionContext,
    signal,
    ɵChangeDetectionScheduler as ChangeDetectionScheduler,
    ɵEffectScheduler as EffectScheduler,
    type EnvironmentInjector,
} from '@angular/core';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const dbMock = vi.hoisted(() => ({
    notes: {
        toArray: vi.fn(async () => [{ id: 'note-1', title: 'One', updatedAt: 10 }]),
    },
    entityNoteIndex: {
        where: vi.fn(() => ({
            equals: vi.fn(() => ({
                toArray: vi.fn(async () => []),
            })),
        })),
    },
}));

vi.mock('../../../../lib/dexie/db', () => ({
    db: dbMock,
}));

import { GraphLensWorkspaceComponent } from './graph-lens-workspace.component';
import { GraphRebuildService } from '../../../../graph-rebuild/graph-rebuild.service';
import { PhoenixProjectionService } from '../../../../services/phoenix-projection.service';

let latestEffectScheduler: ReturnType<typeof createImmediateEffectScheduler> | null = null;

describe('GraphLensWorkspaceComponent read-only snapshot loading', () => {
    let injector: EnvironmentInjector;
    let graphRebuild: ReturnType<typeof createGraphRebuildMock>;
    let component: GraphLensWorkspaceComponent;
    let effectScheduler: ReturnType<typeof createImmediateEffectScheduler>;

    beforeEach(() => {
        graphRebuild = createGraphRebuildMock();
        effectScheduler = createImmediateEffectScheduler();
        latestEffectScheduler = effectScheduler;
        injector = createEnvironmentInjector([
            { provide: GraphRebuildService, useValue: graphRebuild },
            { provide: PhoenixProjectionService, useValue: createProjectionMock() },
            { provide: ChangeDetectionScheduler, useValue: { notify: vi.fn(), runningTick: false } },
            { provide: EffectScheduler, useValue: effectScheduler },
        ], Injector.create({ providers: [] }) as unknown as EnvironmentInjector);
        component = runInInjectionContext(injector, () => new GraphLensWorkspaceComponent());
    });

    afterEach(() => {
        component?.ngOnDestroy();
        injector?.destroy();
        vi.clearAllMocks();
    });

    it('loads cached graph snapshots without invoking graph rebuild on lens or anchor changes', async () => {
        await flushAsync();

        expect(graphRebuild.loadPersistedSnapshot).toHaveBeenCalledWith('global');
        expect(graphRebuild.buildAndPersistSnapshot).not.toHaveBeenCalled();

        component.setLensMode('note');
        component.toggleNote('note-1');
        await flushAsync();

        expect(graphRebuild.loadPersistedSnapshot).toHaveBeenCalledWith('note:note-1');
        expect(graphRebuild.buildAndPersistSnapshot).not.toHaveBeenCalled();

        window.dispatchEvent(new CustomEvent('graph-rebuild-anchors-changed'));
        await flushAsync();

        expect(component.graphSnapshotStale()).toBe(true);
        expect(graphRebuild.buildAndPersistSnapshot).not.toHaveBeenCalled();

        window.dispatchEvent(new CustomEvent('graph-rebuild-snapshot-updated'));
        await flushAsync();

        expect(graphRebuild.loadPersistedSnapshot).toHaveBeenCalledTimes(3);
        expect(graphRebuild.buildAndPersistSnapshot).not.toHaveBeenCalled();
    });
});

function createGraphRebuildMock() {
    return {
        loadPersistedSnapshot: vi.fn(async () => null),
        buildAndPersistSnapshot: vi.fn(async () => null),
    };
}

function createProjectionMock() {
    return {
        entities: signal([]),
        getEdgesForEntity: vi.fn(() => []),
    };
}

function createImmediateEffectScheduler() {
    const scheduled = new Set<any>();
    const run = (effect: any) => {
        if (typeof effect?.run === 'function') effect.run();
    };
    return {
        add: vi.fn((effect: any) => {
            scheduled.add(effect);
        }),
        schedule: vi.fn((effect: any) => {
            scheduled.add(effect);
        }),
        flush: vi.fn(() => {
            for (const effect of [...scheduled]) run(effect);
        }),
        remove: vi.fn((effect: any) => {
            scheduled.delete(effect);
        }),
    };
}

async function flushAsync(): Promise<void> {
    latestEffectScheduler?.flush();
    await Promise.resolve();
    latestEffectScheduler?.flush();
    await Promise.resolve();
}
