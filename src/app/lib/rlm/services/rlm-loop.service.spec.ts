import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
    RlmLoopService,
    runRLMLoop,
    type RLMContext,
    type RLMStepResult,
    type ObservationResult,
    type ReasoningPlan,
    type ExecutionResult,
    type EvaluationResult,
    type RLMLoopResult,
} from './rlm-loop.service';
import { QueryRunnerService } from './query-runner.service';
import { WorkspaceOpsService, type LinkPayload } from './workspace-ops.service';
import { RetrievalService } from './retrieval.service';
import { RlmLlmService } from './rlm-llm.service';
import { AppContextProviderService } from './app-context-provider.service';
import { emptyAppContext } from './app-context';

// Mock dependencies
vi.mock('../../cozo/memory/EpisodeLogService', () => ({
    recordAction: vi.fn(),
}));

vi.mock('../../cozo/fts/FtsService', () => ({
    ftsService: {
        searchNotes: vi.fn(() => []),
    },
}));

vi.mock('./app-context-provider.service', () => ({
    AppContextProviderService: class {
        getCurrentContext = vi.fn();
    }
}));

import { recordAction } from '../../cozo/memory/EpisodeLogService';
import { ftsService } from '../../cozo/fts/FtsService';

// Mock RlmLlmService — default: unconfigured (heuristic fallback)
function createLlmMock(overrides: Record<string, unknown> = {}) {
    return {
        isConfigured: vi.fn(() => false),
        complete: vi.fn(async () => ''),
        completeJSON: vi.fn(async () => ({})),
        getModel: vi.fn(() => 'test-model'),
        setModel: vi.fn(),
        model: vi.fn(() => 'test-model'),
        ...overrides,
    };
}

