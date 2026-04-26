import { beforeEach, describe, expect, it, vi } from 'vitest';
import { signal } from '@angular/core';

vi.mock('../lib/registry', () => ({
  smartGraphRegistry: {
    isRegisteredEntity: vi.fn(() => false),
    registerEntity: vi.fn(),
  },
}));

vi.mock('../lib/store/note-editor.store', () => ({
  NoteEditorStore: vi.fn(),
}));

vi.mock('../lib/dexie/settings.service', () => ({
  getSetting: vi.fn(() => null),
  setSetting: vi.fn(),
}));

vi.mock('../lib/entity-learning/entity-feedback', () => ({
  filterRejectedSuggestions: vi.fn(async (suggestions) => suggestions),
  recordSuggestionAccepted: vi.fn(async () => undefined),
  recordSuggestionRejected: vi.fn(async () => undefined),
}));

vi.mock('uuid', () => ({
  v4: vi.fn(() => 'uuid-1'),
}));

import { smartGraphRegistry } from '../lib/registry';
import { NerService } from './ner.service';

describe('NerService provider orchestration', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  function makeService() {
    return Object.assign(Object.create(NerService.prototype), {
      noteStore: {
        currentNote: vi.fn(() => ({ id: 'note-1', title: 'Untitled Note' })),
      },
      fstProvider: {
        scan: vi.fn(async () => []),
        getStatus: vi.fn(async () => ({ ready: true, loading: false, device: null })),
        dispose: vi.fn(async () => undefined),
      },
      lfmLocalProvider: {
        status: signal({ ready: false, loading: false, device: null }),
        scan: vi.fn(async () => []),
        getStatus: vi.fn(async () => ({ ready: true, loading: false, device: 'wasm' })),
        dispose: vi.fn(async () => undefined),
      },
      glinerLocalProvider: {
        status: signal({ ready: false, loading: false, device: null }),
        scan: vi.fn(async () => []),
        getStatus: vi.fn(async () => ({ ready: true, loading: false, device: 'wasm' })),
        dispose: vi.fn(async () => undefined),
      },
      suggestions: signal([]),
      fstEnabled: signal(true),
      fstStatus: signal({ ready: true, loading: false, device: null }),
      isAnalyzing: signal(false),
      activeProvider: signal(null),
      lastSuggestionSource: signal(null),
      errorMessage: signal(null),
      currentText: '',
    }) as NerService & {
      fstProvider: { scan: ReturnType<typeof vi.fn>; getStatus: ReturnType<typeof vi.fn> };
      lfmLocalProvider: {
        status: ReturnType<typeof signal>;
        scan: ReturnType<typeof vi.fn>;
        getStatus: ReturnType<typeof vi.fn>;
      };
    };
  }

  it('analyzeNote still routes through the Phoenix scan provider', async () => {
    const service = makeService();
    service.fstProvider.scan.mockResolvedValue([
      {
        label: 'Kai',
        kind: 'person',
        confidence: 'high',
        rawScore: 0.91,
        reasoning: '',
        evidence: '',
        aliases: [],
      },
    ]);

    await service.analyzeNote('Kai crossed the room.');

    expect(service.fstProvider.scan).toHaveBeenCalledWith({
      noteId: 'note-1',
      noteTitle: 'Untitled Note',
      plainText: 'Kai crossed the room.',
    });
    expect(service.suggestions()).toEqual([
      expect.objectContaining({
        label: 'Kai',
        kind: 'CHARACTER',
        confidence: 0.91,
        source: 'fst',
      }),
    ]);
  });

  it('runManualScan maps LFM suggestions into enhanced cards', async () => {
    const service = makeService();
    service.lfmLocalProvider.scan.mockResolvedValue([
      {
        label: 'Fiora',
        kind: 'PERSON',
        confidence: 'high',
        reasoning: 'Named speaker with repeated evidence.',
        evidence: 'Fiora smiles without shame.',
        aliases: ['Lady Fiora'],
      },
    ]);

    await service.runManualScan('lfm_local_experiment', {
      noteId: 'note-1',
      noteTitle: 'Untitled Note',
      plainText: 'Fiora smiles without shame.',
    });

    expect(service.lfmLocalProvider.scan).toHaveBeenCalledWith({
      noteId: 'note-1',
      noteTitle: 'Untitled Note',
      plainText: 'Fiora smiles without shame.',
    });
    expect(service.suggestions()).toEqual([
      expect.objectContaining({
        label: 'Fiora',
        kind: 'CHARACTER',
        confidence: 0.9,
        context: 'Fiora smiles without shame.',
        llmEnhanced: true,
        llmReasoning: 'Named speaker with repeated evidence.',
        source: 'lfm_local_experiment',
      }),
    ]);
    expect(service.lastSuggestionSource()).toBe('lfm_local_experiment');
  });

  it('keeps prior suggestions when the local model scan fails', async () => {
    const service = makeService();
    service.suggestions.set([
      {
        id: 'existing',
        label: 'Kai',
        kind: 'UNKNOWN',
        confidence: 0.8,
        source: 'fst',
      },
    ] as any);
    service.lastSuggestionSource.set('fst');
    service.lfmLocalProvider.scan.mockRejectedValue(new Error('Model output was invalid'));

    await service.runManualScan('lfm_local_experiment', {
      noteId: 'note-1',
      noteTitle: 'Untitled Note',
      plainText: 'Kai crossed the room.',
    });

    expect(service.suggestions()).toEqual([
      expect.objectContaining({
        label: 'Kai',
        source: 'fst',
      }),
    ]);
    expect(service.errorMessage()).toBe('Model output was invalid');
    expect(service.isAnalyzing()).toBe(false);
  });

  it('filters registered labels before exposing provider suggestions', async () => {
    vi.mocked(smartGraphRegistry.isRegisteredEntity).mockImplementation(
      (label: string) => label === 'Known',
    );

    const service = makeService();
    service.fstProvider.scan.mockResolvedValue([
      {
        label: 'Known',
        kind: 'UNKNOWN',
        confidence: 'medium',
        rawScore: 0.7,
        reasoning: '',
        evidence: '',
        aliases: [],
      },
      {
        label: 'Kai',
        kind: 'UNKNOWN',
        confidence: 'medium',
        rawScore: 0.7,
        reasoning: '',
        evidence: '',
        aliases: [],
      },
    ]);

    await service.runManualScan('fst', {
      noteId: 'note-1',
      noteTitle: 'Untitled Note',
      plainText: 'Kai met Known.',
    });

    expect(service.suggestions()).toEqual([
      expect.objectContaining({
        label: 'Kai',
      }),
    ]);
  });
});
