/**
 * Workspace Operations Service for RLM
 *
 * Provides 8-10 canonical operations for workspace manipulation.
 * These operations compile to safe CozoScript and execute via QueryRunnerService.
 *
 * Canonical Operations:
 * 1. createNode - Create a workspace node
 * 2. updateNode - Update node's json payload
 * 3. deleteNode - Delete a workspace node
 * 4. link - Create an edge between nodes
 * 5. unlink - Delete an edge between nodes
 * 6. snapshotView - Store a materialized view
 * 7. getView - Retrieve a cached view
 * 8. storeQuery - Store a query node with metadata
 * 9. storeResult - Store a result node and link to query
 * 10. spawnTask - Create a task node for recursive processing
 */

import { Injectable, inject } from '@angular/core';
import { cozoDb } from '../../cozo/db';
import { recordAction } from '../../cozo/memory/EpisodeLogService';
import { QueryRunnerService, type QueryResult, type RunOptions } from './query-runner.service';
import {
    type WsNode,
    type WsNodeKind,
    type WsEdge,
    type WsEdgeRel,
    type WsViewCache,
    WS_QUERIES,
} from '../schema/workspace-schema';

// ============================================================================
// Types
// ============================================================================

/**
 * Result of a workspace operation
 */
export interface OpResult<T = unknown> {
    ok: boolean;
    data?: T;
    affected?: string[];
    error?: string;
    latMs?: number;
}

/**
 * Node creation payload
 */
export interface CreateNodePayload {
    nodeId: string;
    kind: WsNodeKind;
    json?: Record<string, unknown>;
}

/**
 * Node update payload
 */
export interface UpdateNodePayload {
    nodeId: string;
    json: Record<string, unknown>;
    merge?: boolean; // If true, merge with existing json
}

/**
 * Edge creation payload
 */
export interface LinkPayload {
    fromId: string;
    toId: string;
    rel: WsEdgeRel;
    meta?: Record<string, unknown>;
}

/**
 * View snapshot payload
 */
export interface SnapshotViewPayload {
    viewId: string;
    json: Record<string, unknown>;
}

/**
 * Query storage payload
 */
export interface StoreQueryPayload {
    queryId?: string; // Auto-generated if not provided
    script: string;
    bindings?: Record<string, unknown>;
    intent?: string;
    costBudget?: number;
}

/**
 * Result storage payload
 */
export interface StoreResultPayload {
    resultId?: string; // Auto-generated if not provided
    queryId: string;
    rows: unknown[];
    headers?: string[];
    truncated?: boolean;
    provenance?: string[];
}

/**
 * Task spawn payload
 */
export interface SpawnTaskPayload {
    taskId?: string; // Auto-generated if not provided
    parentId?: string; // Parent task for recursive spawning
    plan: string;
    context?: Record<string, unknown>;
}

/**
 * Workspace operation type for logging
 */
export type WorkspaceOpType =
    | 'create_node'
    | 'update_node'
    | 'delete_node'
    | 'link'
    | 'unlink'
    | 'snapshot_view'
    | 'get_view'
    | 'store_query'
    | 'store_result'
    | 'spawn_task';

/**
 * Compiled operation with script and params
 */
interface CompiledOp {
    script: string;
    params: Record<string, unknown>;
    affected: string[];
}

// ============================================================================
// Service
// ============================================================================

@Injectable({ providedIn: 'root' })
export class WorkspaceOpsService {
    private queryRunner: QueryRunnerService;

    constructor(queryRunner?: QueryRunnerService) {
        this.queryRunner = queryRunner || inject(QueryRunnerService);
    }

    // Track workspace initialization
    private initializedWorkspaces = new Set<string>();

    // ========================================================================
    // Node Operations
    // ========================================================================

