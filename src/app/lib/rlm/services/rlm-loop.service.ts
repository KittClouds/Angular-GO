/**
 * RLM Loop Service - Recursive Language Model Reasoning Loop
 *
 * Implements the observe/plan/execute/evaluate cycle for graph-native RLM.
 * Key insight: Recursion works better in a graph - Datalog's fixed-point
 * semantics handle recursive queries naturally.
 *
 * Architecture:
 * 1. Observe - Gather context via RO queries (FTS, vector, graph expansion)
 * 2. Plan - Create reasoning plan node in workspace
 * 3. Execute - Run queries, mutate workspace, store results
 * 4. Evaluate - Check termination conditions, decide to recurse or complete
 *
 * Safety:
 * - Depth limits prevent infinite recursion
 * - All queries validated before execution
 * - All operations logged to episode_log
 */

import { Injectable, inject } from '@angular/core';
import { QueryRunnerService, type QueryResult } from './query-runner.service';
import { RetrievalService } from './retrieval.service';
import { RlmLlmService } from './rlm-llm.service';
import { z } from 'zod';
import {
    WorkspaceOpsService,
    type OpResult,
    type CreateNodePayload,
    type LinkPayload,
} from './workspace-ops.service';
import {
    type WsNode,
    type WsNodeKind,
    type WsEdgeRel,
    WS_QUERIES,
} from '../schema/workspace-schema';
import { recordAction } from '../../cozo/memory/EpisodeLogService';
import { ftsService } from '../../cozo/fts/FtsService';
import { type AppContext } from './app-context';

// ============================================================================
// Zod Schemas — structured LLM response validation
// ============================================================================

/** LLM-generated plan step */
const LlmPlanStepSchema = z.object({
    description: z.string(),
    query: z.string().optional(),
    expectedOutput: z.enum(['entities', 'notes', 'blocks', 'graph', 'aggregation']).default('blocks'),
    status: z.literal('pending').default('pending'),
});

/** LLM-generated reasoning plan */
const LlmPlanSchema = z.object({
    steps: z.array(LlmPlanStepSchema),
    reasoning: z.string(),
});

/** LLM-generated evaluation decision */
const LlmEvalSchema = z.object({
    complete: z.boolean(),
    shouldRecurse: z.boolean(),
    reason: z.string(),
    output: z.string().optional(),
    confidence: z.number().min(0).max(1),
});

// ============================================================================
// Types
// ============================================================================

/**
 * RLM execution context - tracks state through the reasoning loop
 */
export interface RLMContext {
    /** Unique workspace identifier for this reasoning session */
    workspaceId: string;
    /** Thread ID for conversation context */
    threadId?: string;
    /** Narrative/world ID for data isolation */
    narrativeId?: string;
    /** Maximum recursion depth */
    maxDepth: number;
    /** Current recursion depth */
    currentDepth: number;
    /** Parent task ID if this is a recursive call */
    parentTaskId?: string;
    /** Initial prompt or query that started this loop */
    initialPrompt?: string;
    /** Live application context (open note, folder path, nearby entities) */
    appContext?: AppContext;
}

/**
 * Step types in the RLM loop
 */
export type RLMStepType = 'observe' | 'plan' | 'execute' | 'evaluate';

/**
 * Result of a single step in the RLM loop
 */
export interface RLMStepResult {
    /** Step type that was executed */
    type: RLMStepType;
    /** Workspace node ID created for this step */
    nodeId: string;
    /** Step-specific result data */
    result?: unknown;
    /** Whether the step succeeded */
    ok: boolean;
    /** Error message if step failed */
    error?: string;
    /** Latency in milliseconds */
    latMs: number;
}

/**
 * Observation result from the observe step
 */
export interface ObservationResult {
    /** Entities discovered */
    entities: Array<{ id: string; label: string; kind: string }>;
    /** Notes found via FTS */
    notes: Array<{ note_id: string; title: string; snippet: string }>;
    /** Blocks found via FTS */
    blocks: Array<{ block_id: string; text: string; score: number }>;
    /** Graph neighborhood expansion */
    neighborhood?: Array<{ entity_id: string; depth: number }>;
    /** Combined context for planning */
    contextSummary: string;
}

/**
 * Plan structure for reasoning
 */
