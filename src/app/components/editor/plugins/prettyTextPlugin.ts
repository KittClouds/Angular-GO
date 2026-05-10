import { isDevMode } from '@angular/core';
import { Plugin, PluginKey } from '@milkdown/kit/prose/state';
import { $prose } from '@milkdown/kit/utils';
import type { MarkType } from '@milkdown/kit/prose/model';
import type { EditorView } from '@milkdown/kit/prose/view';
import type { EditorState, Transaction } from '@milkdown/kit/prose/state';

import { getPrettyTextApi } from '../../../api/pretty-text-api';
import { docContent } from '../../../lib/Scanner/prosemirror-bridge';
import type { DecorationSpan } from '../../../lib/Scanner/types';
import { smartGraphRegistry } from '../../../lib/registry';
import {
    classifyExplicitEntityAttrs,
    type EntityLookup,
} from '../entity-mark-sanitizer';

const PRETTY_TEXT_PLUGIN_KEY = new PluginKey('PRETTY_TEXT');
const WORD_BOUNDARY_RE = /[\s.,!?;:\-\n\r]/;

type EntityAttrs = {
    type?: string;
    kind?: string;
    label?: string;
    id?: string;
    mode?: string;
};

type ExplicitEntityOverlap = {
    hasBlockingMark: boolean;
    staleRanges: Array<{ from: number; to: number; reason: 'stale' | 'derived'; attrs: EntityAttrs }>;
};

type ReconcileImplicitMarksOptions = {
    mode: string;
    lookup: EntityLookup;
    logAutoPrune?: (range: { from: number; to: number; reason: 'stale' | 'derived'; attrs: EntityAttrs }) => void;
};

function normalizeEntityAttrs(attrs: unknown): EntityAttrs {
    if (!attrs || typeof attrs !== 'object' || Array.isArray(attrs)) {
        return {};
    }

    const record = attrs as Record<string, unknown>;
    return {
        type: typeof record['type'] === 'string' ? record['type'] : undefined,
        kind: typeof record['kind'] === 'string' ? record['kind'] : undefined,
        label: typeof record['label'] === 'string' ? record['label'] : undefined,
        id: typeof record['id'] === 'string' ? record['id'] : undefined,
        mode: typeof record['mode'] === 'string' ? record['mode'] : undefined,
    };
}

function isRangeOverlapping(leftFrom: number, leftTo: number, rightFrom: number, rightTo: number): boolean {
    return leftFrom < rightTo && rightFrom < leftTo;
}

function getTextNodeRange(pos: number, nodeSize: number): { from: number; to: number } {
    return {
        from: pos,
        to: pos + nodeSize,
    };
}

export function inspectExplicitEntityOverlap(
    state: EditorState,
    explicitMarkType: MarkType | undefined,
    from: number,
    to: number,
    lookup: EntityLookup,
): ExplicitEntityOverlap {
    if (!explicitMarkType) {
        return { hasBlockingMark: false, staleRanges: [] };
    }

    const staleRanges: ExplicitEntityOverlap['staleRanges'] = [];
    const seenRanges = new Set<string>();
    let hasBlockingMark = false;

    state.doc.descendants((node, pos) => {
        if (!node.isText) {
            return;
        }

        const range = getTextNodeRange(pos, node.nodeSize);
        if (!isRangeOverlapping(range.from, range.to, from, to)) {
            return;
        }

        for (const mark of node.marks) {
            if (mark.type !== explicitMarkType) {
                continue;
            }

            const attrs = normalizeEntityAttrs(mark.attrs);
            const status = classifyExplicitEntityAttrs(attrs, lookup);
            if (status === 'valid' && !isIncompleteExplicitEntityAttrs(attrs)) {
                hasBlockingMark = true;
                continue;
            }

            const reason = status === 'derived' || status === 'valid' ? 'derived' : 'stale';
            const key = `${range.from}:${range.to}:${reason}`;
            if (seenRanges.has(key)) {
                continue;
            }

            staleRanges.push({ ...range, reason, attrs });
            seenRanges.add(key);
        }
    });

    return { hasBlockingMark, staleRanges };
}

function isIncompleteExplicitEntityAttrs(attrs: EntityAttrs): boolean {
    return !attrs.id?.trim() || !attrs.kind?.trim() || attrs.type !== 'entity';
}