    /**
     * Create a workspace node
     *
     * @param workspaceId - Workspace identifier
     * @param payload - Node creation payload
     * @returns Operation result with created node
     */
    async createNode(
        workspaceId: string,
        payload: CreateNodePayload
    ): Promise<OpResult<WsNode>> {
        const startTime = Date.now();
        const now = Date.now();

        const compiled = this.compileCreateNode(workspaceId, payload, now);
        const result = await this.queryRunner.runWS<unknown[]>(
            compiled.script,
            compiled.params,
            { workspaceId, skipLog: true }
        );

        if (!result.ok) {
            return {
                ok: false,
                error: result.error,
                latMs: Date.now() - startTime,
            };
        }

        const node: WsNode = {
            workspace_id: workspaceId,
            node_id: payload.nodeId,
            kind: payload.kind,
            json: payload.json || {},
            created_at: now,
            updated_at: now,
        };

        // Log episode
        this.logOp(workspaceId, 'create_node', payload.nodeId, {
            kind: payload.kind,
            json_size: JSON.stringify(payload.json || {}).length,
        });

        return {
            ok: true,
            data: node,
            affected: [payload.nodeId],
            latMs: Date.now() - startTime,
        };
    }

    /**
     * Update a workspace node's json payload
     *
     * @param workspaceId - Workspace identifier
     * @param payload - Update payload
     * @returns Operation result
     */
    async updateNode(
        workspaceId: string,
        payload: UpdateNodePayload
    ): Promise<OpResult<WsNode>> {
        const startTime = Date.now();
        const now = Date.now();

        // If merge mode, first fetch existing node
        let json = payload.json;
        if (payload.merge) {
            const existing = await this.getNode(workspaceId, payload.nodeId);
            if (!existing.ok || !existing.data) {
                return {
                    ok: false,
                    error: `Node not found: ${payload.nodeId}`,
                    latMs: Date.now() - startTime,
                };
            }
            json = { ...existing.data.json, ...payload.json };
        }

        const compiled = this.compileUpdateNode(workspaceId, payload.nodeId, json, now);
        const result = await this.queryRunner.runWS<unknown[]>(
            compiled.script,
            compiled.params,
            { workspaceId, skipLog: true }
        );

        if (!result.ok) {
            return {
                ok: false,
                error: result.error,
                latMs: Date.now() - startTime,
            };
        }

        // Log episode
        this.logOp(workspaceId, 'update_node', payload.nodeId, {
            merge: payload.merge,
            json_size: JSON.stringify(json).length,
        });

        return {
            ok: true,
            data: {
                workspace_id: workspaceId,
                node_id: payload.nodeId,
                kind: 'draft', // Kind is preserved but we don't have it here
                json,
                created_at: now, // Approximation
                updated_at: now,
            },
            affected: [payload.nodeId],
            latMs: Date.now() - startTime,
        };
    }

    /**
     * Delete a workspace node
     *
     * @param workspaceId - Workspace identifier
     * @param nodeId - Node to delete
     * @returns Operation result
     */
    async deleteNode(
        workspaceId: string,
        nodeId: string
    ): Promise<OpResult<void>> {
        const startTime = Date.now();

        const compiled = this.compileDeleteNode(workspaceId, nodeId);
        const result = await this.queryRunner.runWS<unknown[]>(
            compiled.script,
            compiled.params,
            { workspaceId, skipLog: true }
        );

        if (!result.ok) {
            return {
                ok: false,
                error: result.error,
                latMs: Date.now() - startTime,
            };
        }

        // Log episode
        this.logOp(workspaceId, 'delete_node', nodeId, {});

        return {
            ok: true,
            affected: [nodeId],
            latMs: Date.now() - startTime,
        };
    }