export interface ReasoningPlan {
    /** Plan ID (node ID) */
    planId: string;
    /** Steps to execute */
    steps: PlanStep[];
    /** Current step index */
    currentStep: number;
    /** Plan status */
    status: 'pending' | 'in_progress' | 'completed' | 'failed';
    /** Reasoning behind the plan */
    reasoning: string;
}

/**
 * Single step in a reasoning plan
 */
export interface PlanStep {
    /** Step description */
    description: string;
    /** Query to execute (if applicable) */
    query?: string;
    /** Query parameters */
    params?: Record<string, unknown>;
    /** Expected output type */
    expectedOutput: 'entities' | 'notes' | 'blocks' | 'graph' | 'aggregation';
    /** Step status */
    status: 'pending' | 'running' | 'completed' | 'failed';
}

/**
 * Execution result from the execute step
 */
export interface ExecutionResult {
    /** Query results */
    queryResults: QueryResult[];
    /** Nodes created */
    createdNodes: string[];
    /** Edges created */
    createdEdges: Array<{ from: string; to: string; rel: string }>;
    /** Whether execution completed successfully */
    success: boolean;
    /** Error if execution failed */
    error?: string;
}

/**
 * Evaluation result from the evaluate step
 */
export interface EvaluationResult {
    /** Whether the reasoning loop should complete */
    complete: boolean;
    /** Whether to recurse with a new task */
    shouldRecurse: boolean;
    /** Reason for the decision */
    reason: string;
    /** Final output if complete */
    output?: string;
    /** Confidence in the result (0-1) */
    confidence: number;
    /** Metrics for this loop iteration */
    metrics: {
        observeMs: number;
        planMs: number;
        executeMs: number;
        evaluateMs: number;
        totalMs: number;
    };
}

/**
 * Complete result of an RLM loop iteration
 */
export interface RLMLoopResult {
    /** Whether the loop completed successfully */
    ok: boolean;
    /** Final output if complete */
    output?: string;
    /** All step results */
    steps: RLMStepResult[];
    /** Final evaluation */
    evaluation?: EvaluationResult;
    /** Error if loop failed */
    error?: string;
    /** Total latency */
    totalLatMs: number;
}

/**
 * Options for running the RLM loop
 */
export interface RLMLoopOptions {
    /** Initial observation queries to run */
    initialQueries?: string[];
    /** Custom termination check */
    terminationCheck?: (ctx: RLMContext, result: ExecutionResult) => boolean;
    /** Callback for each step */
    onStep?: (step: RLMStepResult) => void;
    /** Skip observation step (use cached context) */
    skipObserve?: boolean;
}

// ============================================================================
// Constants
// ============================================================================

/** Default maximum recursion depth */
const DEFAULT_MAX_DEPTH = 10;

/** Default context for new RLM loops */
const DEFAULT_CONTEXT: Partial<RLMContext> = {
    maxDepth: DEFAULT_MAX_DEPTH,
    currentDepth: 0,
};

// ============================================================================
// Service
// ============================================================================

import { AppContextProviderService } from './app-context-provider.service';

@Injectable({ providedIn: 'root' })
export class RlmLoopService {
    private queryRunner: QueryRunnerService;
    private workspaceOps: WorkspaceOpsService;
    private retrievalHelper: RetrievalService;
    private llm: RlmLlmService;
    private appContextProvider: AppContextProviderService;

    constructor(
        queryRunner?: QueryRunnerService,
        workspaceOps?: WorkspaceOpsService,
        retrievalHelper?: RetrievalService,
        llm?: RlmLlmService,
        appContextProvider?: AppContextProviderService
    ) {
        this.queryRunner = queryRunner || inject(QueryRunnerService);
        this.workspaceOps = workspaceOps || inject(WorkspaceOpsService);
        this.retrievalHelper = retrievalHelper || inject(RetrievalService);
        this.llm = llm || inject(RlmLlmService);
        this.appContextProvider = appContextProvider || inject(AppContextProviderService);
    }

    // Track active loops for debugging
    private activeLoops = new Map<string, RLMContext>();