export function reconcileImplicitEntityMarks(
    state: EditorState,
    spans: DecorationSpan[],
    explicitMarkType: MarkType | undefined,
    implicitMarkType: MarkType | undefined,
    options: ReconcileImplicitMarksOptions,
): Transaction | null {
    if (!implicitMarkType) {
        return null;
    }

    let tr = state.tr.removeMark(0, state.doc.content.size, implicitMarkType);
    let changed = tr.steps.length > 0;
    const removedExplicitRanges = new Set<string>();

    for (const span of spans) {
        if (span.type !== 'entity_implicit') {
            continue;
        }
        if (span.from < 0 || span.to > state.doc.content.size || span.from >= span.to) {
            continue;
        }

        const overlap = inspectExplicitEntityOverlap(state, explicitMarkType, span.from, span.to, options.lookup);
        for (const staleRange of overlap.staleRanges) {
            const key = `${staleRange.from}:${staleRange.to}`;
            if (removedExplicitRanges.has(key)) {
                continue;
            }

            tr = tr.removeMark(staleRange.from, staleRange.to, explicitMarkType);
            changed = true;
            removedExplicitRanges.add(key);
            options.logAutoPrune?.(staleRange);
        }

        if (overlap.hasBlockingMark) {
            continue;
        }

        const mark = implicitMarkType.create({
            type: 'entity_implicit',
            kind: span.kind || '',
            label: span.label || '',
            id: span.entityId || '',
            mode: options.mode,
        });
        tr = tr.addMark(span.from, span.to, mark);
        changed = true;
    }

    return changed ? tr : null;
}

