import { editorViewOptionsCtx } from '@milkdown/kit/core';
import type { Ctx } from '@milkdown/kit/ctx';
import type { Slice } from '@milkdown/kit/prose/model';
import type { EditorView } from '@milkdown/kit/prose/view';

type ClipboardHandler = NonNullable<
    NonNullable<NonNullable<EditorView['props']['handleDOMEvents']>['copy']>
>;

function getSelectedPlainText(view: EditorView): string | null {
    const { selection } = view.state;
    if (selection.empty) return null;

    return selectionSliceToPlainText(selection.content());
}

function writeSelectionToClipboard(view: EditorView, event: ClipboardEvent): string | null {
    const text = getSelectedPlainText(view);
    if (!text || !event.clipboardData) return null;

    event.clipboardData.clearData?.();
    event.clipboardData.setData('text/plain', text);
    event.preventDefault();

    return text;
}

export function selectionSliceToPlainText(slice: Slice): string {
    return slice.content.textBetween(0, slice.content.size, '\n\n', '\n');
}

export function handlePlainTextCopy(view: EditorView, event: ClipboardEvent): boolean {
    return writeSelectionToClipboard(view, event) !== null;
}

export function handlePlainTextCut(view: EditorView, event: ClipboardEvent): boolean {
    if (!view.editable) return false;

    const text = writeSelectionToClipboard(view, event);
    if (text === null) return false;

    view.dispatch(view.state.tr.deleteSelection().scrollIntoView());
    return true;
}

export function configurePlainTextClipboard() {
    return (ctx: Ctx) => {
        ctx.update(editorViewOptionsCtx, (prev) => {
            const previousHandleDomEvents = prev.handleDOMEvents;
            const previousCopy = previousHandleDomEvents?.copy as ClipboardHandler | undefined;
            const previousCut = previousHandleDomEvents?.cut as ClipboardHandler | undefined;

            return {
                ...prev,
                clipboardTextSerializer: selectionSliceToPlainText,
                handleDOMEvents: {
                    ...previousHandleDomEvents,
                    copy: (view, event) => {
                        if (handlePlainTextCopy(view, event as ClipboardEvent)) return true;
                        return previousCopy?.(view, event) ?? false;
                    },
                    cut: (view, event) => {
                        if (handlePlainTextCut(view, event as ClipboardEvent)) return true;
                        return previousCut?.(view, event) ?? false;
                    },
                },
            };
        });
    };
}