    /**
     * Get a single workspace node
     *
     * @param workspaceId - Workspace identifier
     * @param nodeId - Node identifier
     * @returns Operation result with node
     */
    async getNode(
        workspaceId: string,
        nodeId: string
    ): Promise<OpResult<WsNode>> {
        const startTime = Date.now();

        const result = await this.queryRunner.runRO<unknown[]>(
            WS_QUERIES.getNode,
            { workspace_id: workspaceId, node_id: nodeId },
            { workspaceId, skipLog: true }
        );

        if (!result.ok) {
            return {
                ok: false,
                error: result.error,
                latMs: Date.now() - startTime,
            };
        }

        if (!result.rows || result.rows.length === 0) {
            return {
                ok: false,
                error: `Node not found: ${nodeId}`,
                latMs: Date.now() - startTime,
            };
        }

        const row = result.rows[0] as unknown[];
        const node: WsNode = {
            workspace_id: workspaceId,
            node_id: nodeId,
            kind: row[0] as WsNodeKind,
            json: row[1] as Record<string, unknown>,
            created_at: row[2] as number,
            updated_at: row[3] as number,
        };

        return {
            ok: true,
            data: node,
            latMs: Date.now() - startTime,
        };
    }

    /**
     * Get all nodes of a specific kind
     *
     * @param workspaceId - Workspace identifier
     * @param kind - Node kind to filter by
     * @returns Operation result with nodes
     */
    async getNodesByKind(
        workspaceId: string,
        kind: WsNodeKind
    ): Promise<OpResult<WsNode[]>> {
        const startTime = Date.now();

        const result = await this.queryRunner.runRO<unknown[]>(
            WS_QUERIES.getNodesByKind,
            { workspace_id: workspaceId, kind },
            { workspaceId, skipLog: true }
        );

        if (!result.ok) {
            return {
                ok: false,
                error: result.error,
                latMs: Date.now() - startTime,
            };
        }

        const nodes = (result.rows || []).map((row: unknown) => {
            const r = row as unknown[];
            return {
                workspace_id: workspaceId,
                node_id: r[0] as string,
                kind: r[1] as WsNodeKind,
                json: r[2] as Record<string, unknown>,
                created_at: r[3] as number,
                updated_at: r[4] as number,
            } as WsNode;
        });

        return {
            ok: true,
            data: nodes,
            latMs: Date.now() - startTime,
        };
    }

    // ========================================================================
    // Edge Operations
    // ========================================================================

    /**
     * Create an edge between two nodes
     *
     * @param workspaceId - Workspace identifier
     * @param payload - Edge creation payload
     * @returns Operation result
     */
    async link(
        workspaceId: string,
        payload: LinkPayload
    ): Promise<OpResult<WsEdge>> {
        const startTime = Date.now();
        const now = Date.now();

        const compiled = this.compileLink(workspaceId, payload, now);
        const result = await this.queryRunner.runWS<unknown[]>(
            compiled.script,
            compiled.params,
            { workspaceId, skipLog: true }
        );

        if (!result.ok) {
            return {
                ok: false,
                error: result.error,
                latMs: Date.now() - startTime,
            };
        }

        const edge: WsEdge = {
            workspace_id: workspaceId,
            from_id: payload.fromId,
            to_id: payload.toId,
            rel: payload.rel,
            meta: payload.meta || {},
            created_at: now,
        };

        // Log episode
        this.logOp(workspaceId, 'link', `${payload.fromId}->${payload.toId}`, {
            rel: payload.rel,
        });

        return {
            ok: true,
            data: edge,
            affected: [payload.fromId, payload.toId],
            latMs: Date.now() - startTime,
        };
    }

    /**
     * Delete an edge between two nodes
     *
     * @param workspaceId - Workspace identifier
     * @param fromId - Source node
     * @param toId - Target node
     * @param rel - Relationship type
     * @returns Operation result
     */
    async unlink(
        workspaceId: string,
        fromId: string,
        toId: string,
        rel: WsEdgeRel
    ): Promise<OpResult<void>> {
        const startTime = Date.now();

        const compiled = this.compileUnlink(workspaceId, fromId, toId, rel);
        const result = await this.queryRunner.runWS<unknown[]>(
            compiled.script,
            compiled.params,
            { workspaceId, skipLog: true }
        );

        if (!result.ok) {
            return {
                ok: false,
                error: result.error,
                latMs: Date.now() - startTime,
            };
        }

        // Log episode
        this.logOp(workspaceId, 'unlink', `${fromId}->${toId}`, { rel });

        return {
            ok: true,
            affected: [fromId, toId],
            latMs: Date.now() - startTime,
        };
    }

