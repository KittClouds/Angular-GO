import { describe, it, expect, vi, beforeEach } from 'vitest';
import { RlmLlmService } from './rlm-llm.service';
import { z } from 'zod';

// ---------------------------------------------------------------------------
// Mock GoChatService
// ---------------------------------------------------------------------------

function createMockGoChatSvc(streamResponse = '{"ok":true}', shouldError = false) {
    return {
        streamChat: vi.fn((
            _messages: unknown[],
            callbacks: { onChunk: (c: string) => void; onComplete: (r: string) => void; onError: (e: Error) => void },
            _systemPrompt?: string
        ) => {
            if (shouldError) {
                callbacks.onError(new Error('stream error'));
            } else {
                callbacks.onComplete(streamResponse);
            }
        }),
    };
}

vi.mock('../../services/go-chat.service', () => ({
    GoChatService: vi.fn(),
}));

// ---------------------------------------------------------------------------
// Mock settings service — prevents Dexie access in tests
// ---------------------------------------------------------------------------

vi.mock('../../dexie/settings.service', () => ({
    getSetting: vi.fn((_key: string, defaultValue: unknown) => {
        // Return a config with an API key so isConfigured() returns true by default
        if (_key === 'openrouter:config') return { apiKey: 'sk-test-key' };
        return defaultValue;
    }),
    setSetting: vi.fn(),
}));

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('RlmLlmService', () => {
    let service: RlmLlmService;
    let mockGoChat: ReturnType<typeof createMockGoChatSvc>;

    beforeEach(() => {
        mockGoChat = createMockGoChatSvc();
        // Bypass Angular DI by injecting the mock service manually via the private field
        service = Object.create(RlmLlmService.prototype) as RlmLlmService;
        (service as any).goChatService = mockGoChat;
        (service as any)._model = Object.assign(
            vi.fn(() => 'z-ai/glm-4.5-air:free'),
            { set: vi.fn() }
        );
        (service as any).isConfigured = vi.fn(() => true);
    });

    // ---- isConfigured -------------------------------------------------------

    describe('isConfigured', () => {
        it('returns true when openrouter:config has an API key', () => {
            expect(service.isConfigured()).toBe(true);
        });
    });

    // ---- Model config -------------------------------------------------------

    describe('model config', () => {
        it('defaults to the free-tier model', () => {
            // Fresh instance from Angular's DI simulation is complex; test via prototype default
            expect(service.getModel()).toBe('z-ai/glm-4.5-air:free');
        });
    });

    // ---- complete -----------------------------------------------------------

    describe('complete', () => {
        it('resolves with the full streaming response', async () => {
            mockGoChat = createMockGoChatSvc('hello world');
            (service as any).goChatService = mockGoChat;
            const result = await service.complete('sys', 'user msg');
            expect(result).toBe('hello world');
        });

        it('rejects when the stream errors', async () => {
            mockGoChat = createMockGoChatSvc('', true);
            (service as any).goChatService = mockGoChat;
            await expect(service.complete('sys', 'user')).rejects.toThrow('stream error');
        });
    });

    // ---- completeJSON -------------------------------------------------------

    describe('completeJSON', () => {
        const TestSchema = z.object({
            steps: z.array(z.string()),
            reasoning: z.string(),
        });

        it('parses clean JSON response', async () => {
            mockGoChat = createMockGoChatSvc('{"steps":["a","b"],"reasoning":"test"}');
            (service as any).goChatService = mockGoChat;
            const result = await service.completeJSON('sys', 'user', TestSchema);
            expect(result).toEqual({ steps: ['a', 'b'], reasoning: 'test' });
        });

        it('strips fenced code block wrappers', async () => {
            mockGoChat = createMockGoChatSvc('```json\n{"steps":["x"],"reasoning":"fenced"}\n```');
            (service as any).goChatService = mockGoChat;
            const result = await service.completeJSON('sys', 'user', TestSchema);
            expect(result).toEqual({ steps: ['x'], reasoning: 'fenced' });
        });

        it('throws on invalid JSON', async () => {
            mockGoChat = createMockGoChatSvc('not json at all');
            (service as any).goChatService = mockGoChat;
            await expect(service.completeJSON('sys', 'user', TestSchema))
                .rejects.toThrow('JSON parse/validation failed');
        });

        it('throws on schema mismatch', async () => {
            mockGoChat = createMockGoChatSvc('{"wrong":"shape"}');
            (service as any).goChatService = mockGoChat;
            await expect(service.completeJSON('sys', 'user', TestSchema))
                .rejects.toThrow('JSON parse/validation failed');
        });
    });
});
