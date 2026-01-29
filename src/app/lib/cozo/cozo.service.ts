/**
 * CozoDbService - Angular Injectable Service for CozoDB WASM
 * 
 * This is the ISOLATED CozoDB service. It does NOT connect to Dexie or any UI.
 * A separate bridge service will handle synchronization when ready.
 * 
 * Architecture:
 * - Dexie = client-facing reactive store (the app reads/writes here)
 * - CozoDB = background graph DB for queries (Datalog, graph traversal, etc.)
 * - Bridge (future) = syncs Dexie <-> CozoDB
 */

import { Injectable } from '@angular/core';

// CozoDB WASM types - matches cozo-lib-wasm exports
interface CozoDbInstance {
    run(script: string, params: string, immutable: boolean): string;
    export_relations(relations: string): string;
    import_relations(data: string): string;
}

interface CozoQueryResult<T = unknown[]> {
    ok: boolean;
    rows?: T[];
    headers?: string[];
    took?: number;
    message?: string;
    display?: string;
}

@Injectable({ providedIn: 'root' })
export class CozoService {
    private db: CozoDbInstance | null = null;
    private initPromise: Promise<void> | null = null;
    private wasmReady = false;

    // WASM module path - must be copied to assets
    private readonly wasmUrl = '/assets/cozo_lib_wasm_bg.wasm';

    /**
     * Check if CozoDB is ready to accept queries
     */
    get isReady(): boolean {
        return this.db !== null && this.wasmReady;
    }

    /**
     * Initialize CozoDB WASM module
     * Call this early in app boot, but don't block on it
     */
    async init(): Promise<void> {
        if (this.db) return;
        if (this.initPromise) return this.initPromise;

        this.initPromise = this.doInit();
        return this.initPromise;
    }

    private async doInit(): Promise<void> {
        try {
            console.log('[CozoService] Loading WASM module...');

            // Dynamic import of the WASM module
            const cozoModule = await import('cozo-lib-wasm');
            await cozoModule.default(this.wasmUrl);

            // Create the DB instance
            this.db = cozoModule.CozoDb.new();
            this.wasmReady = true;

            console.log('[CozoService] ✅ WASM module loaded, DB instance created');

            // Create schemas
            await this.createSchemas();

        } catch (err) {
            console.error('[CozoService] ❌ WASM initialization failed:', err);
            this.initPromise = null;
            throw err;
        }
    }

    /**
     * Create all CozoDB schemas (relations)
     * Safe to call multiple times - will ignore "already exists" errors
     */
    private async createSchemas(): Promise<void> {
        console.log('[CozoService] Creating schemas...');

        // Import schema definitions
        const { CONTENT_SCHEMAS } = await import('./content/ContentSchema');

        let created = 0;
        for (const { name, script } of CONTENT_SCHEMAS) {
            try {
                this.runRaw(script);
                console.log(`[CozoService] ✓ ${name}`);
                created++;
            } catch (err: unknown) {
                const msg = err instanceof Error ? err.message : String(err);
                if (!msg.includes('already exists')) {
                    console.warn(`[CozoService] ⚠ ${name}:`, msg);
                }
            }
        }

        console.log(`[CozoService] ✅ Schemas created: ${created}`);
    }

    /**
     * Run a raw CozoScript query
     * @returns The raw JSON string from CozoDB
     */
    runRaw(script: string, params: Record<string, unknown> = {}): string {
        if (!this.db) {
            throw new Error('[CozoService] Not initialized. Call init() first.');
        }
        return this.db.run(script, JSON.stringify(params), false);
    }

    /**
     * Run a query and parse the result
     * @returns Parsed CozoQueryResult
     */
    run<T = unknown[]>(script: string, params: Record<string, unknown> = {}): CozoQueryResult<T> {
        const resultStr = this.runRaw(script, params);
        return JSON.parse(resultStr) as CozoQueryResult<T>;
    }

    /**
     * Run a mutation (put/rm) and return success status
     */
    mutate(script: string, params: Record<string, unknown> = {}): boolean {
        const result = this.run(script, params);
        if (!result.ok) {
            console.error('[CozoService] Mutation failed:', result.message || result.display);
        }
        return result.ok;
    }

    /**
     * Export specified relations as JSON string
     */
    exportRelations(relations: string[]): string {
        if (!this.db) throw new Error('[CozoService] Not initialized');
        return this.db.export_relations(JSON.stringify({ relations }));
    }

    /**
     * Import relations from JSON string (from exportRelations)
     */
    importRelations(data: string): string {
        if (!this.db) throw new Error('[CozoService] Not initialized');
        return this.db.import_relations(data);
    }

    /**
     * List all relations in the database
     */
    listRelations(): string[] {
        const result = this.run<[string]>('::relations');
        if (!result.ok || !result.rows) return [];
        return result.rows.map(row => row[0]);
    }
}
