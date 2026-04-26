import { beforeEach, describe, expect, it, vi } from 'vitest';

describe('highlightingStore', () => {
    let storedSetting: any;

    beforeEach(() => {
        vi.resetModules();
        storedSetting = null;

        vi.doMock('../dexie/settings.service', () => ({
            getSetting: vi.fn((_key: string, defaultValue: unknown) => storedSetting ?? defaultValue),
            setSetting: vi.fn((_key: string, value: unknown) => {
                storedSetting = value;
            }),
        }));
    });

    it('reloads persisted mode after the settings cache hydrates', async () => {
        const { highlightingStore } = await import('./highlightingStore');
        const listener = vi.fn();

        expect(highlightingStore.getMode()).toBe('vivid');

        storedSetting = {
            mode: 'gradient',
            focusEntityKinds: ['CHARACTER'],
            showWikilinks: true,
            showTags: true,
            showMentions: true,
            showTemporal: true,
        };

        const unsubscribe = highlightingStore.subscribe(listener);
        highlightingStore.reloadFromStorage();

        expect(highlightingStore.getMode()).toBe('gradient');
        expect(highlightingStore.getFocusEntityKinds()).toEqual(['CHARACTER']);
        expect(listener).toHaveBeenCalledTimes(1);

        unsubscribe();
    });

    it('does not notify when persisted settings match the current snapshot', async () => {
        const { highlightingStore } = await import('./highlightingStore');
        const listener = vi.fn();

        const unsubscribe = highlightingStore.subscribe(listener);
        highlightingStore.reloadFromStorage();

        expect(highlightingStore.getMode()).toBe('vivid');
        expect(listener).not.toHaveBeenCalled();

        unsubscribe();
    });
});
