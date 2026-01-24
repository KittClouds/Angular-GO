import { ScanCoordinator } from './ScanCoordinator';
import { smartGraphRegistry } from '../registry';
import { kittCore } from '../kittcore';

let instance: ScanCoordinator | null = null;

export function getScanCoordinator(): ScanCoordinator {
    if (!instance) {
        instance = new ScanCoordinator({
            kittCore,
            graphRegistry: smartGraphRegistry,
            onNewRelations: (relations) => {
                console.log('[ScanCoordinatorInstance] New relations found:', relations.length);
            },
            idleTimeoutMs: 1000
        });
    }
    return instance;
}

export function resetScanCoordinator(): void {
    if (instance) {
        instance.dispose();
        instance = null;
    }
}
