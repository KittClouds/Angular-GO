import { describe, it, expect, vi, beforeEach } from 'vitest';
import { FtsService } from './FtsService';
import { cozoDb } from '../db';
import * as FtsSchema from './FtsSchema';

// Mock logging to avoid extra DB calls
vi.mock('../memory/EpisodeLogService', () => ({
    recordAction: vi.fn(),
}));

// Mock dependencies
vi.mock('../db', () => ({
    cozoDb: {
        run: vi.fn(),
    },
}));

vi.mock('./FtsSchema', async (importOriginal) => {
    const actual = await importOriginal<typeof FtsSchema>();
    return {
        ...actual,
        createFtsIndexes: vi.fn(),
    };
});

describe('FtsService', () => {
    let service: FtsService;

    beforeEach(() => {
        vi.clearAllMocks();
        service = new FtsService();
    });

    describe('initialize', () => {
        it('should initialize indexes via createFtsIndexes', () => {
            const mockStatus = {
                blocksFts: true,
                notesFts: true,
                notesContentFts: true,
            };
            vi.spyOn(FtsSchema, 'createFtsIndexes').mockReturnValue(mockStatus);

            const status = service.initialize();

            expect(FtsSchema.createFtsIndexes).toHaveBeenCalled();
            expect(status).toEqual(mockStatus);
            expect(service.getIndexStatus()).toEqual(mockStatus);
        });

        it('should be idempotent', () => {
            vi.spyOn(FtsSchema, 'createFtsIndexes').mockReturnValue({
                blocksFts: true,
                notesFts: true,
                notesContentFts: true,
            });

            service.initialize();
            service.initialize();

            expect(FtsSchema.createFtsIndexes).toHaveBeenCalledTimes(1);
        });
    });

    describe('searchBlocks', () => {
        it('should use FTS query when index is available', () => {
            // Setup initialized state with FTS available
            vi.spyOn(FtsSchema, 'createFtsIndexes').mockReturnValue({
                blocksFts: true,
                notesFts: true,
                notesContentFts: true,
            });
            service.initialize();

            // Mock FTS result
            const mockRows = [['block-1', 'note-1', 'text content', 0.8]];
            vi.spyOn(cozoDb, 'run').mockReturnValue(JSON.stringify({ ok: true, rows: mockRows }));

            const results = service.searchBlocks({ query: 'test' });

            expect(cozoDb.run).toHaveBeenCalledWith(
                expect.stringContaining('blocks:blocks_fts'), // Should use FTS index
                expect.objectContaining({ query: 'test' })
            );
            expect(results).toHaveLength(1);
            expect(results[0].blockId).toBe('block-1');
        });

        it('should fallback to Regex when FTS index is missing', () => {
            // Setup initialized state with NO FTS
            vi.spyOn(FtsSchema, 'createFtsIndexes').mockReturnValue({
                blocksFts: false,
                notesFts: false,
                notesContentFts: false,
            });
            service.initialize();

            // Mock Regex result
            const mockRows = [['block-1', 'note-1', 'text content']]; // Regex result has no score
            vi.spyOn(cozoDb, 'run').mockReturnValue(JSON.stringify({ ok: true, rows: mockRows }));

            const results = service.searchBlocks({ query: 'test' });

            // Should NOT call FTS query (which usually has ::fts or specific query structure)
            // But checking the query string is fragile. 
            // Better to check that it called the regex query structure.
            expect(cozoDb.run).toHaveBeenCalledWith(
                expect.stringContaining('*blocks'), // Regex query scans base table
                expect.objectContaining({ pattern: '(?i)test' })
            );
            expect(results).toHaveLength(1);
            expect(results[0].score).toBe(1.0); // Default regex score
        });

        it('should fallback to Regex when FTS returns no results', () => {
            // Setup initialized state WITH FTS
            vi.spyOn(FtsSchema, 'createFtsIndexes').mockReturnValue({
                blocksFts: true,
                notesFts: true,
                notesContentFts: true,
            });
            service.initialize();

            // Mock FTS result (empty) then Regex result (match)
            vi.spyOn(cozoDb, 'run')
                .mockReturnValueOnce(JSON.stringify({ ok: true, rows: [] })) // FTS
                .mockReturnValueOnce(JSON.stringify({ ok: true, rows: [['block-1', 'note-1', 'regex match']] })); // Regex query

            const results = service.searchBlocks({ query: 'test' });

            expect(cozoDb.run).toHaveBeenCalledTimes(2);
            expect(results).toHaveLength(1);
            expect(results[0].text).toBe('regex match');
        });
    });

    describe('searchNotes', () => {
        it('should use Combined FTS when both indexes available', () => {
            vi.spyOn(FtsSchema, 'createFtsIndexes').mockReturnValue({
                blocksFts: true,
                notesFts: true,
                notesContentFts: true,
            });
            service.initialize();

            vi.spyOn(cozoDb, 'run').mockReturnValue(JSON.stringify({
                ok: true,
                rows: [['note-1', 'Title', 'Content', 0.9]]
            }));

            const results = service.searchNotes({ query: 'test' });

            expect(results).toHaveLength(1);
            expect(results[0].title).toBe('Title');
            // Verify query used (checking for 'searchNotesCombined' characteristics or simply that it ran)
            expect(cozoDb.run).toHaveBeenCalled();
        });

        it('should fallback to Regex if FTS disabled', () => {
            vi.spyOn(FtsSchema, 'createFtsIndexes').mockReturnValue({
                blocksFts: false,
                notesFts: false,
                notesContentFts: false,
            });
            service.initialize();

            vi.spyOn(cozoDb, 'run').mockReturnValue(JSON.stringify({
                ok: true,
                rows: [['note-1', 'Title', 'Content']]
            }));

            service.searchNotes({ query: 'test' });

            expect(cozoDb.run).toHaveBeenCalledWith(
                expect.any(String),
                expect.objectContaining({ pattern: '(?i)test' })
            );
        });
    });

    describe('hybridSearch', () => {
        it('should return empty if FTS not available', () => {
            vi.spyOn(FtsSchema, 'createFtsIndexes').mockReturnValue({
                blocksFts: false,
                notesFts: false,
                notesContentFts: false,
            });
            service.initialize();

            const results = service.hybridSearch({
                query: 'test',
                queryVector: [0.1, 0.2]
            });

            expect(results).toEqual([]);
            expect(cozoDb.run).not.toHaveBeenCalled();
        });

        it('should run hybrid query if FTS available', () => {
            vi.spyOn(FtsSchema, 'createFtsIndexes').mockReturnValue({
                blocksFts: true,
                notesFts: true,
                notesContentFts: true,
            });
            service.initialize();

            vi.spyOn(cozoDb, 'run').mockReturnValue(JSON.stringify({
                ok: true,
                rows: [['block-1', 'note-1', 'Text', 0.85]]
            }));

            const vec = [0.1, 0.2];
            service.hybridSearch({
                query: 'test',
                queryVector: vec
            });

            expect(cozoDb.run).toHaveBeenCalledWith(
                expect.any(String),
                expect.objectContaining({
                    query: 'test',
                    query_vector: vec
                })
            );
        });
    });
});