    /**
     * Run the RLM reasoning loop
     *
     * @param ctx - RLM context with workspace and session info
     * @param options - Optional loop configuration
     * @returns Loop result with final output or error
     */
    async run(
        ctx: Partial<RLMContext>,
        options: RLMLoopOptions = {}
    ): Promise<RLMLoopResult> {
        const startTime = Date.now();

        // 0. Hydrate App Context if missing and not explicitly skipped
        let loadedAppCtx = ctx.appContext;
        if (!loadedAppCtx && !options.skipObserve) {
            try {
                loadedAppCtx = await this.appContextProvider.getCurrentContext();
            } catch (err) {
                console.warn('[RLM] Failed to load app context:', err);
            }
        }

        const fullCtx: RLMContext = {
            ...DEFAULT_CONTEXT,
            ...ctx,
            appContext: loadedAppCtx
        } as RLMContext;

        // Validate context
        if (!fullCtx.workspaceId) {
            return {
                ok: false,
                error: 'workspaceId is required',
                steps: [],
                totalLatMs: Date.now() - startTime,
            };
        }

        // Check depth limit
        if (fullCtx.currentDepth > fullCtx.maxDepth) {
            return {
                ok: false,
                error: `Maximum recursion depth exceeded: ${fullCtx.currentDepth} > ${fullCtx.maxDepth}`,
                steps: [],
                totalLatMs: Date.now() - startTime,
            };
        }

        // Track active loop
        this.activeLoops.set(fullCtx.workspaceId, fullCtx);

        const steps: RLMStepResult[] = [];

        try {
            // 1. OBSERVE: Gather context via RO queries
            const observeResult = await this.observe(fullCtx, options);
            steps.push(observeResult);
            options.onStep?.(observeResult);

            if (!observeResult.ok) {
                return this.finalizeLoop(fullCtx, steps, startTime, observeResult.error);
            }

            // 2. PLAN: Create reasoning plan
            const planResult = await this.plan(fullCtx, observeResult.result as ObservationResult);
            steps.push(planResult);
            options.onStep?.(planResult);

            if (!planResult.ok) {
                return this.finalizeLoop(fullCtx, steps, startTime, planResult.error);
            }

            // 3. EXECUTE: Run queries, mutate workspace
            const executeResult = await this.execute(
                fullCtx,
                planResult.result as ReasoningPlan
            );
            steps.push(executeResult);
            options.onStep?.(executeResult);

            if (!executeResult.ok) {
                return this.finalizeLoop(fullCtx, steps, startTime, executeResult.error);
            }

            // 4. EVALUATE: Check termination, decide to recurse
            const evaluateResult = await this.evaluate(
                fullCtx,
                observeResult.result as ObservationResult,
                executeResult.result as ExecutionResult
            );
            steps.push(evaluateResult);
            options.onStep?.(evaluateResult);

            if (!evaluateResult.ok) {
                return this.finalizeLoop(fullCtx, steps, startTime, evaluateResult.error);
            }

            const evaluation = evaluateResult.result as EvaluationResult;

            // Check for recursion or completion
            if (evaluation.complete) {
                return {
                    ok: true,
                    output: evaluation.output,
                    steps,
                    evaluation,
                    totalLatMs: Date.now() - startTime,
                };
            }

            if (evaluation.shouldRecurse && fullCtx.currentDepth < fullCtx.maxDepth) {
                // Spawn child task and recurse
                return this.recurse(fullCtx, steps, startTime, evaluation);
            }

            // Max depth reached without completion
            return {
                ok: true,
                output: evaluation.output || 'Max depth reached without completion',
                steps,
                evaluation,
                totalLatMs: Date.now() - startTime,
            };

        } finally {
            this.activeLoops.delete(fullCtx.workspaceId);
        }
    }

