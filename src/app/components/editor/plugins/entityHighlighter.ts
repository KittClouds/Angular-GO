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
    const widget = document.createElement('span');
    widget.className = api.getClass(span) + ' entity-widget';
    widget.style.cssText = api.getStyle(span);
    widget.textContent = span.displayText || span.label;
    widget.setAttribute('data-span-type', span.type);
    widget.setAttribute('data-target', span.target || span.label);
    widget.setAttribute('title', getTooltip(span));
    widget.style.cursor = 'pointer';

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
 */
export const entityHighlighter = $prose(() => {
    const highlighterApi = getHighlighterApi();
    let currentSpans: DecorationSpan[] = [];
    let unsubscribe: (() => void) | null = null;

    return new Plugin({
        key: new PluginKey('ENTITY_HIGHLIGHTER'),

        view(editorView: EditorView) {
            // Subscribe to highlighting store changes for live updates
            unsubscribe = highlighterApi.subscribe(() => {
                // Force decoration recalculation when mode changes
                const tr = editorView.state.tr;
                tr.setMeta('forceDecorationUpdate', true);
                editorView.dispatch(tr);
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
            decorations: (state: EditorState) => {
                const { selection } = state;
                const currentMode = highlighterApi.getMode();
                currentSpans = highlighterApi.getDecorations(state.doc);

                if (currentSpans.length === 0) {
                    return DecorationSet.empty;
                }

                const decorations: Decoration[] = [];

                for (const span of currentSpans) {
                    const isEditing = isCursorInside(span, selection);

                    // IMPLICIT HIGHLIGHTS: Always render as inline, never replace text
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

                    // PREDICATE HIGHLIGHTS: Show as inline with subtle muted color
                    if (span.type === 'predicate') {
                        const mode = highlighterApi.getMode();
                        const vividClass = mode === 'vivid' ? ' vivid' : '';
                        decorations.push(
                            Decoration.inline(span.from, span.to, {
                                class: `predicate-highlight${vividClass}`,
                                title: `${span.sourceEntity} → ${span.verb} → ${span.targetEntity}`,
                            })
                        );
                        continue;
                    }

                    // NER CANDIDATE HIGHLIGHTS: Use centralized styles (Yellow dotted)
                    if (span.type === 'entity_candidate') {
                        if (span.label?.toLowerCase() === 'elbaph') {
                            console.log(`[EntityHighlighter:DIAG] Rendering Elbaph candidate at ${span.from}-${span.to}`);
                        }
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

                        // Include mode in key so widget is recreated when mode changes (clean↔vivid)
                        decorations.push(
                            Decoration.widget(span.from, () => createWidget(span, highlighterApi), {
                                side: 0,
                                key: `widget-${currentMode}-${span.from}-${span.to}`,
                            })
                        );
                    }
                }

                return DecorationSet.create(state.doc, decorations);
            },
        },
    });
});
