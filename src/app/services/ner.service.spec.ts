import { describe, expect, it, vi, beforeEach } from 'vitest';
import { signal } from '@angular/core';

vi.mock('../lib/registry', () => ({
    smartGraphRegistry: {
        isRegisteredEntity: vi.fn(() => false),
        registerEntity: vi.fn(),
    }
}));

vi.mock('../lib/store/note-editor.store', () => ({
    NoteEditorStore: vi.fn(),
}));

vi.mock('./gokitt.service', () => ({
    GoKittService: vi.fn(),
}));

vi.mock('../lib/dexie/settings.service', () => ({
    getSetting: vi.fn(() => null),
    setSetting: vi.fn(),
}));

vi.mock('uuid', () => ({
    v4: vi.fn(() => 'uuid-1'),
}));

import { smartGraphRegistry } from '../lib/registry';
import { NerService } from './ner.service';

describe('NerService manual discovery path', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    function makeService(rawSuggestions: any[]) {
        return Object.assign(Object.create(NerService.prototype), {
            goKitt: {
                scanDiscovery: vi.fn(async () => rawSuggestions),
            },
            noteStore: {
                currentNote: vi.fn(() => null),
            },
            suggestions: signal([]),
            fstEnabled: signal(true),
            isAnalyzing: signal(false),
            currentText: '',
        }) as NerService & {
            goKitt: { scanDiscovery: ReturnType<typeof vi.fn> };
        };
    }

    it('manual analyzeNote still calls GoKitt discovery', async () => {
        const service = makeService([
            { token: 'Kai', kind: 'UNKNOWN', score: 6, status: 0 },
        ]);

        await service.analyzeNote('Kai crossed the room.');

        expect(service.goKitt.scanDiscovery).toHaveBeenCalledWith('Kai crossed the room.');
    });

    it('manual analyzeNote still populates filtered suggestions', async () => {
        vi.mocked(smartGraphRegistry.isRegisteredEntity).mockImplementation((label: string) => label === 'Known');

        const service = makeService([
            { token: 'Kai', kind: 'UNKNOWN', score: 6, status: 0 },
            { token: 'Known', kind: 'UNKNOWN', score: 3, status: 0 },
            { token: 'Promoted', kind: 'UNKNOWN', score: 2, status: 1 },
        ]);

        await service.analyzeNote('Kai met Known and Promoted.');

        expect(service.suggestions()).toEqual([
            expect.objectContaining({
                label: 'Kai',
                kind: 'UNKNOWN',
                confidence: 6,
            })
        ]);
        expect(service.isAnalyzing()).toBe(false);
    });
});
