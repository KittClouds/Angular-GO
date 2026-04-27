import { $mark, $command } from '@milkdown/kit/utils';
import type { Mark } from '@milkdown/kit/prose/model';

/**
 * Font Family Mark
 */
export const fontFamilyMark = $mark('font_family', () => ({
    attrs: {
        fontFamily: { default: null },
    },

    parseDOM: [
        {
            style: 'font-family',
            getAttrs: (value) => {
                if (typeof value !== 'string') return false;
                return { fontFamily: value };
            },
        },
        {
            tag: 'span[data-font-family]',
            getAttrs: (dom: HTMLElement) => ({
                fontFamily: dom.getAttribute('data-font-family'),
            }),
        }
    ],

    toDOM: (mark: Mark) => {
        const { fontFamily } = mark.attrs;
        return [
            'span',
            {
                style: `font-family: ${fontFamily}`,
                'data-font-family': fontFamily,
            },
            0,
        ];
    },

    // This mark doesn't exist in standard markdown - skip parsing from MD
    parseMarkdown: {
        match: () => false,
        runner: () => { },
    },
    // Serialize to inline HTML in markdown (so it can be round-tripped if needed)
    toMarkdown: {
        match: (mark) => mark.type.name === 'font_family',
        runner: (state, mark, node) => {
            const fontFamily = mark.attrs['fontFamily'];
            const text = node.text || '';
            state.addNode('html', undefined, `<span style="font-family:${fontFamily}">${text}</span>`);
            return true;
        },
    },
}));

/**
 * Set Font Family Command
 */
// Set Font Family Command
export const setFontFamilyCommand = $command('SetFontFamily', (ctx) => {
    return (fontFamily: string | null | undefined) => (state, dispatch) => {
        const { from, to } = state.selection;
        const markType = fontFamilyMark.type(ctx);

        if (!markType) return false;

        // Remove mark if fontFamily is null or 'default'
        if (!fontFamily || fontFamily === 'inherit' || fontFamily === 'default') {
            const tr = state.tr.removeMark(from, to, markType);
            dispatch?.(tr);
            return true;
        }

        // Add mark
        const mark = markType.create({ fontFamily });
        const tr = state.tr.addMark(from, to, mark);
        dispatch?.(tr);
        return true;
    };
});

// Toggle Font Family Command (smart toggle/remove)
export const toggleFontFamilyCommand = $command('ToggleFontFamily', (ctx) => {
    return (fontFamily: string | undefined) => (state, dispatch) => {
        if (!fontFamily) return false;
        const { from, to } = state.selection;
        const markType = fontFamilyMark.type(ctx);

        if (!markType) return false;

        // Check if this font is already applied
        let hasMark = false;
        state.doc.nodesBetween(from, to, (node: any) => {
            if (hasMark) return false;
            if (node.marks && node.marks.some(
                (m: any) => m.type === markType && m.attrs['fontFamily'] === fontFamily
            )) {
                hasMark = true;
            }
            return !hasMark;
        });

        if (hasMark) {
            // Remove the mark
            const tr = state.tr.removeMark(from, to, markType);
            dispatch?.(tr);
            return true;
        }

        // Add the mark
        const mark = markType.create({ fontFamily });
        const tr = state.tr.addMark(from, to, mark);
        dispatch?.(tr);
        return true;
    };
});

export const fontFamilyPlugin = [
    fontFamilyMark,
    setFontFamilyCommand,
    toggleFontFamilyCommand,
];
