import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../dexie/settings.service', () => ({
    getSetting: vi.fn((_key: string, fallback: unknown) => fallback),
    setSetting: vi.fn(),
    removeSetting: vi.fn(),
}));

import { NvidiaNimService } from './nvidia-nim.service';

function sseResponse(lines: string[]): Response {
    const encoder = new TextEncoder();
    const stream = new ReadableStream<Uint8Array>({
        start(controller) {
            for (const line of lines) {
                controller.enqueue(encoder.encode(line));
            }
            controller.close();
        },
    });
    return new Response(stream, {
        status: 200,
        headers: { 'Content-Type': 'text/event-stream' },
    });
}

describe('NvidiaNimService', () => {
    let service: NvidiaNimService;
    let fetchMock: ReturnType<typeof vi.fn>;

    beforeEach(() => {
        service = new NvidiaNimService();
        fetchMock = vi.fn();
        vi.stubGlobal('fetch', fetchMock);
    });

    afterEach(() => {
        vi.unstubAllGlobals();
        vi.clearAllMocks();
    });

    it('streams Kimi content and reasoning from NVIDIA NIM SSE', async () => {
        fetchMock.mockResolvedValue(sseResponse([
            'data: {"choices":[{"delta":{"reasoning_content":"checking "}}]}\n\n',
            'data: {"choices":[{"delta":{"content":"Hello"}}]}\n\n',
            'data: {"choices":[{"delta":{"content":" world"}}]}\n\n',
            'data: [DONE]\n\n',
        ]));

        service.saveConfig({
            apiKey: 'nvapi-test',
            model: 'moonshotai/kimi-k2-thinking',
        });

        const chunks: string[] = [];
        const reasoning: string[] = [];
        let completed = '';

        await service.streamChat(
            [{ role: 'user', content: 'Write one sentence.' }],
            {
                onChunk: (chunk) => chunks.push(chunk),
                onReasoningChunk: (chunk) => reasoning.push(chunk),
                onComplete: (full) => {
                    completed = full;
                },
                onError: (error) => {
                    throw error;
                },
            },
            'You are Kammi.',
        );

        expect(chunks).toEqual(['Hello', ' world']);
        expect(reasoning).toEqual(['checking ']);
        expect(completed).toBe('Hello world');
        expect(fetchMock).toHaveBeenCalledWith(
            'https://integrate.api.nvidia.com/v1/chat/completions',
            expect.objectContaining({
                method: 'POST',
                headers: expect.objectContaining({
                    Authorization: 'Bearer nvapi-test',
                    Accept: 'text/event-stream',
                }),
            }),
        );

        const body = JSON.parse(fetchMock.mock.calls[0][1].body);
        expect(body).toMatchObject({
            model: 'moonshotai/kimi-k2-thinking',
            stream: true,
            temperature: 1,
            top_p: 0.9,
            max_tokens: 16384,
        });
        expect(body.messages).toEqual([
            { role: 'system', content: 'You are Kammi.' },
            { role: 'user', content: 'Write one sentence.' },
        ]);
    });
});
