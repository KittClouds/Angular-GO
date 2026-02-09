// src/editor/plugins/entityHighlighter.ts
// Entity Highlighter Plugin - "accordion" behavior for entities, refs, and note links
//
// ┌─────────────────────────────────────────────────────────────────────────────┐
// │                           ⚠️  CRITICAL CODE PATH  ⚠️                         │
// │                                                                             │
// │  This file handles click navigation for entity/note widgets.               │
// │                                                                             │
// │  DO NOT:                                                                    │
// │  - Use ProseMirror's handleClick or handleDOMEvents for widget clicks      │
// │  - Remove the direct addEventListener on widget elements                    │
// │  - Remove the mousedown preventDefault (editor steals focus otherwise)     │
// │                                                                             │
// │  WHY: ProseMirror's event handlers are unreliable for dynamically created  │
// │  widgets. The decoration system recreates widgets frequently, and PM's     │
// │  click handlers don't consistently fire. Direct DOM handlers are the ONLY  │
// │  reliable way to handle widget clicks.                                     │
// │                                                                             │
// │  If navigation stops working after changes, check:                         │
// │  1. Is addEventListener still attached in createWidget()?                  │
// │  2. Is mousedown still prevented?                                          │
// │  3. Is the widget class 'entity-widget' still present?                     │
// │  4. Console should show: "[EntityHighlighter] Direct widget click..."      │
// └─────────────────────────────────────────────────────────────────────────────┘
//
// Last verified working: 2026-01-13

import { Plugin, PluginKey } from '@milkdown/kit/prose/state';
import { Decoration, DecorationSet } from '@milkdown/kit/prose/view';
import { $prose } from '@milkdown/kit/utils';
import type { EditorView } from '@milkdown/kit/prose/view';
import type { EditorState } from '@milkdown/kit/prose/state';

import { getHighlighterApi, getNavigationApi } from '../../../api';
import type { DecorationSpan } from '../../../lib/Scanner/types';
import { getEntityColorVar } from '../../../lib/store/entityColorStore';

/**
 * Check if cursor is inside a span
 */
function isCursorInside(span: DecorationSpan, selection: { from: number; to: number }): boolean {
    return selection.from <= span.to && selection.to >= span.from;
}

/**
 * Get subtle (editing mode) style for a span 
 */
function getEditingStyle(span: DecorationSpan): string {
    if (span.type === 'entity' && span.kind) {
        const colorVar = getEntityColorVar(span.kind);
        return `color: hsl(var(${colorVar})); font-weight: 500;`;
    }
    if (span.type === 'entity_ref') {
        if (span.kind) {
            const colorVar = getEntityColorVar(span.kind);
            return `color: hsl(var(${colorVar})); text-decoration: underline;`;
        }
        return 'color: #8b5cf6; text-decoration: underline;';
    }
    if (span.type === 'wikilink') {
        return 'color: #3b82f6; text-decoration: underline;';
    }
    return '';
}

/**
 * Get tooltip text for a span
 */
function getTooltip(span: DecorationSpan): string {
    switch (span.type) {
        case 'entity':
            return `Entity: ${span.label} (${span.kind})`;
        case 'entity_ref':
            if (span.resolved && span.kind) {
                return `Entity: ${span.label} (${span.kind})`;
            }
            return `Entity: ${span.label} (unresolved)`;
        case 'wikilink':
            return `Open note: ${span.target}`;
        case 'relationship':
            return `${span.sourceEntity} → ${span.targetEntity}`;
        default:
            return span.label;
    }
}

/**
 * Handle click on a span - navigate to target
 */
function handleSpanClick(span: DecorationSpan): void {
    const navigationApi = getNavigationApi();
    const target = span.target || span.label;

    console.log(`[EntityHighlighter] Click on ${span.type}: "${target}"`);

    if (span.type === 'wikilink') {
        // Note link: <<note>> -> navigate to note
        navigationApi.navigateToNoteByTitle(target);
    } else if (span.type === 'entity_ref' || span.type === 'entity') {
        // Entity: [KIND|Label] or [[ref]] -> navigate to entity
        navigationApi.navigateToEntityByLabel(target);
    }
}

/**
 * Create widget element for a span (the pill)
 * IMPORTANT: Click handler is attached directly to widget element
 */
function createWidget(span: DecorationSpan, api: ReturnType<typeof getHighlighterApi>): HTMLElement {
    const mode = api.getMode();
    const widget = document.createElement('span');

    if (mode === 'subtle') {
        // Subtle mode: Text color only, no pill background
        widget.className = 'entity-widget entity-widget-subtle';
        const colorStyle = getEditingStyle(span);
        widget.style.cssText = `${colorStyle} background: transparent; padding: 0; border: none; border-radius: 0; display: inline; box-shadow: none; cursor: pointer;`;
    } else {
        // Normal pill mode (Vivid/Clean/Focus)
        widget.className = api.getClass(span) + ' entity-widget';
        widget.style.cssText = api.getStyle(span);
        widget.style.cursor = 'pointer';
    }

    widget.textContent = span.displayText || span.label;
    widget.setAttribute('data-span-type', span.type);
    widget.setAttribute('data-target', span.target || span.label);
    widget.setAttribute('title', getTooltip(span));

    // DIRECT click handler - most reliable
    widget.addEventListener('click', (e) => {
        console.log('[EntityHighlighter] Direct widget click handler fired');
        e.preventDefault();
        e.stopPropagation();
        handleSpanClick(span);
    });

    // Also handle mousedown to prevent editor from stealing focus
    widget.addEventListener('mousedown', (e) => {
        e.preventDefault();
        e.stopPropagation();
    });

    return widget;
}

