import { Injectable, signal, computed } from '@angular/core';
import type { TTSWorkerMessage, TTSResponseMessage } from '../workers/tts.worker';
import { modelCache } from '../lib/model-cache';

export type TTSModelState = 'idle' | 'loading' | 'ready' | 'error';

// Voice configuration
export interface TtsVoice {
    id: string;
    name: string;
    gender: 'male' | 'female';
    url: string;
}

// Available voices from Supertonic TTS
// https://supertone-inc.github.io/supertonic-py/voices/
const VOICE_BASE = 'https://huggingface.co/onnx-community/Supertonic-TTS-2-ONNX/resolve/main/voices';

export const TTS_VOICES: TtsVoice[] = [
    { id: 'F1', name: 'Sofia', gender: 'female', url: `${VOICE_BASE}/F1.bin` },
    { id: 'F2', name: 'Elena', gender: 'female', url: `${VOICE_BASE}/F2.bin` },
    { id: 'F3', name: 'Maya', gender: 'female', url: `${VOICE_BASE}/F3.bin` },
    { id: 'F4', name: 'Luna', gender: 'female', url: `${VOICE_BASE}/F4.bin` },
    { id: 'M1', name: 'James', gender: 'male', url: `${VOICE_BASE}/M1.bin` },
    { id: 'M2', name: 'Oliver', gender: 'male', url: `${VOICE_BASE}/M2.bin` },
    { id: 'M3', name: 'Daniel', gender: 'male', url: `${VOICE_BASE}/M3.bin` },
    { id: 'M4', name: 'Henry', gender: 'male', url: `${VOICE_BASE}/M4.bin` },
];

/**
 * Get a voice embedding buffer, using cache if available.
 */
export async function getVoiceEmbeddingBuffer(voice: TtsVoice): Promise<ArrayBuffer> {
    const cacheId = `voice:${voice.id}`;
    const blob = await modelCache.fetchWithCache(cacheId, voice.url, 'voice');
    return blob.arrayBuffer();
}

@Injectable({ providedIn: 'root' })
export class TtsService {
    // ========================================================================
    // State Signals
    // ========================================================================

    private readonly _modelState = signal<TTSModelState>('idle');
    private readonly _loadProgress = signal<number>(0);
    private readonly _loadStatus = signal<string>('');
    private readonly _isPlaying = signal<boolean>(false);
    private readonly _errorMessage = signal<string | null>(null);
    private readonly _selectedVoice = signal<TtsVoice>(TTS_VOICES[0]);

    // Public readonly signals
    readonly modelState = this._modelState.asReadonly();
    readonly loadProgress = this._loadProgress.asReadonly();
    readonly loadStatus = this._loadStatus.asReadonly();
    readonly isPlaying = this._isPlaying.asReadonly();
    readonly errorMessage = this._errorMessage.asReadonly();
    readonly selectedVoice = this._selectedVoice.asReadonly();

    // Computed
    readonly isModelReady = computed(() => this._modelState() === 'ready');
    readonly isModelLoading = computed(() => this._modelState() === 'loading');

    // ========================================================================
    // Worker & Audio
    // ========================================================================

    private worker: Worker | null = null;
    private audioContext: AudioContext | null = null;
    private idleUnloadTimer: ReturnType<typeof setTimeout> | null = null;

    // ========================================================================
    // Prefetch Pipeline State
    // ========================================================================

    private readonly MAX_CHUNK_SIZE = 280;
    private readonly PREFETCH_BUFFER_SIZE = 1;
    private readonly IDLE_UNLOAD_DELAY_MS = 60_000;

    private pendingChunks: string[] = [];
    private audioBufferQueue: AudioBuffer[] = [];
    private activeSourceNodes: AudioBufferSourceNode[] = [];
    private scheduledEndTime = 0;
    private isGenerating = false;
    private stopRequested = false;
    private playbackGeneration = 0;
    private nextRequestId = 0;
    private activePlaybackVoiceId: string | null = null;

    private readonly cachedWorkerVoiceIds = new Set<string>();
    private readonly voicePreloadPromises = new Map<string, Promise<void>>();
    private readonly voicePreloadResolvers = new Map<string, {
        resolve: () => void;
        reject: (error: Error) => void;
    }>();

    private pendingUnload: Promise<void> | null = null;
    private unloadWaiter: {
        resolve: () => void;
        timeout: ReturnType<typeof setTimeout>;
    } | null = null;

    // ========================================================================
    // Voice Selection
    // ========================================================================

