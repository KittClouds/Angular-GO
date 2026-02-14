import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
    RetrievalService,
    type BlockSearchResult,
    type NoteSearchResult,
    type WsNodeJsonResult,
    type EpisodePayloadResult,
    type FolderMetadataResult,
} from './retrieval.service';
import { QueryRunnerService } from './query-runner.service';

describe('RetrievalService', () => {
    let service: RetrievalService;
    let queryRunnerMock: any;

    beforeEach(() => {
        vi.clearAllMocks();

        queryRunnerMock = {
            runRO: vi.fn(),
        };

        service = new RetrievalService(queryRunnerMock);
    });

    afterEach(() => vi.restoreAllMocks());

    // =========================================================================
    // searchBlocksFTS
    // =========================================================================

    describe('searchBlocksFTS', () => {
        it('returns mapped results on success', async () => {
            queryRunnerMock.runRO.mockResolvedValue({
                ok: true,
                rows: [
                    ['b1', 'The dragon breathes fire', 2.5],
                    ['b2', 'The knight fights', 1.2],
                ],
            });

            const results = await service.searchBlocksFTS('dragon');

            expect(results).toHaveLength(2);
            expect(results[0]).toEqual({ blockId: 'b1', text: 'The dragon breathes fire', score: 2.5 });
            expect(queryRunnerMock.runRO).toHaveBeenCalledOnce();
        });

        it('returns empty array on failure', async () => {
            queryRunnerMock.runRO.mockResolvedValue({ ok: false, error: 'no index' });

            const results = await service.searchBlocksFTS('dragon');

            expect(results).toEqual([]);
        });

        it('caps limit at 50', async () => {
            queryRunnerMock.runRO.mockResolvedValue({ ok: true, rows: [] });

            await service.searchBlocksFTS('query', 999);

            // Verify the script contains :limit 50
            const script: string = queryRunnerMock.runRO.mock.calls[0][0];
            expect(script).toContain(':limit 50');
        });
    });

    // =========================================================================
    // searchNotesRegex
    // =========================================================================

    describe('searchNotesRegex', () => {
        it('returns mapped results on success', async () => {
            queryRunnerMock.runRO.mockResolvedValue({
                ok: true,
                rows: [
                    ['note_1', 'Dragon Lore', 'fire-breathing'],
                    ['note_2', 'Geography', 'volcanoes'],
                ],
            });

            const results = await service.searchNotesRegex('fire|volcano');

            expect(results).toHaveLength(2);
            expect(results[0]).toEqual({
                noteId: 'note_1',
                title: 'Dragon Lore',
                snippet: 'fire-breathing',
            });
        });

        it('passes pattern as $pattern parameter', async () => {
            queryRunnerMock.runRO.mockResolvedValue({ ok: true, rows: [] });

            await service.searchNotesRegex('\\bdragon\\b');

            const params: Record<string, unknown> = queryRunnerMock.runRO.mock.calls[0][1];
            expect(params.pattern).toBe('\\bdragon\\b');
        });

        it('returns empty array for empty pattern', async () => {
            const results = await service.searchNotesRegex('');

            expect(results).toEqual([]);
            expect(queryRunnerMock.runRO).not.toHaveBeenCalled();
        });

        it('returns empty array on query failure', async () => {
            queryRunnerMock.runRO.mockResolvedValue({ ok: false, error: 'invalid regex' });

            const results = await service.searchNotesRegex('[invalid');

            expect(results).toEqual([]);
        });

        it('truncates snippets to 200 chars', async () => {
            const longMatch = 'x'.repeat(500);
            queryRunnerMock.runRO.mockResolvedValue({
                ok: true,
                rows: [['n1', 'Title', longMatch]],
            });

            const results = await service.searchNotesRegex('x+');

            expect(results[0].snippet).toHaveLength(200);
        });

        it('caps limit at 50', async () => {
            queryRunnerMock.runRO.mockResolvedValue({ ok: true, rows: [] });

            await service.searchNotesRegex('pattern', 100);

            const script: string = queryRunnerMock.runRO.mock.calls[0][0];
            expect(script).toContain(':limit 50');
        });

        it('uses regex_matches in the Datalog script', async () => {
            queryRunnerMock.runRO.mockResolvedValue({ ok: true, rows: [] });

            await service.searchNotesRegex('test');

            const script: string = queryRunnerMock.runRO.mock.calls[0][0];
            expect(script).toContain('regex_matches(content, $pattern)');
        });
    });

    // =========================================================================
    // searchBlocksRegex
    // =========================================================================

    describe('searchBlocksRegex', () => {
        it('returns mapped results on success', async () => {
            queryRunnerMock.runRO.mockResolvedValue({
                ok: true,
                rows: [
                    ['b10', 'The dragon roars', 1.0],
                ],
            });

            const results = await service.searchBlocksRegex('dragon');

            expect(results).toHaveLength(1);
            expect(results[0]).toEqual({ blockId: 'b10', text: 'The dragon roars', score: 1.0 });
        });

        it('returns empty array for empty pattern', async () => {
            const results = await service.searchBlocksRegex('');

            expect(results).toEqual([]);
            expect(queryRunnerMock.runRO).not.toHaveBeenCalled();
        });

        it('returns empty array on failure', async () => {
            queryRunnerMock.runRO.mockResolvedValue({ ok: false, error: 'bad regex' });

            const results = await service.searchBlocksRegex('(unclosed');

            expect(results).toEqual([]);
        });

        it('uses regex_matches in the Datalog script', async () => {
            queryRunnerMock.runRO.mockResolvedValue({ ok: true, rows: [] });

            await service.searchBlocksRegex('\\d+');

            const script: string = queryRunnerMock.runRO.mock.calls[0][0];
            expect(script).toContain('regex_matches(text, $pattern)');
        });

        it('assigns score = 1.0 for all matches', async () => {
            queryRunnerMock.runRO.mockResolvedValue({
                ok: true,
                rows: [
                    ['b1', 'match one', 1.0],
                    ['b2', 'match two', 1.0],
                ],
            });

            const results = await service.searchBlocksRegex('match');

            expect(results.every(r => r.score === 1.0)).toBe(true);
        });
    });
});

