/**
 * CozoDB Service - WASM + OPFS Persistence
 * 
 * Features:
 * - WASM initialization with preloading
 * - In-memory CozoDB instance
 * - OPFS persistence via Snapshot + WAL
 * - Export/import utilities
 */

import init, { CozoDb } from 'cozo-lib-wasm';
const wasmUrl = '/assets/cozo_lib_wasm_bg.wasm';
import { cozoPersistence } from './persistence/CozoPersistenceService';
import { initContentRepo } from './content';
import { createGraphSchemas, createBlocksHnswIndex } from './graph/GraphSchema';
import { WS_SCHEMAS, WS_RELATIONS } from '../rlm';

// Relations to persist (graph + content)
export const PERSISTED_RELATIONS = [
    // Graph relations
    'entities', 'entity_edge', 'entity_mentions', 'entity_aliases', 'entity_metadata',
    'relationship_provenance', 'relationship_attributes', 'discovery_candidates',
    // Content relations
    'notes', 'folders', 'tags', 'note_tags',
    // Calendar relations
    'calendar_definitions', 'calendar_months', 'calendar_weekdays',
    'calendar_events', 'calendar_periods',
    // Fact Sheets & Schemas
    'folder_schemas', 'entity_cards', 'fact_sheet_card_schemas', 'fact_sheet_field_schemas',
    // Network & Cross-Doc
    'network_instance', 'network_membership', 'network_relationship',
    'node_vectors', 'entity_clusters', 'cluster_members', 'cooccurrence_edges',
    // LLM Memory relations
    'episode_log', 'blocks',
    // RLM Workspace relations
    ...WS_RELATIONS
];

export class CozoDbService {
    private db: CozoDb | null = null;
    private initPromise: Promise<void> | null = null;
    private preloadPromise: Promise<void> | null = null;
    private wasmReady = false;
    private walEntryCount = 0;
    private lastCompactTime = Date.now();
    private isCompacting = false;                    // Mutex to prevent concurrent compaction
    private compactDebounceTimer: number | null = null;
    private readonly COMPACT_THRESHOLD = 50;         // Compact after N WAL entries
    private readonly COMPACT_INTERVAL_MS = 300000;   // Or after 5 minutes
    private readonly COMPACT_DEBOUNCE_MS = 5000;     // Debounce: wait 5s after last mutation

    /**
     * Preload the WASM module (fire-and-forget, non-blocking)
     * Call this early in boot sequence to overlap with other init work.
     */
    preload(): Promise<void> {
        if (this.wasmReady) return Promise.resolve();
        if (this.preloadPromise) return this.preloadPromise;

        console.log('[CozoDB] Preloading WASM...');
        this.preloadPromise = init(wasmUrl).then(() => {
            this.wasmReady = true;
            console.log('[CozoDB] ✅ WASM preloaded');
        }).catch(err => {
            console.error('[CozoDB] WASM preload failed:', err);
            this.preloadPromise = null;
            throw err;
        });

        return this.preloadPromise;
    }

    /**
     * Initialize the CozoDB WASM module and restore from persistence
     */
    async init(): Promise<void> {
        if (this.db) return;
        if (this.initPromise) return this.initPromise;

        this.initPromise = this.doInit().catch(err => {
            console.error('[CozoDB] Initialization failed:', err);
            this.initPromise = null; // Reset so retry is possible
            throw err;
        });

        return this.initPromise;
    }

    /**
     * Internal initialization logic
     */
    private async doInit(): Promise<void> {
        console.log('[CozoDB] Initializing...');
        const startTime = Date.now();

        try {
            // Wait for preload if in progress, or start fresh
            if (this.preloadPromise) {
                await this.preloadPromise;
            } else if (!this.wasmReady) {
                await init(wasmUrl);
                this.wasmReady = true;
            }

            // Create in-memory DB instance
            this.db = CozoDb.new();
            console.log('[CozoDB] ✅ WASM loaded, DB instance created');

            // Create schemas first (before restoring data)
            await this.createSchemas();

            // Restore from persistence (snapshot + WAL replay)
            await this.restoreFromPersistence();

            // Initialize content repo (notes/folders schemas)
            initContentRepo();

            const elapsed = Date.now() - startTime;
            console.log(`[CozoDB] ✅ Initialized in ${elapsed}ms`);

        } catch (err) {
            console.error('[CozoDB] ❌ Initialization failed:', err);
            this.db = null;
            this.wasmReady = false;
            throw err;
        }
    }

