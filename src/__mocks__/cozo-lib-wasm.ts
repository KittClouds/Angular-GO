/**
 * Mock for cozo-lib-wasm
 */

export class CozoDb {
    static instance: CozoDb | null = null;

    constructor() {
        (CozoDb as unknown as { instance: CozoDb }).instance = this;
    }

    run(_script: string, _params?: Record<string, unknown>): string {
        return JSON.stringify({ ok: true, rows: [], headers: [] });
    }

    close(): void {
        // Mock close
    }
}

export default function init(): Promise<void> {
    return Promise.resolve();
}