// =============================================================================
// World-Scoped + JSON Path Queries
// =============================================================================

describe('RetrievalService — World-Scoped + JSON', () => {
    let service: RetrievalService;
    let queryRunnerMock: any;

    beforeEach(() => {
        vi.clearAllMocks();

        queryRunnerMock = {
            runRO: vi.fn(),
        };

        service = new RetrievalService(queryRunnerMock);
    });

    afterEach(() => vi.restoreAllMocks());

    // =========================================================================
    // searchNotesInWorld
    // =========================================================================

    describe('searchNotesInWorld', () => {
        it('returns world-scoped results', async () => {
            queryRunnerMock.runRO.mockResolvedValue({
                ok: true,
                rows: [
                    ['n1', 'Dragon Lore', 'Fire-breathers of...'],
                ],
            });

            const results = await service.searchNotesInWorld('world-1', 'dragon');

            expect(results).toHaveLength(1);
            expect(results[0]).toEqual({
                noteId: 'n1',
                title: 'Dragon Lore',
                snippet: 'Fire-breathers of...',
            });
        });

        it('passes world_id as parameter', async () => {
            queryRunnerMock.runRO.mockResolvedValue({ ok: true, rows: [] });

            await service.searchNotesInWorld('world-42', 'test');

            const params = queryRunnerMock.runRO.mock.calls[0][1];
            expect(params.world_id).toBe('world-42');
            expect(params.query).toBe('test');
        });

        it('uses world_id filter in script', async () => {
            queryRunnerMock.runRO.mockResolvedValue({ ok: true, rows: [] });

            await service.searchNotesInWorld('w1', 'fire');

            const script: string = queryRunnerMock.runRO.mock.calls[0][0];
            expect(script).toContain('world_id == $world_id');
        });

        it('returns empty for missing worldId', async () => {
            const results = await service.searchNotesInWorld('', 'test');
            expect(results).toEqual([]);
            expect(queryRunnerMock.runRO).not.toHaveBeenCalled();
        });

        it('returns empty for missing query', async () => {
            const results = await service.searchNotesInWorld('w1', '');
            expect(results).toEqual([]);
            expect(queryRunnerMock.runRO).not.toHaveBeenCalled();
        });

        it('returns empty on failure', async () => {
            queryRunnerMock.runRO.mockResolvedValue({ ok: false, error: 'fail' });

            const results = await service.searchNotesInWorld('w1', 'test');
            expect(results).toEqual([]);
        });
    });

    // =========================================================================
    // queryWorkspaceNodesJson
    // =========================================================================

    describe('queryWorkspaceNodesJson', () => {
        it('extracts JSON path value from ws_node', async () => {
            queryRunnerMock.runRO.mockResolvedValue({
                ok: true,
                rows: [
                    ['node_1', 'claim', { text: 'Alice is a spy', confidence: 0.9 }, 0.9],
                ],
            });

            const results = await service.queryWorkspaceNodesJson('ws-1', 'confidence');

            expect(results).toHaveLength(1);
            expect(results[0]).toEqual({
                nodeId: 'node_1',
                kind: 'claim',
                json: { text: 'Alice is a spy', confidence: 0.9 },
                matchedValue: 0.9,
            });
        });

        it('uses get() in the Datalog script', async () => {
            queryRunnerMock.runRO.mockResolvedValue({ ok: true, rows: [] });

            await service.queryWorkspaceNodesJson('ws-1', 'confidence');

            const script: string = queryRunnerMock.runRO.mock.calls[0][0];
            expect(script).toContain('get(json_blob, $path, null)');
        });

        it('passes value filter when provided', async () => {
            queryRunnerMock.runRO.mockResolvedValue({ ok: true, rows: [] });

            await service.queryWorkspaceNodesJson('ws-1', 'status', 'active');

            const params = queryRunnerMock.runRO.mock.calls[0][1];
            expect(params.value).toBe('active');

            const script: string = queryRunnerMock.runRO.mock.calls[0][0];
            expect(script).toContain('matched == json($value)');
        });

        it('omits value filter when not provided', async () => {
            queryRunnerMock.runRO.mockResolvedValue({ ok: true, rows: [] });

            await service.queryWorkspaceNodesJson('ws-1', 'text');

            const script: string = queryRunnerMock.runRO.mock.calls[0][0];
            expect(script).not.toContain('$value');
        });

        it('returns empty for missing workspaceId', async () => {
            const results = await service.queryWorkspaceNodesJson('', 'key');
            expect(results).toEqual([]);
            expect(queryRunnerMock.runRO).not.toHaveBeenCalled();
        });

        it('returns empty for missing jsonPath', async () => {
            const results = await service.queryWorkspaceNodesJson('ws-1', '');
            expect(results).toEqual([]);
            expect(queryRunnerMock.runRO).not.toHaveBeenCalled();
        });

        it('returns empty on failure', async () => {
            queryRunnerMock.runRO.mockResolvedValue({ ok: false, error: 'bad path' });

            const results = await service.queryWorkspaceNodesJson('ws-1', 'x');
            expect(results).toEqual([]);
        });
    });

    // =========================================================================
    // queryEpisodesByPayload
    // =========================================================================

    describe('queryEpisodesByPayload', () => {
        it('extracts payload key from episodes', async () => {
            queryRunnerMock.runRO.mockResolvedValue({
                ok: true,
                rows: [
                    ['scope_1', 'note_1', 1700000000, 'rlm_query_executed', 'ws_abc'],
                ],
            });

            const results = await service.queryEpisodesByPayload('scope_1', 'workspace_id');

            expect(results).toHaveLength(1);
            expect(results[0]).toEqual({
                scopeId: 'scope_1',
                noteId: 'note_1',
                ts: 1700000000,
                actionType: 'rlm_query_executed',
                payloadValue: 'ws_abc',
            });
        });

        it('uses maybe_get in the Datalog script', async () => {
            queryRunnerMock.runRO.mockResolvedValue({ ok: true, rows: [] });

            await service.queryEpisodesByPayload('s1', 'workspace_id');

            const script: string = queryRunnerMock.runRO.mock.calls[0][0];
            expect(script).toContain('maybe_get(payload, $key)');
        });

        it('passes value filter when provided', async () => {
            queryRunnerMock.runRO.mockResolvedValue({ ok: true, rows: [] });

            await service.queryEpisodesByPayload('s1', 'workspace_id', 'ws-target');

            const params = queryRunnerMock.runRO.mock.calls[0][1];
            expect(params.value).toBe('ws-target');
        });

        it('returns empty for missing scopeId', async () => {
            const results = await service.queryEpisodesByPayload('', 'key');
            expect(results).toEqual([]);
            expect(queryRunnerMock.runRO).not.toHaveBeenCalled();
        });

        it('returns empty for missing payloadKey', async () => {
            const results = await service.queryEpisodesByPayload('s1', '');
            expect(results).toEqual([]);
        });

        it('returns empty on failure', async () => {
            queryRunnerMock.runRO.mockResolvedValue({ ok: false, error: 'err' });

            const results = await service.queryEpisodesByPayload('s1', 'x');
            expect(results).toEqual([]);
        });
    });

    // =========================================================================
    // searchFoldersMetadata
    // =========================================================================

    describe('searchFoldersMetadata', () => {
        it('extracts metadata key from folders', async () => {
            queryRunnerMock.runRO.mockResolvedValue({
                ok: true,
                rows: [
                    ['f1', 'Characters', 'value-1'],
                ],
            });

            const results = await service.searchFoldersMetadata('world-1', 'customProp');

            expect(results).toHaveLength(1);
            expect(results[0]).toEqual({
                folderId: 'f1',
                name: 'Characters',
                metaValue: 'value-1',
            });
        });

        it('uses maybe_get in the Datalog script', async () => {
            queryRunnerMock.runRO.mockResolvedValue({ ok: true, rows: [] });

            await service.searchFoldersMetadata('w1', 'icon');

            const script: string = queryRunnerMock.runRO.mock.calls[0][0];
            expect(script).toContain('maybe_get(metadata, $key)');
        });

        it('filters by world_id', async () => {
            queryRunnerMock.runRO.mockResolvedValue({ ok: true, rows: [] });

            await service.searchFoldersMetadata('world-42', 'theme');

            const params = queryRunnerMock.runRO.mock.calls[0][1];
            expect(params.world_id).toBe('world-42');
        });

        it('returns empty for missing worldId', async () => {
            const results = await service.searchFoldersMetadata('', 'key');
            expect(results).toEqual([]);
            expect(queryRunnerMock.runRO).not.toHaveBeenCalled();
        });

        it('returns empty for missing metaKey', async () => {
            const results = await service.searchFoldersMetadata('w1', '');
            expect(results).toEqual([]);
        });

        it('returns empty on failure', async () => {
            queryRunnerMock.runRO.mockResolvedValue({ ok: false, error: 'no relation' });

            const results = await service.searchFoldersMetadata('w1', 'key');
            expect(results).toEqual([]);
        });
    });
});

