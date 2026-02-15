import { Injectable } from '@angular/core';
import { cozoDb } from './db';

// CozoDB WASM types - matches cozo-lib-wasm exports
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

    /**
     * Check if CozoDB is ready to accept queries
     */
    get isReady(): boolean {
        return cozoDb.isReady();
    }

    /**
     * Initialize CozoDB WASM module
     * Delegates to the singleton instance
     */
    async init(): Promise<void> {
        return cozoDb.init();
    }

    /**
     * Run a raw CozoScript query
     * @returns The raw JSON string from CozoDB
     */
    runRaw(script: string, params: Record<string, unknown> = {}): string {
        return cozoDb.run(script, params);
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
        return cozoDb.exportRelations(relations);
    }

    /**
     * Import relations from JSON string (from exportRelations)
     */
    importRelations(data: string): string {
        return cozoDb.importRelations(data);
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