/**
 * Entity Highlighter Milkdown Plugin
 * 
 * Uses ProseMirror plugin STATE to track decorations across transactions.
 * Key insight: DecorationSet.map() keeps positions aligned with doc changes.
 */
export const entityHighlighter = $prose(() => {
    const highlighterApi = getHighlighterApi();
    let unsubscribe: (() => void) | null = null;
    let pendingUpdate = false;
    let lastSpanHash = '';

    const pluginKey = new PluginKey('ENTITY_HIGHLIGHTER');

    /** Quick hash for change detection */
    function hashSpans(spans: DecorationSpan[], mode: string): string {
        if (spans.length === 0) return `empty-${mode}`;
        const first = spans[0];
        const last = spans[spans.length - 1];
        return `${spans.length}-${first.from}-${first.to}-${last.from}-${last.to}-${mode}`;
    }

    /** Build decorations from spans */
    function buildDecorations(
        spans: DecorationSpan[],
        selection: { from: number; to: number },
        doc: EditorState['doc']
    ): DecorationSet {
        if (spans.length === 0) return DecorationSet.empty;

        const currentMode = highlighterApi.getMode();
        const decorations: Decoration[] = [];

        for (const span of spans) {
            // Skip invalid spans (position out of bounds)
            if (span.from < 0 || span.to > doc.content.size) continue;

            const isEditing = isCursorInside(span, selection);

            // IMPLICIT HIGHLIGHTS: Always render as inline
            if (span.type === 'entity_implicit') {
                decorations.push(
                    Decoration.inline(span.from, span.to, {
                        class: highlighterApi.getClass(span),
                        style: highlighterApi.getStyle(span),
                        title: getTooltip(span)
                    })
                );
                continue;
            }

            // PREDICATE HIGHLIGHTS
            if (span.type === 'predicate') {
                const vividClass = currentMode === 'vivid' ? ' vivid' : '';
                decorations.push(
                    Decoration.inline(span.from, span.to, {
                        class: `predicate-highlight${vividClass}`,
                        title: `${span.sourceEntity} → ${span.verb} → ${span.targetEntity}`,
                    })
                );
                continue;
            }

            // NER CANDIDATE HIGHLIGHTS
            if (span.type === 'entity_candidate') {
                decorations.push(
                    Decoration.inline(span.from, span.to, {
                        class: highlighterApi.getClass(span),
                        style: highlighterApi.getStyle(span),
                        title: `Potential entity: ${span.label} (score: ${span.matchedText || 'unknown'})`
                    })
                );
                continue;
            }

            if (isEditing) {
                // EDITING MODE: Show raw text with subtle highlight
                decorations.push(
                    Decoration.inline(span.from, span.to, {
                        class: 'entity-editing',
                        style: getEditingStyle(span),
                        'data-span-type': span.type,
                    })
                );
            } else {
                // VIEW MODE: Hide raw text, show widget
                decorations.push(
                    Decoration.inline(span.from, span.to, {
                        class: 'entity-hidden',
                        style: 'display: none;',
                    })
                );

                decorations.push(
                    Decoration.widget(span.from, () => createWidget(span, highlighterApi), {
                        side: 0,
                        // Use label+type for stable key (avoids recreation when positions shift)
                        key: `widget-${currentMode}-${span.type}-${span.label}`,
                    })
                );
            }
        }

        return DecorationSet.create(doc, decorations);
    }

    return new Plugin({
        key: pluginKey,

        // STATE: Holds the DecorationSet, mapped through each transaction
        state: {
            init(_, state) {
                const spans = highlighterApi.getDecorations(state.doc);
                lastSpanHash = hashSpans(spans, highlighterApi.getMode());
                return buildDecorations(spans, state.selection, state.doc);
            },

            apply(tr, oldDecorations, oldState, newState) {
                // Get fresh spans from highlighter
                const spans = highlighterApi.getDecorations(newState.doc);
                const currentMode = highlighterApi.getMode();
                const newHash = hashSpans(spans, currentMode);

                // If spans changed (new scan result), rebuild from scratch
                if (newHash !== lastSpanHash || tr.getMeta('forceDecorationUpdate')) {
                    lastSpanHash = newHash;
                    return buildDecorations(spans, newState.selection, newState.doc);
                }

                // If doc changed but spans are the same, MAP existing decorations
                // This keeps positions aligned with document changes
                if (tr.docChanged) {
                    return oldDecorations.map(tr.mapping, tr.doc);
                }

                // Selection change only - rebuild for editing mode toggle
                if (!tr.selection.eq(oldState.selection)) {
                    return buildDecorations(spans, newState.selection, newState.doc);
                }

                return oldDecorations;
            }
        },

        view(editorView: EditorView) {
            // Subscribe to highlighting store changes (mode, settings)
            unsubscribe = highlighterApi.subscribe(() => {
                pendingUpdate = true;
                requestAnimationFrame(() => {
                    if (pendingUpdate) {
                        pendingUpdate = false;

                        // Lock scroll position to prevent jump during redraw
                        const scrollContainer = editorView.dom.closest('.milkdown') || editorView.dom.parentElement;
                        const scrollY = scrollContainer?.scrollTop ?? 0;

                        const tr = editorView.state.tr;
                        tr.setMeta('forceDecorationUpdate', true);
                        editorView.dispatch(tr);

                        // Restore scroll position after DOM updates
                        if (scrollContainer) {
                            scrollContainer.scrollTop = scrollY;
                        }
                    }
                });
            });

            return {
                destroy() {
                    if (unsubscribe) {
                        unsubscribe();
                        unsubscribe = null;
                    }
                }
            };
        },

        props: {
            decorations(state: EditorState) {
                return pluginKey.getState(state);
            }
        }
    });
});

