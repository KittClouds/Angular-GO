import '@angular/compiler';
import {
    Injector,
    createEnvironmentInjector,
    runInInjectionContext,
    type EnvironmentInjector,
} from '@angular/core';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { MemoryModuleComponent } from './memory-module.component';
import { GoKittService } from '../../services/gokitt.service';
import { PlaygroundLogService } from '../../services/playground-log.service';

class GoKittServiceMock {
    private ready = false;
    private callbacks: Array<() => void> = [];

    get isReady(): boolean {
        return this.ready;
    }

    onReady(callback: () => void): void {
        if (this.ready) {
            callback();
            return;
        }
        this.callbacks.push(callback);
    }

    markReady(): void {
        this.ready = true;
        const pending = [...this.callbacks];
        this.callbacks = [];
        for (const callback of pending) {
            callback();
        }
    }
}

describe('MemoryModuleComponent readiness', () => {
    let injector: EnvironmentInjector;
    let component: MemoryModuleComponent;
    let goKittMock: GoKittServiceMock;

    beforeEach(() => {
        vi.useFakeTimers();
        goKittMock = new GoKittServiceMock();

        injector = createEnvironmentInjector([
            { provide: GoKittService, useValue: goKittMock },
            {
                provide: PlaygroundLogService,
                useValue: {
                    log: vi.fn(),
                    info: vi.fn(),
                },
            },
        ], Injector.create({ providers: [] }));

        component = runInInjectionContext(injector, () => new MemoryModuleComponent());
    });

    afterEach(() => {
        injector.destroy();
        vi.clearAllTimers();
        vi.useRealTimers();
    });

    it('mirrors GoKitt readiness through a deferred component signal', () => {
        expect(component.wasmReady()).toBe(false);

        vi.runOnlyPendingTimers();
        expect(component.wasmReady()).toBe(false);

        goKittMock.markReady();
        expect(component.wasmReady()).toBe(true);
    });
});
