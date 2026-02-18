// src/app/lib/eval/eval-runner.ts
// RAPTOR Evaluation Runner - Executes gold queries and calculates metrics

import { GoldQuery, GOLD_QUERIES, getSampleQueries } from './gold-queries';
import { RaptorEvalService, RaptorResult, RaptorDocResult } from '../../services/raptor-eval.service';

export interface EvalMetrics {
    queryId: string;
    query: string;
    category: GoldQuery['category'];
    mode: 'leaf-only' | 'collapsed-tree' | 'aggregated';

    // Retrieval metrics (Chunk Level - Evidence)
    chunkPrecision: number;
    chunkRecall: number;
    chunkF1: number;
    chunkNdcg: number;

    // Retrieval metrics (Doc Level - Router)
    docPrecision: number;
    docRecall: number;
    docF1: number;
    docNdcg: number;

    // Latency
    latencyMs: number;

    // Result counts
    resultCount: number;
    chunkResultCount: number;
    docResultCount: number;
    relevantChunkCount: number;
    relevantDocCount: number;
}

export interface EvalSummary {
    totalQueries: number;
    byCategory: Record<GoldQuery['category'], {
        avgChunkPrecision: number;
        avgChunkRecall: number;
        avgChunkF1: number;
        avgDocPrecision: number;
        avgDocRecall: number;
        avgDocF1: number;
        avgLatencyMs: number;
    }>;
    byMode: Record<'leaf-only' | 'collapsed-tree' | 'aggregated', {
        avgChunkPrecision: number;
        avgChunkRecall: number;
        avgChunkF1: number;
        avgDocPrecision: number;
        avgDocRecall: number;
        avgDocF1: number;
        avgLatencyMs: number;
    }>;
    overall: {
        avgChunkPrecision: number;
        avgChunkRecall: number;
        avgChunkF1: number;
        avgDocPrecision: number;
        avgDocRecall: number;
        avgDocF1: number;
        avgLatencyMs: number;
    };
}

export interface EvalConfig {
    k: number; // Number of results to retrieve
    sampleSize: number; // Number of queries to run (0 = all)
    categories: GoldQuery['category'][]; // Categories to include
    modes: ('leaf-only' | 'collapsed-tree' | 'aggregated')[]; // Modes to test
    onLog?: (message: string) => void; // Optional logger
}

export const DEFAULT_EVAL_CONFIG: EvalConfig = {
    k: 10,
    sampleSize: 0, // Run all queries
    categories: ['exact', 'paraphrase', 'thematic', 'cross-chapter'],
    modes: ['leaf-only', 'collapsed-tree', 'aggregated'],
};

/**
 * RAPTOR Evaluation Runner.
 * 
 * Usage:
 * ```typescript
 * const runner = new EvalRunner(raptorEvalService);
 * await runner.initialize();
 * const results = await runner.runEvaluation();
 * console.log(runner.summarize(results));
 * ```
 */
export class EvalRunner {
    private results: EvalMetrics[] = [];

    constructor(
        private raptorService: RaptorEvalService,
        private config: EvalConfig = DEFAULT_EVAL_CONFIG,
    ) { }

    /**
     * Run the full evaluation suite.
     */
    async runEvaluation(): Promise<EvalMetrics[]> {
        this.results = [];

        // Get queries to run
        let queries = GOLD_QUERIES;
        if (this.config.sampleSize > 0) {
            queries = getSampleQueries(this.config.sampleSize);
        }

        // Filter by category
        queries = queries.filter(q => this.config.categories.includes(q.category));

        this.log(`Running ${queries.length} queries across ${this.config.modes.length} modes`);

        // Run each query in each mode
        for (const query of queries) {
            for (const mode of this.config.modes) {
                const metrics = await this.evaluateQuery(query, mode);
                this.results.push(metrics);
            }
        }

        return this.results;
    }

