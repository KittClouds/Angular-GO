/**
 * Tests for WorkspaceOpsService
 *
 * Tests the 10 canonical operations for RLM workspace manipulation.
 * Uses vitest with mocked CozoDB and QueryRunnerService.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { TestBed } from '@angular/core/testing';
import { WorkspaceOpsService } from './workspace-ops.service';
import { QueryRunnerService, type QueryResult } from './query-runner.service';

// ============================================================================
// Mocks - Must be before imports that use them
// ============================================================================

// Mock the cozo db module
vi.mock('../../cozo/db', () => ({
    cozoDb: {
        isReady: () => true,
        run: vi.fn(() => JSON.stringify({ ok: true, rows: [], headers: [] })),
    },
}));

// Mock recordAction
vi.mock('../../cozo/memory/EpisodeLogService', () => ({
    recordAction: vi.fn(),
}));

// ============================================================================
// Mock QueryRunnerService
// ============================================================================

interface CallLogEntry {
    script: string;
    params: Record<string, unknown>;
    lane: 'ro' | 'ws';
}

class MockQueryRunnerService {
    private mockResults = new Map<string, QueryResult>();
    private callLog: CallLogEntry[] = [];

    setMockResult(pattern: string, result: QueryResult): void {
        this.mockResults.set(pattern, result);
    }

    getCallLog(): CallLogEntry[] {
        return [...this.callLog];
    }

    clearCallLog(): void {
        this.callLog = [];
    }

    async runRO<T = unknown>(
        script: string,
        params: Record<string, unknown> = {},
        _options?: { workspaceId?: string; skipLog?: boolean }
    ): Promise<QueryResult<T>> {
        this.callLog.push({ script, params, lane: 'ro' });

        if (script.includes('*ws_node') && params.node_id) {
            const mockResult = this.mockResults.get('getNode');
            if (mockResult) return mockResult as QueryResult<T>;
        }
        if (script.includes('*ws_node') && params.kind) {
            const mockResult = this.mockResults.get('getNodesByKind');
            if (mockResult) return mockResult as QueryResult<T>;
        }
        if (script.includes('*ws_edge') && params.from_id) {
            const mockResult = this.mockResults.get('getEdgesFrom');
            if (mockResult) return mockResult as QueryResult<T>;
        }
        if (script.includes('*ws_edge') && params.to_id) {
            const mockResult = this.mockResults.get('getEdgesTo');
            if (mockResult) return mockResult as QueryResult<T>;
        }
        if (script.includes('*ws_view_cache')) {
            const mockResult = this.mockResults.get('getView');
            if (mockResult) return mockResult as QueryResult<T>;
        }
        if (script.includes('count(*ws_node')) {
            const mockResult = this.mockResults.get('getStats');
            if (mockResult) return mockResult as QueryResult<T>;
        }

        return { ok: true, rows: [], headers: [] };
    }

    async runWS<T = unknown>(
        script: string,
        params: Record<string, unknown> = {},
        _options?: { workspaceId?: string; skipLog?: boolean }
    ): Promise<QueryResult<T>> {
        this.callLog.push({ script, params, lane: 'ws' });

        if (script.includes(':put ws_node')) {
            const mockResult = this.mockResults.get('createNode');
            if (mockResult) return mockResult as QueryResult<T>;
        }
        if (script.includes(':rm ws_node')) {
            const mockResult = this.mockResults.get('deleteNode');
            if (mockResult) return mockResult as QueryResult<T>;
        }
        if (script.includes(':put ws_edge')) {
            const mockResult = this.mockResults.get('createEdge');
            if (mockResult) return mockResult as QueryResult<T>;
        }
        if (script.includes(':rm ws_edge')) {
            const mockResult = this.mockResults.get('deleteEdge');
            if (mockResult) return mockResult as QueryResult<T>;
        }
        if (script.includes(':put ws_view_cache')) {
            const mockResult = this.mockResults.get('createView');
            if (mockResult) return mockResult as QueryResult<T>;
        }
        if (script.includes(':put ws_session')) {
            const mockResult = this.mockResults.get('createSession');
            if (mockResult) return mockResult as QueryResult<T>;
        }

        return { ok: true, rows: [], headers: [] };
    }

    async runAuto<T = unknown>(
        script: string,
        params: Record<string, unknown> = {},
        options?: { workspaceId?: string; skipLog?: boolean }
    ): Promise<QueryResult<T>> {
        if (/:put|:rm|:update|:create/i.test(script)) {
            return this.runWS<T>(script, params, options);
        }
        return this.runRO<T>(script, params, options);
    }
}

// ============================================================================
// Test Suite
// ============================================================================

describe('WorkspaceOpsService', () => {
    let service: WorkspaceOpsService;
    let mockQueryRunner: MockQueryRunnerService;

    beforeEach(() => {
        mockQueryRunner = new MockQueryRunnerService();

        TestBed.configureTestingModule({
            providers: [
                WorkspaceOpsService,
                { provide: QueryRunnerService, useValue: mockQueryRunner },
            ],
        });

        service = TestBed.inject(WorkspaceOpsService);
    });

    // ========================================================================
    // Node Operations
    // ========================================================================

    describe('createNode', () => {
        it('should create a workspace node with required fields', async () => {
            mockQueryRunner.setMockResult('createNode', { ok: true, rows: [], headers: [] });

            const result = await service.createNode('ws-test', {
                nodeId: 'node-1',
                kind: 'claim',
                json: { text: 'John knows Mary', confidence: 0.85 },
            });

            expect(result.ok).toBe(true);
            expect(result.data).toBeDefined();
            expect(result.data?.workspace_id).toBe('ws-test');
            expect(result.data?.node_id).toBe('node-1');
            expect(result.data?.kind).toBe('claim');
            expect(result.data?.json).toEqual({ text: 'John knows Mary', confidence: 0.85 });
            expect(result.affected).toContain('node-1');
        });

        it('should create a node with empty json if not provided', async () => {
            mockQueryRunner.setMockResult('createNode', { ok: true, rows: [], headers: [] });

            const result = await service.createNode('ws-test', {
                nodeId: 'node-2',
                kind: 'draft',
            });

            expect(result.ok).toBe(true);
            expect(result.data?.json).toEqual({});
        });

        it('should return error if query fails', async () => {
            mockQueryRunner.setMockResult('createNode', {
                ok: false,
                error: 'Relation ws_node not found',
            });

            const result = await service.createNode('ws-test', {
                nodeId: 'node-3',
                kind: 'query',
            });

            expect(result.ok).toBe(false);
            expect(result.error).toContain('Relation ws_node not found');
        });

        it('should use WS lane for mutations', async () => {
            mockQueryRunner.setMockResult('createNode', { ok: true, rows: [], headers: [] });

            await service.createNode('ws-test', {
                nodeId: 'node-4',
                kind: 'claim',
            });

            const callLog = mockQueryRunner.getCallLog();
            expect(callLog.length).toBeGreaterThan(0);
            expect(callLog[0].lane).toBe('ws');
            expect(callLog[0].script).toContain(':put ws_node');
        });
    });

    describe('updateNode', () => {
        it('should update node json payload', async () => {
            mockQueryRunner.setMockResult('getNode', {
                ok: true,
                rows: [['claim', { text: 'Original' }, 1000, 1000]],
                headers: ['kind', 'json', 'created_at', 'updated_at'],
            });
            mockQueryRunner.setMockResult('createNode', { ok: true, rows: [], headers: [] });

            const result = await service.updateNode('ws-test', {
                nodeId: 'node-1',
                json: { text: 'Updated', confidence: 0.9 },
            });

            expect(result.ok).toBe(true);
        });

        it('should return error if node not found for merge', async () => {
            mockQueryRunner.setMockResult('getNode', { ok: true, rows: [], headers: [] });

            const result = await service.updateNode('ws-test', {
                nodeId: 'nonexistent',
                json: { text: 'Updated' },
                merge: true,
            });

            expect(result.ok).toBe(false);
            expect(result.error).toContain('Node not found');
        });
    });

    describe('deleteNode', () => {
        it('should delete a workspace node', async () => {
            mockQueryRunner.setMockResult('deleteNode', { ok: true, rows: [], headers: [] });

            const result = await service.deleteNode('ws-test', 'node-1');

            expect(result.ok).toBe(true);
            expect(result.affected).toContain('node-1');
        });

        it('should return error if deletion fails', async () => {
            mockQueryRunner.setMockResult('deleteNode', {
                ok: false,
                error: 'Node not found',
            });

            const result = await service.deleteNode('ws-test', 'nonexistent');

            expect(result.ok).toBe(false);
            expect(result.error).toContain('Node not found');
        });
    });

    describe('getNode', () => {
        it('should retrieve a workspace node by id', async () => {
            mockQueryRunner.setMockResult('getNode', {
                ok: true,
                rows: [['claim', { text: 'Test claim' }, 1000, 2000]],
                headers: ['kind', 'json', 'created_at', 'updated_at'],
            });

            const result = await service.getNode('ws-test', 'node-1');

            expect(result.ok).toBe(true);
            expect(result.data?.node_id).toBe('node-1');
            expect(result.data?.kind).toBe('claim');
            expect(result.data?.json).toEqual({ text: 'Test claim' });
        });

        it('should return error if node not found', async () => {
            mockQueryRunner.setMockResult('getNode', { ok: true, rows: [], headers: [] });

            const result = await service.getNode('ws-test', 'nonexistent');

            expect(result.ok).toBe(false);
            expect(result.error).toContain('Node not found');
        });

        it('should use RO lane for reads', async () => {
            mockQueryRunner.setMockResult('getNode', {
                ok: true,
                rows: [['claim', {}, 1000, 2000]],
                headers: ['kind', 'json', 'created_at', 'updated_at'],
            });

            await service.getNode('ws-test', 'node-1');

            const callLog = mockQueryRunner.getCallLog();
            expect(callLog[0].lane).toBe('ro');
        });
    });

    describe('getNodesByKind', () => {
        it('should retrieve all nodes of a specific kind', async () => {
            mockQueryRunner.setMockResult('getNodesByKind', {
                ok: true,
                rows: [
                    ['claim-1', 'claim', { text: 'Claim 1' }, 1000, 1000],
                    ['claim-2', 'claim', { text: 'Claim 2' }, 2000, 2000],
                ],
                headers: ['node_id', 'kind', 'json', 'created_at', 'updated_at'],
            });

            const result = await service.getNodesByKind('ws-test', 'claim');

            expect(result.ok).toBe(true);
            expect(result.data?.length).toBe(2);
            expect(result.data?.[0].node_id).toBe('claim-1');
            expect(result.data?.[1].node_id).toBe('claim-2');
        });
    });

    // ========================================================================
    // Edge Operations
    // ========================================================================

    describe('link', () => {
        it('should create an edge between two nodes', async () => {
            mockQueryRunner.setMockResult('createEdge', { ok: true, rows: [], headers: [] });

            const result = await service.link('ws-test', {
                fromId: 'query-1',
                toId: 'result-1',
                rel: 'produced',
                meta: { row_count: 10 },
            });

            expect(result.ok).toBe(true);
            expect(result.data?.from_id).toBe('query-1');
            expect(result.data?.to_id).toBe('result-1');
            expect(result.data?.rel).toBe('produced');
            expect(result.affected).toContain('query-1');
            expect(result.affected).toContain('result-1');
        });

        it('should create edge with empty meta if not provided', async () => {
            mockQueryRunner.setMockResult('createEdge', { ok: true, rows: [], headers: [] });

            const result = await service.link('ws-test', {
                fromId: 'claim-1',
                toId: 'claim-2',
                rel: 'contradicts',
            });

            expect(result.ok).toBe(true);
            expect(result.data?.meta).toEqual({});
        });

        it('should use WS lane for edge creation', async () => {
            mockQueryRunner.setMockResult('createEdge', { ok: true, rows: [], headers: [] });

            await service.link('ws-test', {
                fromId: 'node-1',
                toId: 'node-2',
                rel: 'supports',
            });

            const callLog = mockQueryRunner.getCallLog();
            expect(callLog[0].lane).toBe('ws');
            expect(callLog[0].script).toContain(':put ws_edge');
        });
    });

    describe('unlink', () => {
        it('should delete an edge between nodes', async () => {
            mockQueryRunner.setMockResult('deleteEdge', { ok: true, rows: [], headers: [] });

            const result = await service.unlink('ws-test', 'node-1', 'node-2', 'supports');

            expect(result.ok).toBe(true);
            expect(result.affected).toContain('node-1');
            expect(result.affected).toContain('node-2');
        });
    });

    describe('getEdgesFrom', () => {
        it('should retrieve all outgoing edges from a node', async () => {
            mockQueryRunner.setMockResult('getEdgesFrom', {
                ok: true,
                rows: [
                    ['result-1', 'produced', { row_count: 10 }, 1000],
                    ['result-2', 'produced', { row_count: 5 }, 2000],
                ],
                headers: ['to_id', 'rel', 'meta', 'created_at'],
            });

            const result = await service.getEdgesFrom('ws-test', 'query-1');

            expect(result.ok).toBe(true);
            expect(result.data?.length).toBe(2);
            expect(result.data?.[0].to_id).toBe('result-1');
            expect(result.data?.[0].rel).toBe('produced');
        });

        it('should use RO lane for edge retrieval', async () => {
            mockQueryRunner.setMockResult('getEdgesFrom', { ok: true, rows: [], headers: [] });

            await service.getEdgesFrom('ws-test', 'node-1');

            const callLog = mockQueryRunner.getCallLog();
            expect(callLog[0].lane).toBe('ro');
        });
    });

    describe('getEdgesTo', () => {
        it('should retrieve all incoming edges to a node', async () => {
            mockQueryRunner.setMockResult('getEdgesTo', {
                ok: true,
                rows: [['query-1', 'produced', { row_count: 10 }, 1000]],
                headers: ['from_id', 'rel', 'meta', 'created_at'],
            });

            const result = await service.getEdgesTo('ws-test', 'result-1');

            expect(result.ok).toBe(true);
            expect(result.data?.length).toBe(1);
            expect(result.data?.[0].from_id).toBe('query-1');
            expect(result.data?.[0].rel).toBe('produced');
        });
    });

    // ========================================================================
    // View Operations
    // ========================================================================

    describe('snapshotView', () => {
        it('should store a materialized view', async () => {
            mockQueryRunner.setMockResult('createView', { ok: true, rows: [], headers: [] });

            const result = await service.snapshotView('ws-test', {
                viewId: 'view-1',
                json: { entities: ['John', 'Mary'], count: 2 },
            });

            expect(result.ok).toBe(true);
            expect(result.data?.view_id).toBe('view-1');
            expect(result.data?.json).toEqual({ entities: ['John', 'Mary'], count: 2 });
            expect(result.affected).toContain('view-1');
        });

        it('should use WS lane for view creation', async () => {
            mockQueryRunner.setMockResult('createView', { ok: true, rows: [], headers: [] });

            await service.snapshotView('ws-test', {
                viewId: 'view-1',
                json: { data: 'test' },
            });

            const callLog = mockQueryRunner.getCallLog();
            expect(callLog[0].lane).toBe('ws');
            expect(callLog[0].script).toContain(':put ws_view_cache');
        });
    });

    describe('getView', () => {
        it('should retrieve a cached view', async () => {
            mockQueryRunner.setMockResult('getView', {
                ok: true,
                rows: [['view-1', { data: 'cached' }, 1000, 2000]],
                headers: ['view_id', 'json', 'created_at', 'updated_at'],
            });

            const result = await service.getView('ws-test', 'view-1');

            expect(result.ok).toBe(true);
            expect(result.data?.view_id).toBe('view-1');
            expect(result.data?.json).toEqual({ data: 'cached' });
        });

        it('should return error if view not found', async () => {
            mockQueryRunner.setMockResult('getView', { ok: true, rows: [], headers: [] });

            const result = await service.getView('ws-test', 'nonexistent');

            expect(result.ok).toBe(false);
            expect(result.error).toContain('View not found');
        });
    });

    // ========================================================================
    // Composite Operations
    // ========================================================================

    describe('storeQuery', () => {
        it('should store a query node with script and bindings', async () => {
            mockQueryRunner.setMockResult('createNode', { ok: true, rows: [], headers: [] });

            const result = await service.storeQuery('ws-test', {
                script: '?[id, label] := *entities{id, label} :limit 10',
                bindings: { kind: 'person' },
                intent: 'entity-discovery',
                costBudget: 500,
            });

            expect(result.ok).toBe(true);
            expect(result.data?.kind).toBe('query');
            expect(result.data?.json.script).toBe('?[id, label] := *entities{id, label} :limit 10');
            expect(result.data?.json.bindings).toEqual({ kind: 'person' });
            expect(result.data?.json.intent).toBe('entity-discovery');
            expect(result.data?.json.costBudget).toBe(500);
        });

        it('should auto-generate query id if not provided', async () => {
            mockQueryRunner.setMockResult('createNode', { ok: true, rows: [], headers: [] });

            const result = await service.storeQuery('ws-test', {
                script: '?[id] := *entities{id}',
            });

            expect(result.ok).toBe(true);
            expect(result.data?.node_id).toMatch(/^query_/);
        });

        it('should use provided query id', async () => {
            mockQueryRunner.setMockResult('createNode', { ok: true, rows: [], headers: [] });

            const result = await service.storeQuery('ws-test', {
                queryId: 'custom-query-1',
                script: '?[id] := *entities{id}',
            });

            expect(result.ok).toBe(true);
            expect(result.data?.node_id).toBe('custom-query-1');
        });
    });

    describe('storeResult', () => {
        it('should store result node and link to query', async () => {
            mockQueryRunner.setMockResult('createNode', { ok: true, rows: [], headers: [] });
            mockQueryRunner.setMockResult('createEdge', { ok: true, rows: [], headers: [] });

            const result = await service.storeResult('ws-test', {
                queryId: 'query-1',
                rows: [[1, 'John'], [2, 'Mary']],
                headers: ['id', 'name'],
                truncated: false,
                provenance: ['entities'],
            });

            expect(result.ok).toBe(true);
            expect(result.data?.kind).toBe('result');
            expect(result.data?.json.rows).toEqual([[1, 'John'], [2, 'Mary']]);
            expect(result.data?.json.queryId).toBe('query-1');
        });

        it('should create produced edge from query to result', async () => {
            mockQueryRunner.setMockResult('createNode', { ok: true, rows: [], headers: [] });
            mockQueryRunner.setMockResult('createEdge', { ok: true, rows: [], headers: [] });

            await service.storeResult('ws-test', {
                queryId: 'query-1',
                rows: [[1, 'John']],
            });

            const callLog = mockQueryRunner.getCallLog();
            const wsCalls = callLog.filter((c) => c.lane === 'ws');
            expect(wsCalls.length).toBe(2);

            const edgeCall = wsCalls[1];
            expect(edgeCall.script).toContain(':put ws_edge');
            expect(edgeCall.params.from_id).toBe('query-1');
            expect(edgeCall.params.rel).toBe('produced');
        });

        it('should auto-generate result id if not provided', async () => {
            mockQueryRunner.setMockResult('createNode', { ok: true, rows: [], headers: [] });
            mockQueryRunner.setMockResult('createEdge', { ok: true, rows: [], headers: [] });

            const result = await service.storeResult('ws-test', {
                queryId: 'query-1',
                rows: [],
            });

            expect(result.ok).toBe(true);
            expect(result.data?.node_id).toMatch(/^result_/);
        });
    });

    describe('spawnTask', () => {
        it('should create a task node with plan', async () => {
            mockQueryRunner.setMockResult('createNode', { ok: true, rows: [], headers: [] });

            const result = await service.spawnTask('ws-test', {
                plan: '1. Find entities\n2. Extract claims\n3. Build graph',
                context: { focus: 'relationships' },
            });

            expect(result.ok).toBe(true);
            expect(result.data?.kind).toBe('task');
            expect(result.data?.json.plan).toBe('1. Find entities\n2. Extract claims\n3. Build graph');
            expect(result.data?.json.context).toEqual({ focus: 'relationships' });
            expect(result.data?.json.status).toBe('pending');
        });

        it('should link to parent task if provided', async () => {
            mockQueryRunner.setMockResult('createNode', { ok: true, rows: [], headers: [] });
            mockQueryRunner.setMockResult('createEdge', { ok: true, rows: [], headers: [] });

            const result = await service.spawnTask('ws-test', {
                parentId: 'task-parent',
                plan: 'Subtask: analyze entity',
            });

            expect(result.ok).toBe(true);
            expect(result.affected).toContain('task-parent');

            const callLog = mockQueryRunner.getCallLog();
            const edgeCall = callLog.find((c) => c.script.includes(':put ws_edge'));
            expect(edgeCall).toBeDefined();
            expect(edgeCall?.params.from_id).toBe('task-parent');
            expect(edgeCall?.params.rel).toBe('spawned');
        });

        it('should auto-generate task id if not provided', async () => {
            mockQueryRunner.setMockResult('createNode', { ok: true, rows: [], headers: [] });

            const result = await service.spawnTask('ws-test', {
                plan: 'Simple task',
            });

            expect(result.ok).toBe(true);
            expect(result.data?.node_id).toMatch(/^task_/);
        });
    });

    // ========================================================================
    // Session Operations
    // ========================================================================

    describe('createSession', () => {
        it('should create a workspace session', async () => {
            mockQueryRunner.setMockResult('createSession', { ok: true, rows: [], headers: [] });

            const result = await service.createSession('ws-test', 'world-1', { model: 'gpt-4' });

            expect(result.ok).toBe(true);
        });

        it('should use WS lane for session creation', async () => {
            mockQueryRunner.setMockResult('createSession', { ok: true, rows: [], headers: [] });

            await service.createSession('ws-test', 'world-1');

            const callLog = mockQueryRunner.getCallLog();
            expect(callLog[0].lane).toBe('ws');
            expect(callLog[0].script).toContain(':put ws_session');
        });
    });

    describe('deleteWorkspace', () => {
        it('should delete all workspace data', async () => {
            mockQueryRunner.setMockResult('createSession', { ok: true, rows: [], headers: [] });

            const result = await service.deleteWorkspace('ws-test');

            expect(result.ok).toBe(true);
        });
    });

    describe('getStats', () => {
        it('should return workspace statistics', async () => {
            mockQueryRunner.setMockResult('getStats', {
                ok: true,
                rows: [[10, 25, 3]],
                headers: ['nodes', 'edges', 'views'],
            });

            const result = await service.getStats('ws-test');

            expect(result.ok).toBe(true);
            expect(result.data?.nodes).toBe(10);
            expect(result.data?.edges).toBe(25);
            expect(result.data?.views).toBe(3);
        });

        it('should return zeros if no data', async () => {
            mockQueryRunner.setMockResult('getStats', {
                ok: true,
                rows: [[0, 0, 0]],
                headers: ['nodes', 'edges', 'views'],
            });

            const result = await service.getStats('ws-test');

            expect(result.ok).toBe(true);
            expect(result.data?.nodes).toBe(0);
            expect(result.data?.edges).toBe(0);
            expect(result.data?.views).toBe(0);
        });
    });

    // ========================================================================
    // ID Generation
    // ========================================================================

    describe('ID generation', () => {
        it('should generate unique IDs for queries', async () => {
            mockQueryRunner.setMockResult('createNode', { ok: true, rows: [], headers: [] });

            const result1 = await service.storeQuery('ws-test', { script: 'q1' });
            const result2 = await service.storeQuery('ws-test', { script: 'q2' });

            expect(result1.data?.node_id).not.toBe(result2.data?.node_id);
            expect(result1.data?.node_id).toMatch(/^query_/);
            expect(result2.data?.node_id).toMatch(/^query_/);
        });

        it('should generate unique IDs for results', async () => {
            mockQueryRunner.setMockResult('createNode', { ok: true, rows: [], headers: [] });
            mockQueryRunner.setMockResult('createEdge', { ok: true, rows: [], headers: [] });

            const result1 = await service.storeResult('ws-test', { queryId: 'q1', rows: [] });
            const result2 = await service.storeResult('ws-test', { queryId: 'q2', rows: [] });

            expect(result1.data?.node_id).not.toBe(result2.data?.node_id);
            expect(result1.data?.node_id).toMatch(/^result_/);
            expect(result2.data?.node_id).toMatch(/^result_/);
        });

        it('should generate unique IDs for tasks', async () => {
            mockQueryRunner.setMockResult('createNode', { ok: true, rows: [], headers: [] });

            const result1 = await service.spawnTask('ws-test', { plan: 'task1' });
            const result2 = await service.spawnTask('ws-test', { plan: 'task2' });

            expect(result1.data?.node_id).not.toBe(result2.data?.node_id);
            expect(result1.data?.node_id).toMatch(/^task_/);
            expect(result2.data?.node_id).toMatch(/^task_/);
        });
    });
});
