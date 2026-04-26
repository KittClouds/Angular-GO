import { beforeAll, describe, expect, it } from 'vitest';

import { PhoenixWasmHarness } from './phoenix-wasm-harness';

const describeWasmHarness = PhoenixWasmHarness.hasPrebuilt() || PhoenixWasmHarness.shouldBuildFromEnv()
    ? describe
    : describe.skip;

describeWasmHarness('Phoenix WASM shared-memory harness', () => {
    let harness: PhoenixWasmHarness;

    beforeAll(async () => {
        harness = await PhoenixWasmHarness.create();
    }, 120000);

    it('boots, scans, ingests, queries, and restores from snapshot bytes', async () => {
        expect(harness.protocolVersion()).toBe(5);

        const init = harness.initRuntime();
        expect(init.ready).toBe(true);

        const scan = harness.scan('Luffy attacked Zoro.');
        expect(scan.sentences.length).toBe(1);
        expect(scan.tokens.length).toBeGreaterThan(0);

        const analytics = harness.analyzeText('The iron gate slammed shut. The iron gate rattled again.');
        expect(analytics.wordCount).toBeGreaterThan(0);
        expect(analytics.sentenceCount).toBe(2);

        const session = harness.createSession('VitestPhoenix');
        expect(session.sessionId).toContain('session-');

        const ingest = harness.ingest(
            session.sessionId,
            'vitest-doc-1',
            'Vitest Packet Story',
            'Ryan attacked Len. Then Ryan gave Len a blade in Chapter 1.',
        );
        expect(ingest.documentCount).toBe(1);

        const query = harness.queryBinary(session.sessionId, 'Ryan');
        expect(query.sessionId).toBe(session.sessionId);
        expect(query.chunkHits.length).toBeGreaterThan(0);

        const snapshot = harness.exportSnapshot();
        expect(snapshot.byteLength).toBeGreaterThan(0);

        const restoredHarness = await PhoenixWasmHarness.create();
        const restoredInit = restoredHarness.initRuntime();
        expect(restoredInit.ready).toBe(true);

        const importResult = restoredHarness.importSnapshot(snapshot);
        expect(importResult.schemaVersion).toBe('phoenix.cozo.v1');

        const restoredQuery = restoredHarness.queryBinary(session.sessionId, 'Ryan');
        expect(restoredQuery.chunkHits[0]?.chunkId).toBe(query.chunkHits[0]?.chunkId);
    }, 120000);

    it('round-trips graph delta plus binary session state and stats', () => {
        harness.initRuntime();
        const session = harness.createSession('VitestGraph');

        harness.ingest(
            session.sessionId,
            'vitest-doc-graph',
            'Graph Story',
            '# Prologue\nRyan woke up.\n\nChapter 1\nRyan attacked Len. Ryan gave Len a blade.',
        );

        const graph = harness.graphDeltaBinary(session.sessionId, 'vitest-doc-graph');
        expect(graph.sessionId).toBe(session.sessionId);
        expect(graph.chunks.length).toBeGreaterThan(0);
        expect(graph.nodes.length).toBeGreaterThan(0);
        expect(graph.edges.length).toBeGreaterThan(0);

        const state = harness.sessionStateBinary(session.sessionId);
        expect(state.sessionId).toBe(session.sessionId);
        expect(state.documents).toHaveLength(1);
        expect(state.documents[0].documentId).toBe('vitest-doc-graph');
        expect(state.manifestNamespaces).toContain('graptor.documents');

        const stats = harness.sessionStatsBinary(session.sessionId);
        expect(stats.sessionId).toBe(session.sessionId);
        expect(stats.documentCount).toBe(1);
        expect(stats.leafCount).toBeGreaterThan(0);
        expect(stats.graphVertexCount).toBeGreaterThan(0);
        expect(stats.graphEdgeCount).toBeGreaterThan(0);
    }, 120000);

    it('keeps JSON and binary hot requests in parity', () => {
        harness.initRuntime();
        const session = harness.createSession('VitestParity');
        const text = 'Ryan attacked Len. Then Ryan gave Len a blade.';

        const scanJson = harness.scanJson(text, 'scan-json');
        const scanBinary = harness.scanBinary(text, 'scan-bin');
        expect(scanBinary.sentences).toEqual(scanJson.sentences);
        expect(scanBinary.mentions).toEqual(scanJson.mentions);

        const structureJson = harness.structureJson(text, scanJson);
        const structureBinary = harness.structureBinary(text, scanBinary);
        expect(structureBinary.relations).toEqual(structureJson.relations);

        const analyticsJson = harness.analyzeTextJson(text);
        const analyticsBinary = harness.analyzeTextBinary(text);
        expect(analyticsBinary).toEqual(analyticsJson);

        const ingestJson = harness.ingestJson(session.sessionId, 'vitest-parity-json', 'Parity Story', text);
        const ingestBinary = harness.ingestBinary(session.sessionId, 'vitest-parity-bin', 'Parity Story', text);
        expect(ingestBinary.documentCount).toBe(ingestJson.documentCount);
        expect(ingestBinary.chunkStats.totalLeaves).toBeGreaterThan(0);

        const queryJson = harness.queryBinaryJson(session.sessionId, 'Ryan');
        const queryBinary = harness.queryBinaryRequest(session.sessionId, 'Ryan');
        expect(queryBinary.chunkHits).toEqual(queryJson.chunkHits);
        expect(queryBinary.diagnostics).toEqual(queryJson.diagnostics);
    }, 120000);
});
