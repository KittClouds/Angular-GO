// @vitest-environment jsdom

import { describe, expect, it, vi } from 'vitest';
import { Schema } from '@milkdown/kit/prose/model';
import { EditorState, TextSelection } from '@milkdown/kit/prose/state';

import {
    handlePlainTextCopy,
    handlePlainTextCut,
    selectionSliceToPlainText,
} from './plain-text-clipboard';

function createSchema() {
    return new Schema({
        nodes: {
            doc: { content: 'block+' },
            paragraph: {
                content: 'inline*',
                group: 'block',
                parseDOM: [{ tag: 'p' }],
                toDOM: () => ['p', 0],
            },
            text: { group: 'inline' },
        },
        marks: {
            textColor: {
                attrs: { color: { default: null } },
                parseDOM: [{ tag: 'span[data-text-color]' }],
                toDOM: (mark) => ['span', { 'data-text-color': mark.attrs['color'] }, 0],
            },
            font_family: {
                attrs: { fontFamily: { default: null } },
                parseDOM: [{ tag: 'span[data-font-family]' }],
                toDOM: (mark) => ['span', { 'data-font-family': mark.attrs['fontFamily'] }, 0],
            },
            font_size: {
                attrs: { fontSize: { default: null } },
                parseDOM: [{ tag: 'span[data-font-size]' }],
                toDOM: (mark) => ['span', { 'data-font-size': mark.attrs['fontSize'] }, 0],
            },
            strong: {
                parseDOM: [{ tag: 'strong' }],
                toDOM: () => ['strong', 0],
            },
        },
    });
}

function createMarkedState() {
    const schema = createSchema();
    const textColor = schema.marks['textColor'].create({ color: 'rgba(255, 255, 255, 0.84)' });
    const fontFamily = schema.marks['font_family'].create({
        fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
    });
    const fontSize = schema.marks['font_size'].create({ fontSize: '16px' });
    const strong = schema.marks['strong'].create();

    const doc = schema.node('doc', null, [
        schema.node('paragraph', null, [
            schema.text('"Good ghost," Isolde murmured.', [textColor, fontFamily, fontSize]),
        ]),
        schema.node('paragraph', null, [schema.text('"Best ghost," Fiora agreed.', [strong])]),
    ]);

    return EditorState.create({
        schema,
        doc,
        selection: TextSelection.create(doc, 1, doc.content.size - 1),
    });
}

function createClipboardEventMock() {
    return {
        clipboardData: {
            clearData: vi.fn(),
            setData: vi.fn(),
        },
        preventDefault: vi.fn(),
    } as unknown as ClipboardEvent;
}

describe('plain text clipboard helpers', () => {
    it('serializes marked content once without inline span wrappers', () => {
        const state = createMarkedState();

        const text = selectionSliceToPlainText(state.selection.content());

        expect(text).toBe('"Good ghost," Isolde murmured.\n\n"Best ghost," Fiora agreed.');
        expect(text).not.toContain('<span');
        expect(text.match(/Good ghost/g)?.length).toBe(1);
    });

    it('preserves paragraph breaks while stripping inline formatting', () => {
        const state = createMarkedState();

        const text = selectionSliceToPlainText(state.selection.content());

        expect(text.split('\n\n')).toEqual([
            '"Good ghost," Isolde murmured.',
            '"Best ghost," Fiora agreed.',
        ]);
    });
});

describe('plain text clipboard handlers', () => {
    it('copies only text/plain and suppresses default clipboard serialization', () => {
        const state = createMarkedState();
        const event = createClipboardEventMock();
        const view = {
            state,
            editable: true,
            dispatch: vi.fn(),
        } as any;

        const handled = handlePlainTextCopy(view, event);

        expect(handled).toBe(true);
        expect(event.clipboardData.clearData).toHaveBeenCalledOnce();
        expect(event.clipboardData.setData).toHaveBeenCalledWith(
            'text/plain',
            '"Good ghost," Isolde murmured.\n\n"Best ghost," Fiora agreed.'
        );
        expect(event.preventDefault).toHaveBeenCalledOnce();
        expect(view.dispatch).not.toHaveBeenCalled();
    });

    it('cuts plain text and removes the selected content from the document', () => {
        let state = createMarkedState();
        const event = createClipboardEventMock();
        const view = {
            get state() {
                return state;
            },
            editable: true,
            dispatch: vi.fn((tr) => {
                state = state.apply(tr);
            }),
        } as any;

        const handled = handlePlainTextCut(view, event);

        expect(handled).toBe(true);
        expect(event.clipboardData.setData).toHaveBeenCalledWith(
            'text/plain',
            '"Good ghost," Isolde murmured.\n\n"Best ghost," Fiora agreed.'
        );
        expect(state.doc.textBetween(0, state.doc.content.size, '\n\n', ' ')).toBe('');
    });
});