    /**
     * Create all CozoDB schemas (relations)
     * Safe to call multiple times - will ignore "already exists" errors
     */
    private async createSchemas(): Promise<void> {
        // Graph schemas
        const graphSchemas = createGraphSchemas();
        for (const script of graphSchemas) {
            try {
                this.db!.run(script, '{}', false);
            } catch (e: unknown) {
                const msg = e instanceof Error ? e.message : String(e);
                // Ignore "already exists" errors
                if (!msg.includes('AlreadyExists') && !msg.includes('already exists')) {
                    console.error('[CozoDB] Schema error:', msg);
                }
            }
        }
        // Create Blocks HNSW Index
        createBlocksHnswIndex();


        console.log('[CozoDB] ✅ Schemas ready');
    }

    /**
     * Restore database state from OPFS snapshot + WAL
     */
    private async restoreFromPersistence(): Promise<void> {
        try {
            const { snapshot, wal } = await cozoPersistence.load();

            // Restore snapshot if exists
            if (snapshot) {
                try {
                    // Cozo's export format wraps data in {data: {...}, ok: true}
                    // But import_relations expects just the relation data directly
                    const dataStr = typeof snapshot === 'string' ? snapshot : JSON.stringify(snapshot);
                    const parsed = JSON.parse(dataStr);

                    // Extract the actual data part for import
                    const dataToImport = parsed.data || parsed;
                    const relationNames = Object.keys(dataToImport);

                    // Track expected counts for validation
                    const expectedCounts: Record<string, number> = {};
                    for (const rel of relationNames) {
                        expectedCounts[rel] = dataToImport[rel]?.rows?.length ?? 0;
                    }

                    // Import just the data part, not the {data, ok} wrapper
                    const importPayload = JSON.stringify(dataToImport);
                    const importResult = this.db!.import_relations(importPayload);
                    const importParsed = JSON.parse(importResult);

                    if (importParsed.ok === false) {
                        console.error('[CozoDB] ❌ import_relations FAILED:', importParsed.message);
                    } else {
                        // Validate import - check row counts match expected
                        let totalExpected = 0;
                        let totalActual = 0;

                        for (const [rel, expected] of Object.entries(expectedCounts)) {
                            if (expected > 0) {
                                try {
                                    const result = this.db!.run(`?[count(id)] := *${rel}{id}`, '{}', false);
                                    const actual = JSON.parse(result).rows?.[0]?.[0] ?? 0;
                                    totalExpected += expected;
                                    totalActual += actual;

                                    if (actual !== expected) {
                                        console.warn(`[CozoDB] ⚠️ ${rel}: expected ${expected} rows, got ${actual}`);
                                    }
                                } catch {
                                    // Relation might not have 'id' column, skip validation
                                }
                            }
                        }

                        console.log(`[CozoDB] ✅ Snapshot restored (${relationNames.length} relations, ${totalActual}/${totalExpected} rows)`);
                    }
                } catch (e) {
                    console.warn('[CozoDB] Snapshot restore failed, starting fresh:', e);
                }
            }

            // Replay WAL entries
            if (wal && wal.length > 0) {
                console.log(`[CozoDB] Replaying ${wal.length} WAL entries...`);

                // 🔍 DIAGNOSTIC: Show first few WAL entries
                console.log('[CozoDB] 🔍 WAL entries preview:');
                wal.slice(0, 3).forEach((entry, i) => {
                    console.log(`  [${i}] ${entry.script.slice(0, 200)}...`);
                });

                let replayedCount = 0;
                for (const entry of wal) {
                    try {
                        // Use stored params if available, otherwise empty object
                        const params = entry.params || '{}';
                        this.db!.run(entry.script, params, false);
                        replayedCount++;
                    } catch (e) {
                        console.warn('[CozoDB] WAL entry replay failed:', entry.script.slice(0, 100), e);
                    }
                }
                console.log(`[CozoDB] ✅ Replayed ${replayedCount}/${wal.length} WAL entries`);
                this.walEntryCount = wal.length;

                // 🔍 DIAGNOSTIC: Check relations after WAL replay
                try {
                    const result = this.db!.run('::relations', '{}', false);
                    console.log('[CozoDB] 🔍 Relations after WAL replay:', result);
                } catch { }
            }
        } catch (e) {
            console.warn('[CozoDB] Persistence load failed, starting fresh:', e);
        }
    }

