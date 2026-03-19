import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('../lib/model-cache', () => ({
    modelCache: {
        fetchWithCache: vi.fn(),
    }
}));

import { modelCache } from '../lib/model-cache';
import { TtsService, TTS_VOICES } from './tts.service';

function createVoiceBlob(): Blob {
    return new Blob([new Float32Array([0.1, 0.2, 0.3, 0.4]).buffer], {
        type: 'application/octet-stream'
    });
}

function createAudioContextMock() {
    const createBuffer = vi.fn((channels: number, length: number, sampleRate: number) => {
        const channelData = Array.from({ length: channels }, () => new Float32Array(length));
        return {
            length,
            sampleRate,
            duration: length / sampleRate,
            copyToChannel: vi.fn((samples: Float32Array, channel: number) => {
                channelData[channel].set(samples);
            }),
            getChannelData: vi.fn((channel: number) => channelData[channel]),
        } as unknown as AudioBuffer;
    });

    const createBufferSource = vi.fn(() => ({
        buffer: null as AudioBuffer | null,
        connect: vi.fn(),
        start: vi.fn(),
        stop: vi.fn(),
        disconnect: vi.fn(),
        onended: null as (() => void) | null,
    }) as unknown as AudioBufferSourceNode);

    return {
        state: 'running',
        currentTime: 0,
        destination: {},
        createBuffer,
        createBufferSource,
        resume: vi.fn(async () => undefined),
        close: vi.fn(async () => undefined),
    } as unknown as AudioContext & {
        createBuffer: typeof createBuffer;
        createBufferSource: typeof createBufferSource;
        close: ReturnType<typeof vi.fn>;
    };
}

function createWorkerMock(service: TtsService) {
    return {
        postMessage: vi.fn((message: any) => {
            if (message.type === 'PRELOAD_VOICE') {
                (service as any).handleWorkerMessage({
                    type: 'VOICE_READY',
                    payload: { voiceId: message.payload.voiceId }
                });
            }

            if (message.type === 'UNLOAD_MODEL') {
                (service as any).handleWorkerMessage({ type: 'MODEL_UNLOADED' });
            }
        }),
        terminate: vi.fn(),
        onmessage: null,
        onerror: null,
    } as unknown as Worker & {
        postMessage: ReturnType<typeof vi.fn>;
        terminate: ReturnType<typeof vi.fn>;
    };
}

async function flushMicrotasks(): Promise<void> {
    await Promise.resolve();
    await Promise.resolve();
}

describe('TtsService', () => {
    let service: TtsService;
    let worker: ReturnType<typeof createWorkerMock>;
    let audioContext: ReturnType<typeof createAudioContextMock>;

    beforeEach(() => {
        vi.useFakeTimers();
        vi.clearAllMocks();

        vi.mocked(modelCache.fetchWithCache).mockResolvedValue(createVoiceBlob());

        service = new TtsService();
        worker = createWorkerMock(service);
        audioContext = createAudioContextMock();

        (service as any).worker = worker;
        (service as any).audioContext = audioContext;
        (service as any)._modelState.set('ready');
    });

    afterEach(() => {
        vi.useRealTimers();
    });

    it('clears queues, active sources, and scheduling state on stop', () => {
        const sourceA = {
            buffer: {} as AudioBuffer,
            onended: vi.fn(),
            stop: vi.fn(),
            disconnect: vi.fn(),
        } as unknown as AudioBufferSourceNode;
        const sourceB = {
            buffer: {} as AudioBuffer,
            onended: vi.fn(),
            stop: vi.fn(),
            disconnect: vi.fn(),
        } as unknown as AudioBufferSourceNode;

        (service as any).pendingChunks = ['first', 'second'];
        (service as any).audioBufferQueue = [{ duration: 1 } as AudioBuffer];
        (service as any).activeSourceNodes = [sourceA, sourceB];
        (service as any).scheduledEndTime = 42;
        (service as any).isGenerating = true;
        (service as any).stopRequested = false;
        (service as any)._isPlaying.set(true);

        service.stop();

        expect((service as any).pendingChunks).toEqual([]);
        expect((service as any).audioBufferQueue).toEqual([]);
        expect((service as any).activeSourceNodes).toEqual([]);
        expect((service as any).scheduledEndTime).toBe(0);
        expect((service as any).isGenerating).toBe(false);
        expect((service as any)._isPlaying()).toBe(false);
        expect(sourceA.stop).toHaveBeenCalled();
        expect(sourceA.disconnect).toHaveBeenCalled();
        expect(sourceB.stop).toHaveBeenCalled();
        expect(sourceB.disconnect).toHaveBeenCalled();
        expect(worker.postMessage).toHaveBeenCalledWith({
            type: 'STOP',
            payload: { generation: 1 }
        });
    });

    it('ignores late audio from an old generation', async () => {
        (service as any).playbackGeneration = 2;
        (service as any).isGenerating = true;

        (service as any).handleWorkerMessage({
            type: 'AUDIO_READY',
            payload: {
                generation: 1,
                requestId: 99,
                samples: new Float32Array([0.1, 0.2, 0.3]).buffer,
                length: 3,
                sampleRate: 44100
            }
        });
        await flushMicrotasks();

        expect(audioContext.createBuffer).not.toHaveBeenCalled();
        expect((service as any).audioBufferQueue).toHaveLength(0);
        expect((service as any).isGenerating).toBe(true);
    });

    it('unloads worker and audio context after the idle timeout', async () => {
        service.stop();

        await vi.advanceTimersByTimeAsync(60_000);
        await flushMicrotasks();

        const messageTypes = worker.postMessage.mock.calls.map(([message]) => message.type);
        expect(messageTypes).toContain('UNLOAD_MODEL');
        expect(worker.terminate).toHaveBeenCalledTimes(1);
        expect(audioContext.close).toHaveBeenCalledTimes(1);
        expect(service.modelState()).toBe('idle');
    });

    it('cancels idle unload when playback restarts before the timer expires', async () => {
        service.stop();
        service.speak('Hello world.');
        await flushMicrotasks();

        await vi.advanceTimersByTimeAsync(60_000);
        await flushMicrotasks();

        const unloadCalls = worker.postMessage.mock.calls
            .filter(([message]) => message.type === 'UNLOAD_MODEL');

        expect(unloadCalls).toHaveLength(0);
        expect(worker.terminate).not.toHaveBeenCalled();
    });

    it('reuses cached voice embeddings instead of refetching them per chunk', async () => {
        service.setVoice(TTS_VOICES[1]);
        await flushMicrotasks();

        service.speak('One short sentence. Another short sentence.');
        await flushMicrotasks();

        const preloadCalls = worker.postMessage.mock.calls
            .filter(([message]) => message.type === 'PRELOAD_VOICE');

        expect(modelCache.fetchWithCache).toHaveBeenCalledTimes(1);
        expect(preloadCalls).toHaveLength(1);
        expect(preloadCalls[0][0].payload.voiceId).toBe(TTS_VOICES[1].id);
    });
});