    /**
     * Get all edges from a node
     *
     * @param workspaceId - Workspace identifier
     * @param fromId - Source node
     * @returns Operation result with edges
     */
    async getEdgesFrom(
        workspaceId: string,
        fromId: string
    ): Promise<OpResult<WsEdge[]>> {
        const startTime = Date.now();

        const result = await this.queryRunner.runRO<unknown[]>(
            WS_QUERIES.getEdgesFrom,
            { workspace_id: workspaceId, from_id: fromId },
            { workspaceId, skipLog: true }
        );

        if (!result.ok) {
            return {
                ok: false,
                error: result.error,
                latMs: Date.now() - startTime,
            };
        }

        const edges = (result.rows || []).map((row: unknown) => {
            const r = row as unknown[];
            return {
                workspace_id: workspaceId,
                from_id: fromId,
                to_id: r[0] as string,
                rel: r[1] as WsEdgeRel,
                meta: r[2] as Record<string, unknown>,
                created_at: r[3] as number,
            } as WsEdge;
        });

        return {
            ok: true,
            data: edges,
            latMs: Date.now() - startTime,
        };
    }

    /**
     * Get all edges to a node
     *
     * @param workspaceId - Workspace identifier
     * @param toId - Target node
     * @returns Operation result with edges
     */
    async getEdgesTo(
        workspaceId: string,
        toId: string
    ): Promise<OpResult<WsEdge[]>> {
        const startTime = Date.now();

        const result = await this.queryRunner.runRO<unknown[]>(
            WS_QUERIES.getEdgesTo,
            { workspace_id: workspaceId, to_id: toId },
            { workspaceId, skipLog: true }
        );

        if (!result.ok) {
            return {
                ok: false,
                error: result.error,
                latMs: Date.now() - startTime,
            };
        }

        const edges = (result.rows || []).map((row: unknown) => {
            const r = row as unknown[];
            return {
                workspace_id: workspaceId,
                from_id: r[0] as string,
                to_id: toId,
                rel: r[1] as WsEdgeRel,
                meta: r[2] as Record<string, unknown>,
                created_at: r[3] as number,
            } as WsEdge;
        });

        return {
            ok: true,
            data: edges,
            latMs: Date.now() - startTime,
        };
    }

    // ========================================================================
    // View Operations
    // ========================================================================

    /**
     * Store a materialized view
     *
     * @param workspaceId - Workspace identifier
     * @param payload - View snapshot payload
     * @returns Operation result
     */
    async snapshotView(
        workspaceId: string,
        payload: SnapshotViewPayload
    ): Promise<OpResult<WsViewCache>> {
        const startTime = Date.now();
        const now = Date.now();

        const compiled = this.compileSnapshotView(workspaceId, payload, now);
        const result = await this.queryRunner.runWS<unknown[]>(
            compiled.script,
            compiled.params,
            { workspaceId, skipLog: true }
        );

        if (!result.ok) {
            return {
                ok: false,
                error: result.error,
                latMs: Date.now() - startTime,
            };
        }

        const view: WsViewCache = {
            workspace_id: workspaceId,
            view_id: payload.viewId,
            json: payload.json,
            created_at: now,
            updated_at: now,
        };

        // Log episode
        this.logOp(workspaceId, 'snapshot_view', payload.viewId, {
            json_size: JSON.stringify(payload.json).length,
        });

        return {
            ok: true,
            data: view,
            affected: [payload.viewId],
            latMs: Date.now() - startTime,
        };
    }