    /**
     * Check if the DB is initialized and ready.
     */
    isReady(): boolean {
        return this.db !== null;
    }

    /**
     * Check if a script is a mutation (modifies data)
     */
    private isMutationScript(script: string): boolean {
        // Cozo mutation keywords
        const mutationPatterns = [
            ':put ',
            ':rm ',
            ':replace ',
            ':create ',
            ':ensure ',
            ':insert ',
            ':delete ',
        ];
        const lowerScript = script.toLowerCase();
        return mutationPatterns.some(pattern => lowerScript.includes(pattern));
    }

    /**
     * Run a CozoScript query.
     * @param script The CozoScript query string
     * @param params Parameters as a generic object (will be JSON stringified)
     * @returns The raw string result from CozoDB
     */
    run(script: string, params: Record<string, any> = {}): string {
        if (!this.db) {
            throw new Error('[CozoDB] Not initialized. Call init() first.');
        }

        try {
            const paramsStr = JSON.stringify(params);
            const result = this.db.run(script, paramsStr, false);

            // Auto-persist mutations to WAL (fire and forget)
            // Skip schema creation scripts (already idempotent)
            if (this.isMutationScript(script) && !script.toLowerCase().includes(':create ')) {
                cozoPersistence.appendWal(script, paramsStr);
                this.walEntryCount++;
                this.maybeCompact();
            }

            return result;
        } catch (err) {
            console.error('[CozoDB] Query failed:', script, err);
            throw err;
        }
    }

    /**
     * Run a query and parse the result as JSON.
     */
    runQuery(script: string, params: Record<string, any> = {}): any {
        const resultStr = this.run(script, params);

        try {
            return JSON.parse(resultStr);
        } catch (e) {
            console.error('[CozoDB] Failed to parse result:', resultStr);
            throw new Error(`CozoDB result parse error: ${e}`);
        }
    }

    /**
     * Run a mutation and persist it to WAL
     * Use this for any script that modifies data (:put, :rm, :replace)
     */
    runMutation(script: string, params: Record<string, any> = {}): any {
        const result = this.runQuery(script, params);

        // Persist to WAL (fire and forget)
        cozoPersistence.appendWal(script);
        this.walEntryCount++;

        // Check if compaction is needed
        this.maybeCompact();

        return result;
    }

    /**
     * Check if compaction should run and trigger it (with debouncing)
     */
    private maybeCompact(): void {
        // Clear any pending debounce timer
        if (this.compactDebounceTimer) {
            clearTimeout(this.compactDebounceTimer);
            this.compactDebounceTimer = null;
        }

        const timeSinceCompact = Date.now() - this.lastCompactTime;

        // Don't compact if we just did one recently
        if (timeSinceCompact < this.COMPACT_DEBOUNCE_MS) {
            return;
        }

        // Only compact if we hit threshold or time limit
        if (this.walEntryCount >= this.COMPACT_THRESHOLD || timeSinceCompact >= this.COMPACT_INTERVAL_MS) {
            // Debounce: schedule compaction for 5s from now
            this.compactDebounceTimer = window.setTimeout(() => {
                this.compactDebounceTimer = null;
                this.compact().catch(e => {
                    console.warn('[CozoDB] Background compaction failed:', e);
                });
            }, this.COMPACT_DEBOUNCE_MS);
        }
    }

