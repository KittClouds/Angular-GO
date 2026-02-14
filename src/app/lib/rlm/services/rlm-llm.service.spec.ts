import { describe, it, expect, vi, beforeEach } from 'vitest';
import { RlmLlmService } from './rlm-llm.service';
import { z } from 'zod';

// ---------------------------------------------------------------------------
// Mock OpenRouterService
// ---------------------------------------------------------------------------

function createMockOpenRouter(overrides: Record<string, unknown> = {}) {
    return {
        getApiKey: vi.fn(() => 'sk-test-key'),
        chat: vi.fn(async () => '{"ok":true}'),
        getModel: vi.fn(() => 'test-model'),
        ...overrides,
    };
}

// ---------------------------------------------------------------------------
// Mock settings service — prevents Dexie access in tests
// ---------------------------------------------------------------------------

vi.mock('../../dexie/settings.service', () => ({
    getSetting: vi.fn((_key: string, defaultValue: unknown) => defaultValue),
    setSetting: vi.fn(),
}));

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('RlmLlmService', () => {
    let service: RlmLlmService;
    let mockOR: ReturnType<typeof createMockOpenRouter>;

    beforeEach(() => {
        mockOR = createMockOpenRouter();
        service = new RlmLlmService(mockOR as any);
    });

    // ---- isConfigured -------------------------------------------------------

    describe('isConfigured', () => {
        it('returns true when OpenRouter has an API key', () => {
            expect(service.isConfigured()).toBe(true);
        });

        it('returns false when OpenRouter has no API key', () => {
            mockOR = createMockOpenRouter({ getApiKey: vi.fn(() => null) });
            service = new RlmLlmService(mockOR as any);
            expect(service.isConfigured()).toBe(false);
        });
    });

    // ---- Model config -------------------------------------------------------

    describe('model config', () => {
        it('defaults to the free-tier model', () => {
            expect(service.getModel()).toBe('z-ai/glm-4.5-air:free');
        });

        it('persists model change via setModel', () => {
            service.setModel('google/gemini-3-flash-preview');
            expect(service.getModel()).toBe('google/gemini-3-flash-preview');
        });
    });

    // ---- complete -----------------------------------------------------------

    describe('complete', () => {
        it('delegates to OpenRouterService.chat with correct args', async () => {
            mockOR.chat.mockResolvedValue('hello world');
            const result = await service.complete('sys', 'user msg');
            expect(result).toBe('hello world');
            expect(mockOR.chat).toHaveBeenCalledWith(
                [{ role: 'user', content: 'user msg' }],
                'sys',
            );
        });

        it('throws when not configured', async () => {
            mockOR = createMockOpenRouter({ getApiKey: vi.fn(() => null) });
            service = new RlmLlmService(mockOR as any);

            await expect(service.complete('sys', 'user'))
                .rejects.toThrow('OpenRouter API key not configured');
        });
    });

    // ---- completeJSON -------------------------------------------------------

    describe('completeJSON', () => {
        const TestSchema = z.object({
            steps: z.array(z.string()),
            reasoning: z.string(),
        });

        it('parses clean JSON response', async () => {
            mockOR.chat.mockResolvedValue(
                '{"steps":["a","b"],"reasoning":"test"}',
            );
            const result = await service.completeJSON('sys', 'user', TestSchema);
            expect(result).toEqual({ steps: ['a', 'b'], reasoning: 'test' });
        });

        it('strips fenced code block wrappers', async () => {
            mockOR.chat.mockResolvedValue(
                '```json\n{"steps":["x"],"reasoning":"fenced"}\n```',
            );
            const result = await service.completeJSON('sys', 'user', TestSchema);
            expect(result).toEqual({ steps: ['x'], reasoning: 'fenced' });
        });

        it('throws on invalid JSON', async () => {
            mockOR.chat.mockResolvedValue('not json at all');
            await expect(service.completeJSON('sys', 'user', TestSchema))
                .rejects.toThrow('JSON parse/validation failed');
        });

        it('throws on schema mismatch', async () => {
            mockOR.chat.mockResolvedValue('{"wrong":"shape"}');
            await expect(service.completeJSON('sys', 'user', TestSchema))
                .rejects.toThrow('JSON parse/validation failed');
        });
    });
});
