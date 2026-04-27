import { $mark, $command } from '@milkdown/kit/utils';
import type { Mark } from '@milkdown/kit/prose/model';

/**
 * Font Size Mark
 */
export const fontSizeMark = $mark('font_size', () => ({
    attrs: {
        fontSize: { default: null },
    },

    parseDOM: [
        {
            style: 'font-size',
            getAttrs: (value) => {
                if (typeof value !== 'string') return false;
                return { fontSize: value };
            },
        },
        {
            tag: 'span[data-font-size]',
            getAttrs: (dom: HTMLElement) => ({
                fontSize: dom.getAttribute('data-font-size'),
            }),
        }
    ],

    toDOM: (mark: Mark) => {
        const { fontSize } = mark.attrs;
        return [
            'span',
            {
                style: `font-size: ${fontSize}`,
                'data-font-size': fontSize,
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
        match: (mark) => mark.type.name === 'font_size',
        runner: (state, mark, node) => {
            const fontSize = mark.attrs['fontSize'];
            const text = node.text || '';
            state.addNode('html', undefined, `<span style="font-size:${fontSize}">${text}</span>`);
            return true;
        },
    },
}));

/**
 * Set Font Size Command
 */
// Set Font Size Command
export const setFontSizeCommand = $command('SetFontSize', (ctx) => {
    return (fontSize: string | null | undefined) => (state, dispatch) => {
        const { from, to } = state.selection;
        const markType = fontSizeMark.type(ctx);

        if (!markType) return false;

        // Remove mark if fontSize is null or 'default'
        if (!fontSize || fontSize === 'inherit' || fontSize === 'default') {
            const tr = state.tr.removeMark(from, to, markType);
            dispatch?.(tr);
            return true;
        }

        // Add mark
        const mark = markType.create({ fontSize });
        const tr = state.tr.addMark(from, to, mark);
        dispatch?.(tr);
        return true;
    };
});

// Toggle Font Size Command
export const toggleFontSizeCommand = $command('ToggleFontSize', (ctx) => {
    return (fontSize: string | undefined) => (state, dispatch) => {
        if (!fontSize) return false;
        const { from, to } = state.selection;
        const markType = fontSizeMark.type(ctx);

        if (!markType) return false;

        // Check if this size is already applied
        let hasMark = false;
        state.doc.nodesBetween(from, to, (node: any) => {
            if (hasMark) return false;
            if (node.marks && node.marks.some(
                (m: any) => m.type === markType && m.attrs['fontSize'] === fontSize
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
        const mark = markType.create({ fontSize });
        const tr = state.tr.addMark(from, to, mark);
        dispatch?.(tr);
        return true;
    };
});

// Helper functions for checking active state
export function getActiveFontSize(ctx: any): string | null {
    try {
        const view = ctx.get('editorView');
        if (!view) return null;

        const { state } = view;
        const { from, to, $from } = state.selection;

        // Get marks at cursor position or in selection
        const marks = from === to
            ? state.storedMarks || $from.marks()
            : state.doc.nodeAt(from)?.marks || [];

        const mark = marks.find((m: any) => m.type.name === 'font_size');
        return mark?.attrs['fontSize'] || null;
    } catch {
        return null;
    }
}

export function getActiveFontFamily(ctx: any): string | null {
    try {
        const view = ctx.get('editorView');
        if (!view) return null;

        const { state } = view;
        const { from, to, $from } = state.selection;

        const marks = from === to
            ? state.storedMarks || $from.marks()
            : state.doc.nodeAt(from)?.marks || [];

        const mark = marks.find((m: any) => m.type.name === 'font_family');
        return mark?.attrs.fontFamily || null;
    } catch {
        return null;
    }
}

export const fontSizePlugin = [
    fontSizeMark,
    setFontSizeCommand,
    toggleFontSizeCommand,
];
