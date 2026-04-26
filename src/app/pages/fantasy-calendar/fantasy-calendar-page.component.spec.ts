import '@angular/compiler';
import {
    Injector,
    createEnvironmentInjector,
    runInInjectionContext,
    ɵChangeDetectionScheduler as ChangeDetectionScheduler,
    ɵEffectScheduler as EffectScheduler,
    type EnvironmentInjector,
} from '@angular/core';
import { convertToParamMap, ActivatedRoute, Router } from '@angular/router';
import { BehaviorSubject } from 'rxjs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { FantasyCalendarPageComponent } from './fantasy-calendar-page.component';

describe('FantasyCalendarPageComponent', () => {
    let injector: EnvironmentInjector;
    let component: FantasyCalendarPageComponent;
    let queryParamMap$: BehaviorSubject<ReturnType<typeof convertToParamMap>>;
    let routerMock: { navigate: ReturnType<typeof vi.fn> };
    let changeDetectionSchedulerMock: { notify: ReturnType<typeof vi.fn>; runningTick: boolean };
    let effectSchedulerMock: {
        add: ReturnType<typeof vi.fn>;
        schedule: ReturnType<typeof vi.fn>;
        flush: ReturnType<typeof vi.fn>;
        remove: ReturnType<typeof vi.fn>;
    };

    beforeEach(() => {
        queryParamMap$ = new BehaviorSubject(convertToParamMap({ view: 'kanban' }));
        routerMock = { navigate: vi.fn().mockResolvedValue(true) };
        changeDetectionSchedulerMock = {
            notify: vi.fn(),
            runningTick: false,
        };
        const scheduledEffects = new Set<{ dirty?: boolean; run: () => void }>();
        let flushPending = false;
        const flushEffects = () => {
            flushPending = false;
            for (const handle of Array.from(scheduledEffects)) {
                scheduledEffects.delete(handle);
                if (handle.dirty === false) continue;
                handle.run();
            }
        };
        const scheduleEffects = () => {
            if (flushPending) return;
            flushPending = true;
            Promise.resolve().then(flushEffects);
        };
        effectSchedulerMock = {
            add: vi.fn((handle) => {
                scheduledEffects.add(handle);
                scheduleEffects();
            }),
            schedule: vi.fn((handle) => {
                scheduledEffects.add(handle);
                scheduleEffects();
            }),
            flush: vi.fn(flushEffects),
            remove: vi.fn((handle) => {
                scheduledEffects.delete(handle);
            }),
        };

        injector = createEnvironmentInjector([
            { provide: Router, useValue: routerMock },
            {
                provide: ActivatedRoute,
                useValue: {
                    queryParamMap: queryParamMap$.asObservable(),
                },
            },
            { provide: ChangeDetectionScheduler, useValue: changeDetectionSchedulerMock },
            { provide: EffectScheduler, useValue: effectSchedulerMock },
        ], Injector.create({ providers: [] }));

        component = runInInjectionContext(injector, () => new FantasyCalendarPageComponent());
    });

    afterEach(() => {
        injector.destroy();
    });

    it('hydrates the current view mode from the route query string', async () => {
        await flushAsync(effectSchedulerMock);

        expect(component.viewMode()).toBe('kanban');

        queryParamMap$.next(convertToParamMap({ view: 'timeline' }));
        await flushAsync(effectSchedulerMock);

        expect(component.viewMode()).toBe('timeline');
    });

    it('persists the selected view mode back into the query string', async () => {
        await component.setViewMode('calendar');

        expect(component.viewMode()).toBe('calendar');
        expect(routerMock.navigate).toHaveBeenCalledWith([], {
            relativeTo: injector.get(ActivatedRoute),
            queryParams: { view: 'calendar' },
            queryParamsHandling: 'merge',
            replaceUrl: true,
        });
    });
});

async function flushAsync(effectSchedulerMock: { flush: () => void }): Promise<void> {
    await Promise.resolve();
    effectSchedulerMock.flush();
    await Promise.resolve();
    effectSchedulerMock.flush();
    await Promise.resolve();
}