    setVoice(voice: TtsVoice): void {
        this._selectedVoice.set(voice);
        console.log(`[TtsService] Voice changed to ${voice.name} (${voice.id})`);

        if (this._modelState() === 'ready') {
            void this.preloadVoice(voice);
        }
    }

    // ========================================================================
    // Public Methods
    // ========================================================================

    /**
     * Load the TTS model. This may take a few minutes on first load.
     */
    loadModel(): void {
        this.cancelIdleUnloadTimer();

        if (this._modelState() === 'loading') {
            console.log('[TtsService] Model already loading.');
            return;
        }

        if (this._modelState() === 'ready') {
            console.log('[TtsService] Model already loaded.');
            void this.preloadVoice(this._selectedVoice());
            return;
        }

        this._modelState.set('loading');
        this._loadProgress.set(0);
        this._loadStatus.set('Initializing...');
        this._errorMessage.set(null);

        this.initWorker();
        this.sendMessage({ type: 'LOAD_MODEL' });
    }

    /**
     * Synthesize speech from text and play it with prefetching for seamless playback.
     */
    speak(text: string): void {
        if (this._modelState() !== 'ready') {
            console.warn('[TtsService] Model not ready. Call loadModel() first.');
            return;
        }

        void this.startPlayback(text);
    }

    /**
     * Stop current playback, clear transient buffers, and begin idle cleanup.
     */
    stop(): void {
        this.stopPlayback(true);
    }

    /**
     * Fully unload model/runtime resources.
     */
    async unloadModel(): Promise<void> {
        this.cancelIdleUnloadTimer();

        if (this.pendingUnload) {
            return this.pendingUnload;
        }

        this.pendingUnload = this.performUnload()
            .finally(() => {
                this.pendingUnload = null;
            });

        return this.pendingUnload;
    }

    /**
     * Cleanup resources.
     */
    destroy(): void {
        this.stopPlayback(false);
        void this.unloadModel();
    }

    // ========================================================================
    // Text Chunking
    // ========================================================================

    private chunkText(text: string): string[] {
        if (!text || text.trim().length === 0) return [];

        const sentencePattern = /[^.!?]+[.!?]+\s*/g;
        const sentences = text.match(sentencePattern) || [text];

        const chunks: string[] = [];
        let currentChunk = '';

        for (const sentence of sentences) {
            const trimmedSentence = sentence.trim();
            if (!trimmedSentence) continue;

            if (currentChunk.length > 0 &&
                (currentChunk.length + trimmedSentence.length) > this.MAX_CHUNK_SIZE) {
                chunks.push(currentChunk.trim());
                currentChunk = trimmedSentence;
            } else {
                currentChunk += (currentChunk ? ' ' : '') + trimmedSentence;
            }
        }

        if (currentChunk.trim()) {
            chunks.push(currentChunk.trim());
        }

        if (chunks.length === 0 && text.trim()) {
            const words = text.split(/\s+/);
            currentChunk = '';
            for (const word of words) {
                if ((currentChunk + ' ' + word).length > this.MAX_CHUNK_SIZE && currentChunk) {
                    chunks.push(currentChunk.trim());
                    currentChunk = word;
                } else {
                    currentChunk += (currentChunk ? ' ' : '') + word;
                }
            }
            if (currentChunk.trim()) {
                chunks.push(currentChunk.trim());
            }
        }

        return chunks;
    }

    // ========================================================================
    // Prefetch Pipeline
    // ========================================================================

    private async startPlayback(text: string): Promise<void> {
        if (this._isPlaying()) {
            this.stopPlayback(false);
        } else {
            this.cancelIdleUnloadTimer();
        }

        const chunks = this.chunkText(text);
        if (chunks.length === 0) {
            console.warn('[TtsService] No text to speak.');
            return;
        }

        const voice = this._selectedVoice();
        const generation = ++this.playbackGeneration;

        this.resetPlaybackBuffers();
        this.pendingChunks = chunks;
        this.stopRequested = false;
        this.activePlaybackVoiceId = voice.id;
        this._isPlaying.set(true);
        this._errorMessage.set(null);

        try {
            await this.preloadVoice(voice);
            if (generation !== this.playbackGeneration || this.stopRequested) {
                return;
            }

            await this.ensureAudioContext();
            if (generation !== this.playbackGeneration || this.stopRequested) {
                return;
            }

            console.log(`[TtsService] Starting prefetch pipeline for ${this.pendingChunks.length} chunks...`);
            this.fillPrefetchBuffer();
        } catch (error) {
            if (generation !== this.playbackGeneration) {
                return;
            }

            const message = error instanceof Error ? error.message : String(error);
            console.error('[TtsService] Failed to start playback:', message);
            this._errorMessage.set(message);
            this._isPlaying.set(false);
            this.scheduleIdleUnload();
        }
    }

