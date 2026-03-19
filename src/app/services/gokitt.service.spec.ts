import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { getEmptyAnalytics } from '../lib/analytics';
import { GoKittService } from './gokitt.service';

describe('GoKittService analyzeText bridge', () => {
    let service: GoKittService;
    let workerMock: { postMessage: ReturnType<typeof vi.fn> };

    beforeEach(() => {
        vi.useFakeTimers();

        service = new GoKittService();
        workerMock = {
            postMessage: vi.fn(),
        };

        Object.assign(service as object, {
            _worker: workerMock,
            wasmLoaded: true,
            pendingRequests: new Map(),
            nextRequestId: 1,
        });
    });

    afterEach(() => {
        vi.clearAllTimers();
        vi.useRealTimers();
    });

    it('resolves analyzeText requests from ANALYZE_TEXT_RESULT worker messages', async () => {
        const payload = {
            ...getEmptyAnalytics(),
            wordCount: 2,
            characterCount: 11,
            repetition: {
                totalFlags: 1,
                items: [{
                    id: 'echo:iron-gate',
                    phrase: 'iron gate',
                    occurrenceCount: 2,
                    severity: 'low' as const,
                    snippets: ['The iron gate rattled again.'],
                    highlightRanges: [{ from: 4, to: 13, text: 'iron gate' }],
                }],
            },
        };
        const promise = service.analyzeText('hello world');

        expect(workerMock.postMessage).toHaveBeenCalledTimes(1);
        const request = workerMock.postMessage.mock.calls[0][0];

        (service as any).handleWorkerMessage({
            type: 'ANALYZE_TEXT_RESULT',
            id: request.id,
            payload,
        });

        await expect(promise).resolves.toEqual(payload);
    });

    it('ignores unknown worker responses instead of resolving analyzeText requests', async () => {
        const resolved = vi.fn();
        const rejected = vi.fn();
        const promise = service.analyzeText('hello world');
        promise.then(resolved).catch(rejected);

        const request = workerMock.postMessage.mock.calls[0][0];

        (service as any).handleWorkerMessage({
            type: 'UNHANDLED_RESULT',
            id: request.id,
            payload: { nope: true },
        });

        await Promise.resolve();

        expect(resolved).not.toHaveBeenCalled();
        expect(rejected).not.toHaveBeenCalled();
        expect((service as any).pendingRequests.has(request.id)).toBe(true);
    });
});
