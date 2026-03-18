import { Injector, computed, createEnvironmentInjector, runInInjectionContext, signal, type EnvironmentInjector } from '@angular/core';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('./app-state.service', () => ({
    AppStateService: class AppStateService {},
}));

import { AppStateService } from './app-state.service';
import { RightSidebarService } from './right-sidebar.service';

describe('RightSidebarService', () => {
    let injector: EnvironmentInjector;
    let appStateMock: {
        rightSidebarMode: ReturnType<typeof computed>;
        rightSidebarActivePanel: ReturnType<typeof computed>;
        setRightSidebarMode: ReturnType<typeof vi.fn>;
        toggleRightSidebar: ReturnType<typeof vi.fn>;
        setRightSidebarActivePanel: ReturnType<typeof vi.fn>;
    };
    let modeSignal: ReturnType<typeof signal<'open' | 'closed'>>;
    let panelSignal: ReturnType<typeof signal<'entities' | 'analytics' | 'timeline' | 'ai'>>;
    let service: RightSidebarService;

    beforeEach(() => {
        modeSignal = signal<'open' | 'closed'>('open');
        panelSignal = signal<'entities' | 'analytics' | 'timeline' | 'ai'>('entities');

        appStateMock = {
            rightSidebarMode: computed(() => modeSignal()),
            rightSidebarActivePanel: computed(() => panelSignal()),
            setRightSidebarMode: vi.fn(),
            toggleRightSidebar: vi.fn(),
            setRightSidebarActivePanel: vi.fn(),
        };

        injector = createEnvironmentInjector([
            { provide: AppStateService, useValue: appStateMock },
        ], Injector.create({ providers: [] }));

        service = runInInjectionContext(injector, () => new RightSidebarService());
    });

    afterEach(() => {
        injector.destroy();
    });

    it('reflects the persisted active panel from app state', () => {
        expect(service.activePanel()).toBe('entities');

        panelSignal.set('analytics');
        expect(service.activePanel()).toBe('analytics');

        panelSignal.set('ai');
        expect(service.activePanel()).toBe('ai');
    });

    it('delegates panel changes back to app state persistence', () => {
        service.setActivePanel('timeline');
        service.setActivePanel('analytics');
        service.setActivePanel('ai');

        expect(appStateMock.setRightSidebarActivePanel).toHaveBeenNthCalledWith(1, 'timeline');
        expect(appStateMock.setRightSidebarActivePanel).toHaveBeenNthCalledWith(2, 'analytics');
        expect(appStateMock.setRightSidebarActivePanel).toHaveBeenNthCalledWith(3, 'ai');
    });
});
