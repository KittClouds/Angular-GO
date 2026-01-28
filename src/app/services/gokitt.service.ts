import { Injectable } from '@angular/core';
import { smartGraphRegistry } from '../lib/registry';
import type { DecorationSpan } from '../lib/Scanner';

// Declare global GoKitt object
declare const GoKitt: {
    // Core
    initialize: (entitiesJSON?: string) => string;
    scan: (text: string) => string;
    scanImplicit: (text: string) => string;
    scanDiscovery: (text: string) => string;

    // Vectors
    initVectors: () => string;
    addVector: (id: number, vectorJSON: string) => string;
    searchVectors: (vectorJSON: string, k: number) => string;
    saveVectors: () => string;
};

// Declare Go global from wasm_exec.js
declare class Go {
    importObject: any;
    run(instance: WebAssembly.Instance): Promise<void>;
}

@Injectable({
    providedIn: 'root'
})
export class GoKittService {
    private wasmLoaded = false;  // Module loaded
    private wasmHydrated = false; // Dictionary populated
    private go: Go | null = null;
    private loadPromise: Promise<void> | null = null;
    private readyCallbacks: Array<() => void> = [];

    constructor() {
        // NO AUTO-INIT - orchestrator controls boot sequence
        console.log('[GoKittService] Service ready (waiting for orchestrated load)');
    }

    /**
     * Register a callback to be called when WASM is fully ready
     * If already ready, callback fires immediately
     */
    onReady(callback: () => void): void {
        if (this.isReady) {
            callback();
        } else {
            this.readyCallbacks.push(callback);
        }
    }

    /**
     * Fire all ready callbacks and dispatch global event
     */
    private notifyReady(): void {
        console.log('[GoKittService] 🚀 WASM ready - notifying listeners');

        // Fire registered callbacks
        for (const cb of this.readyCallbacks) {
            try { cb(); } catch (e) { console.error('[GoKittService] Callback error:', e); }
        }
        this.readyCallbacks = [];

        // Dispatch global event for non-DI listeners (like highlighter-api singleton)
        if (typeof window !== 'undefined') {
            window.dispatchEvent(new CustomEvent('gokitt-ready'));

            // Expose debug function for console testing
            (window as any).testGraphScan = (text?: string) => {
                const testText = text || "Gandalf said to Frodo that the ring is dangerous. The hobbit looked at the wizard with fear.";
                console.log('🧪 [DEBUG] Testing Reality Layer with:', testText);
                return this.scan(testText);
            };
            console.log('[GoKittService] 💡 Debug: Call window.testGraphScan() in console to test graph building');
        }
    }


    /**
     * Phase 3: Load WASM module (does NOT initialize dictionary)
     * Called by AppOrchestrator after data_layer is ready
     */
    async loadWasm(): Promise<void> {
        // Return existing promise if already loading
        if (this.loadPromise) return this.loadPromise;
        if (this.wasmLoaded) return;

        this.loadPromise = this._loadWasmInternal();
        return this.loadPromise;
    }

    private async _loadWasmInternal(): Promise<void> {
        // Ensure wasm_exec.js is loaded
        if (typeof Go === 'undefined') {
            throw new Error('[GoKittService] Go global not found. Ensure wasm_exec.js is loaded.');
        }

        // Handle partial process polyfill (bundler artifacts)
        const w = globalThis as any;
        let processBackup = null;

        if (typeof w.process !== 'undefined' && w.process) {
            const isRealNode = typeof w.process.versions === 'object' && !!w.process.versions.node;
            if (!isRealNode) {
                processBackup = w.process;
                try {
                    delete w.process;
                } catch (e) {
                    // Fallback: shim missing fields
                    if (w.process.pid === undefined) w.process.pid = -1;
                    if (w.process.ppid === undefined) w.process.ppid = -1;
                    if (!w.process.cwd) w.process.cwd = () => '/';
                    if (!w.process.getuid) w.process.getuid = () => -1;
                    if (!w.process.getgid) w.process.getgid = () => -1;
                }
            }
        }

        // Ensure fs.constants are defined BEFORE go.run()
        this.ensureGoWasmFsConstants();

        this.go = new Go();

        try {
            // Cache bust the WASM file
            const wasmUrl = `assets/gokitt.wasm?v=${Date.now()}`;
            const result = await WebAssembly.instantiateStreaming(
                fetch(wasmUrl),
                this.go.importObject
            );

            // Run Go main (non-blocking, runs in background)
            this.go.run(result.instance);

            // Wait for exports to be registered
            await new Promise<void>(resolve => setTimeout(resolve, 50));

            this.wasmLoaded = true;
            console.log('[GoKittService] WASM module loaded');

            // Restore process if we hid it
            if (processBackup) {
                (globalThis as any).process = processBackup;
            }

        } catch (err) {
            console.error('[GoKittService] Failed to load WASM:', err);
            throw err;
        }
    }

    /**
     * Phase 4: Hydrate WASM with entities from registry
     * Called by AppOrchestrator AFTER registry is ready
     */
    async hydrateWithEntities(): Promise<void> {
        if (!this.wasmLoaded) {
            throw new Error('[GoKittService] Cannot hydrate - WASM not loaded');
        }
        if (this.wasmHydrated) {
            console.log('[GoKittService.hydrateWithEntities] Already hydrated, skipping');
            return;
        }

        try {
            // Gather entities from registry for Aho-Corasick dictionary
            const allEntities = smartGraphRegistry.getAll();

            const entities = allEntities.map(e => ({
                ID: e.id,
                Label: e.label,
                Kind: e.kind,
                Aliases: e.aliases || [],
                NarrativeID: e.noteId || ''
            }));

            const entitiesJSON = JSON.stringify(entities);
            const res = GoKitt.initialize(entitiesJSON);

            try {
                const resObj = JSON.parse(res);
                if (resObj.error) {
                    console.error('[GoKittService] WASM Initialize failed:', resObj.error);
                    return;
                }
            } catch (e) {
                // Ignore parse error if simple string success
            }

            this.wasmHydrated = true;
            console.log(`[GoKittService] ✅ Hydrated with ${entities.length} entities`);

            // Notify listeners that WASM is ready for scanning
            this.notifyReady();

        } catch (e) {
            console.error('[GoKittService] ❌ Hydration failed:', e);
            throw e;
        }
    }

