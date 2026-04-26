import { NgZone } from '@angular/core';

type ZoneFunction<T> = (...args: any[]) => T;

function invokeWithoutZone<T>(fn: ZoneFunction<T>, applyThis?: unknown, applyArgs?: unknown[]): T {
    return fn.apply(applyThis, applyArgs ?? []);
}

export function createNoopNgZone(): NgZone {
    return {
        run: invokeWithoutZone,
        runGuarded: invokeWithoutZone,
        runTask: invokeWithoutZone,
        runOutsideAngular: invokeWithoutZone,
    } as NgZone;
}

export function createWorkerOutsideAngular(
    ngZone: NgZone,
    factory: () => Worker,
    bind?: (worker: Worker) => void,
): Worker {
    return ngZone.runOutsideAngular(() => {
        const worker = factory();
        bind?.(worker);
        return worker;
    });
}

export function addWorkerListenerOutsideAngular<K extends keyof WorkerEventMap>(
    ngZone: NgZone,
    worker: Worker,
    type: K,
    listener: (event: WorkerEventMap[K]) => void,
    options?: boolean | AddEventListenerOptions,
): () => void {
    ngZone.runOutsideAngular(() => {
        worker.addEventListener(type, listener as EventListener, options);
    });
    return () => worker.removeEventListener(type, listener as EventListener, options);
}
