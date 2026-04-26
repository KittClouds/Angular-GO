import type { Ctx } from '@milkdown/kit/ctx';
import { cursor as cursorPlugin, dropIndicatorConfig } from '@milkdown/kit/plugin/cursor';
import { $prose } from '@milkdown/kit/utils';
import { createVirtualCursor } from 'prosemirror-virtual-cursor';

const ENTITY_IMPLICIT_MARK = 'entity_implicit';

export function configureEditorCursor() {
    return (ctx: Ctx) => {
        ctx.update(dropIndicatorConfig.key, () => ({
            class: 'crepe-drop-cursor',
            width: 4,
            color: false as const,
        }));
    };
}

export const editorCursorPlugin = cursorPlugin;

export const editorVirtualCursorPlugin = $prose(() =>
    createVirtualCursor({
        skipWarning: [ENTITY_IMPLICIT_MARK],
    })
);