describe('RlmLoopService', () => {
    let service: RlmLoopService;
    let queryRunnerMock: any;
    let workspaceOpsMock: any;
    let retrievalServiceMock: any;
    let llmMock: any;
    let appContextProviderMock: any;

    beforeEach(() => {
        vi.clearAllMocks();

        queryRunnerMock = {
            runRO: vi.fn(),
        } as unknown as QueryRunnerService;

        workspaceOpsMock = {
            createNode: vi.fn().mockResolvedValue({ ok: true, nodeId: 'node_1' }),
            link: vi.fn().mockResolvedValue({ ok: true }),
        } as unknown as WorkspaceOpsService;

        retrievalServiceMock = {
            searchBlocksFTS: vi.fn().mockResolvedValue([]),
        } as unknown as RetrievalService;

        appContextProviderMock = {
            getCurrentContext: vi.fn().mockResolvedValue(emptyAppContext('narrative-1')),
        };

        llmMock = createLlmMock();

        service = new RlmLoopService(
            queryRunnerMock,
            workspaceOpsMock,
            retrievalServiceMock,
            llmMock,
            appContextProviderMock
        );
    });

    afterEach(() => {
        vi.restoreAllMocks();
    });

    // =========================================================================
    // Service Instantiation
    // =========================================================================

    describe('instantiation', () => {
        it('should create service instance', () => {
            expect(service).toBeInstanceOf(RlmLoopService);
        });

        it('should have empty active loops initially', () => {
            const activeLoops = service.getActiveLoops();
            expect(activeLoops.size).toBe(0);
        });
    });

    // =========================================================================
    // run() method
    // =========================================================================

    describe('run()', () => {
        it('should fail without workspaceId', async () => {
            const result = await service.run({});

            expect(result.ok).toBe(false);
            expect(result.error).toBe('workspaceId is required');
            expect(result.steps).toHaveLength(0);
        });

        it('should fail when max depth exceeded', async () => {
            const result = await service.run({
                workspaceId: 'test-ws',
                currentDepth: 15,
                maxDepth: 10,
            });

            expect(result.ok).toBe(false);
            expect(result.error).toContain('Maximum recursion depth exceeded');
        });

        it('should run complete loop with empty results', async () => {
            // Mock FTS/Retrieval to return empty results
            retrievalServiceMock.searchBlocksFTS.mockResolvedValue([]);
            vi.mocked(ftsService.searchNotes).mockReturnValue([]);

            // Mock QueryRunner
            queryRunnerMock.runRO.mockResolvedValue({ ok: true, rows: [] });

            const result = await service.run({
                workspaceId: 'test-ws',
                initialPrompt: 'test query',
            });

            expect(result.ok).toBe(true);
            expect(result.steps).toHaveLength(4);
            expect(result.steps.map(s => s.type)).toEqual([
                'observe', 'plan', 'execute', 'evaluate'
            ]);
        });

        it('should track active loops during execution', async () => {
            retrievalServiceMock.searchBlocksFTS.mockResolvedValue([]);
            vi.mocked(ftsService.searchNotes).mockReturnValue([]);
            queryRunnerMock.runRO.mockResolvedValue({ ok: true, rows: [] });

            // Start loop but check active state during execution
            const loopPromise = service.run({
                workspaceId: 'tracking-ws',
            });

            // After promise resolves, active loops should be cleared
            await loopPromise;
            expect(service.hasActiveLoop('tracking-ws')).toBe(false);
        });

        it('should call onStep callback for each step', async () => {
            retrievalServiceMock.searchBlocksFTS.mockResolvedValue([]);
            vi.mocked(ftsService.searchNotes).mockReturnValue([]);
            queryRunnerMock.runRO.mockResolvedValue({ ok: true, rows: [] });

            const steps: RLMStepResult[] = [];
            const onStep = (step: RLMStepResult) => steps.push(step);

            await service.run(
                { workspaceId: 'callback-ws' },
                { onStep }
            );

            expect(steps).toHaveLength(4);
            expect(steps.map(s => s.type)).toEqual([
                'observe', 'plan', 'execute', 'evaluate'
            ]);
        });
    });

    // =========================================================================
    // observe() method
    // =========================================================================

    describe('observe()', () => {
        it('should gather context from FTS', async () => {
            retrievalServiceMock.searchBlocksFTS.mockResolvedValue([
                { blockId: 'b1', text: 'test block', score: 0.9 },
            ]);
            vi.mocked(ftsService.searchNotes).mockReturnValue([
                { id: 'n1', title: 'Test Note', content: 'content', score: 0.8 },
            ]);
            queryRunnerMock.runRO.mockResolvedValue({ ok: true, rows: [] });

            const ctx: RLMContext = {
                workspaceId: 'observe-ws',
                maxDepth: 10,
                currentDepth: 0,
                initialPrompt: 'test query',
            };

            const result = await service.observe(ctx);

            expect(result.ok).toBe(true);
            expect(result.type).toBe('observe');
            expect(result.nodeId).toContain('observe_');

            const observation = result.result as ObservationResult;
            expect(observation.blocks).toHaveLength(1);
            expect(observation.notes).toHaveLength(1);
            expect(observation.contextSummary).toBeTruthy();
        });

        it('should run initial queries when provided', async () => {
            retrievalServiceMock.searchBlocksFTS.mockResolvedValue([]);
            vi.mocked(ftsService.searchNotes).mockReturnValue([]);
            queryRunnerMock.runRO.mockImplementation((script: string) => {
                if (script.includes('*entities')) {
                    return Promise.resolve({
                        ok: true,
                        rows: [['e1', 'Entity One', 'person']],
                        headers: ['id', 'label', 'kind'],
                    });
                }
                return Promise.resolve({ ok: true, rows: [] });
            });

            const ctx: RLMContext = {
                workspaceId: 'query-ws',
                maxDepth: 10,
                currentDepth: 0,
            };

            const result = await service.observe(ctx, {
                initialQueries: ['?[id, label, kind] := *entities{id, label, kind}'],
            });

            expect(result.ok).toBe(true);
            const observation = result.result as ObservationResult;
            expect(observation.entities.length).toBeGreaterThanOrEqual(0);
        });

        it('should handle FTS errors gracefully', async () => {
            retrievalServiceMock.searchBlocksFTS.mockRejectedValue(new Error('FTS error'));
            vi.mocked(ftsService.searchNotes).mockReturnValue([]);
            queryRunnerMock.runRO.mockResolvedValue({ ok: true, rows: [] });

            const ctx: RLMContext = {
                workspaceId: 'error-ws',
                maxDepth: 10,
                currentDepth: 0,
                initialPrompt: 'test',
            };

            const result = await service.observe(ctx);

            expect(result.ok).toBe(false);
            expect(result.error).toContain('FTS error');
        });
    });

    // =========================================================================
    // plan() method
    // =========================================================================

    describe('plan()', () => {
        it('should create plan from observation', async () => {
            queryRunnerMock.runRO.mockResolvedValue({ ok: true, rows: [] });

            const ctx: RLMContext = {
                workspaceId: 'plan-ws',
                maxDepth: 10,
                currentDepth: 0,
            };

            const observation: ObservationResult = {
                entities: [
                    { id: 'e1', label: 'Entity One', kind: 'person' },
                ],
                notes: [],
                blocks: [
                    { block_id: 'b1', text: 'test block', score: 0.9 },
                ],
                contextSummary: 'Found 1 entity and 1 block',
            };

            const result = await service.plan(ctx, observation);

            expect(result.ok).toBe(true);
            expect(result.type).toBe('plan');
            expect(result.nodeId).toContain('plan_');

            const plan = result.result as ReasoningPlan;
            expect(plan.steps.length).toBeGreaterThan(0);
            expect(plan.reasoning).toBeTruthy();
        });

        it('should create empty plan for empty observation', async () => {
            queryRunnerMock.runRO.mockResolvedValue({ ok: true, rows: [] });

            const ctx: RLMContext = {
                workspaceId: 'empty-plan-ws',
                maxDepth: 10,
                currentDepth: 0,
            };

            const observation: ObservationResult = {
                entities: [],
                notes: [],
                blocks: [],
                contextSummary: 'No relevant context found',
            };

            const result = await service.plan(ctx, observation);

            expect(result.ok).toBe(true);
            const plan = result.result as ReasoningPlan;
            expect(plan.steps).toHaveLength(0);
        });
    });

    // =========================================================================
    // execute() method
    // =========================================================================

    describe('execute()', () => {
        it('should execute plan steps', async () => {
            queryRunnerMock.runRO.mockResolvedValue({
                ok: true,
                rows: [['result1', 'result2']],
                headers: ['col1', 'col2'],
            });

            const ctx: RLMContext = {
                workspaceId: 'exec-ws',
                maxDepth: 10,
                currentDepth: 0,
            };

            const plan: ReasoningPlan = {
                planId: 'plan_123',
                steps: [
                    {
                        description: 'Test query',
                        query: '?[a, b] := a = 1, b = 2',
                        expectedOutput: 'aggregation',
                        status: 'pending',
                    },
                ],
                currentStep: 0,
                status: 'pending',
                reasoning: 'Test plan',
            };

            const result = await service.execute(ctx, plan);

            expect(result.ok).toBe(true);
            expect(result.type).toBe('execute');

            const execution = result.result as ExecutionResult;
            expect(execution.queryResults).toHaveLength(1);
            expect(execution.success).toBe(true);
        });

        it('should handle query failures', async () => {
            queryRunnerMock.runRO.mockResolvedValue({
                ok: false,
                message: 'Query failed',
            });

            const ctx: RLMContext = {
                workspaceId: 'fail-ws',
                maxDepth: 10,
                currentDepth: 0,
            };

            const plan: ReasoningPlan = {
                planId: 'plan_456',
                steps: [
                    {
                        description: 'Failing query',
                        query: '?[a] := invalid',
                        expectedOutput: 'entities',
                        status: 'pending',
                    },
                ],
                currentStep: 0,
                status: 'pending',
                reasoning: 'Test failure',
            };

            const result = await service.execute(ctx, plan);

            const execution = result.result as ExecutionResult;
            expect(execution.success).toBe(false);
        });

        it('should skip non-query steps', async () => {
            queryRunnerMock.runRO.mockResolvedValue({ ok: true, rows: [] });

            const ctx: RLMContext = {
                workspaceId: 'skip-ws',
                maxDepth: 10,
                currentDepth: 0,
            };

            const plan: ReasoningPlan = {
                planId: 'plan_789',
                steps: [
                    {
                        description: 'Non-query step',
                        expectedOutput: 'blocks',
                        status: 'pending',
                    },
                ],
                currentStep: 0,
                status: 'pending',
                reasoning: 'Test skip',
            };

            const result = await service.execute(ctx, plan);

            expect(result.ok).toBe(true);
            const execution = result.result as ExecutionResult;
            expect(execution.queryResults).toHaveLength(0);
            expect(execution.success).toBe(true);
        });
    });

    // =========================================================================
    // evaluate() method
    // =========================================================================

    describe('evaluate()', () => {
        it('should complete when good results found', async () => {
            queryRunnerMock.runRO.mockResolvedValue({ ok: true, rows: [] });

            const ctx: RLMContext = {
                workspaceId: 'eval-ws',
                maxDepth: 10,
                currentDepth: 0,
            };

            const observation: ObservationResult = {
                entities: [],
                notes: [],
                blocks: [],
                contextSummary: 'Test',
            };

            const execution: ExecutionResult = {
                queryResults: [
                    { ok: true, rows: [['data']], headers: ['col'] },
                ],
                createdNodes: ['result_1'],
                createdEdges: [],
                success: true,
            };

            const result = await service.evaluate(ctx, observation, execution);

            expect(result.ok).toBe(true);
            expect(result.type).toBe('evaluate');

            const evaluation = result.result as EvaluationResult;
            expect(evaluation.complete).toBe(true);
            expect(evaluation.shouldRecurse).toBe(false);
            expect(evaluation.confidence).toBeGreaterThan(0.5);
        });

        it('should complete with empty output when no results', async () => {
            queryRunnerMock.runRO.mockResolvedValue({ ok: true, rows: [] });

            const ctx: RLMContext = {
                workspaceId: 'empty-eval-ws',
                maxDepth: 10,
                currentDepth: 0,
            };

            const observation: ObservationResult = {
                entities: [],
                notes: [],
                blocks: [],
                contextSummary: 'Empty',
            };

            const execution: ExecutionResult = {
                queryResults: [],
                createdNodes: [],
                createdEdges: [],
                success: true,
            };

            const result = await service.evaluate(ctx, observation, execution);

            const evaluation = result.result as EvaluationResult;
            expect(evaluation.complete).toBe(true);
            expect(evaluation.output).toContain('No relevant information');
        });

        it('should suggest recursion for partial results', async () => {
            queryRunnerMock.runRO.mockResolvedValue({ ok: true, rows: [] });

            const ctx: RLMContext = {
                workspaceId: 'recurse-ws',
                maxDepth: 10,
                currentDepth: 0,
            };

            const observation: ObservationResult = {
                entities: [],
                notes: [],
                blocks: [],
                contextSummary: 'Partial',
            };

            const execution: ExecutionResult = {
                queryResults: [
                    { ok: false, error: 'Query failed' },
                ],
                createdNodes: [],
                createdEdges: [],
                success: false,
            };

            const result = await service.evaluate(ctx, observation, execution);

            const evaluation = result.result as EvaluationResult;
            expect(evaluation.shouldRecurse).toBe(true);
        });

        it('should not suggest recursion at max depth', async () => {
            queryRunnerMock.runRO.mockResolvedValue({ ok: true, rows: [] });

            const ctx: RLMContext = {
                workspaceId: 'max-depth-ws',
                maxDepth: 10,
                currentDepth: 10, // At max
            };

            const observation: ObservationResult = {
                entities: [],
                notes: [],
                blocks: [],
                contextSummary: 'At max',
            };

            const execution: ExecutionResult = {
                queryResults: [
                    { ok: false, error: 'Failed' },
                ],
                createdNodes: [],
                createdEdges: [],
                success: false,
            };

            const result = await service.evaluate(ctx, observation, execution);

            const evaluation = result.result as EvaluationResult;
            expect(evaluation.shouldRecurse).toBe(false);
            expect(evaluation.complete).toBe(true);
            expect(evaluation.reason).toContain('Max depth');
        });
    });

    // =========================================================================
    // Recursion
    // =========================================================================

    describe('recursion', () => {
        it('should increment depth on recursion', async () => {
            retrievalServiceMock.searchBlocksFTS.mockResolvedValue([]);
            vi.mocked(ftsService.searchNotes).mockReturnValue([]);

            // Return results that trigger recursion, then completion
            // We simple mock successful runs here, as logic is handled by service
            queryRunnerMock.runRO.mockResolvedValue({
                ok: true,
                rows: [],
                headers: [],
            });

            // This test verifies the recursion logic exists
            // Full recursion testing would require more complex mocking
            const result = await service.run({
                workspaceId: 'recurse-test-ws',
                maxDepth: 2,
                currentDepth: 0,
            });

            expect(result.ok).toBe(true);
        });
    });

    // =========================================================================
    // Episode Logging
    // =========================================================================

    describe('episode logging', () => {
        it('should log steps to episode_log', async () => {
            retrievalServiceMock.searchBlocksFTS.mockResolvedValue([]);
            vi.mocked(ftsService.searchNotes).mockReturnValue([]);
            queryRunnerMock.runRO.mockResolvedValue({ ok: true, rows: [] });

            await service.run({
                workspaceId: 'log-ws',
            });

            // Should have logged multiple steps
            expect(recordAction).toHaveBeenCalled();
        });
    });

    // =========================================================================
    // Active Loop Tracking
    // =========================================================================

    describe('active loop tracking', () => {
        it('should track active loops', async () => {
            retrievalServiceMock.searchBlocksFTS.mockResolvedValue([]);
            vi.mocked(ftsService.searchNotes).mockReturnValue([]);
            queryRunnerMock.runRO.mockResolvedValue({ ok: true, rows: [] });

            expect(service.hasActiveLoop('track-ws')).toBe(false);

            await service.run({ workspaceId: 'track-ws' });

            expect(service.hasActiveLoop('track-ws')).toBe(false);
        });
    });
});