    /**
     * Ensure we have enough chunks being synthesized ahead of playback.
     */
    private fillPrefetchBuffer(): void {
        while (
            !this.stopRequested &&
            !this.isGenerating &&
            this.pendingChunks.length > 0 &&
            this.audioBufferQueue.length < this.PREFETCH_BUFFER_SIZE
        ) {
            this.requestNextChunk();
        }
    }

    /**
     * Request the worker to synthesize the next chunk.
     */
    private requestNextChunk(): void {
        if (this.pendingChunks.length === 0 || this.isGenerating || !this.activePlaybackVoiceId) {
            return;
        }

        const chunk = this.pendingChunks.shift()!;
        const generation = this.playbackGeneration;
        const requestId = ++this.nextRequestId;
        this.isGenerating = true;

        console.log(`[TtsService] Requesting synthesis (${this.pendingChunks.length} pending): "${chunk.substring(0, 40)}..."`);
        this.sendMessage({
            type: 'SPEAK',
            payload: {
                text: chunk,
                voiceId: this.activePlaybackVoiceId,
                generation,
                requestId
            }
        });
    }

    /**
     * Schedule the next audio buffer for playback at the precise end time.
     */
    private scheduleNextBuffer(): void {
        if (this.stopRequested || this.audioBufferQueue.length === 0) {
            if (this.pendingChunks.length === 0 && !this.isGenerating && this.audioBufferQueue.length === 0) {
                this.finishPlayback();
            }
            return;
        }

        const buffer = this.audioBufferQueue.shift()!;
        const ctx = this.audioContext!;

        const source = ctx.createBufferSource();
        source.buffer = buffer;
        source.connect(ctx.destination);

        const now = ctx.currentTime;
        const startAt = Math.max(now, this.scheduledEndTime);

        source.start(startAt);
        this.scheduledEndTime = startAt + buffer.duration;
        this.activeSourceNodes.push(source);

        source.onended = () => {
            this.cleanupSource(source);
            this.scheduleNextBuffer();
        };

        console.log(`[TtsService] Scheduled buffer: start=${startAt.toFixed(3)}, duration=${buffer.duration.toFixed(2)}s, queue=${this.audioBufferQueue.length}`);
        this.fillPrefetchBuffer();
    }

    /**
     * Remove a source node from tracking.
     */
    private cleanupSource(source: AudioBufferSourceNode): void {
        const idx = this.activeSourceNodes.indexOf(source);
        if (idx !== -1) {
            this.activeSourceNodes.splice(idx, 1);
        }

        source.onended = null;
        source.buffer = null;

        try {
            source.disconnect();
        } catch {
            // Already disconnected
        }
    }

    /**
     * Called when all audio has finished playing.
     */
    private finishPlayback(): void {
        if (!this.stopRequested && this._isPlaying()) {
            console.log('[TtsService] Finished playing all chunks.');
            this._isPlaying.set(false);
            this.activePlaybackVoiceId = null;
            this.scheduleIdleUnload();
        }
    }

    private stopPlayback(scheduleIdleUnload: boolean): void {
        console.log('[TtsService] Stopping playback...');

        const cancelledGeneration = ++this.playbackGeneration;
        this.stopRequested = true;
        this.isGenerating = false;
        this.activePlaybackVoiceId = null;

        this.resetPlaybackBuffers();

        for (const source of this.activeSourceNodes) {
            source.onended = null;
            source.buffer = null;
            try {
                source.stop();
                source.disconnect();
            } catch {
                // Already stopped
            }
        }

        this.activeSourceNodes = [];
        this._isPlaying.set(false);

        if (this.worker) {
            this.sendMessage({
                type: 'STOP',
                payload: { generation: cancelledGeneration }
            });
        }

        if (scheduleIdleUnload) {
            this.scheduleIdleUnload();
        } else {
            this.cancelIdleUnloadTimer();
        }
    }

    private resetPlaybackBuffers(): void {
        this.pendingChunks = [];
        this.audioBufferQueue = [];
        this.scheduledEndTime = 0;
    }

    // ========================================================================
    // Audio Context
    // ========================================================================

