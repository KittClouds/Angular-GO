import { readFileSync } from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import { PhoenixWasmHarness } from './phoenix-wasm-harness';

const runPerf = process.env.PHOENIX_WASM_PERF === '1';
const describePerf = runPerf ? describe : describe.skip;

type PhaseMetrics = {
    name: string;
    wallMs: number;
    memoryBeforeBytes: number;
    memoryAfterBytes: number;
    memoryDeltaBytes: number;
    memoryAfterPages: number;
};

type CorpusReport = {
    corpusId: string;
    inputBytes: number;
    lexicalQueries: string[];
    graphQueries: string[];
    phases: PhaseMetrics[];
    chunkHits: number;
    graphNodeHits: number;
    graphEdgeCount: number;
    stateDocumentCount: number;
    snapshotBytes: number;
    restoredChunkHits: number;
};

type CorpusBudget = {
    maxAnalyzeMs: number;
    maxAnalyzeMemoryDeltaBytes: number;
    maxIngestMs: number;
    maxIngestMemoryDeltaBytes: number;
    maxPostIngestMemoryBytes: number;
    maxLexicalQueryMs: number;
    maxGraphQueryMs: number;
    maxGraphDeltaMs: number;
    maxExportMs: number;
    maxImportMs: number;
    maxRestoreQueryMs: number;
    maxFinalMemoryBytes: number;
    maxSnapshotBytes: number;
};

const CORPORA = [
    {
        id: 'shortrun',
        title: 'Shortrun',
        path: path.join(process.cwd(), 'docs', 'shortrun.md'),
        capacityHint: 16 * 1024 * 1024,
        budget: {
            maxAnalyzeMs: 2_000,
            maxAnalyzeMemoryDeltaBytes: 96 * 1024 * 1024,
            maxIngestMs: 5_000,
            maxIngestMemoryDeltaBytes: 64 * 1024 * 1024,
            maxPostIngestMemoryBytes: 128 * 1024 * 1024,
            maxLexicalQueryMs: 2_500,
            maxGraphQueryMs: 5_000,
            maxGraphDeltaMs: 5_000,
            maxExportMs: 5_000,
            maxImportMs: 8_000,
            maxRestoreQueryMs: 2_000,
            maxFinalMemoryBytes: 256 * 1024 * 1024,
            maxSnapshotBytes: 64 * 1024 * 1024,
        },
    },
    {
        id: 'perfect_run',
        title: 'Perfect Run',
        path: path.join(process.cwd(), 'docs', 'perfect_run.md'),
        capacityHint: 128 * 1024 * 1024,
        budget: {
            maxAnalyzeMs: 12_000,
            maxAnalyzeMemoryDeltaBytes: 300 * 1024 * 1024,
            maxIngestMs: 15_000,
            maxIngestMemoryDeltaBytes: 180 * 1024 * 1024,
            maxPostIngestMemoryBytes: 550 * 1024 * 1024,
            maxLexicalQueryMs: 6_000,
            maxGraphQueryMs: 20_000,
            maxGraphDeltaMs: 25_000,
            maxExportMs: 25_000,
            maxImportMs: 120_000,
            maxRestoreQueryMs: 4_000,
            maxFinalMemoryBytes: 1024 * 1024 * 1024,
            maxSnapshotBytes: 256 * 1024 * 1024,
        },
    },
] as const;

describePerf('phoenix wasm performance', () => {
    it(
        'measures the real corpus without opening the app',
        async () => {
            const reports: CorpusReport[] = [];

            for (const corpus of CORPORA) {
                const text = readFileSync(corpus.path, 'utf8');
                const lexicalQueries = selectLexicalQueries(text);
                const graphQueries = selectGraphQueries(text);
                const harness = await PhoenixWasmHarness.create({ release: true });
                const phases: PhaseMetrics[] = [];

                await measurePhase(harness, phases, 'initRuntime', () => harness.initRuntime());
                const session = await measurePhase(harness, phases, 'createSession', () =>
                    harness.createSession(`Perf ${corpus.title}`),
                );

                await measurePhase(harness, phases, 'analyzeText', () =>
                    harness.analyzeText(text, corpus.capacityHint),
                );
                await measurePhase(harness, phases, 'ingest', () =>
                    harness.ingest(session.sessionId, `wasm-${corpus.id}`, corpus.title, text),
                );

                const lexicalQuery = await measurePhase(harness, phases, 'lexicalQuery', () =>
                    harness.queryBinary(session.sessionId, lexicalQueries[0], {
                        targets: ['chunks'],
                        limit: 8,
                        capacityHint: corpus.capacityHint,
                    }),
                );
                const graphQuery = await measurePhase(harness, phases, 'graphQuery', () =>
                    harness.queryBinary(session.sessionId, graphQueries[0], {
                        targets: ['graph', 'nodes'],
                        limit: 8,
                        capacityHint: corpus.capacityHint,
                    }),
                );
                const graphDelta = await measurePhase(harness, phases, 'graphDelta', () =>
                    harness.graphDeltaBinary(session.sessionId, `wasm-${corpus.id}`, {
                        limit: null,
                        capacityHint: corpus.capacityHint,
                    }),
                );
                const state = await measurePhase(harness, phases, 'sessionState', () =>
                    harness.sessionStateBinary(session.sessionId, corpus.capacityHint),
                );
                await measurePhase(harness, phases, 'sessionStats', () =>
                    harness.sessionStatsBinary(session.sessionId, corpus.capacityHint),
                );
                const snapshot = await measurePhase(harness, phases, 'snapshotExport', () =>
                    harness.exportSnapshot(corpus.capacityHint),
                );

                const restoredHarness = await PhoenixWasmHarness.create({ release: true });
                await measurePhase(restoredHarness, phases, 'restoreInit', () => restoredHarness.initRuntime());
                await measurePhase(restoredHarness, phases, 'snapshotImport', () =>
                    restoredHarness.importSnapshot(snapshot, corpus.capacityHint),
                );
                const restoreQuery = await measurePhase(restoredHarness, phases, 'restoreQuery', () =>
                    restoredHarness.queryBinary(session.sessionId, lexicalQueries[0], {
                        targets: ['chunks'],
                        limit: 8,
                        capacityHint: corpus.capacityHint,
                    }),
                );

                reports.push({
                    corpusId: corpus.id,
                    inputBytes: text.length,
                    lexicalQueries,
                    graphQueries,
                    phases,
                    chunkHits: lexicalQuery.chunkHits.length,
                    graphNodeHits: graphQuery.nodeHits.length,
                    graphEdgeCount: graphDelta.edges.length,
                    stateDocumentCount: state.documents.length,
                    snapshotBytes: snapshot.length,
                    restoredChunkHits: restoreQuery.chunkHits.length,
                });

                console.log(JSON.stringify(reports[reports.length - 1], null, 2));

                assertBudget(corpus.budget, phases, snapshot.length);
                expect(lexicalQuery.chunkHits.length).toBeGreaterThan(0);
                expect(graphDelta.edges.length).toBeGreaterThan(0);
                expect(state.documents.length).toBeGreaterThan(0);
                expect(restoreQuery.chunkHits.length).toBeGreaterThan(0);
            }

            console.log(JSON.stringify(reports, null, 2));
        },
        900_000,
    );
});