    /**
     * Get a cached view
     *
     * @param workspaceId - Workspace identifier
     * @param viewId - View identifier
     * @returns Operation result with view
     */
    async getView(
        workspaceId: string,
        viewId: string
    ): Promise<OpResult<WsViewCache>> {
        const startTime = Date.now();

        const result = await this.queryRunner.runRO<unknown[]>(
            WS_QUERIES.getView,
            { workspace_id: workspaceId, view_id: viewId },
            { workspaceId, skipLog: true }
        );

        if (!result.ok) {
            return {
                ok: false,
                error: result.error,
                latMs: Date.now() - startTime,
            };
        }

        if (!result.rows || result.rows.length === 0) {
            return {
                ok: false,
                error: `View not found: ${viewId}`,
                latMs: Date.now() - startTime,
            };
        }

        const row = result.rows[0] as unknown[];
        const view: WsViewCache = {
            workspace_id: workspaceId,
            view_id: viewId,
            json: row[1] as Record<string, unknown>,
            created_at: row[2] as number,
            updated_at: row[3] as number,
        };

        return {
            ok: true,
            data: view,
            latMs: Date.now() - startTime,
        };
    }

    // ========================================================================
    // Composite Operations
    // ========================================================================

    /**
     * Store a query as a workspace node
     *
     * @param workspaceId - Workspace identifier
     * @param payload - Query storage payload
     * @returns Operation result with query node
     */
    async storeQuery(
        workspaceId: string,
        payload: StoreQueryPayload
    ): Promise<OpResult<WsNode>> {
        const startTime = Date.now();
        const queryId = payload.queryId || this.generateId('query');

        const result = await this.createNode(workspaceId, {
            nodeId: queryId,
            kind: 'query',
            json: {
                script: payload.script,
                bindings: payload.bindings || {},
                intent: payload.intent || 'model-initiated',
                costBudget: payload.costBudget || 1000,
            },
        });

        if (!result.ok) {
            return {
                ok: false,
                error: result.error,
                latMs: Date.now() - startTime,
            };
        }

        // Log episode
        this.logOp(workspaceId, 'store_query', queryId, {
            script_length: payload.script.length,
            intent: payload.intent,
        });

        return {
            ok: true,
            data: result.data,
            affected: [queryId],
            latMs: Date.now() - startTime,
        };
    }

    /**
     * Store a result node and link it to a query
     *
     * @param workspaceId - Workspace identifier
     * @param payload - Result storage payload
     * @returns Operation result with result node
     */
    async storeResult(
        workspaceId: string,
        payload: StoreResultPayload
    ): Promise<OpResult<WsNode>> {
        const startTime = Date.now();
        const resultId = payload.resultId || this.generateId('result');

        // Create result node
        const nodeResult = await this.createNode(workspaceId, {
            nodeId: resultId,
            kind: 'result',
            json: {
                rows: payload.rows,
                headers: payload.headers || [],
                truncated: payload.truncated || false,
                provenance: payload.provenance || [],
                queryId: payload.queryId,
            },
        });

        if (!nodeResult.ok) {
            return {
                ok: false,
                error: nodeResult.error,
                latMs: Date.now() - startTime,
            };
        }

        // Link result to query
        await this.link(workspaceId, {
            fromId: payload.queryId,
            toId: resultId,
            rel: 'produced',
            meta: { row_count: payload.rows.length },
        });

        // Log episode
        this.logOp(workspaceId, 'store_result', resultId, {
            query_id: payload.queryId,
            row_count: payload.rows.length,
            truncated: payload.truncated,
        });

        return {
            ok: true,
            data: nodeResult.data,
            affected: [resultId, payload.queryId],
            latMs: Date.now() - startTime,
        };
    }