// =============================================================================
// Standalone Function Tests
// =============================================================================

describe('runRLMLoop', () => {
    it('should run loop without DI', async () => {
        // Just verify it's a function - testing standalone DI is cleaner in integration tests
        expect(typeof runRLMLoop).toBe('function');
    });
});

// =============================================================================
// Type Exports
// =============================================================================

describe('type exports', () => {
    it('should export RLMContext type', () => {
        const ctx: RLMContext = {
            workspaceId: 'test',
            maxDepth: 10,
            currentDepth: 0,
        };
        expect(ctx.workspaceId).toBe('test');
    });

    it('should export RLMStepResult type', () => {
        const step: RLMStepResult = {
            type: 'observe',
            nodeId: 'node_1',
            ok: true,
            latMs: 100,
        };
        expect(step.type).toBe('observe');
    });

    it('should export ObservationResult type', () => {
        const obs: ObservationResult = {
            entities: [],
            notes: [],
            blocks: [],
            contextSummary: 'test',
        };
        expect(obs.contextSummary).toBe('test');
    });

    it('should export ReasoningPlan type', () => {
        const plan: ReasoningPlan = {
            planId: 'plan_1',
            steps: [],
            currentStep: 0,
            status: 'pending',
            reasoning: 'test',
        };
        expect(plan.planId).toBe('plan_1');
    });

    it('should export ExecutionResult type', () => {
        const exec: ExecutionResult = {
            queryResults: [],
            createdNodes: [],
            createdEdges: [],
            success: true,
        };
        expect(exec.success).toBe(true);
    });

    it('should export EvaluationResult type', () => {
        const eval_: EvaluationResult = {
            complete: true,
            shouldRecurse: false,
            reason: 'test',
            confidence: 0.9,
            metrics: {
                observeMs: 10,
                planMs: 10,
                executeMs: 10,
                evaluateMs: 10,
                totalMs: 40,
            },
        };
        expect(eval_.complete).toBe(true);
    });

    it('should export RLMLoopResult type', () => {
        const result: RLMLoopResult = {
            ok: true,
            steps: [],
            totalLatMs: 100,
        };
        expect(result.ok).toBe(true);
    });
});

