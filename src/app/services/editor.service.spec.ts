import { describe, expect, it, vi } from 'vitest';

import { EditorService } from './editor.service';

describe('EditorService lifecycle guards', () => {
    it('does not emit save requests when no editor is registered', () => {
        const service = new EditorService();
        const saveListener = vi.fn();

        service.saveRequest$.subscribe(saveListener);
        service.save();

        expect(saveListener).not.toHaveBeenCalled();
    });

    it('emits save requests only while a live editor is registered', () => {
        const service = new EditorService();
        const saveListener = vi.fn();
        const crepe = { editor: { ctx: { get: vi.fn() } } } as any;

        service.saveRequest$.subscribe(saveListener);
        service.registerEditor(crepe);
        service.save();
        service.unregisterEditor(crepe);
        service.save();

        expect(saveListener).toHaveBeenCalledTimes(1);
        expect(service.hasEditor()).toBe(false);
    });

    it('keeps the current editor when unregisterEditor receives a different instance', () => {
        const service = new EditorService();
        const activeCrepe = { editor: { ctx: { get: vi.fn() } } } as any;

        service.registerEditor(activeCrepe);
        service.unregisterEditor({ editor: { ctx: { get: vi.fn() } } } as any);

        expect(service.getCrepe()).toBe(activeCrepe);
    });

    it('treats undo and redo as safe no-ops without an editor', () => {
        const service = new EditorService();

        expect(() => service.undo()).not.toThrow();
        expect(() => service.redo()).not.toThrow();
    });

    it('emits lightweight live updates without generating markdown snapshots', () => {
        const service = new EditorService();
        const liveListener = vi.fn();
        const getMarkdown = vi.fn();
        const crepe = {
            getMarkdown,
            editor: { ctx: { get: vi.fn() } },
        } as any;

        service.liveUpdate$.subscribe(liveListener);
        service.registerEditor(crepe);
        service.updateLiveContent({
            noteId: 'note-1',
            revision: 1,
            plainText: 'hello world',
            textLength: 11,
            timings: { plainTextMs: 1.25 },
        });

        expect(liveListener).toHaveBeenCalledWith({
            noteId: 'note-1',
            revision: 1,
            plainText: 'hello world',
            textLength: 11,
            timings: { plainTextMs: 1.25 },
        });
        expect(getMarkdown).not.toHaveBeenCalled();
    });

    it('builds full snapshots only on explicit request', () => {
        const service = new EditorService();
        const toJSON = vi.fn(() => ({ type: 'doc' }));
        const getMarkdown = vi.fn(() => 'hello world');
        const crepe = {
            getMarkdown,
            editor: {
                ctx: {
                    get: vi.fn(() => ({
                        state: {
                            doc: { toJSON },
                        },
                    })),
                },
            },
        } as any;

        service.registerEditor(crepe);
        const snapshot = service.captureSnapshot('manual-save');

        expect(snapshot?.json).toEqual({ type: 'doc' });
        expect(snapshot?.markdown).toBe('hello world');
        expect(toJSON).toHaveBeenCalledTimes(1);
        expect(getMarkdown).toHaveBeenCalledTimes(1);
    });
});