    /**
     * Spawn a recursive task
     *
     * @param workspaceId - Workspace identifier
     * @param payload - Task spawn payload
     * @returns Operation result with task node
     */
    async spawnTask(
        workspaceId: string,
        payload: SpawnTaskPayload
    ): Promise<OpResult<WsNode>> {
        const startTime = Date.now();
        const taskId = payload.taskId || this.generateId('task');

        // Create task node
        const nodeResult = await this.createNode(workspaceId, {
            nodeId: taskId,
            kind: 'task',
            json: {
                plan: payload.plan,
                context: payload.context || {},
                status: 'pending',
                parentId: payload.parentId,
                createdAt: Date.now(),
            },
        });

        if (!nodeResult.ok) {
            return {
                ok: false,
                error: nodeResult.error,
                latMs: Date.now() - startTime,
            };
        }

        // Link to parent if provided
        if (payload.parentId) {
            await this.link(workspaceId, {
                fromId: payload.parentId,
                toId: taskId,
                rel: 'spawned',
                meta: { plan: payload.plan },
            });
        }

        // Log episode
        this.logOp(workspaceId, 'spawn_task', taskId, {
            parent_id: payload.parentId,
            plan_length: payload.plan.length,
        });

        return {
            ok: true,
            data: nodeResult.data,
            affected: [taskId, payload.parentId].filter(Boolean) as string[],
            latMs: Date.now() - startTime,
        };
    }

    // ========================================================================
    // Session Operations
    // ========================================================================

    /**
     * Create a new workspace session
     *
     * @param workspaceId - Workspace identifier
     * @param worldId - World/context identifier
     * @param meta - Optional metadata
     * @returns Operation result
     */
    async createSession(
        workspaceId: string,
        worldId: string,
        meta: Record<string, unknown> = {}
    ): Promise<OpResult<void>> {
        const startTime = Date.now();
        const now = Date.now();

        const result = await this.queryRunner.runWS<unknown[]>(
            WS_QUERIES.createSession,
            {
                workspace_id: workspaceId,
                world_id: worldId,
                created_at: now,
                meta,
            },
            { workspaceId, skipLog: true }
        );

        if (!result.ok) {
            return {
                ok: false,
                error: result.error,
                latMs: Date.now() - startTime,
            };
        }

        this.initializedWorkspaces.add(workspaceId);

        return {
            ok: true,
            latMs: Date.now() - startTime,
        };
    }

    /**
     * Delete all workspace data
     *
     * @param workspaceId - Workspace identifier
     * @returns Operation result
     */
    async deleteWorkspace(workspaceId: string): Promise<OpResult<void>> {
        const startTime = Date.now();

        const result = await this.queryRunner.runWS<unknown[]>(
            WS_QUERIES.deleteWorkspaceData,
            { workspace_id: workspaceId },
            { workspaceId, skipLog: true }
        );

        if (!result.ok) {
            return {
                ok: false,
                error: result.error,
                latMs: Date.now() - startTime,
            };
        }

        this.initializedWorkspaces.delete(workspaceId);

        return {
            ok: true,
            latMs: Date.now() - startTime,
        };
    }

    /**
     * Get workspace statistics
     *
     * @param workspaceId - Workspace identifier
     * @returns Operation result with stats
     */
    async getStats(
        workspaceId: string
    ): Promise<OpResult<{ nodes: number; edges: number; views: number }>> {
        const startTime = Date.now();

        const result = await this.queryRunner.runRO<unknown[]>(
            WS_QUERIES.getWorkspaceStats,
            { workspace_id: workspaceId },
            { workspaceId, skipLog: true }
        );

        if (!result.ok) {
            return {
                ok: false,
                error: result.error,
                latMs: Date.now() - startTime,
            };
        }

        const row = result.rows?.[0] as unknown[] | undefined;
        const stats = {
            nodes: (row?.[0] as number) || 0,
            edges: (row?.[1] as number) || 0,
            views: (row?.[2] as number) || 0,
        };

        return {
            ok: true,
            data: stats,
            latMs: Date.now() - startTime,
        };
    }

    // ========================================================================
    // Operation Compilers
    // ========================================================================

    private compileCreateNode(
        workspaceId: string,
        payload: CreateNodePayload,
        now: number
    ): CompiledOp {
        return {
            script: WS_QUERIES.createNode,
            params: {
                workspace_id: workspaceId,
                node_id: payload.nodeId,
                kind: payload.kind,
                json: payload.json || {},
                created_at: now,
                updated_at: now,
            },
            affected: [payload.nodeId],
        };
    }