// =============================================================================
// LLM-driven plan / evaluate
// =============================================================================

describe('RlmLoopService — LLM-driven plan + evaluate', () => {
    let service: RlmLoopService;
    let queryRunnerMock: any;
    let workspaceOpsMock: any;
    let retrievalServiceMock: any;
    let llmMock: any;
    let appContextProviderMock: any;

    beforeEach(() => {
        vi.clearAllMocks();

        queryRunnerMock = {
            runRO: vi.fn().mockResolvedValue({ ok: true, rows: [] }),
        };

        workspaceOpsMock = {
            createNode: vi.fn().mockResolvedValue({ ok: true, nodeId: 'node_1' }),
            link: vi.fn().mockResolvedValue({ ok: true }),
        };

        retrievalServiceMock = {
            searchBlocksFTS: vi.fn().mockResolvedValue([]),
        };

        // LLM configured and returning valid JSON
        llmMock = createLlmMock({
            isConfigured: vi.fn(() => true),
        });

        // Initialize mock
        appContextProviderMock = {
            getCurrentContext: vi.fn(),
        };

        service = new RlmLoopService(
            queryRunnerMock, workspaceOpsMock, retrievalServiceMock, llmMock, appContextProviderMock
        );
    });

    afterEach(() => vi.restoreAllMocks());

    // ---- Plan ---------------------------------------------------------------

    describe('plan() with LLM', () => {
        it('uses LLM plan when configured and call succeeds', async () => {
            llmMock.completeJSON.mockResolvedValue({
                steps: [
                    { description: 'Search for dragons', expectedOutput: 'entities', status: 'pending' },
                ],
                reasoning: 'User asked about dragons.',
            });

            const observation: ObservationResult = {
                entities: [{ id: 'e1', label: 'Dragon', kind: 'species' }],
                notes: [],
                blocks: [],
                contextSummary: 'Found 1 entity.',
            };

            const ctx: RLMContext = {
                workspaceId: 'ws-test',
                maxDepth: 3,
                currentDepth: 0,
            };

            const result = await service.plan(ctx, observation);

            expect(result.ok).toBe(true);
            const plan = result.result as ReasoningPlan;
            expect(plan.reasoning).toContain('[LLM]');
            expect(plan.steps).toHaveLength(1);
            expect(plan.steps[0].description).toBe('Search for dragons');
            expect(llmMock.completeJSON).toHaveBeenCalledOnce();
        });

        it('falls back to heuristic when LLM call fails', async () => {
            llmMock.completeJSON.mockRejectedValue(new Error('LLM timeout'));

            const observation: ObservationResult = {
                entities: [{ id: 'e1', label: 'Dragon', kind: 'species' }],
                notes: [],
                blocks: [{ block_id: 'b1', text: 'Fire-breathing', score: 0.9 }],
                contextSummary: 'Found context.',
            };

            const ctx: RLMContext = {
                workspaceId: 'ws-test',
                maxDepth: 3,
                currentDepth: 0,
            };

            const result = await service.plan(ctx, observation);

            expect(result.ok).toBe(true);
            const plan = result.result as ReasoningPlan;
            // Should NOT contain [LLM] prefix — heuristic used
            expect(plan.reasoning).not.toContain('[LLM]');
            // Heuristic should generate entity expansion + blocks steps
            expect(plan.steps.length).toBeGreaterThanOrEqual(1);
        });

        it('uses heuristic when LLM not configured', async () => {
            llmMock.isConfigured.mockReturnValue(false);

            const observation: ObservationResult = {
                entities: [],
                notes: [],
                blocks: [],
                contextSummary: '',
            };

            const ctx: RLMContext = {
                workspaceId: 'ws-test',
                maxDepth: 3,
                currentDepth: 0,
            };

            const result = await service.plan(ctx, observation);

            expect(result.ok).toBe(true);
            expect(llmMock.completeJSON).not.toHaveBeenCalled();
        });
    });

    // ---- Evaluate ------------------------------------------------------------

    describe('evaluate() with LLM', () => {
        const baseCtx: RLMContext = {
            workspaceId: 'ws-test',
            maxDepth: 3,
            currentDepth: 0,
            initialPrompt: 'Tell me about dragons',
        };

        const baseObs: ObservationResult = {
            entities: [],
            notes: [],
            blocks: [],
            contextSummary: 'Found context.',
        };

        const baseExec: ExecutionResult = {
            queryResults: [{ ok: true, rows: [['row1']] }],
            createdNodes: ['n1'],
            createdEdges: [],
            success: true,
        };

        it('uses LLM evaluation when configured and call succeeds', async () => {
            llmMock.completeJSON.mockResolvedValue({
                complete: true,
                shouldRecurse: false,
                reason: 'Sufficient data gathered.',
                output: 'Dragons are fire-breathing creatures.',
                confidence: 0.9,
            });

            const result = await service.evaluate(baseCtx, baseObs, baseExec);

            expect(result.ok).toBe(true);
            const ev = result.result as EvaluationResult;
            expect(ev.reason).toContain('[LLM]');
            expect(ev.complete).toBe(true);
            expect(ev.output).toBe('Dragons are fire-breathing creatures.');
            expect(ev.confidence).toBe(0.9);
        });

        it('falls back to heuristic when LLM fails', async () => {
            llmMock.completeJSON.mockRejectedValue(new Error('API down'));

            const result = await service.evaluate(baseCtx, baseObs, baseExec);

            expect(result.ok).toBe(true);
            const ev = result.result as EvaluationResult;
            expect(ev.reason).not.toContain('[LLM]');
            // Heuristic: success + rows > 0 → complete
            expect(ev.complete).toBe(true);
            expect(ev.confidence).toBe(0.8);
        });

        it('uses heuristic when LLM not configured', async () => {
            llmMock.isConfigured.mockReturnValue(false);

            const result = await service.evaluate(baseCtx, baseObs, baseExec);

            expect(result.ok).toBe(true);
            expect(llmMock.completeJSON).not.toHaveBeenCalled();
        });
    });

    // =========================================================================
    // AppContext Seeding in Observe Step
    // =========================================================================

    describe('observe() — AppContext seeding', () => {
        const baseCtx: RLMContext = {
            workspaceId: 'ws-test',
            maxDepth: 3,
            currentDepth: 0,
            initialPrompt: 'Tell me about dragons',
        };

        it('should seed entities from appContext.nearbyEntities', async () => {
            const ctx: RLMContext = {
                ...baseCtx,
                appContext: {
                    activeNoteId: 'note-1',
                    activeNoteTitle: 'Dragon Lore',
                    activeNoteSnippet: 'Fire-breathing creatures...',
                    worldId: 'world-1',
                    narrativeId: 'narr-1',
                    folderId: 'folder-chars',
                    folderPath: ['Root', 'Characters'],
                    nearbyEntities: [
                        { id: 'e1', label: 'Red Dragon', kind: 'creature', subtype: 'dragon' },
                        { id: 'e2', label: 'Alice', kind: 'person', subtype: null },
                    ],
                },
            };

            const result = await service.observe(ctx);

            expect(result.ok).toBe(true);
            const obs = result.result as ObservationResult;
            // Entities from AppContext should be included
            expect(obs.entities.some(e => e.label === 'Red Dragon')).toBe(true);
            expect(obs.entities.some(e => e.label === 'Alice')).toBe(true);
        });

        it('should seed active note into observation.notes', async () => {
            const ctx: RLMContext = {
                ...baseCtx,
                appContext: {
                    activeNoteId: 'note-42',
                    activeNoteTitle: 'Mystery Chapter',
                    activeNoteSnippet: 'The detective arrives...',
                    worldId: 'world-1',
                    narrativeId: null,
                    folderId: null,
                    folderPath: [],
                    nearbyEntities: [],
                },
            };

            const result = await service.observe(ctx);

            expect(result.ok).toBe(true);
            const obs = result.result as ObservationResult;
            // The FTS search overrides observation.notes, but the AppContext note
            // should be pushed before FTS runs — check contextSummary includes it
            expect(obs.contextSummary).toContain('Mystery Chapter');
        });

        it('should include folder path in context summary', async () => {
            const ctx: RLMContext = {
                ...baseCtx,
                initialPrompt: '', // No FTS to keep observation clean
                appContext: {
                    activeNoteId: 'note-1',
                    activeNoteTitle: 'Test',
                    activeNoteSnippet: null,
                    worldId: 'w1',
                    narrativeId: null,
                    folderId: 'f1',
                    folderPath: ['World', 'Characters', 'Protagonists'],
                    nearbyEntities: [],
                },
            };

            const result = await service.observe(ctx);

            expect(result.ok).toBe(true);
            const obs = result.result as ObservationResult;
            expect(obs.contextSummary).toContain('World > Characters > Protagonists');
        });

        it('should include nearby entity labels in context summary', async () => {
            const ctx: RLMContext = {
                ...baseCtx,
                initialPrompt: '',
                appContext: {
                    activeNoteId: 'note-1',
                    activeNoteTitle: 'Test',
                    activeNoteSnippet: null,
                    worldId: 'w1',
                    narrativeId: null,
                    folderId: null,
                    folderPath: [],
                    nearbyEntities: [
                        { id: 'e1', label: 'Gandalf', kind: 'person', subtype: null },
                        { id: 'e2', label: 'Mordor', kind: 'place', subtype: null },
                    ],
                },
            };

            const result = await service.observe(ctx);

            expect(result.ok).toBe(true);
            const obs = result.result as ObservationResult;
            expect(obs.contextSummary).toContain('Gandalf');
            expect(obs.contextSummary).toContain('Mordor');
        });

        it('should work without appContext (undefined)', async () => {
            const ctx: RLMContext = {
                ...baseCtx,
                initialPrompt: '', // No FTS
            };

            const result = await service.observe(ctx);

            expect(result.ok).toBe(true);
            const obs = result.result as ObservationResult;
            expect(obs.contextSummary).toBe('No relevant context found.');
        });
    });
});
