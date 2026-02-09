// src/app/components/editor/plugins/marks/entity.ts
// Native Entity Mark Schema - The "Highlighter C" Strategy

import { $markAttr, $markSchema } from '@milkdown/kit/utils';
import { getHighlighterApi } from '../../../../api';

export const entityAttr = $markAttr('entity');

export const entitySchema = $markSchema('entity', (ctx) => ({
    inclusive: true,  // Allow typing at boundaries to extend mark (silences virtual-cursor warning)
    attrs: {
        type: { default: 'entity' },
        kind: { default: '' },
        label: { default: '' },
        id: { default: '' },
        mode: { default: 'vivid' }, // Add mode to force re-render on change
    },
    parseDOM: [
        {
            tag: 'span[data-entity-type]',
            getAttrs: (dom: HTMLElement) => ({
                type: dom.getAttribute('data-entity-type'),
                kind: dom.getAttribute('data-entity-kind'),
                label: dom.getAttribute('data-entity-label'),
                id: dom.getAttribute('data-entity-id'),
                mode: dom.getAttribute('data-entity-mode'),
            }),
        },
    ],
    toDOM: (mark) => {
        const highlighterApi = getHighlighterApi();
        // Construct span dummy to get class/style from API
        const span = {
            from: 0,
            to: 0,
            type: mark.attrs['type'] || 'entity',
            kind: mark.attrs['kind'] || '',
            label: mark.attrs['label'] || '',
        } as any; // Cast to any to satisfy DecorationSpan interface

        // Use current store mode - re-render triggered by attribute change
        // We include data-entity-mode so DOM diff sees attribute change too

        return [
            'span',
            {
                'data-entity-type': mark.attrs['type'],
                'data-entity-kind': mark.attrs['kind'],
                'data-entity-label': mark.attrs['label'],
                'data-entity-id': mark.attrs['id'],
                'data-entity-mode': mark.attrs['mode'],
                class: highlighterApi.getClass(span),
                style: highlighterApi.getStyle(span),
                title: `${mark.attrs['label']} (${mark.attrs['kind']})`
            },
            0,
        ];
    },
    parseMarkdown: {
        match: () => false,
        runner: () => { },
    },
    toMarkdown: {
        match: (mark) => mark.type.name === 'entity',
        runner: (state, mark, node) => {
            state.addNode('text', undefined, node.text || '');
        },
    },
}));