    private log(message: string) {
        if (this.config.onLog) {
            this.config.onLog(`[EvalRunner] ${message}`);
        } else {
            console.log(`[EvalRunner] ${message}`);
        }
    }

    /**
     * Evaluate a single query in a specific mode.
     */
    private async evaluateQuery(query: GoldQuery, mode: 'leaf-only' | 'collapsed-tree' | 'aggregated'): Promise<EvalMetrics> {
        const startTime = performance.now();

        let results: RaptorResult[] | RaptorDocResult[] = [];

        switch (mode) {
            case 'leaf-only':
                results = await this.raptorService.searchLeafOnly(query.query, this.config.k);
                break;
            case 'collapsed-tree':
                results = await this.raptorService.search(query.query, this.config.k);
                break;
            case 'aggregated':
                results = await this.raptorService.searchAggregated(query.query, this.config.k);
                break;
        }

        const latencyMs = performance.now() - startTime;

        // Calculate metrics
        const metrics = this.calculateMetrics(query, results, mode, latencyMs);

        return metrics;
    }

    /**
     * Calculate retrieval metrics for a query.
     */
    private calculateMetrics(
        query: GoldQuery,
        results: RaptorResult[] | RaptorDocResult[],
        mode: 'leaf-only' | 'collapsed-tree' | 'aggregated',
        latencyMs: number,
    ): EvalMetrics {
        // 1. Extract Chunk IDs (Evidence)
        // 1. Extract Chunk IDs (Evidence)
        let retrievedChunkIds: string[] = [];

        if (mode === 'aggregated') {
            // Flatten chunks from doc results
            const docResults = results as RaptorDocResult[];
            retrievedChunkIds = docResults.flatMap(d =>
                d.chunks.map(c => c.chunkKey || c.chunkId || '')
            ).filter(id => id !== '');
        } else {
            // Flat list of chunks
            // Fix: Check for chunkKey OR chunkId, don't rely on 'chunkId' in r check
            const chunkResults = results as RaptorResult[];
            retrievedChunkIds = chunkResults
                .map(r => r.chunkKey || r.chunkId || '')
                .filter(id => id !== '');
        }

        // 2. Extract Doc IDs (Router)
        // If result is a chunk, map to its docId. If result is a doc, take docId.
        const retrievedDocIds = Array.from(new Set(results.map(r => r.docId)));

        // --- Chunk Metrics ---
        const expectedChunkIds = query.expectedChunks;
        const relevantChunks = retrievedChunkIds.filter(id => expectedChunkIds.includes(id)).length;
        const chunkPrecision = retrievedChunkIds.length > 0 ? relevantChunks / retrievedChunkIds.length : 0;
        const chunkRecall = expectedChunkIds.length > 0 ? relevantChunks / expectedChunkIds.length : 0;
        const chunkF1 = chunkPrecision + chunkRecall > 0 ? (2 * chunkPrecision * chunkRecall) / (chunkPrecision + chunkRecall) : 0;

        // Chunk NDCG
        const chunkDcg = retrievedChunkIds.reduce((sum, id, i) => {
            const relevance = query.relevanceGrades[id] ?? (expectedChunkIds.includes(id) ? 1 : 0);
            return sum + relevance / Math.log2(i + 2);
        }, 0);
        const idealChunkDcg = Object.entries(query.relevanceGrades)
            .filter(([id]) => id.startsWith('chunk'))
            .map(([, score]) => score)
            .sort((a, b) => b - a)
            .slice(0, this.config.k)
            .reduce((sum, rel, i) => sum + rel / Math.log2(i + 2), 0);
        const chunkNdcg = idealChunkDcg > 0 ? chunkDcg / idealChunkDcg : 0;


        // --- Doc Metrics ---
        const expectedDocIds = query.expectedDocs;
        const relevantDocs = retrievedDocIds.filter(id => expectedDocIds.includes(id)).length;
        const docPrecision = retrievedDocIds.length > 0 ? relevantDocs / retrievedDocIds.length : 0;
        const docRecall = expectedDocIds.length > 0 ? relevantDocs / expectedDocIds.length : 0;
        const docF1 = docPrecision + docRecall > 0 ? (2 * docPrecision * docRecall) / (docPrecision + docRecall) : 0;

        // Doc NDCG (Approximation: treat all expected docs as equal weight 1)
        const docDcg = retrievedDocIds.reduce((sum, id, i) => {
            const relevance = expectedDocIds.includes(id) ? 1 : 0;
            return sum + relevance / Math.log2(i + 2);
        }, 0);
        const idealDocDcg = expectedDocIds.slice(0, this.config.k)
            .reduce((sum, _, i) => sum + 1 / Math.log2(i + 2), 0);
        const docNdcg = idealDocDcg > 0 ? docDcg / idealDocDcg : 0;


        return {
            queryId: query.id,
            query: query.query,
            category: query.category,
            mode,

            chunkPrecision,
            chunkRecall,
            chunkF1,
            chunkNdcg,

            docPrecision,
            docRecall,
            docF1,
            docNdcg,

            latencyMs,
            resultCount: results.length,
            chunkResultCount: retrievedChunkIds.length,
            docResultCount: retrievedDocIds.length,
            relevantChunkCount: relevantChunks,
            relevantDocCount: relevantDocs,
        };
    }