    /**
     * OBSERVE step: Gather context via RO queries
     *
     * Executes FTS, vector, and graph queries to build observation context.
     */
    async observe(
        ctx: RLMContext,
        options: RLMLoopOptions = {}
    ): Promise<RLMStepResult> {
        const startTime = Date.now();
        const nodeId = this.generateId('observe');

        try {
            const observation: ObservationResult = {
                entities: [],
                notes: [],
                blocks: [],
                contextSummary: '',
            };

            // ─────────────────────────────────────────────────────────────
            // SEED FROM APP CONTEXT (live application state)
            // ─────────────────────────────────────────────────────────────
            if (ctx.appContext) {
                const appCtx = ctx.appContext;

                // Add nearby entities from app context
                if (appCtx.nearbyEntities.length > 0) {
                    observation.entities.push(
                        ...appCtx.nearbyEntities.map(e => ({
                            id: e.id,
                            label: e.label,
                            kind: e.kind,
                        }))
                    );
                }

                // Add active note as context
                if (appCtx.activeNoteId && appCtx.activeNoteTitle) {
                    observation.notes.push({
                        note_id: appCtx.activeNoteId,
                        title: appCtx.activeNoteTitle,
                        snippet: appCtx.activeNoteSnippet || '',
                    });
                }
            }

            // Run FTS search if we have an initial prompt
            if (ctx.initialPrompt) {
                // Search blocks via Native Cozo FTS
                const blockResults = await this.retrievalHelper.searchBlocksFTS(
                    ctx.initialPrompt,
                    10,
                    ctx.workspaceId
                );

                observation.blocks = blockResults.map(r => ({
                    block_id: r.blockId,
                    text: r.text || '',
                    score: r.score || 0,
                }));

                // Search notes via FTS
                const noteResults = ftsService.searchNotes({
                    query: ctx.initialPrompt,
                    limit: 5,
                    minScore: 0.3,
                });

                observation.notes = noteResults.map(r => ({
                    note_id: r.id,
                    title: r.title || '',
                    snippet: r.content?.slice(0, 200) || '',
                }));
            }

            // Run any initial queries provided
            if (options.initialQueries) {
                for (const query of options.initialQueries) {
                    const result = await this.queryRunner.runRO(query, {}, { workspaceId: ctx.workspaceId });
                    if (result.ok && result.rows) {
                        // Merge results into observation
                        observation.entities.push(
                            ...result.rows
                                .filter((r): r is unknown[] => Array.isArray(r))
                                .map(r => ({
                                    id: String(r[0] || ''),
                                    label: String(r[1] || ''),
                                    kind: String(r[2] || 'unknown'),
                                }))
                        );
                    }
                }
            }

            // Build context summary (includes AppContext if present)
            observation.contextSummary = this.buildContextSummary(observation, ctx.appContext);

            // Store observation as workspace node
            await this.workspaceOps.createNode(ctx.workspaceId, {
                nodeId,
                kind: 'span', // Using 'span' for observation snapshots
                json: observation as unknown as Record<string, unknown>,
            });

            // Log episode
            this.logStep(ctx.workspaceId, 'observe', nodeId, {
                entities_count: observation.entities.length,
                notes_count: observation.notes.length,
                blocks_count: observation.blocks.length,
            });

            return {
                type: 'observe',
                nodeId,
                result: observation,
                ok: true,
                latMs: Date.now() - startTime,
            };

        } catch (err) {
            return {
                type: 'observe',
                nodeId,
                ok: false,
                error: err instanceof Error ? err.message : String(err),
                latMs: Date.now() - startTime,
            };
        }
    }

    /**
     * PLAN step: Create reasoning plan node
     *
     * Tries LLM-driven planning first, falls back to heuristic plan.
     */
    async plan(
        ctx: RLMContext,
        observation: ObservationResult
    ): Promise<RLMStepResult> {
        const startTime = Date.now();
        const planId = this.generateId('plan');

        try {
            // Build plan — try LLM first, fall back to heuristic
            const plan = await this.buildPlan(planId, ctx, observation);

            // Store plan as workspace node
            await this.workspaceOps.createNode(ctx.workspaceId, {
                nodeId: planId,
                kind: 'plan',
                json: plan as unknown as Record<string, unknown>,
            });

            // Log episode
            this.logStep(ctx.workspaceId, 'plan', planId, {
                steps_count: plan.steps.length,
                reasoning: plan.reasoning.slice(0, 200),
                llm_driven: plan.reasoning.startsWith('[LLM]'),
            });

            return {
                type: 'plan',
                nodeId: planId,
                result: plan,
                ok: true,
                latMs: Date.now() - startTime,
            };

        } catch (err) {
            return {
                type: 'plan',
                nodeId: planId,
                ok: false,
                error: err instanceof Error ? err.message : String(err),
                latMs: Date.now() - startTime,
            };
        }
    }

    /**
     * Try LLM-driven plan, fall back to heuristic.
     */
    private async buildPlan(
        planId: string,
        ctx: RLMContext,
        observation: ObservationResult
    ): Promise<ReasoningPlan> {
        // Attempt LLM planning when configured
        if (this.llm.isConfigured()) {
            try {
                return await this.llmPlan(planId, ctx, observation);
            } catch (err) {
                console.warn('[RLM] LLM plan failed, using heuristic fallback:', err);
            }
        }
        return this.heuristicPlan(planId, observation);
    }

