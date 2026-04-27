import { $markSchema } from '@milkdown/kit/utils';

import { getPrettyTextApi } from '../../../../api';

export const entityImplicitSchema = $markSchema('entity_implicit', () => ({
    // Implicit highlights are derived from scanner metadata, so typed text
    // should not inherit them or stretch them into neighboring words.
    inclusive: false,
    attrs: {
        type: { default: 'entity_implicit' },
        kind: { default: '' },
        label: { default: '' },
        id: { default: '' },
        mode: { default: 'vivid' },
    },
    parseDOM: [
        {
            tag: 'span[data-entity-implicit]',
            getAttrs: (dom: HTMLElement) => ({
                type: dom.getAttribute('data-entity-type') || 'entity_implicit',
                kind: dom.getAttribute('data-entity-kind'),
                label: dom.getAttribute('data-entity-label'),
                id: dom.getAttribute('data-entity-id'),
                mode: dom.getAttribute('data-entity-mode'),
            }),
        },
    ],
    toDOM: (mark) => {
        const prettyTextApi = getPrettyTextApi();
        const span = {
            from: 0,
            to: 0,
            type: 'entity_implicit',
            kind: mark.attrs['kind'] || '',
            label: mark.attrs['label'] || '',
        } as any;

        return [
            'span',
            {
                'data-entity-implicit': 'true',
                'data-entity-type': 'entity_implicit',
                'data-entity-kind': mark.attrs['kind'],
                'data-entity-label': mark.attrs['label'],
                'data-entity-id': mark.attrs['id'],
                'data-entity-mode': mark.attrs['mode'],
                class: prettyTextApi.getClass(span),
                style: prettyTextApi.getStyle(span),
                title: `${mark.attrs['label']} (${mark.attrs['kind']})`,
            },
            0,
        ];
    },
    parseMarkdown: {
        match: () => false,
        runner: () => { },
    },
    toMarkdown: {
        match: (mark) => mark.type.name === 'entity_implicit',
        // Derived highlights are paint, not content. Returning false lets
        // Milkdown serialize the original text exactly once.
        runner: () => false,
    },
}));
