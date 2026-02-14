/**
 * Query Runner Service for RLM
 *
 * Two-lane execution model:
 * - RunRO: Read-only queries across all data
 * - RunWS: Workspace mutations only
 *
 * All queries are validated before execution and logged to episode_log.
 */

import { Injectable, inject } from '@angular/core';
import { cozoDb } from '../../cozo/db';
import { recordAction } from '../../cozo/memory/EpisodeLogService';
import {
    validateRO,
    validateWS,
    validateAuto,
    type ValidationResult,
    type QueryCaps,
    DEFAULT_RO_CAPS,
    DEFAULT_WS_CAPS,
} from '../validators/query-validator';

// ============================================================================
// Types
// ============================================================================

export interface QueryResult<T = unknown> {
    ok: boolean;
    rows?: T[];
    headers?: string[];
    truncated?: boolean;
    latMs?: number;
    error?: string;
    warning?: string;
}

export interface RunOptions {
    workspaceId?: string;
    narrativeId?: string;
    caps?: Partial<QueryCaps>;
    skipLog?: boolean;
}

// ============================================================================
// Service
// ============================================================================

@Injectable({ providedIn: 'root' })
export class QueryRunnerService {
    // Track active queries for timeout enforcement
    private activeQueries = new Map<string, AbortController>();

    /**
     * Run a read-only query with validation
     *
     * @param script - CozoScript query
     * @param params - Query parameters
     * @param options - Execution options
     * @returns Query result with rows and metadata
     */
    async runRO<T = unknown>(
        script: string,
        params: Record<string, unknown> = {},
        options: RunOptions = {}
    ): Promise<QueryResult<T>> {
        const caps: QueryCaps = { ...DEFAULT_RO_CAPS, ...options.caps };
        const startTime = Date.now();

        // Validate
        const validation = validateRO(script, caps);
        if (!validation.valid) {
            return {
                ok: false,
                error: validation.error,
                latMs: Date.now() - startTime,
            };
        }

        // Execute
        try {
            const result = await this.executeWithCaps<T>(script, params, caps);
            const latMs = Date.now() - startTime;

            // Log to episode_log
            if (!options.skipLog && options.workspaceId) {
                this.logQuery(options.workspaceId, script, latMs, result);
            }

            return {
                ...result,
                latMs,
                warning: validation.warnings?.join('; '),
            };
        } catch (err) {
            const latMs = Date.now() - startTime;
            return {
                ok: false,
                error: err instanceof Error ? err.message : String(err),
                latMs,
            };
        }
    }

    /**
     * Run a workspace mutation query with validation
     *
     * @param script - CozoScript mutation (must target ws_* relations only)
     * @param params - Query parameters
     * @param options - Execution options (workspaceId required)
     * @returns Query result
     */
    async runWS<T = unknown>(
        script: string,
        params: Record<string, unknown> = {},
        options: RunOptions = {}
    ): Promise<QueryResult<T>> {
        if (!options.workspaceId) {
            return {
                ok: false,
                error: 'workspaceId is required for WS mutations',
            };
        }

        const caps: QueryCaps = { ...DEFAULT_WS_CAPS, ...options.caps };
        const startTime = Date.now();

        // Validate
        const validation = validateWS(script, caps);
        if (!validation.valid) {
            return {
                ok: false,
                error: validation.error,
                latMs: Date.now() - startTime,
            };
        }

        // Execute
        try {
            const result = await this.executeWithCaps<T>(script, params, caps);
            const latMs = Date.now() - startTime;

            // Log to episode_log
            if (!options.skipLog) {
                this.logMutation(options.workspaceId, script, latMs, result);
            }

            return {
                ...result,
                latMs,
                warning: validation.warnings?.join('; '),
            };
        } catch (err) {
            const latMs = Date.now() - startTime;
            return {
                ok: false,
                error: err instanceof Error ? err.message : String(err),
                latMs,
            };
        }
    }

    /**
     * Auto-detect query type and execute in appropriate lane
     */
    async runAuto<T = unknown>(
        script: string,
        params: Record<string, unknown> = {},
        options: RunOptions = {}
    ): Promise<QueryResult<T>> {
        const validation = validateAuto(script);

        if (validation.suggestedLane === 'ws') {
            return this.runWS<T>(script, params, options);
        } else {
            return this.runRO<T>(script, params, options);
        }
    }