    /**
     * LLM-driven planning via structured JSON prompt.
     */
    private async llmPlan(
        planId: string,
        ctx: RLMContext,
        observation: ObservationResult
    ): Promise<ReasoningPlan> {
        const systemPrompt = `You are the planning module of a Recursive Language Model (RLM).
Given the following observation context, create a structured plan.

## Available Query Types
- entity neighborhood expansion (Cozo Datalog) — expectedOutput: "graph"
- block text search (FTS) — expectedOutput: "blocks"
- claim extraction (from blocks) — expectedOutput: "blocks"
- entity lookup — expectedOutput: "entities"
- aggregation queries — expectedOutput: "aggregation"

## Rules
- Each step may include an optional Cozo Datalog query string.
- Keep plans concise: 1-4 steps max.
- If no useful action is available, return an empty steps array.`;

        const userPrompt = `## Observation
- Entities (${observation.entities.length}): ${observation.entities.slice(0, 10).map(e => `${e.label} [${e.kind}]`).join(', ') || 'none'}
- Notes (${observation.notes.length}): ${observation.notes.slice(0, 5).map(n => n.title).join(', ') || 'none'}
- Blocks (${observation.blocks.length}): ${observation.blocks.slice(0, 3).map(b => b.text.slice(0, 80)).join(' | ') || 'none'}
- User Query: ${ctx.initialPrompt || '(none)'}

Return JSON: { "steps": [{ "description": string, "query?": string, "expectedOutput": string, "status": "pending" }], "reasoning": string }`;

        const llmResult = await this.llm.completeJSON(systemPrompt, userPrompt, LlmPlanSchema);

        return {
            planId,
            steps: llmResult.steps.map(s => ({
                description: s.description,
                query: s.query,
                expectedOutput: s.expectedOutput as PlanStep['expectedOutput'],
                status: 'pending' as const,
            })),
            currentStep: 0,
            status: 'pending',
            reasoning: `[LLM] ${llmResult.reasoning}`,
        };
    }

    /**
     * Heuristic plan — the original conditional logic, used as fallback.
     */
    private heuristicPlan(
        planId: string,
        observation: ObservationResult
    ): ReasoningPlan {
        const plan: ReasoningPlan = {
            planId,
            steps: [],
            currentStep: 0,
            status: 'pending',
            reasoning: '',
        };

        if (observation.entities.length > 0) {
            plan.steps.push({
                description: 'Expand entity neighborhood',
                query: this.buildNeighborhoodQuery(observation.entities.map(e => e.id)),
                expectedOutput: 'graph',
                status: 'pending',
            });
        }

        if (observation.blocks.length > 0) {
            plan.steps.push({
                description: 'Extract claims from relevant blocks',
                expectedOutput: 'blocks',
                status: 'pending',
            });
        }

        plan.reasoning = `Based on observation of ${observation.entities.length} entities, ` +
            `${observation.notes.length} notes, and ${observation.blocks.length} blocks. ` +
            `Generated ${plan.steps.length} plan steps.`;

        return plan;
    }

    /**
     * EXECUTE step: Run queries, mutate workspace
     *
     * Executes the plan steps and stores results in workspace.
     */
    async execute(
        ctx: RLMContext,
        plan: ReasoningPlan
    ): Promise<RLMStepResult> {
        const startTime = Date.now();
        const nodeId = this.generateId('execute');

        try {
            const execution: ExecutionResult = {
                queryResults: [],
                createdNodes: [],
                createdEdges: [],
                success: true,
            };

            // Execute each plan step
            for (let i = 0; i < plan.steps.length; i++) {
                const step = plan.steps[i];
                step.status = 'running';

                if (step.query) {
                    // Execute query
                    const result = await this.queryRunner.runRO(
                        step.query,
                        step.params || {},
                        { workspaceId: ctx.workspaceId }
                    );

                    execution.queryResults.push(result);

                    if (result.ok) {
                        step.status = 'completed';

                        // Store result as workspace node
                        const resultId = this.generateId('result');
                        await this.workspaceOps.createNode(ctx.workspaceId, {
                            nodeId: resultId,
                            kind: 'result',
                            json: {
                                rows: result.rows,
                                headers: result.headers,
                                step_index: i,
                            },
                        });

                        execution.createdNodes.push(resultId);

                        // Link plan to result
                        await this.workspaceOps.link(ctx.workspaceId, {
                            fromId: plan.planId,
                            toId: resultId,
                            rel: 'produced',
                        });

                        execution.createdEdges.push({
                            from: plan.planId,
                            to: resultId,
                            rel: 'produced',
                        });
                    } else {
                        step.status = 'failed';
                        execution.success = false;
                    }
                } else {
                    // Non-query step (e.g., claim extraction)
                    step.status = 'completed';
                }
            }

            // Store execution result
            await this.workspaceOps.createNode(ctx.workspaceId, {
                nodeId,
                kind: 'draft',
                json: execution as unknown as Record<string, unknown>,
            });

            // Log episode
            this.logStep(ctx.workspaceId, 'execute', nodeId, {
                steps_executed: plan.steps.length,
                nodes_created: execution.createdNodes.length,
                edges_created: execution.createdEdges.length,
                success: execution.success,
            });

            return {
                type: 'execute',
                nodeId,
                result: execution,
                ok: execution.success,
                latMs: Date.now() - startTime,
            };

        } catch (err) {
            return {
                type: 'execute',
                nodeId,
                ok: false,
                error: err instanceof Error ? err.message : String(err),
                latMs: Date.now() - startTime,
            };
        }
    }

