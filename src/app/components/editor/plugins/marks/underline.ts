// src/editor/plugins/marks/underline.ts
// Custom underline mark with color support for rich text formatting

import { $command, $markAttr, $markSchema } from '@milkdown/kit/utils';

// HTML attributes for the underline mark
export const underlineAttr = $markAttr('underline');

// Underline mark schema
export const underlineSchema = $markSchema('underline', (ctx) => ({
    attrs: {
        color: { default: null },
    },
    parseDOM: [
        {
            tag: 'u',
            getAttrs: (dom: HTMLElement) => {
                const color = dom.style.textDecorationColor || dom.getAttribute('data-underline-color');
                return { color: color || null };
            },
        },
        {
            style: 'text-decoration',
            getAttrs: (value: string) => {
                if (!value.includes('underline')) return false;
                // We can't easily extract color from the shorthand 'text-decoration' value here reliably without regex,
                // but usually color is separate style property 'text-decoration-color'.
                return {};
            },
        },
        {
            style: 'text-decoration-line',
            getAttrs: (value: string) => {
                if (!value.includes('underline')) return false;
                return {};
            },
        },
    ],
    toDOM: (mark) => {
        const color = mark.attrs['color'];
        const style = color
            ? `text-decoration: underline; text-decoration-color: ${color}; text-underline-offset: 4px;`
            : `text-decoration: underline; text-underline-offset: 4px;`;

        return [
            'span',
            {
                style,
                'data-underline-color': color,
            },
            0,
        ];
    },
    // This mark doesn't exist in standard markdown
    parseMarkdown: {
        match: () => false,
        runner: () => { },
    },
    // Serialize to inline HTML in markdown
    toMarkdown: {
        match: (mark) => mark.type.name === 'underline',
        runner: (state, mark, node) => {
            const color = mark.attrs['color'];
            const text = node.text || '';
            const style = color
                ? `text-decoration: underline; text-decoration-color: ${color}`
                : 'text-decoration: underline';
            state.addNode('html', undefined, `<span style="${style}">${text}</span>`);
            return true;
        },
    },
}));

// Command to set underline with optional color
export const setUnderlineCommand = $command(
    'SetUnderline',
    (ctx) =>
        (color: string | null | undefined = null) =>
            (state, dispatch) => {
                const markType = underlineSchema.type(ctx);
                const { from, to } = state.selection;

                if (!dispatch) return true;

                // Remove logic: if no color provided and already has standard underline, toggle off.
                // If color provided, update/set color.

                // For simplicity: simple toggle if no color, or set if color.

                const hasMark = state.doc.rangeHasMark(from, to, markType);

                if (hasMark && !color) {
                    // Toggle off if simply clicking "Underline" (no color arg)
                    dispatch(state.tr.removeMark(from, to, markType));
                    return true;
                }

                // Add/update mark
                const mark = markType.create({ color });
                dispatch(state.tr.addMark(from, to, mark));
                return true;
            }
);
