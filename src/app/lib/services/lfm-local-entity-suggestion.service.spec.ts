import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { LfmLocalEntitySuggestionProvider } from './lfm-local-entity-suggestion.service';

function flushMicrotasks(): Promise<void> {
  return Promise.resolve().then(() => Promise.resolve());
}

describe('LfmLocalEntitySuggestionProvider', () => {
  let provider: LfmLocalEntitySuggestionProvider;
  let workerMock: {
    postMessage: ReturnType<typeof vi.fn>;
    terminate: ReturnType<typeof vi.fn>;
    onmessage: ((event: MessageEvent) => void) | null;
    onerror: ((event: ErrorEvent) => void) | null;
  };
  let WorkerMockClass: new () => Worker;

  beforeEach(() => {
    vi.useFakeTimers();

    workerMock = {
      postMessage: vi.fn((message: any) => {
        if (message.type === 'INIT') {
          queueMicrotask(() => {
            workerMock.onmessage?.({
              data: {
                type: 'INIT_COMPLETE',
                payload: { device: 'wasm' },
                _id: message._id,
              },
            } as MessageEvent);
          });
        }

        if (message.type === 'SCAN') {
          queueMicrotask(() => {
            workerMock.onmessage?.({
              data: {
                type: 'SCAN_COMPLETE',
                payload: {
                  device: 'wasm',
                  suggestions: [
                    {
                      label: 'Kai',
                      kind: 'CHARACTER',
                      confidence: 'high',
                      reasoning: 'Named entity from the note chunk.',
                      evidence: 'Kai laughs.',
                      aliases: [],
                    },
                  ],
                },
                _id: message._id,
              },
            } as MessageEvent);
          });
        }

        if (message.type === 'GET_STATUS') {
          queueMicrotask(() => {
            workerMock.onmessage?.({
              data: {
                type: 'STATUS',
                payload: provider.status(),
                _id: message._id,
              },
            } as MessageEvent);
          });
        }

        if (message.type === 'DISPOSE') {
          queueMicrotask(() => {
            workerMock.onmessage?.({
              data: {
                type: 'DISPOSED',
                _id: message._id,
              },
            } as MessageEvent);
          });
        }
      }),
      terminate: vi.fn(),
      onmessage: null,
      onerror: null,
    };

    WorkerMockClass = class {
      postMessage = workerMock.postMessage;
      terminate = workerMock.terminate;
      private _onmessage: ((event: MessageEvent) => void) | null = null;
      private _onerror: ((event: ErrorEvent) => void) | null = null;

      constructor() {
        workerMock.onmessage = this._onmessage;
        workerMock.onerror = this._onerror;
      }

      get onmessage() {
        return this._onmessage;
      }

      set onmessage(handler: ((event: MessageEvent) => void) | null) {
        this._onmessage = handler;
        workerMock.onmessage = handler;
      }

      get onerror() {
        return this._onerror;
      }

      set onerror(handler: ((event: ErrorEvent) => void) | null) {
        this._onerror = handler;
        workerMock.onerror = handler;
      }
    } as unknown as new () => Worker;

    vi.stubGlobal('Worker', WorkerMockClass);

    provider = new LfmLocalEntitySuggestionProvider();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  it('initializes lazily, scans, and updates device/status', async () => {
    const suggestions = await provider.scan({
      noteId: 'note-1',
      noteTitle: 'Untitled Note',
      plainText: 'Kai laughs.',
    });
    await flushMicrotasks();

    expect(suggestions).toHaveLength(1);
    expect(suggestions[0].label).toBe('Kai');
    expect(provider.status()).toEqual({
      ready: true,
      loading: false,
      device: 'wasm',
    });
  });

  it('disposes the worker after the idle timeout', async () => {
    await provider.scan({
      noteId: 'note-1',
      noteTitle: 'Untitled Note',
      plainText: 'Kai laughs.',
    });
    await flushMicrotasks();

    await vi.advanceTimersByTimeAsync(120_000);
    await flushMicrotasks();

    expect(workerMock.postMessage).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'DISPOSE' }),
    );
    expect(workerMock.terminate).toHaveBeenCalledTimes(1);
    expect(provider.status()).toEqual({
      ready: false,
      loading: false,
      device: null,
    });
  });
});