async function measurePhase<T>(
    harness: PhoenixWasmHarness,
    phases: PhaseMetrics[],
    name: string,
    fn: () => T,
): Promise<T> {
    const memoryBeforeBytes = harness.memoryByteLength();
    const started = performance.now();
    const result = fn();
    const wallMs = performance.now() - started;
    const memoryAfterBytes = harness.memoryByteLength();
    phases.push({
        name,
        wallMs,
        memoryBeforeBytes,
        memoryAfterBytes,
        memoryDeltaBytes: memoryAfterBytes - memoryBeforeBytes,
        memoryAfterPages: harness.memoryPageCount(),
    });
    return result;
}

function selectLexicalQueries(text: string): string[] {
    const lower = text.toLowerCase();
    const lexical = ['Ryan'];
    if (lower.includes('new rome')) {
        lexical.push('"New Rome"');
    }
    for (const candidate of ['Len', 'Ghoul', 'Augusti', 'Zanbato']) {
        if (lower.includes(candidate.toLowerCase())) {
            lexical.push(candidate);
        }
        if (lexical.length === 3) {
            break;
        }
    }
    return [...new Set(lexical)];
}

function selectGraphQueries(text: string): string[] {
    const lower = text.toLowerCase();
    const names = ['Ryan', 'Len', 'Ghoul', 'Augusti', 'Zanbato'].filter((candidate) =>
        lower.includes(candidate.toLowerCase()),
    );
    if (names.length >= 2) {
        return [`${names[0]} ${names[1]}`];
    }
    if (lower.includes('meta-gang')) {
        return ['"Meta-Gang"'];
    }
    return [names[0] ?? 'Ryan'];
}

function assertBudget(budget: CorpusBudget, phases: PhaseMetrics[], snapshotBytes: number): void {
    const phase = (name: string): PhaseMetrics => {
        const found = phases.find((entry) => entry.name === name);
        expect(found, `missing phase ${name}`).toBeDefined();
        return found as PhaseMetrics;
    };

    expect(phase('analyzeText').wallMs).toBeLessThanOrEqual(budget.maxAnalyzeMs);
    expect(phase('analyzeText').memoryDeltaBytes).toBeLessThanOrEqual(
        budget.maxAnalyzeMemoryDeltaBytes,
    );
    expect(phase('ingest').wallMs).toBeLessThanOrEqual(budget.maxIngestMs);
    expect(phase('ingest').memoryDeltaBytes).toBeLessThanOrEqual(
        budget.maxIngestMemoryDeltaBytes,
    );
    expect(phase('ingest').memoryAfterBytes).toBeLessThanOrEqual(
        budget.maxPostIngestMemoryBytes,
    );
    expect(phase('lexicalQuery').wallMs).toBeLessThanOrEqual(budget.maxLexicalQueryMs);
    expect(phase('graphQuery').wallMs).toBeLessThanOrEqual(budget.maxGraphQueryMs);
    expect(phase('graphDelta').wallMs).toBeLessThanOrEqual(budget.maxGraphDeltaMs);
    expect(phase('snapshotExport').wallMs).toBeLessThanOrEqual(budget.maxExportMs);
    expect(phase('snapshotImport').wallMs).toBeLessThanOrEqual(budget.maxImportMs);
    expect(phase('restoreQuery').wallMs).toBeLessThanOrEqual(budget.maxRestoreQueryMs);
    expect(phase('restoreQuery').memoryAfterBytes).toBeLessThanOrEqual(budget.maxFinalMemoryBytes);
    expect(snapshotBytes).toBeLessThanOrEqual(budget.maxSnapshotBytes);
}