    /**
     * Summarize evaluation results.
     */
    summarize(results: EvalMetrics[] = this.results): EvalSummary {
        if (results.length === 0) {
            return this.emptySummary();
        }

        // Helper to group results
        const groupBy = <K extends keyof EvalMetrics>(key: K) => {
            const groups: Record<string, EvalMetrics[]> = {};
            results.forEach(r => {
                const val = String(r[key]);
                if (!groups[val]) groups[val] = [];
                groups[val].push(r);
            });
            return groups;
        };

        const byCategory = groupBy('category');
        const byMode = groupBy('mode');

        const calcAvg = (metrics: EvalMetrics[]) => this.averageMetrics(metrics);

        return {
            totalQueries: results.length,
            byCategory: {
                'exact': calcAvg(byCategory['exact'] || []),
                'paraphrase': calcAvg(byCategory['paraphrase'] || []),
                'thematic': calcAvg(byCategory['thematic'] || []),
                'cross-chapter': calcAvg(byCategory['cross-chapter'] || []),
            },
            byMode: {
                'leaf-only': calcAvg(byMode['leaf-only'] || []),
                'collapsed-tree': calcAvg(byMode['collapsed-tree'] || []),
                'aggregated': calcAvg(byMode['aggregated'] || []),
            },
            overall: calcAvg(results),
        };
    }

    /**
     * Calculate average metrics for a set of results.
     */
    private averageMetrics(results: EvalMetrics[]): {
        avgChunkPrecision: number;
        avgChunkRecall: number;
        avgChunkF1: number;
        avgDocPrecision: number;
        avgDocRecall: number;
        avgDocF1: number;
        avgLatencyMs: number;
    } {
        if (results.length === 0) {
            return {
                avgChunkPrecision: 0, avgChunkRecall: 0, avgChunkF1: 0,
                avgDocPrecision: 0, avgDocRecall: 0, avgDocF1: 0,
                avgLatencyMs: 0
            };
        }

        const sum = results.reduce((acc, r) => ({
            chunkPrecision: acc.chunkPrecision + r.chunkPrecision,
            chunkRecall: acc.chunkRecall + r.chunkRecall,
            chunkF1: acc.chunkF1 + r.chunkF1,
            docPrecision: acc.docPrecision + r.docPrecision,
            docRecall: acc.docRecall + r.docRecall,
            docF1: acc.docF1 + r.docF1,
            latencyMs: acc.latencyMs + r.latencyMs,
        }), {
            chunkPrecision: 0, chunkRecall: 0, chunkF1: 0,
            docPrecision: 0, docRecall: 0, docF1: 0,
            latencyMs: 0
        });

        const n = results.length;
        return {
            avgChunkPrecision: sum.chunkPrecision / n,
            avgChunkRecall: sum.chunkRecall / n,
            avgChunkF1: sum.chunkF1 / n,
            avgDocPrecision: sum.docPrecision / n,
            avgDocRecall: sum.docRecall / n,
            avgDocF1: sum.docF1 / n,
            avgLatencyMs: sum.latencyMs / n,
        };
    }

