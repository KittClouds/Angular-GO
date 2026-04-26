import { describe, expect, it } from 'vitest';
import { Schema } from '@milkdown/kit/prose/model';
import { EditorState } from '@milkdown/kit/prose/state';

import { reconcileImplicitEntityMarks } from './prettyTextPlugin';

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
            entity: {
                attrs: {
                    type: { default: 'entity' },
                    kind: { default: '' },
                    label: { default: '' },
                    id: { default: '' },
                    mode: { default: 'vivid' },
                },
                toDOM: (mark) => ['span', { 'data-entity-type': mark.attrs['type'] }, 0],
            },
            entity_implicit: {
                attrs: {
                    type: { default: 'entity_implicit' },
                    kind: { default: '' },
                    label: { default: '' },
                    id: { default: '' },
                    mode: { default: 'vivid' },
                },
                toDOM: (mark) => ['span', { 'data-entity-type': mark.attrs['type'] }, 0],
            },
        },
    });
}

function createState(explicitAttrs?: Record<string, string>) {
    const schema = createSchema();
    const explicitMark = explicitAttrs
        ? schema.marks['entity'].create(explicitAttrs)
        : null;
    const doc = schema.node('doc', null, [
        schema.node('paragraph', null, [
            schema.text('Kai', explicitMark ? [explicitMark] : []),
            schema.text(' moved.'),
        ]),
    ]);

    return EditorState.create({ schema, doc });
}

function getFirstTextMarkNames(state: EditorState): string[] {
    let names: string[] = [];
    state.doc.descendants((node) => {
        if (node.isText && node.text === 'Kai') {
            names = node.marks.map((mark) => mark.type.name);
            return false;
        }
        return;
    });
    return names;
}

describe('reconcileImplicitEntityMarks', () => {
    const implicitSpan = {
        type: 'entity_implicit' as const,
        from: 1,
        to: 4,
        label: 'Kai',
        kind: 'CHARACTER',
        entityId: 'entity-1',
    };

    it('removes stale explicit overlaps and applies the implicit mark', () => {
        const state = createState({ type: 'entity', id: 'ghost-1', label: 'Kai' });

        const tr = reconcileImplicitEntityMarks(
            state,
            [implicitSpan],
            state.schema.marks['entity'],
            state.schema.marks['entity_implicit'],
            {
                mode: 'vivid',
                lookup: {
                    hasEntityId: () => false,
                    hasEntityLabel: () => false,
                },
            },
        );

        expect(tr).not.toBeNull();

        const nextState = state.apply(tr!);
        expect(getFirstTextMarkNames(nextState)).toEqual(['entity_implicit']);
    });

    it('removes legacy derived explicit overlaps and applies the implicit mark', () => {
        const state = createState({ type: 'entity_implicit', id: 'entity-1', label: 'Kai' });

        const tr = reconcileImplicitEntityMarks(
            state,
            [implicitSpan],
            state.schema.marks['entity'],
            state.schema.marks['entity_implicit'],
            {
                mode: 'vivid',
                lookup: {
                    hasEntityId: (id) => id === 'entity-1',
                    hasEntityLabel: (label) => label === 'Kai',
                },
            },
        );

        expect(tr).not.toBeNull();

        const nextState = state.apply(tr!);
        expect(getFirstTextMarkNames(nextState)).toEqual(['entity_implicit']);
    });

    it('keeps valid explicit marks authoritative and skips implicit paint-over', () => {
        const state = createState({ type: 'entity', id: 'entity-1', label: 'Kai', kind: 'CHARACTER' });

        const tr = reconcileImplicitEntityMarks(
            state,
            [implicitSpan],
            state.schema.marks['entity'],
            state.schema.marks['entity_implicit'],
            {
                mode: 'vivid',
                lookup: {
                    hasEntityId: (id) => id === 'entity-1',
                    hasEntityLabel: (label) => label === 'Kai',
                },
            },
        );

        expect(tr).toBeNull();
        expect(getFirstTextMarkNames(state)).toEqual(['entity']);
    });

    it('replaces incomplete explicit marks that would visually block implicit highlights', () => {
        const state = createState({ type: 'entity', label: 'Kai' });

        const tr = reconcileImplicitEntityMarks(
            state,
            [implicitSpan],
            state.schema.marks['entity'],
            state.schema.marks['entity_implicit'],
            {
                mode: 'vivid',
                lookup: {
                    hasEntityId: (id) => id === 'entity-1',
                    hasEntityLabel: (label) => label === 'Kai',
                },
            },
        );

        expect(tr).not.toBeNull();

        const nextState = state.apply(tr!);
        expect(getFirstTextMarkNames(nextState)).toEqual(['entity_implicit']);
    });

    it('stays healed when the same implicit span set is reused after stale cleanup', () => {
        const state = createState({ type: 'entity', id: 'ghost-1', label: 'Kai' });

        const firstTr = reconcileImplicitEntityMarks(
            state,
            [implicitSpan],
            state.schema.marks['entity'],
            state.schema.marks['entity_implicit'],
            {
                mode: 'vivid',
                lookup: {
                    hasEntityId: () => false,
                    hasEntityLabel: () => false,
                },
            },
        );

        const healedState = state.apply(firstTr!);
        const secondTr = reconcileImplicitEntityMarks(
            healedState,
            [implicitSpan],
            healedState.schema.marks['entity'],
            healedState.schema.marks['entity_implicit'],
            {
                mode: 'vivid',
                lookup: {
                    hasEntityId: () => false,
                    hasEntityLabel: () => false,
                },
            },
        );

        expect(secondTr).not.toBeNull();

        const reusedSpanState = healedState.apply(secondTr!);
        expect(getFirstTextMarkNames(reusedSpanState)).toEqual(['entity_implicit']);
    });
});
