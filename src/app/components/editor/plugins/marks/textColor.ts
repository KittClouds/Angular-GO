// src/editor/plugins/marks/textColor.ts
// Custom text color mark for rich text formatting

import { commandsCtx } from '@milkdown/kit/core';
import { $command, $markAttr, $markSchema } from '@milkdown/kit/utils';

// HTML attributes for the text color mark
export const textColorAttr = $markAttr('textColor');

// Text color mark schema
export const textColorSchema = $markSchema('textColor', (ctx) => ({
    attrs: {
        color: { default: null },
    },
    parseDOM: [
        {
            style: 'color',
            getAttrs: (value: string) => {
                if (!value || value === 'inherit' || value === 'currentColor') return false;
                return { color: value };
            },
        },
        {
            tag: 'span[data-text-color]',
            getAttrs: (dom: HTMLElement) => ({
                color: dom.getAttribute('data-text-color'),
            }),
        },
    ],
    toDOM: (mark) => [
        'span',
        {
            style: `color: ${mark.attrs['color']}`,
            'data-text-color': mark.attrs['color'],
            class: 'toolbar-colored', // For theme-aware CSS adjustments
        },
        0,
    ],
    // This mark doesn't exist in standard markdown - skip parsing from MD
    parseMarkdown: {
        match: () => false,
        runner: () => { },
    },
    // Serialize to inline HTML in markdown (so it can be round-tripped if needed)
    toMarkdown: {
        match: (mark) => mark.type.name === 'textColor',
        runner: (state, mark, node) => {
            // Output as inline HTML wrapped text
            const color = mark.attrs['color'];
            const text = node.text || '';
            state.addNode('html', undefined, `<span style="color:${color}">${text}</span>`);
            return true;
        },
    },
}));

// Command to set text color on selection
export const setTextColorCommand = $command(
    'SetTextColor',
    (ctx) =>
        (color: string | null | undefined) =>
            (state, dispatch) => {
                const markType = textColorSchema.type(ctx);
                const { from, to } = state.selection;

                if (!dispatch) return true;

                if (!color) {
                    // Remove color mark
                    dispatch(state.tr.removeMark(from, to, markType));
                    return true;
                }

                // Add/update color mark
                const mark = markType.create({ color });
                dispatch(state.tr.addMark(from, to, mark));
                return true;
            }
);

// Helper to check if text color mark is active and get its color
export function getActiveTextColor(ctx: any): string | null {
    try {
        const view = ctx.get('editorView');
        if (!view) return null;

        const { state } = view;
        const { from, to, $from } = state.selection;

        // Get marks at cursor position or in selection
        const marks =
            from === to
                ? state.storedMarks || $from.marks()
                : state.doc.nodeAt(from)?.marks || [];

        const colorMark = marks.find((m: any) => m.type.name === 'textColor');
        return colorMark?.attrs['color'] || null;
    } catch {
        return null;
    }
}

// Check if a specific color is active
export function isTextColorActive(ctx: any, color: string): boolean {
    const activeColor = getActiveTextColor(ctx);
    return activeColor === color;
}