    /**
     * Compact: Export current state and truncate WAL
     */
    async compact(): Promise<void> {
        if (!this.db) return;

        // Mutex: prevent concurrent compactions
        if (this.isCompacting) {
            return;
        }
        this.isCompacting = true;

        try {
            // Disabled: PERSISTED_RELATIONS commented out
            /*
            // Check which relations exist before exporting
            const existingRelations: string[] = [];
            for (const rel of PERSISTED_RELATIONS) {
                try {
                    // Check if relation has any rows using exact count pattern
                    const result = this.db.run(`?[count(id)] := *${rel}{id}`, '{}', false);
                    const parsed = JSON.parse(result);
                    const count = parsed.rows?.[0]?.[0] || 0;
                    if (count > 0) {
                        existingRelations.push(rel);
                    }
                } catch {
                    // Relation doesn't exist, skip
                }
            }

            if (existingRelations.length === 0) {
                return;
            }

            const exportData = this.exportRelations(existingRelations);
            await cozoPersistence.compact(exportData);
            */

            this.walEntryCount = 0;
            this.lastCompactTime = Date.now();
        } catch (e) {
            console.error('[CozoDB] Compaction failed:', e);
        } finally {
            this.isCompacting = false;
        }
    }

    /**
     * Export relations as JSON string.
     * @param relations Array of relation names to export
     */
    exportRelations(relations: string[]): string {
        if (!this.db) throw new Error('[CozoDB] Not initialized');

        try {
            const payload = JSON.stringify({ relations });
            return this.db.export_relations(payload);
        } catch (err) {
            console.error('[CozoDB] Export failed:', err);
            throw err;
        }
    }

    /**
     * Import relations from JSON string.
     * @param data Serialized relations data (from exportRelations)
     */
    importRelations(data: string): string {
        if (!this.db) throw new Error('[CozoDB] Not initialized');

        try {
            return this.db.import_relations(data);
        } catch (err) {
            console.error('[CozoDB] Import failed:', err);
            throw err;
        }
    }

    /**
     * Export entire database state to downloadable JSON
     */
    async exportToFile(relations: string[]): Promise<Blob> {
        const data = this.exportRelations(relations);

        const exportData = {
            version: '2.0',
            timestamp: new Date().toISOString(),
            relations,
            data,
        };

        const json = JSON.stringify(exportData, null, 2);
        return new Blob([json], { type: 'application/json' });
    }

    /**
     * Import database state from file
     */
    async importFromFile(fileContent: string): Promise<void> {
        const parsed = JSON.parse(fileContent);

        if (!parsed.data) {
            throw new Error('Invalid export file format');
        }

        this.importRelations(parsed.data);

        // Trigger compaction to persist the import
        await this.compact();
    }

    /**
     * Close database connection (cleanup)
     */
    async close(): Promise<void> {
        // Compact before close to ensure data is saved
        await this.compact();

        this.db = null;
        this.initPromise = null;
        console.log('[CozoDB] Connection closed');
    }
}

// Singleton instance
export const cozoDb = new CozoDbService();

// Debug utilities (accessible from browser console)
if (typeof window !== 'undefined') {
    (window as any).cozoDebug = {
        // Clear the stale WAL (fixes duplicate entity issue)
        clearWal: async () => {
            const { cozoPersistence } = await import('./persistence/CozoPersistenceService');
            await cozoPersistence.clearWal();
            console.log('✅ WAL cleared. Refresh the page to see changes.');
        },
        // Query entities count
        queryEntities: () => {
            const result = cozoDb.runQuery('?[count(id)] := *entities{id}');
            console.log('Entities count:', result.rows?.[0]?.[0] ?? 0);
            return result;
        },
        // List all entities
        listEntities: () => {
            const result = cozoDb.runQuery('?[id, label, kind] := *entities{id, label, kind}');
            console.table(result.rows?.map((r: any) => ({ id: r[0], label: r[1], kind: r[2] })));
            return result;
        },
        // Delete all entities (nuclear option)
        clearEntities: () => {
            const result = cozoDb.runQuery('?[id] := *entities{id} :rm entities {id}');
            console.log('Cleared entities:', result);
            return result;
        }
    };
    console.log('[CozoDB] 🔧 Debug: window.cozoDebug.clearWal() to fix duplicate entities');
}
