import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock NoteEditorStore to prevent Angular JIT compilation errors
vi.mock('../lib/store/note-editor.store', () => ({
    NoteEditorStore: vi.fn(),
}));

import { OrchestratorService } from './orchestrator.service';
import { GoogleGenAIService } from '../lib/services/google-genai.service';
import { OpenRouterService } from '../lib/services/openrouter.service';
import { RlmLoopService, RlmLlmService, type RLMLoopResult } from '../lib/rlm';

describe('OrchestratorService', () => {
    let service: OrchestratorService;
    let googleGenAiMock: any;
    let openRouterMock: any;
    let rlmServiceMock: any;
    let rlmLlmMock: any;
    let noteEditorStoreMock: any;
    let retrievalServiceMock: any;

    beforeEach(() => {
        googleGenAiMock = {} as unknown as GoogleGenAIService;

        // OpenRouter configured by default
        openRouterMock = {
            getApiKey: vi.fn(() => 'sk-test-key'),
        } as unknown as OpenRouterService;

        rlmServiceMock = {
            run: vi.fn(),
        } as unknown as RlmLoopService;

        rlmLlmMock = {
            isConfigured: vi.fn(() => true),
        } as unknown as RlmLlmService;

        // NoteEditorStore — no note open by default
        noteEditorStoreMock = {
            activeNoteId: vi.fn(() => null),
            currentNote: vi.fn(() => undefined),
        };

        // RetrievalService
        retrievalServiceMock = {
            getFolderAncestors: vi.fn(async () => []),
            getEntitiesByNarrative: vi.fn(async () => []),
            getEntityNeighbors: vi.fn(async () => []),
        };

        service = new OrchestratorService(
            googleGenAiMock,
            openRouterMock,
            rlmServiceMock,
            rlmLlmMock,
            noteEditorStoreMock,
            retrievalServiceMock,
        );
    });

    it('should format RLM context with timing, result, and reasoning', async () => {
        const mockResult: RLMLoopResult = {
            ok: true,
            output: 'The answer is 42.',
            steps: [
                { type: 'observe', nodeId: 'obs_1', ok: true, latMs: 10, result: { entities: [], notes: [], blocks: [], contextSummary: 'empty' } } as any,
                { type: 'plan', nodeId: 'plan_1', ok: true, latMs: 10, result: { reasoning: 'Building plan' } } as any,
                { type: 'execute', nodeId: 'exec_1', ok: true, latMs: 20 } as any,
                { type: 'evaluate', nodeId: 'eval_1', ok: true, latMs: 5, result: { reason: 'Found direct answer' } } as any,
            ],
            evaluation: {
                complete: true,
                shouldRecurse: false,
                reason: 'Found direct answer',
                confidence: 0.9,
                metrics: {} as any,
            },
            totalLatMs: 100,
        };

        rlmServiceMock.run.mockResolvedValue(mockResult);

        const result = await service.orchestrate('What is the answer?', 'thread-123');

        // Header
        expect(result).toContain('[RLM Context gathered in');
        // Result section
        expect(result).toContain('Result: The answer is 42.');
        // Evaluation
        expect(result).toContain('Reasoning: Found direct answer');
        expect(result).toContain('Confidence: 0.9');
        // Reasoning trace
        expect(result).toContain('[OBSERVE]');
        expect(result).toContain('[PLAN]');
        // Footer
        expect(result).toContain('[End Context]');
        // Verify RLM was called with correct params
        expect(rlmServiceMock.run).toHaveBeenCalledWith(expect.objectContaining({
            threadId: 'thread-123',
            initialPrompt: 'What is the answer?',
            maxDepth: 2,
        }));
    });

    it('should return empty string if prompt is empty', async () => {
        const result = await service.orchestrate('   ', 'thread-123');
        expect(result).toBe('');
        expect(rlmServiceMock.run).not.toHaveBeenCalled();
    });

    it('should return empty string if OpenRouter is not configured', async () => {
        openRouterMock.getApiKey.mockReturnValue(null);

        const result = await service.orchestrate('Hello world', 'thread-123');
        expect(result).toBe('');
        expect(rlmServiceMock.run).not.toHaveBeenCalled();
    });

    it('should return empty string if RLM loop fails', async () => {
        const mockResult: RLMLoopResult = {
            ok: false,
            error: 'Something went wrong',
            steps: [],
            totalLatMs: 50,
        };

        rlmServiceMock.run.mockResolvedValue(mockResult);

        const result = await service.orchestrate('Failing prompt', 'thread-123');
        expect(result).toBe('');
    });

    it('should handle exceptions gracefully', async () => {
        rlmServiceMock.run.mockRejectedValue(new Error('Critical failure'));

        const result = await service.orchestrate('Crash prompt', 'thread-123');
        expect(result).toBe('');
    });

    it('should use maxDepth of 2 for cost safety', async () => {
        rlmServiceMock.run.mockResolvedValue({
            ok: true,
            output: 'Done',
            steps: [],
            totalLatMs: 10,
        });

        await service.orchestrate('Test', 'thread-1');

        expect(rlmServiceMock.run).toHaveBeenCalledWith(
            expect.objectContaining({ maxDepth: 2 }),
        );
    });

    // =========================================================================
    // AppContext Integration
    // =========================================================================

    it('should pass appContext=undefined when no note is open', async () => {
        noteEditorStoreMock.activeNoteId.mockReturnValue(null);
        noteEditorStoreMock.currentNote.mockReturnValue(undefined);

        rlmServiceMock.run.mockResolvedValue({
            ok: true, output: 'ok', steps: [], totalLatMs: 5,
        });

        await service.orchestrate('Test', 'thread-1');

        expect(rlmServiceMock.run).toHaveBeenCalledWith(
            expect.objectContaining({ appContext: undefined }),
        );
    });

    it('should populate appContext when a note is open', async () => {
        noteEditorStoreMock.activeNoteId.mockReturnValue('note-42');
        noteEditorStoreMock.currentNote.mockReturnValue({
            id: 'note-42',
            title: 'Dragon Lore',
            worldId: 'world-1',
            narrativeId: 'narr-1',
            folderId: 'folder-chars',
            markdownContent: 'The dragon breathes fire across the mountains...',
        });

        retrievalServiceMock.getFolderAncestors.mockResolvedValue(['Root', 'Characters']);
        retrievalServiceMock.getEntitiesByNarrative.mockResolvedValue([
            { id: 'e1', label: 'Red Dragon', kind: 'creature', subtype: null },
        ]);

        rlmServiceMock.run.mockResolvedValue({
            ok: true, output: 'ok', steps: [], totalLatMs: 5,
        });

        await service.orchestrate('Tell me about dragons', 'thread-1');

        const ctx = rlmServiceMock.run.mock.calls[0][0];
        expect(ctx.appContext).toBeDefined();
        expect(ctx.appContext.activeNoteId).toBe('note-42');
        expect(ctx.appContext.activeNoteTitle).toBe('Dragon Lore');
        expect(ctx.appContext.worldId).toBe('world-1');
        expect(ctx.appContext.narrativeId).toBe('narr-1');
        expect(ctx.appContext.folderPath).toEqual(['Root', 'Characters']);
        expect(ctx.appContext.nearbyEntities).toHaveLength(1);
        expect(ctx.appContext.nearbyEntities[0].label).toBe('Red Dragon');
    });

    it('should handle retrieval failures gracefully during AppContext gathering', async () => {
        noteEditorStoreMock.activeNoteId.mockReturnValue('note-1');
        noteEditorStoreMock.currentNote.mockReturnValue({
            id: 'note-1',
            title: 'Test',
            worldId: 'w1',
            narrativeId: 'n1',
            folderId: 'f1',
            markdownContent: 'content',
        });

        // Both retrieval calls fail
        retrievalServiceMock.getFolderAncestors.mockRejectedValue(new Error('DB error'));
        retrievalServiceMock.getEntitiesByNarrative.mockRejectedValue(new Error('DB error'));

        rlmServiceMock.run.mockResolvedValue({
            ok: true, output: 'ok', steps: [], totalLatMs: 5,
        });

        await service.orchestrate('Test', 'thread-1');

        // Should still run successfully with empty folder path and entities
        const ctx = rlmServiceMock.run.mock.calls[0][0];
        expect(ctx.appContext).toBeDefined();
        expect(ctx.appContext.activeNoteId).toBe('note-1');
        expect(ctx.appContext.folderPath).toEqual([]);
        expect(ctx.appContext.nearbyEntities).toEqual([]);
    });

    it('should truncate activeNoteSnippet to 200 chars', async () => {
        const longContent = 'x'.repeat(500);
        noteEditorStoreMock.activeNoteId.mockReturnValue('note-1');
        noteEditorStoreMock.currentNote.mockReturnValue({
            id: 'note-1',
            title: 'Long Note',
            worldId: 'w1',
            markdownContent: longContent,
        });

        rlmServiceMock.run.mockResolvedValue({
            ok: true, output: 'ok', steps: [], totalLatMs: 5,
        });

        await service.orchestrate('Test', 'thread-1');

        const ctx = rlmServiceMock.run.mock.calls[0][0];
        expect(ctx.appContext.activeNoteSnippet).toHaveLength(200);
    });
});