    private compileUpdateNode(
        workspaceId: string,
        nodeId: string,
        json: Record<string, unknown>,
        now: number
    ): CompiledOp {
        // First get the existing node to preserve kind and created_at
        return {
            script: `
                # Get existing node
                ?[kind, created_at] := *ws_node{workspace_id, node_id, kind, created_at},
                    workspace_id == $workspace_id, node_id == $node_id
                
                # Update with new json
                ?[workspace_id, node_id, kind, json, created_at, updated_at] <- [[
                    $workspace_id, $node_id, kind, $json, created_at, $updated_at
                ]]
                :put ws_node {workspace_id, node_id}
            `,
            params: {
                workspace_id: workspaceId,
                node_id: nodeId,
                json,
                updated_at: now,
            },
            affected: [nodeId],
        };
    }

    private compileDeleteNode(
        workspaceId: string,
        nodeId: string
    ): CompiledOp {
        return {
            script: WS_QUERIES.deleteNode,
            params: {
                workspace_id: workspaceId,
                node_id: nodeId,
            },
            affected: [nodeId],
        };
    }

    private compileLink(
        workspaceId: string,
        payload: LinkPayload,
        now: number
    ): CompiledOp {
        return {
            script: WS_QUERIES.createEdge,
            params: {
                workspace_id: workspaceId,
                from_id: payload.fromId,
                to_id: payload.toId,
                rel: payload.rel,
                meta: payload.meta || {},
                created_at: now,
            },
            affected: [payload.fromId, payload.toId],
        };
    }

    private compileUnlink(
        workspaceId: string,
        fromId: string,
        toId: string,
        rel: WsEdgeRel
    ): CompiledOp {
        return {
            script: WS_QUERIES.deleteEdge,
            params: {
                workspace_id: workspaceId,
                from_id: fromId,
                to_id: toId,
                rel,
            },
            affected: [fromId, toId],
        };
    }

    private compileSnapshotView(
        workspaceId: string,
        payload: SnapshotViewPayload,
        now: number
    ): CompiledOp {
        return {
            script: WS_QUERIES.createView,
            params: {
                workspace_id: workspaceId,
                view_id: payload.viewId,
                json: payload.json,
                created_at: now,
                updated_at: now,
            },
            affected: [payload.viewId],
        };
    }

    // ========================================================================
    // Utilities
    // ========================================================================

    private generateId(prefix: string): string {
        const timestamp = Date.now().toString(36);
        const random = Math.random().toString(36).slice(2, 8);
        return `${prefix}_${timestamp}_${random}`;
    }

    private logOp(
        workspaceId: string,
        op: WorkspaceOpType,
        targetId: string,
        metadata: Record<string, unknown>
    ): void {
        try {
            recordAction(
                workspaceId,
                '',
                `rlm_${op}`,
                targetId,
                'workspace_node',
                { metadata },
                ''
            );
        } catch (err) {
            console.warn(`[WorkspaceOps] Failed to log ${op}:`, err);
        }
    }
}

// ============================================================================
// Standalone Functions (for non-DI usage)
// ============================================================================

/**
 * Create a workspace node without DI
 */
export async function createNode(
    workspaceId: string,
    payload: CreateNodePayload
): Promise<OpResult<WsNode>> {
    const service = new WorkspaceOpsService(new QueryRunnerService());
    return service.createNode(workspaceId, payload);
}

/**
 * Create an edge without DI
 */
export async function link(
    workspaceId: string,
    payload: LinkPayload
): Promise<OpResult<WsEdge>> {
    const service = new WorkspaceOpsService(new QueryRunnerService());
    return service.link(workspaceId, payload);
}

/**
 * Store a query without DI
 */
export async function storeQuery(
    workspaceId: string,
    payload: StoreQueryPayload
): Promise<OpResult<WsNode>> {
    const service = new WorkspaceOpsService(new QueryRunnerService());
    return service.storeQuery(workspaceId, payload);
}
