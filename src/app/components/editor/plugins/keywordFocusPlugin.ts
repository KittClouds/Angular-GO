import { Plugin, PluginKey } from '@milkdown/kit/prose/state';
import { $prose } from '@milkdown/kit/utils';
import { Decoration, DecorationSet, type EditorView } from '@milkdown/kit/prose/view';

import { getPrettyTextApi } from '../../../api/pretty-text-api';
import type { DecorationSpan } from '../../../lib/Scanner/types';

const KEYWORD_FOCUS_PLUGIN_KEY = new PluginKey('KEYWORD_FOCUS');

function buildKeywordDecorationSet(view: EditorView): DecorationSet {
    const prettyTextApi = getPrettyTextApi();
    const keywordSpans = prettyTextApi.getDecorations(view.state.doc)
        .filter((span: DecorationSpan) => span.type === 'keyword_focus');

    if (keywordSpans.length === 0) {
        return DecorationSet.empty;
    }

    const decorations = keywordSpans
        .filter(span => span.from < span.to && span.from >= 0 && span.to <= view.state.doc.content.size)
        .map(span => Decoration.inline(span.from, span.to, {
            class: prettyTextApi.getClass(span),
            style: prettyTextApi.getStyle(span),
            'data-keyword-focus': span.label,
        }));

    return DecorationSet.create(view.state.doc, decorations);
}

export const keywordFocusPlugin = $prose(() => {
    const prettyTextApi = getPrettyTextApi();

    return new Plugin({
        key: KEYWORD_FOCUS_PLUGIN_KEY,

        state: {
            init: () => DecorationSet.empty,
            apply(tr, set) {
                const meta = tr.getMeta(KEYWORD_FOCUS_PLUGIN_KEY) as { decorations?: DecorationSet } | undefined;
                if (meta?.decorations) {
                    return meta.decorations;
                }

                return tr.docChanged ? set.map(tr.mapping, tr.doc) : set;
            },
        },

        props: {
            decorations(state) {
                return KEYWORD_FOCUS_PLUGIN_KEY.getState(state);
            },
        },

        view(editorView: EditorView) {
            const refresh = () => {
                const decorations = buildKeywordDecorationSet(editorView);
                const tr = editorView.state.tr.setMeta(KEYWORD_FOCUS_PLUGIN_KEY, { decorations });
                editorView.dispatch(tr);
            };

            const unsubscribe = prettyTextApi.subscribe(refresh);
            setTimeout(refresh, 0);

            return {
                update(view, prevState) {
                    if (!view.state.doc.eq(prevState.doc)) {
                        refresh();
                    }
                },
                destroy() {
                    unsubscribe();
                },
            };
        },
    });
});