    private async ensureAudioContext(): Promise<void> {
        if (!this.audioContext) {
            this.audioContext = new AudioContext();
        }
        if (this.audioContext.state === 'suspended') {
            await this.audioContext.resume();
        }
    }

    private async closeAudioContext(): Promise<void> {
        const ctx = this.audioContext;
        this.audioContext = null;

        if (ctx) {
            try {
                await ctx.close();
            } catch (error) {
                console.warn('[TtsService] Failed to close AudioContext:', error);
            }
        }
    }

    // ========================================================================
    // Worker Communication
    // ========================================================================

    private initWorker(): void {
        if (this.worker) return;

        this.worker = new Worker(new URL('../workers/tts.worker', import.meta.url), {
            type: 'module'
        });

        this.worker.onmessage = (e: MessageEvent<TTSResponseMessage>) => {
            this.handleWorkerMessage(e.data);
        };

        this.worker.onerror = (error) => {
            console.error('[TtsService] Worker error:', error);
            this.resolveUnloadWaiter();
            this.rejectAllVoicePreloads(new Error('Worker failed to initialize.'));
            this._modelState.set('error');
            this._errorMessage.set('Worker failed to initialize.');
        };
    }

    private sendMessage(msg: TTSWorkerMessage, transfer: Transferable[] = []): void {
        if (!this.worker) {
            console.error('[TtsService] Worker not initialized.');
            return;
        }

        if (transfer.length > 0) {
            this.worker.postMessage(msg, transfer);
            return;
        }

        this.worker.postMessage(msg);
    }

    private handleWorkerMessage(msg: TTSResponseMessage): void {
        switch (msg.type) {
            case 'PROGRESS':
                this.handleProgress(msg.payload);
                break;

            case 'MODEL_READY':
                this._modelState.set('ready');
                this._loadProgress.set(100);
                this._loadStatus.set('Ready');
                console.log('[TtsService] Model ready!');
                void this.preloadVoice(this._selectedVoice());
                break;

            case 'MODEL_UNLOADED':
                this.resolveUnloadWaiter();
                break;

            case 'MODEL_ERROR':
                this.resolveUnloadWaiter();
                this._modelState.set('error');
                this._errorMessage.set(msg.payload.message);
                this.isGenerating = false;
                console.error('[TtsService] Model load error:', msg.payload.message);
                break;

            case 'VOICE_READY': {
                this.cachedWorkerVoiceIds.add(msg.payload.voiceId);
                const resolver = this.voicePreloadResolvers.get(msg.payload.voiceId);
                if (resolver) {
                    this.voicePreloadResolvers.delete(msg.payload.voiceId);
                    resolver.resolve();
                }
                break;
            }

            case 'VOICE_ERROR': {
                this.cachedWorkerVoiceIds.delete(msg.payload.voiceId);
                const resolver = this.voicePreloadResolvers.get(msg.payload.voiceId);
                if (resolver) {
                    this.voicePreloadResolvers.delete(msg.payload.voiceId);
                    resolver.reject(new Error(msg.payload.message));
                }
                break;
            }

            case 'AUDIO_READY':
                void this.handleAudioReady(
                    msg.payload.samples,
                    msg.payload.length,
                    msg.payload.sampleRate,
                    msg.payload.generation,
                    msg.payload.requestId
                );
                break;

            case 'SPEAK_ERROR':
                this.handleSpeakError(msg.payload.generation, msg.payload.requestId, msg.payload.message);
                break;

            case 'STATUS':
                if (msg.payload.modelLoaded && this._modelState() !== 'ready') {
                    this._modelState.set('ready');
                }
                break;
        }
    }

    private handleProgress(progress: { status: string; progress?: number; file?: string }): void {
        this._loadStatus.set(progress.status);
        if (progress.progress !== undefined) {
            this._loadProgress.set(Math.round(progress.progress));
        }
        if (progress.file) {
            const shortName = progress.file.split('/').pop() || progress.file;
            this._loadStatus.set(`Loading ${shortName}...`);
        }
    }