export const prettyTextPlugin = $prose(() => {
    const prettyTextApi = getPrettyTextApi();
    const entityLookup: EntityLookup = {
        hasEntityId: (id) => !!smartGraphRegistry.getEntityById(id),
        hasEntityLabel: (label) => !!smartGraphRegistry.findEntityByLabel(label),
    };

    return new Plugin({
        key: PRETTY_TEXT_PLUGIN_KEY,

        view(editorView: EditorView) {
            let suppressedUpdates = 0;
            let lastImplicitSignature = '';

            const dispatchInternal = (view: EditorView, transaction: Transaction) => {
                suppressedUpdates += 1;
                view.dispatch(transaction);
            };

            const getMarkTypes = (view: EditorView) => ({
                explicit: view.state.schema.marks['entity'] as MarkType | undefined,
                implicit: view.state.schema.marks['entity_implicit'] as MarkType | undefined,
            });

            const spanSignature = (spans: DecorationSpan[]) =>
                spans
                    .map(span => `${span.from}:${span.to}:${span.label}:${span.kind || ''}:${span.entityId || ''}`)
                    .join('|');

            const syncImplicitMarks = (view: EditorView, spans: DecorationSpan[]) => {
                const { explicit, implicit } = getMarkTypes(view);
                const tr = reconcileImplicitEntityMarks(view.state, spans, explicit, implicit, {
                    mode: prettyTextApi.getMode(),
                    lookup: entityLookup,
                    logAutoPrune: (range) => {
                        if (!isDevMode()) {
                            return;
                        }
                        const label = range.attrs.label?.trim() || '(unlabeled)';
                        console.debug(
                            `[PrettyTextPlugin] Auto-pruned ${range.reason} explicit entity mark for "${label}" at ${range.from}-${range.to}`,
                        );
                    },
                });

                if (tr) {
                    dispatchInternal(view, tr);
                }
            };

            const resolveExplicitAttrs = (attrs: EntityAttrs): EntityAttrs => {
                const id = typeof attrs.id === 'string' ? attrs.id.trim() : '';
                const label = typeof attrs.label === 'string' ? attrs.label.trim() : '';
                const kind = typeof attrs.kind === 'string' ? attrs.kind : '';
                const entity = (id ? smartGraphRegistry.getEntityById(id) : null) || (label ? smartGraphRegistry.findEntityByLabel(label) : null);

                return {
                    type: 'entity',
                    mode: prettyTextApi.getMode(),
                    id: entity?.id || id,
                    label: entity?.label || label,
                    kind: entity?.kind || kind,
                };
            };

            const attrsEqual = (a: EntityAttrs, b: EntityAttrs) =>
                (a.type || '') === (b.type || '') &&
                (a.kind || '') === (b.kind || '') &&
                (a.label || '') === (b.label || '') &&
                (a.id || '') === (b.id || '') &&
                (a.mode || '') === (b.mode || '');

            const refreshEntityMarkPresentation = (view: EditorView) => {
                const { explicit, implicit } = getMarkTypes(view);
                if (!explicit && !implicit) {
                    return;
                }

                let tr = view.state.tr;
                let changed = false;
                const mode = prettyTextApi.getMode();

                view.state.doc.descendants((node, pos) => {
                    if (!node.isText) {
                        return;
                    }

                    for (const mark of node.marks) {
                        if (explicit && mark.type === explicit) {
                            const attrs = normalizeEntityAttrs(mark.attrs);
                            const status = classifyExplicitEntityAttrs(attrs, entityLookup);
                            if (status !== 'valid') {
                                tr = tr.removeMark(pos, pos + node.nodeSize, explicit);
                                changed = true;
                                continue;
                            }

                            const nextAttrs = resolveExplicitAttrs(mark.attrs as EntityAttrs);
                            if (!attrsEqual(mark.attrs as EntityAttrs, nextAttrs)) {
                                tr = tr.removeMark(pos, pos + node.nodeSize, explicit);
                                tr = tr.addMark(pos, pos + node.nodeSize, explicit.create(nextAttrs));
                                changed = true;
                            }
                        } else if (implicit && mark.type === implicit) {
                            const nextAttrs: EntityAttrs = {
                                ...mark.attrs,
                                type: 'entity_implicit',
                                mode,
                            };
                            if (!attrsEqual(mark.attrs as EntityAttrs, nextAttrs)) {
                                tr = tr.removeMark(pos, pos + node.nodeSize, implicit);
                                tr = tr.addMark(pos, pos + node.nodeSize, implicit.create(nextAttrs));
                                changed = true;
                            }
                        }
                    }
                });

                if (changed) {
                    dispatchInternal(view, tr);
                }
            };

            const syncFromApi = (view: EditorView) => {
                const implicitSpans = prettyTextApi.getImplicitDecorations(view.state.doc);
                const nextSignature = spanSignature(implicitSpans);
                if (nextSignature !== lastImplicitSignature) {
                    syncImplicitMarks(view, implicitSpans);
                    lastImplicitSignature = nextSignature;
                }

                refreshEntityMarkPresentation(view);
            };

            const scheduleRefreshForEdit = (view: EditorView, prevState: EditorState) => {
                const prevText = docContent(prevState.doc);
                const nextText = docContent(view.state.doc);
                if (prevText === nextText) {
                    return;
                }

                const delta = Math.abs(nextText.length - prevText.length);
                const isDelete = nextText.length < prevText.length;
                const isPaste = delta > 3;
                const cursorPos = view.state.selection.from;
                const boundaryChar = view.state.doc.textBetween(
                    Math.max(0, cursorPos - 1),
                    cursorPos,
                    '\n',
                    '\n',
                );
                const isBoundary = WORD_BOUNDARY_RE.test(boundaryChar);

                const delayMs = isBoundary || isPaste
                    ? 90
                    : isDelete
                        ? 160
                        : 325;

                prettyTextApi.scheduleImplicitRefresh(view.state.doc, {
                    delayMs,
                    allowRealign: false,
                });
            };

            const handlePhoenixReady = () => {
                prettyTextApi.scheduleImplicitRefresh(editorView.state.doc, {
                    immediate: true,
                    force: true,
                });
            };

            const handleDictionaryRebuilt = () => {
                refreshEntityMarkPresentation(editorView);
                prettyTextApi.scheduleImplicitRefresh(editorView.state.doc, {
                    immediate: true,
                    force: true,
                    allowRealign: false,
                });
            };

            const unsubscribe = prettyTextApi.subscribe(() => syncFromApi(editorView));

            window.addEventListener('phoenix-ready', handlePhoenixReady);
            window.addEventListener('dictionary-rebuilt', handleDictionaryRebuilt);

            setTimeout(() => {
                prettyTextApi.primeImplicitDecorations(editorView.state.doc);
                syncFromApi(editorView);
            }, 0);

            return {
                update(view: EditorView, prevState: EditorState) {
                    if (suppressedUpdates > 0) {
                        suppressedUpdates -= 1;
                        return;
                    }

                    if (!view.state.doc.eq(prevState.doc)) {
                        scheduleRefreshForEdit(view, prevState);
                    }
                },

                destroy() {
                    unsubscribe();
                    window.removeEventListener('phoenix-ready', handlePhoenixReady);
                    window.removeEventListener('dictionary-rebuilt', handleDictionaryRebuilt);
                },
            };
        },
    });
});
