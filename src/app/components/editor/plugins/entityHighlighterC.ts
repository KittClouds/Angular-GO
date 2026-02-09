// src/app/components/editor/plugins/entityHighlighterC.ts
// =============================================================================
// HIGHLIGHTER C: TRUE MARK-BASED (Like Text Color)
// =============================================================================
//
// The key insight: Text color doesn't flicker because it's a MARK stored in
// the document JSON, applied ONCE and ProseMirror just renders it.
//
// This highlighter:
// - Uses entity MARKS (stored in document JSON, like text color)
// - Applies marks ONCE on note open
// - NO constant scanning/rebuilding on every keystroke
// - NO decorations (those are view-layer only and cause flicker)
//
// =============================================================================

import { Plugin, PluginKey } from '@milkdown/kit/prose/state';
import { $prose } from '@milkdown/kit/utils';
import type { EditorView } from '@milkdown/kit/prose/view';
import type { EditorState, Transaction } from '@milkdown/kit/prose/state';

import { getHighlighterApi } from '../../../api';
import type { DecorationSpan } from '../../../lib/Scanner/types';

// =============================================================================
// PLUGIN KEY
// =============================================================================

const HIGHLIGHTER_C_KEY = new PluginKey('ENTITY_HIGHLIGHTER_C');

export const entityHighlighterC = $prose((ctx) => {
    const highlighterApi = getHighlighterApi();
    let hasAppliedInitialMarks = false;
    let lastNoteId = '';

    /**
     * Apply entity marks to text ranges that don't already have them.
     * This is the equivalent of clicking the color picker - one-time application.
     */
    function applyEntityMarksOnce(view: EditorView, spans: DecorationSpan[]): void {
        const { state } = view;
        const entityMarkType = state.schema.marks['entity'];

        if (!entityMarkType) {
            console.warn('[HighlighterC] Entity mark type not found in schema');
            return;
        }

        let tr = state.tr;
        let anyAdded = false;

        for (const span of spans) {
            // Skip invalid positions
            if (span.from < 0 || span.to > state.doc.content.size) continue;
            if (span.from >= span.to) continue;

            // Check if this text range already has an entity mark
            let hasEntityMark = false;
            state.doc.nodesBetween(span.from, span.to, (node, pos) => {
                if (node.isText && node.marks.some(m => m.type.name === 'entity')) {
                    hasEntityMark = true;
                    return false; // stop iteration
                }
                return true; // continue iteration
            });

            if (!hasEntityMark) {
                // Apply entity mark (like applying text color)
                const mark = entityMarkType.create({
                    type: span.type || 'entity_implicit',
                    kind: span.kind || '',
                    label: span.label || '',
                    id: span.entityId || '',
                    mode: highlighterApi.getMode(),
                });
                tr = tr.addMark(span.from, span.to, mark);
                anyAdded = true;
            }
        }

        if (anyAdded) {
            // Dispatch the transaction to add marks to document
            view.dispatch(tr);
            console.log(`[HighlighterC] Applied ${spans.length} entity marks`);
        }
    }

    /**
     * Scan and apply marks - called only on note open or explicit trigger
     * This is ASYNC because we need to wait for GoKitt scan to complete
     */
    async function scanAndApplyMarks(view: EditorView): Promise<void> {
        // Use the async method that waits for scan to complete
        const spans = await highlighterApi.scanForSpansAsync(view.state.doc);

        const entitySpans = spans.filter(s =>
            s.type === 'entity' ||
            s.type === 'entity_implicit' ||
            s.type === 'entity_ref'
        );

        if (entitySpans.length > 0) {
            applyEntityMarksOnce(view, entitySpans);
        }
        // No warning if empty - normal for notes without entities
    }

    return new Plugin({
        key: HIGHLIGHTER_C_KEY,

        // NO STATE - we don't use decorations at all
        // Marks are stored in the document JSON

        view(editorView: EditorView) {
            // Apply marks on initial load (after a brief delay for content to load)
            setTimeout(() => {
                if (!hasAppliedInitialMarks) {
                    hasAppliedInitialMarks = true;
                    scanAndApplyMarks(editorView);
                }
            }, 500);

            // Also listen for gokitt-ready event to rescan when WASM is ready
            const handleGoKittReady = () => {
                console.log('[HighlighterC] GoKitt ready event - rescanning');
                scanAndApplyMarks(editorView);
            };
            window.addEventListener('gokitt-ready', handleGoKittReady);

            // Subscribe to mode changes to update mark attributes
            const unsubscribe = highlighterApi.subscribe(() => {
                // Also try to apply marks if we haven't yet (GoKitt may have just become ready)
                const spans = highlighterApi.getDecorations(editorView.state.doc);
                if (spans.length > 0) {
                    const entitySpans = spans.filter(s =>
                        s.type === 'entity' ||
                        s.type === 'entity_implicit' ||
                        s.type === 'entity_ref'
                    );
                    if (entitySpans.length > 0) {
                        console.log('[HighlighterC] Subscribe notified with spans - applying marks');
                        applyEntityMarksOnce(editorView, entitySpans);
                    }
                }

                // When mode changes, we need to update the mark attributes
                const entityMarkType = editorView.state.schema.marks['entity'];
                if (!entityMarkType) return;

                const newMode = highlighterApi.getMode();
                let tr = editorView.state.tr;
                let anyUpdated = false;

                // Find all entity marks and update their mode attribute
                editorView.state.doc.descendants((node, pos) => {
                    if (node.isText) {
                        node.marks.forEach(mark => {
                            if (mark.type.name === 'entity' && mark.attrs['mode'] !== newMode) {
                                // Remove old mark, add new one with updated mode
                                const newMark = entityMarkType.create({
                                    ...mark.attrs,
                                    mode: newMode,
                                });
                                tr = tr.removeMark(pos, pos + node.nodeSize, mark.type);
                                tr = tr.addMark(pos, pos + node.nodeSize, newMark);
                                anyUpdated = true;
                            }
                        });
                    }
                });

                if (anyUpdated) {
                    editorView.dispatch(tr);
                }
            });

            let lastDocSize = 0;
            let pendingScanTimer: ReturnType<typeof setTimeout> | null = null;

            return {
                // Called when view updates - detect note loading
                update(view: EditorView, prevState: EditorState) {
                    const currentDocSize = view.state.doc.content.size;
                    const docSizeChange = Math.abs(currentDocSize - lastDocSize);

                    // Detect note load: large doc change (> 100 chars) or noteChanged meta
                    const isNoteLoad = docSizeChange > 100 || view.state.tr.getMeta('noteChanged');

                    if (isNoteLoad && currentDocSize > 50) {
                        console.log(`[HighlighterC] Detected note load (size: ${lastDocSize} -> ${currentDocSize})`);
                        lastDocSize = currentDocSize;

                        // Debounce to avoid multiple scans
                        if (pendingScanTimer) clearTimeout(pendingScanTimer);
                        pendingScanTimer = setTimeout(() => {
                            console.log('[HighlighterC] Triggering scan after note load');
                            scanAndApplyMarks(view);
                            pendingScanTimer = null;
                        }, 500);
                    } else {
                        lastDocSize = currentDocSize;
                    }
                },

                destroy() {
                    unsubscribe();
                    window.removeEventListener('gokitt-ready', handleGoKittReady);
                    if (pendingScanTimer) clearTimeout(pendingScanTimer);
                }
            };
        },

        // Handle word boundary - detect when user finishes typing an entity name
        appendTransaction(transactions: readonly Transaction[], oldState: EditorState, newState: EditorState) {
            // Only check if text was inserted
            const textInserted = transactions.some(tr => tr.docChanged);
            if (!textInserted) return null;

            // Check for word boundary (space, punctuation)
            const lastChar = newState.doc.textBetween(
                Math.max(0, newState.selection.from - 1),
                newState.selection.from
            );

            if (!/[\s.,!?;:\-\n\r]/.test(lastChar)) {
                return null; // Not a word boundary, don't scan
            }

            // Word boundary detected - scan for new entities
            // But do it async to not block typing
            // (We use setTimeout in appendTransaction which isn't ideal,
            // but the actual mark application happens in view.update)
            return null;
        }
    });
});

// =============================================================================
// USAGE: In editor.component.ts:
//
// 1. Import the entity schema:
//    import { entitySchema } from './plugins/marks/entity';
//
// 2. Use both schema and plugin:
//    .use(entitySchema)
//    .use(entityHighlighterC)
//
// The entity schema defines HOW marks are rendered (like textColor).
// This plugin decides WHEN to apply them (on note open).
// =============================================================================