// =============================================================================
// Entity Graph + Folder Ancestor Queries (for AppContext)
// =============================================================================

describe('RetrievalService — Entity Graph + Folders', () => {
    let service: RetrievalService;
    let queryRunnerMock: any;

    beforeEach(() => {
        vi.clearAllMocks();

        queryRunnerMock = {
            runRO: vi.fn(),
        };

        service = new RetrievalService(queryRunnerMock);
    });

    afterEach(() => vi.restoreAllMocks());

    // =========================================================================
    // getEntitiesByNarrative
    // =========================================================================

    describe('getEntitiesByNarrative', () => {
        it('returns entities scoped to a narrative', async () => {
            queryRunnerMock.runRO.mockResolvedValue({
                ok: true,
                rows: [
                    ['e1', 'Red Dragon', 'creature', 'dragon'],
                    ['e2', 'Alice', 'person', null],
                ],
            });

            const results = await service.getEntitiesByNarrative('narr-1');

            expect(results).toHaveLength(2);
            expect(results[0]).toEqual({
                id: 'e1',
                label: 'Red Dragon',
                kind: 'creature',
                subtype: 'dragon',
            });
            expect(results[1]).toEqual({
                id: 'e2',
                label: 'Alice',
                kind: 'person',
                subtype: null,
            });
        });

        it('passes narrative_id as parameter', async () => {
            queryRunnerMock.runRO.mockResolvedValue({ ok: true, rows: [] });

            await service.getEntitiesByNarrative('narr-42');

            const params = queryRunnerMock.runRO.mock.calls[0][1];
            expect(params.narrative_id).toBe('narr-42');
        });

        it('queries the entities relation', async () => {
            queryRunnerMock.runRO.mockResolvedValue({ ok: true, rows: [] });

            await service.getEntitiesByNarrative('narr-1');

            const script: string = queryRunnerMock.runRO.mock.calls[0][0];
            expect(script).toContain('*entities{');
            expect(script).toContain('narrative_id == $narrative_id');
        });

        it('returns empty for missing narrativeId', async () => {
            const results = await service.getEntitiesByNarrative('');
            expect(results).toEqual([]);
            expect(queryRunnerMock.runRO).not.toHaveBeenCalled();
        });

        it('returns empty on failure', async () => {
            queryRunnerMock.runRO.mockResolvedValue({ ok: false, error: 'fail' });

            const results = await service.getEntitiesByNarrative('narr-1');
            expect(results).toEqual([]);
        });

        it('caps limit at 50', async () => {
            queryRunnerMock.runRO.mockResolvedValue({ ok: true, rows: [] });

            await service.getEntitiesByNarrative('narr-1', 999);

            const script: string = queryRunnerMock.runRO.mock.calls[0][0];
            expect(script).toContain(':limit 50');
        });
    });

    // =========================================================================
    // getEntityNeighbors
    // =========================================================================

    describe('getEntityNeighbors', () => {
        it('returns 1-hop neighbors', async () => {
            queryRunnerMock.runRO.mockResolvedValue({
                ok: true,
                rows: [
                    ['e2', 'Alice', 'person', null],
                    ['e3', 'Sword', 'item', 'weapon'],
                ],
            });

            const results = await service.getEntityNeighbors('e1');

            expect(results).toHaveLength(2);
            expect(results[0]).toEqual({
                id: 'e2',
                label: 'Alice',
                kind: 'person',
                subtype: null,
            });
        });

        it('uses entity_edge for both directions', async () => {
            queryRunnerMock.runRO.mockResolvedValue({ ok: true, rows: [] });

            await service.getEntityNeighbors('e1');

            const script: string = queryRunnerMock.runRO.mock.calls[0][0];
            // Outgoing
            expect(script).toContain('*entity_edge{source_id, target_id: neighbor_id}');
            // Incoming
            expect(script).toContain('*entity_edge{target_id, source_id: neighbor_id}');
        });

        it('passes entity_id as parameter', async () => {
            queryRunnerMock.runRO.mockResolvedValue({ ok: true, rows: [] });

            await service.getEntityNeighbors('e42');

            const params = queryRunnerMock.runRO.mock.calls[0][1];
            expect(params.entity_id).toBe('e42');
        });

        it('returns empty for missing entityId', async () => {
            const results = await service.getEntityNeighbors('');
            expect(results).toEqual([]);
            expect(queryRunnerMock.runRO).not.toHaveBeenCalled();
        });

        it('returns empty on failure', async () => {
            queryRunnerMock.runRO.mockResolvedValue({ ok: false, error: 'bad' });

            const results = await service.getEntityNeighbors('e1');
            expect(results).toEqual([]);
        });

        it('caps limit at 30', async () => {
            queryRunnerMock.runRO.mockResolvedValue({ ok: true, rows: [] });

            await service.getEntityNeighbors('e1', 999);

            const script: string = queryRunnerMock.runRO.mock.calls[0][0];
            expect(script).toContain(':limit 30');
        });
    });

    // =========================================================================
    // getFolderAncestors
    // =========================================================================

    describe('getFolderAncestors', () => {
        it('returns ancestor names in order', async () => {
            queryRunnerMock.runRO.mockResolvedValue({
                ok: true,
                rows: [
                    ['Characters', 1],
                    ['Root', 2],
                ],
            });

            const results = await service.getFolderAncestors('folder-leaf');

            expect(results).toEqual(['Characters', 'Root']);
        });

        it('uses recursive Datalog with folder_hierarchy', async () => {
            queryRunnerMock.runRO.mockResolvedValue({ ok: true, rows: [] });

            await service.getFolderAncestors('f1');

            const script: string = queryRunnerMock.runRO.mock.calls[0][0];
            expect(script).toContain('*folder_hierarchy');
            expect(script).toContain('ancestor');
            expect(script).toContain(':order depth');
        });

        it('passes folder_id as parameter', async () => {
            queryRunnerMock.runRO.mockResolvedValue({ ok: true, rows: [] });

            await service.getFolderAncestors('folder-42');

            const params = queryRunnerMock.runRO.mock.calls[0][1];
            expect(params.folder_id).toBe('folder-42');
        });

        it('returns empty for missing folderId', async () => {
            const results = await service.getFolderAncestors('');
            expect(results).toEqual([]);
            expect(queryRunnerMock.runRO).not.toHaveBeenCalled();
        });

        it('returns empty on failure', async () => {
            queryRunnerMock.runRO.mockResolvedValue({ ok: false, error: 'no hierarchy' });

            const results = await service.getFolderAncestors('f1');
            expect(results).toEqual([]);
        });

        it('caps maxDepth at 20', async () => {
            queryRunnerMock.runRO.mockResolvedValue({ ok: true, rows: [] });

            await service.getFolderAncestors('f1', 100);

            const script: string = queryRunnerMock.runRO.mock.calls[0][0];
            expect(script).toContain('depth <= 20');
        });
    });
});