    /**
     * Handle synthesized audio from worker and add it to the playback queue.
     */
    private async handleAudioReady(
        samplesBuffer: ArrayBuffer,
        length: number,
        sampleRate: number,
        generation: number,
        requestId: number
    ): Promise<void> {
        if (generation !== this.playbackGeneration || this.stopRequested) {
            return;
        }

        try {
            await this.ensureAudioContext();

            if (generation !== this.playbackGeneration || this.stopRequested) {
                return;
            }

            const samples = new Float32Array(samplesBuffer, 0, length);
            const audioBuffer = this.audioContext!.createBuffer(1, samples.length, sampleRate);
            audioBuffer.copyToChannel(samples, 0);

            this.audioBufferQueue.push(audioBuffer);
            this.isGenerating = false;

            console.log(`[TtsService] Buffer received (#${requestId}). Queue size: ${this.audioBufferQueue.length}`);

            if (this.activeSourceNodes.length === 0 ||
                this.audioContext!.currentTime >= this.scheduledEndTime) {
                this.scheduleNextBuffer();
            }

            this.fillPrefetchBuffer();
        } catch (error) {
            if (generation !== this.playbackGeneration) {
                return;
            }

            console.error('[TtsService] Audio buffer error:', error);
            this.isGenerating = false;
            this.fillPrefetchBuffer();
        }
    }

    private handleSpeakError(generation: number, _requestId: number, message: string): void {
        if (generation !== this.playbackGeneration || this.stopRequested) {
            return;
        }

        console.error('[TtsService] Speak error:', message);
        this.isGenerating = false;
        this._errorMessage.set(message);
        this.fillPrefetchBuffer();
    }

    // ========================================================================
    // Voice Preload
    // ========================================================================

    private preloadVoice(voice: TtsVoice): Promise<void> {
        if (this._modelState() !== 'ready' || !this.worker) {
            return Promise.resolve();
        }

        if (this.cachedWorkerVoiceIds.has(voice.id)) {
            return Promise.resolve();
        }

        const existing = this.voicePreloadPromises.get(voice.id);
        if (existing) {
            return existing;
        }

        const promise = (async () => {
            const buffer = await getVoiceEmbeddingBuffer(voice);

            if (!this.worker) {
                throw new Error('Worker not initialized.');
            }

            const ack = new Promise<void>((resolve, reject) => {
                this.voicePreloadResolvers.set(voice.id, { resolve, reject });
            });

            this.sendMessage({
                type: 'PRELOAD_VOICE',
                payload: {
                    voiceId: voice.id,
                    buffer
                }
            }, [buffer]);

            await ack;
        })()
            .finally(() => {
                this.voicePreloadPromises.delete(voice.id);
            });

        this.voicePreloadPromises.set(voice.id, promise);
        return promise;
    }

    private rejectAllVoicePreloads(error: Error): void {
        for (const [voiceId, resolver] of this.voicePreloadResolvers.entries()) {
            this.voicePreloadResolvers.delete(voiceId);
            resolver.reject(error);
        }
        this.voicePreloadPromises.clear();
        this.cachedWorkerVoiceIds.clear();
    }

    // ========================================================================
    // Idle Unload
    // ========================================================================

    private scheduleIdleUnload(): void {
        this.cancelIdleUnloadTimer();
        this.idleUnloadTimer = setTimeout(() => {
            void this.unloadModel();
        }, this.IDLE_UNLOAD_DELAY_MS);
    }

    private cancelIdleUnloadTimer(): void {
        if (this.idleUnloadTimer !== null) {
            clearTimeout(this.idleUnloadTimer);
            this.idleUnloadTimer = null;
        }
    }

    private async performUnload(): Promise<void> {
        this.stopPlayback(false);
        this.rejectAllVoicePreloads(new Error('TTS model unloaded.'));
        await this.closeAudioContext();

        const worker = this.worker;
        if (worker) {
            const ack = this.createUnloadWaiter();
            this.sendMessage({ type: 'UNLOAD_MODEL' });
            await ack;
            worker.terminate();
            this.worker = null;
        }

        this.cachedWorkerVoiceIds.clear();
        this.activePlaybackVoiceId = null;
        this._modelState.set('idle');
        this._loadProgress.set(0);
        this._loadStatus.set('');
        this._isPlaying.set(false);
    }

    private createUnloadWaiter(): Promise<void> {
        if (this.unloadWaiter) {
            clearTimeout(this.unloadWaiter.timeout);
        }

        return new Promise<void>((resolve) => {
            const timeout = setTimeout(() => {
                this.unloadWaiter = null;
                resolve();
            }, 1500);

            this.unloadWaiter = {
                resolve: () => {
                    clearTimeout(timeout);
                    this.unloadWaiter = null;
                    resolve();
                },
                timeout
            };
        });
    }

    private resolveUnloadWaiter(): void {
        if (this.unloadWaiter) {
            const waiter = this.unloadWaiter;
            this.unloadWaiter = null;
            clearTimeout(waiter.timeout);
            waiter.resolve();
        }
    }
}