    /**
     * EVALUATE step: Check termination conditions
     *
     * Tries LLM-driven evaluation first, falls back to heuristic.
     */
    async evaluate(
        ctx: RLMContext,
        observation: ObservationResult,
        execution: ExecutionResult
    ): Promise<RLMStepResult> {
        const startTime = Date.now();
        const nodeId = this.generateId('evaluate');

        try {
            // Try LLM evaluation first, fall back to heuristic
            const evaluation = await this.buildEvaluation(ctx, observation, execution);

            // Store evaluation as workspace node
            await this.workspaceOps.createNode(ctx.workspaceId, {
                nodeId,
                kind: 'claim',
                json: evaluation as unknown as Record<string, unknown>,
            });

            // Log episode
            this.logStep(ctx.workspaceId, 'evaluate', nodeId, {
                complete: evaluation.complete,
                should_recurse: evaluation.shouldRecurse,
                reason: evaluation.reason,
                confidence: evaluation.confidence,
                llm_driven: evaluation.reason.startsWith('[LLM]'),
            });

            return {
                type: 'evaluate',
                nodeId,
                result: evaluation,
                ok: true,
                latMs: Date.now() - startTime,
            };

        } catch (err) {
            return {
                type: 'evaluate',
                nodeId,
                ok: false,
                error: err instanceof Error ? err.message : String(err),
                latMs: Date.now() - startTime,
            };
        }
    }

    /**
     * Try LLM-driven evaluation, fall back to heuristic.
     */
    private async buildEvaluation(
        ctx: RLMContext,
        observation: ObservationResult,
        execution: ExecutionResult
    ): Promise<EvaluationResult> {
        if (this.llm.isConfigured()) {
            try {
                return await this.llmEvaluate(ctx, observation, execution);
            } catch (err) {
                console.warn('[RLM] LLM evaluate failed, using heuristic fallback:', err);
            }
        }
        return this.heuristicEvaluate(ctx, execution);
    }

    /**
     * LLM-driven evaluation via structured JSON prompt.
     */
    private async llmEvaluate(
        ctx: RLMContext,
        observation: ObservationResult,
        execution: ExecutionResult
    ): Promise<EvaluationResult> {
        const systemPrompt = `You are the evaluation module of a Recursive Language Model (RLM).
Given the observation and execution results, decide whether to complete or recurse.

## Rules
- Set complete=true if the query has been satisfactorily answered.
- Set shouldRecurse=true only if deeper exploration would yield better results AND depth budget allows.
- Provide a concise output string summarizing findings when complete=true.
- confidence is a float 0-1 indicating certainty.`;

        const queryResultsSummary = execution.queryResults.map((r, i) => {
            const rowCount = r.rows?.length ?? 0;
            return `Query ${i + 1}: ${r.ok ? 'OK' : 'FAIL'} — ${rowCount} rows`;
        }).join('\n');

        const userPrompt = `## Context
- Original Query: ${ctx.initialPrompt || '(none)'}
- Observation Summary: ${observation.contextSummary}
- Execution Success: ${execution.success}
- Execution Results:
${queryResultsSummary || '(no queries executed)'}
- Nodes Created: ${execution.createdNodes.length}
- Current Depth: ${ctx.currentDepth} / ${ctx.maxDepth}

Return JSON: { "complete": boolean, "shouldRecurse": boolean, "reason": string, "output?": string, "confidence": number }`;

        const llmResult = await this.llm.completeJSON(systemPrompt, userPrompt, LlmEvalSchema);

        return {
            complete: llmResult.complete,
            shouldRecurse: llmResult.shouldRecurse,
            reason: `[LLM] ${llmResult.reason}`,
            output: llmResult.output,
            confidence: llmResult.confidence,
            metrics: {
                observeMs: 0,
                planMs: 0,
                executeMs: 0,
                evaluateMs: 0,
                totalMs: 0,
            },
        };
    }

