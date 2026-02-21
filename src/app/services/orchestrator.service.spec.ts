import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock Angular DI
vi.mock('../lib/store/note-editor.store', () => ({
    NoteEditorStore: vi.fn(),
}));

vi.mock('../lib/rlm', () => ({
    RlmOrchestratorService: vi.fn(),
    RlmLlmService: vi.fn(),
}));

vi.mock('./gokitt.service', () => ({
    GoKittService: vi.fn(),
}));

import { OrchestratorService } from './orchestrator.service';

// ============================================================================
// Helpers
// ============================================================================

function makeNoteStore(note: Record<string, unknown> | null = null) {
    return {
        activeNoteId: vi.fn(() => note?.id ?? null),
        currentNote: vi.fn(() => note ?? undefined),
    };
}

function makeOrchestrator(result: Record<string, unknown> = { triggered: false }) {
    return {
        processWithWorkspace: vi.fn(async () => result),
        getContext: vi.fn(async () => ''),
        isActivating: { set: vi.fn() },
        lastActivation: { set: vi.fn() },
    };
}

// ============================================================================
// Tests
// ============================================================================

describe('OrchestratorService', () => {
    let service: OrchestratorService;
    let orchestratorMock: ReturnType<typeof makeOrchestrator>;
    let noteStoreMock: ReturnType<typeof makeNoteStore>;

    beforeEach(() => {
        orchestratorMock = makeOrchestrator({ triggered: false });
        noteStoreMock = makeNoteStore();

        // OrchestratorService now uses inject() internally; construct manually
        service = Object.assign(Object.create(OrchestratorService.prototype), {
            orchestrator: orchestratorMock,
            rlmLlm: { isConfigured: vi.fn(() => true) },
            goKitt: { isReady: true },
            noteEditorStore: noteStoreMock,
        });
    });

    it('returns empty string for empty prompt', async () => {
        const result = await service.orchestrate('   ', 'thread-1');
        expect(result).toBe('');
        expect(orchestratorMock.processWithWorkspace).not.toHaveBeenCalled();
    });

    it('calls processWithWorkspace with correct args when prompt is provided', async () => {
        orchestratorMock.processWithWorkspace.mockResolvedValue({ triggered: false });

        await service.orchestrate('What is Fiora?', 'thread-99', 'narr-1');

        expect(orchestratorMock.processWithWorkspace).toHaveBeenCalledWith(
            'thread-99',
            'narr-1',
            'What is Fiora?'
        );
    });

    it('returns empty string when workspace does not activate', async () => {
        orchestratorMock.processWithWorkspace.mockResolvedValue({ triggered: false });

        const result = await service.orchestrate('Hello', 'thread-1');
        expect(result).toBe('');
    });

    it('returns new_observation when workspace activates', async () => {
        const obs = 'Fiora is a blade champion with high mobility.';
        orchestratorMock.processWithWorkspace.mockResolvedValue({
            triggered: true,
            new_observation: obs,
            miss_reason: 'keyword miss on fiora',
        });

        const result = await service.orchestrate('Tell me about Fiora', 'thread-1');
        expect(result).toBe(obs);
    });

    it('returns empty string on workspace error', async () => {
        orchestratorMock.processWithWorkspace.mockResolvedValue({
            triggered: false,
            error: 'go wasm exploded',
        });

        const result = await service.orchestrate('Test', 'thread-1');
        expect(result).toBe('');
    });

    it('returns empty string when processWithWorkspace throws', async () => {
        orchestratorMock.processWithWorkspace.mockRejectedValue(new Error('Critical failure'));

        const result = await service.orchestrate('Crash prompt', 'thread-1');
        expect(result).toBe('');
    });

    it('uses narrativeId from active note when scopeId not provided', async () => {
        noteStoreMock = makeNoteStore({
            id: 'note-1', title: 'T', worldId: 'w1',
            narrativeId: 'narr-from-note', folderId: 'f1', markdownContent: '',
        });
        service = Object.assign(Object.create(OrchestratorService.prototype), {
            orchestrator: orchestratorMock,
            rlmLlm: { isConfigured: vi.fn(() => true) },
            goKitt: { isReady: true },
            noteEditorStore: noteStoreMock,
        });

        orchestratorMock.processWithWorkspace.mockResolvedValue({ triggered: false });

        await service.orchestrate('Test', 'thread-1');

        expect(orchestratorMock.processWithWorkspace).toHaveBeenCalledWith(
            'thread-1',
            'narr-from-note',
            'Test'
        );
    });

    it('getContext delegates to orchestrator', async () => {
        orchestratorMock.getContext.mockResolvedValue('ctx-block');

        const result = await service.getContext('thread-1');
        expect(result).toBe('ctx-block');
        expect(orchestratorMock.getContext).toHaveBeenCalledWith('thread-1');
    });
});