    /**
     * Re-hydrate dictionary when registry changes
     * Called after new entities are added
     */
    async refreshDictionary(): Promise<void> {
        if (!this.wasmLoaded) return;

        const allEntities = smartGraphRegistry.getAll();
        const entities = allEntities.map(e => ({
            ID: e.id,
            Label: e.label,
            Kind: e.kind,
            Aliases: e.aliases || [],
            NarrativeID: e.noteId || ''
        }));

        const entitiesJSON = JSON.stringify(entities);
        GoKitt.initialize(entitiesJSON);
        console.log(`[GoKittService] Dictionary refreshed: ${entities.length} entities`);
    }

    /**
     * Ensures all fs.constants values are numeric before Go runtime init.
     */
    private ensureGoWasmFsConstants() {
        const g = globalThis as any;
        g.fs ??= {};
        g.fs.constants ??= {};

        const c = g.fs.constants;
        c.O_WRONLY ??= 1;
        c.O_RDWR ??= 2;
        c.O_CREAT ??= 0;
        c.O_TRUNC ??= 0;
        c.O_APPEND ??= 0;
        c.O_EXCL ??= 0;
        c.O_SYNC ??= 0;
        c.O_DIRECTORY ??= -1;
    }

    // ============ Public API ============

    /**
     * Check if WASM is ready for operations
     */
    get isReady(): boolean {
        return this.wasmLoaded && this.wasmHydrated;
    }

    scan(text: string): any {
        if (!this.wasmLoaded) return { error: 'Wasm not ready' };
        try {
            console.log('[GoKittService.scan] 🧠 REALITY LAYER: Starting full scan...');
            console.log('[GoKittService.scan] Input text:', text.substring(0, 100) + '...');

            const json = GoKitt.scan(text);
            const result = JSON.parse(json);

            console.log('[GoKittService.scan] ✅ Result:', result);
            console.log('[GoKittService.scan] CST:', result.cst);
            console.log('[GoKittService.scan] Graph Nodes:', result.graph?.Nodes ? Object.keys(result.graph.Nodes).length : 0);
            console.log('[GoKittService.scan] Graph Edges:', result.graph?.Edges?.length ?? 0);

            return result;
        } catch (e) {
            console.error('[GoKittService] Scan error:', e);
            return { error: String(e) };
        }
    }

    scanDiscovery(text: string): any[] {
        if (!this.wasmLoaded) {
            console.warn('[GoKittService.scanDiscovery] WASM not loaded');
            return [];
        }
        try {
            console.log(`[GoKittService.scanDiscovery] Scanning ${text.length} chars`);
            const json = GoKitt.scanDiscovery(text);
            console.log('[GoKittService.scanDiscovery] Raw JSON:', json);
            const parsed = JSON.parse(json);
            console.log('[GoKittService.scanDiscovery] Parsed:', parsed);
            return parsed;
        } catch (e) {
            console.error('[GoKittService] Discovery error:', e);
            return [];
        }
    }

    /**
     * Scan text for known entities using Aho-Corasick
     * Returns decoration spans for implicit entity mentions
     * SILENTLY returns empty if WASM not ready (doesn't block editor)
     */
    scanImplicit(text: string): DecorationSpan[] {
        // Silently skip if not ready - don't slow down editor
        if (!this.isReady) {
            return [];
        }

        try {
            const json = GoKitt.scanImplicit(text);
            const spans = JSON.parse(json) as DecorationSpan[];

            // Post-process: Ensure Kinds are correct by verifying with Registry
            // This fixes issues where WASM might return partial data or casing mismatches
            for (const span of spans) {
                if (span.type === 'entity_implicit') {
                    // 1. Try to find authoritative entity in registry
                    const entity = smartGraphRegistry.findEntityByLabel(span.label);

                    if (entity) {
                        // Authority: Registry kind wins
                        span.kind = entity.kind;
                    } else if (span.kind) {
                        // Fallback: Normalize provided kind
                        span.kind = span.kind.toUpperCase() as any;
                    } else {
                        // Fallback: Default to UNKNOWN
                        span.kind = 'UNKNOWN';
                    }
                }
            }

            // DIAGNOSTIC LOGGING
            if (text.includes('Elbaph') || text.includes('Sanji')) {
                console.log(`[GoKitt] scanImplicit('${text}') -> found ${spans.length} spans`, spans);
            }

            return spans;
        } catch (e) {
            console.error('[GoKittService.scanImplicit] Error:', e);
            return [];
        }
    }



    async addVector(id: number, vector: number[]): Promise<void> {
        if (!this.wasmLoaded) return;
        const vecJson = JSON.stringify(vector);
        const res = GoKitt.addVector(id, vecJson);
        const parsed = JSON.parse(res);
        if (parsed.error) throw new Error(parsed.error);
    }

    async searchVectors(vector: number[], k: number): Promise<number[]> {
        if (!this.wasmLoaded) return [];
        const vecJson = JSON.stringify(vector);
        const res = GoKitt.searchVectors(vecJson, k);
        try {
            return JSON.parse(res);
        } catch (e) {
            const parsed = JSON.parse(res);
            if (parsed.error) throw new Error(parsed.error);
            return [];
        }
    }
}