    /**
     * Heuristic evaluation — the original conditional logic, used as fallback.
     */
    private heuristicEvaluate(
        ctx: RLMContext,
        execution: ExecutionResult
    ): EvaluationResult {
        const evaluation: EvaluationResult = {
            complete: false,
            shouldRecurse: false,
            reason: '',
            confidence: 0,
            metrics: {
                observeMs: 0,
                planMs: 0,
                executeMs: 0,
                evaluateMs: 0,
                totalMs: 0,
            },
        };

        // 1. No results found — complete with empty output
        if (execution.success && (
            execution.queryResults.length === 0 ||
            execution.queryResults.every(r => !r.rows || r.rows.length === 0)
        )) {
            evaluation.complete = true;
            evaluation.shouldRecurse = false;
            evaluation.reason = 'No results found from queries';
            evaluation.confidence = 0.5;
            evaluation.output = 'No relevant information found.';
        }

        // 2. Good results found — complete with output
        else if (execution.success && execution.queryResults.some(r => r.rows && r.rows.length > 0)) {
            evaluation.complete = true;
            evaluation.shouldRecurse = false;
            evaluation.reason = 'Successfully retrieved relevant information';
            evaluation.confidence = 0.8;
            evaluation.output = this.buildOutputFromResults(execution);
        }

        // 3. Partial results — consider recursion
        else if (!execution.success && ctx.currentDepth < ctx.maxDepth) {
            evaluation.complete = false;
            evaluation.shouldRecurse = true;
            evaluation.reason = 'Partial results, may need deeper exploration';
            evaluation.confidence = 0.4;
        }

        // 4. Failed but at max depth — complete anyway
        else {
            evaluation.complete = true;
            evaluation.shouldRecurse = false;
            evaluation.reason = 'Max depth reached with partial results';
            evaluation.confidence = 0.3;
            evaluation.output = this.buildOutputFromResults(execution);
        }

        return evaluation;
    }

    /**
     * Recurse with a child task
     */
    private async recurse(
        ctx: RLMContext,
        steps: RLMStepResult[],
        startTime: number,
        evaluation: EvaluationResult
    ): Promise<RLMLoopResult> {
        // Create child task node
        const taskId = this.generateId('task');

        await this.workspaceOps.createNode(ctx.workspaceId, {
            nodeId: taskId,
            kind: 'task',
            json: {
                parent_task: ctx.parentTaskId,
                depth: ctx.currentDepth + 1,
                reason: evaluation.reason,
            },
        });

        // Link to parent if exists
        if (ctx.parentTaskId) {
            await this.workspaceOps.link(ctx.workspaceId, {
                fromId: ctx.parentTaskId,
                toId: taskId,
                rel: 'spawned',
            });
        }

        // Create child context
        const childCtx: RLMContext = {
            ...ctx,
            currentDepth: ctx.currentDepth + 1,
            parentTaskId: taskId,
        };

        // Log recursion
        this.logStep(ctx.workspaceId, 'rlm_step', taskId, {
            action: 'recurse',
            new_depth: childCtx.currentDepth,
            parent_task: ctx.parentTaskId,
        });

        // Run child loop
        const childResult = await this.run(childCtx);

        return {
            ...childResult,
            steps: [...steps, ...childResult.steps],
            totalLatMs: Date.now() - startTime,
        };
    }

    /**
     * Finalize loop result
     */
    private finalizeLoop(
        ctx: RLMContext,
        steps: RLMStepResult[],
        startTime: number,
        error?: string
    ): RLMLoopResult {
        return {
            ok: false,
            error,
            steps,
            totalLatMs: Date.now() - startTime,
        };
    }