    /**
     * Return an empty summary.
     */
    private emptySummary(): EvalSummary {
        const empty = {
            avgChunkPrecision: 0, avgChunkRecall: 0, avgChunkF1: 0,
            avgDocPrecision: 0, avgDocRecall: 0, avgDocF1: 0,
            avgLatencyMs: 0
        };
        return {
            totalQueries: 0,
            byCategory: { 'exact': empty, 'paraphrase': empty, 'thematic': empty, 'cross-chapter': empty },
            byMode: { 'leaf-only': empty, 'collapsed-tree': empty, 'aggregated': empty },
            overall: empty,
        };
    }

    /**
     * Export results as CSV.
     */
    toCSV(results: EvalMetrics[] = this.results): string {
        const headers = [
            'queryId', 'query', 'category', 'mode',
            'chunkPrecision', 'chunkRecall', 'chunkF1', 'chunkNdcg',
            'docPrecision', 'docRecall', 'docF1', 'docNdcg',
            'latencyMs', 'resultCount', 'chunkResultCount', 'docResultCount',
            'relevantChunkCount', 'relevantDocCount',
        ];

        const rows = results.map(r => [
            r.queryId,
            `"${r.query.replace(/"/g, '""')}"`,
            r.category,
            r.mode,
            r.chunkPrecision.toFixed(4),
            r.chunkRecall.toFixed(4),
            r.chunkF1.toFixed(4),
            r.chunkNdcg.toFixed(4),
            r.docPrecision.toFixed(4),
            r.docRecall.toFixed(4),
            r.docF1.toFixed(4),
            r.docNdcg.toFixed(4),
            r.latencyMs.toFixed(2),
            r.resultCount,
            r.chunkResultCount,
            r.docResultCount,
            r.relevantChunkCount,
            r.relevantDocCount,
        ]);

        return [headers.join(','), ...rows.map(r => r.join(','))].join('\n');
    }

    /**
     * Export summary as markdown table.
     */
    toMarkdown(summary: EvalSummary = this.summarize()): string {
        const lines: string[] = [
            '# RAPTOR Evaluation Results (Split Metrics)',
            '',
            `**Total Queries:** ${summary.totalQueries}`,
            '',
            '## By Mode',
            '',
            '| Mode | Doc Precision | Doc Recall | Chunk Precision | Chunk Recall | Latency (ms) |',
            '|------|---------------|------------|-----------------|--------------|--------------|',
        ];

        for (const [mode, metrics] of Object.entries(summary.byMode)) {
            lines.push(
                `| ${mode} | ${metrics.avgDocPrecision.toFixed(4)} | ${metrics.avgDocRecall.toFixed(4)} | ${metrics.avgChunkPrecision.toFixed(4)} | ${metrics.avgChunkRecall.toFixed(4)} | ${metrics.avgLatencyMs.toFixed(2)} |`,
            );
        }

        lines.push('', '## By Category', '');
        lines.push('| Category | Doc Recall | Chunk Recall | Latency (ms) |');
        lines.push('|----------|------------|--------------|--------------|');

        for (const [category, metrics] of Object.entries(summary.byCategory)) {
            lines.push(
                `| ${category} | ${metrics.avgDocRecall.toFixed(4)} | ${metrics.avgChunkRecall.toFixed(4)} | ${metrics.avgLatencyMs.toFixed(2)} |`,
            );
        }

        return lines.join('\n');
    }
}