    /**
     * Execute query with resource caps
     */
    private async executeWithCaps<T>(
        script: string,
        params: Record<string, unknown>,
        caps: QueryCaps
    ): Promise<QueryResult<T>> {
        if (!cozoDb.isReady()) {
            return { ok: false, error: 'CozoDB not initialized' };
        }

        // Execute query
        const resultStr = cozoDb.run(script, params);

        // Parse result
        let result: { ok: boolean; rows?: T[][]; headers?: string[]; message?: string };
        try {
            result = JSON.parse(resultStr);
        } catch {
            return { ok: false, error: 'Failed to parse CozoDB result' };
        }

        if (!result.ok) {
            return {
                ok: false,
                error: result.message || 'Query failed',
            };
        }

        // Apply row cap
        let rows = result.rows || [];
        let truncated = false;
        if (rows.length > caps.maxRows) {
            rows = rows.slice(0, caps.maxRows);
            truncated = true;
        }

        // Check output size (rough estimate)
        const outputSize = JSON.stringify(rows).length;
        if (outputSize > caps.maxOutputBytes) {
            // Truncate further
            while (rows.length > 0 && JSON.stringify(rows).length > caps.maxOutputBytes) {
                rows.pop();
                truncated = true;
            }
        }

        return {
            ok: true,
            rows: rows as T[],
            headers: result.headers,
            truncated,
        };
    }

    /**
     * Log RO query to episode_log
     */
    private logQuery(
        workspaceId: string,
        script: string,
        latMs: number,
        result: QueryResult
    ): void {
        try {
            recordAction(
                workspaceId,
                '',
                'rlm_query_executed',
                '', // No specific target for RO queries
                'workspace',
                {
                    metadata: {
                        workspace_id: workspaceId,
                        query_node_id: '', // Would be set if query was stored as node
                        script: script.slice(0, 500), // Truncate for storage
                        lat_ms: latMs,
                        rows: result.rows?.length ?? 0,
                        truncated: result.truncated ?? false,
                        error: result.error,
                    },
                },
                ''
            );
        } catch (err) {
            console.warn('[QueryRunner] Failed to log query episode:', err);
        }
    }

    /**
     * Log WS mutation to episode_log
     */
    private logMutation(
        workspaceId: string,
        script: string,
        latMs: number,
        result: QueryResult
    ): void {
        try {
            recordAction(
                workspaceId,
                '',
                'rlm_workspace_mutation',
                '',
                'workspace',
                {
                    metadata: {
                        workspace_id: workspaceId,
                        ops: [{ op: 'raw_script', payload: { script: script.slice(0, 500) } }],
                        affected: [],
                        lat_ms: latMs,
                        success: result.ok,
                        error: result.error,
                    },
                },
                ''
            );
        } catch (err) {
            console.warn('[QueryRunner] Failed to log mutation episode:', err);
        }
    }

    /**
     * Check if a script is safe to execute
     */
    isSafe(script: string): ValidationResult {
        const roResult = validateRO(script);
        if (roResult.valid) return roResult;

        return validateWS(script);
    }

    /**
     * Get suggested lane for a script
     */
    getSuggestedLane(script: string): 'ro' | 'ws' {
        const result = validateAuto(script);
        return result.suggestedLane;
    }
}

// ============================================================================
// Standalone Functions (for non-DI usage)
// ============================================================================

/**
 * Run a read-only query without DI
 */
export async function runRO<T = unknown>(
    script: string,
    params: Record<string, unknown> = {},
    options: RunOptions = {}
): Promise<QueryResult<T>> {
    const service = new QueryRunnerService();
    return service.runRO<T>(script, params, options);
}

/**
 * Run a workspace mutation without DI
 */
export async function runWS<T = unknown>(
    script: string,
    params: Record<string, unknown> = {},
    options: RunOptions = {}
): Promise<QueryResult<T>> {
    const service = new QueryRunnerService();
    return service.runWS<T>(script, params, options);
}