    /**
     * Build context summary from observation and optional app context
     */
    private buildContextSummary(observation: ObservationResult, appContext?: AppContext): string {
        const parts: string[] = [];

        // Include AppContext grounding info first
        if (appContext) {
            if (appContext.activeNoteTitle) {
                parts.push(`User is viewing note: "${appContext.activeNoteTitle}"`);
                if (appContext.activeNoteSnippet) {
                    parts.push(`Note snippet: "${appContext.activeNoteSnippet.slice(0, 100)}..."`);
                }
            }
            if (appContext.folderPath.length > 0) {
                parts.push(`Folder context: ${appContext.folderPath.join(' > ')}`);
            }
            if (appContext.nearbyEntities.length > 0) {
                parts.push(`Nearby entities: ${appContext.nearbyEntities.slice(0, 5).map(e => e.label).join(', ')}`);
            }
        }

        if (observation.entities.length > 0) {
            parts.push(`Found ${observation.entities.length} entities: ` +
                observation.entities.slice(0, 5).map(e => e.label).join(', '));
        }

        if (observation.notes.length > 0) {
            parts.push(`Found ${observation.notes.length} notes: ` +
                observation.notes.slice(0, 3).map(n => n.title).join(', '));
        }

        if (observation.blocks.length > 0) {
            parts.push(`Found ${observation.blocks.length} relevant text blocks`);
        }

        return parts.join('. ') || 'No relevant context found.';
    }

    /**
     * Build neighborhood expansion query
     */
    private buildNeighborhoodQuery(entityIds: string[]): string {
        return `
            # Expand entity neighborhood to depth 2
            expand[entity_id, depth] :=
                entity_id in $seed_entities,
                depth = 0

            expand[neighbor_id, depth] :=
                expand[entity_id, prev_depth],
                prev_depth < 2,
                *entity_edge{source_id: entity_id, target_id: neighbor_id},
                depth = prev_depth + 1

            expand[neighbor_id, depth] :=
                expand[entity_id, prev_depth],
                prev_depth < 2,
                *entity_edge{target_id: entity_id, source_id: neighbor_id},
                depth = prev_depth + 1

            ?[entity_id, label, kind, min_depth] :=
                expand[entity_id, depth],
                *entities{id: entity_id, label, kind},
                min_depth = min(depth)
            :order min_depth
            :limit 50
        `;
    }

    /**
     * Build output string from execution results
     */
    private buildOutputFromResults(execution: ExecutionResult): string {
        const parts: string[] = [];

        for (const result of execution.queryResults) {
            if (result.ok && result.rows && result.rows.length > 0) {
                parts.push(`Found ${result.rows.length} results`);
            }
        }

        return parts.join('. ') || 'Query execution completed.';
    }

    /**
     * Generate a unique ID with optional prefix
     */
    private generateId(prefix: string = 'node'): string {
        return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
    }

    /**
     * Log a step to episode_log
     */
    private logStep(
        workspaceId: string,
        stepType: string,
        nodeId: string,
        metadata: Record<string, unknown>
    ): void {
        try {
            recordAction(
                workspaceId,
                '',
                'rlm_step',
                nodeId,
                'node',
                { metadata: { step_type: stepType, ...metadata } },
                ''
            );
        } catch (err) {
            console.warn('[RlmLoopService] Failed to log step:', err);
        }
    }

    /**
     * Get active loops for debugging
     */
    getActiveLoops(): Map<string, RLMContext> {
        return new Map(this.activeLoops);
    }

    /**
     * Check if a workspace has an active loop
     */
    hasActiveLoop(workspaceId: string): boolean {
        return this.activeLoops.has(workspaceId);
    }
}

// ============================================================================
// Standalone Functions (for non-DI usage)
// ============================================================================

/**
 * Run RLM loop without DI
 */
export async function runRLMLoop(
    ctx: Partial<RLMContext>,
    options: RLMLoopOptions = {}
): Promise<RLMLoopResult> {
    const queryRunner = new QueryRunnerService();
    // We must manually wire dependencies for standalone usage
    const workspaceOps = new WorkspaceOpsService(queryRunner);
    const retrievalService = new RetrievalService(queryRunner);
    const llm = new RlmLlmService();
    const service = new RlmLoopService(queryRunner, workspaceOps, retrievalService, llm);

    return service.run(ctx, options);
}
