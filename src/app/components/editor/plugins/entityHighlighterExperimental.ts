// src/app/components/editor/plugins/entityHighlighterExperimental.ts
// =============================================================================
// EXPERIMENTAL ENTITY HIGHLIGHTER - A/B Testing Ground
// =============================================================================
//
// This is a 1:1 functional equivalent of entityHighlighter.ts
// Same logic, same modes, same styling - different rendering approach.
//
// RENDERING DIFFERENCE:
// - Original: ProseMirror decorations (mutates PM DOM)
// - This: DOM overlay for implicit highlights, decorations for syntax hiding
//
// =============================================================================

import { Plugin, PluginKey } from '@milkdown/kit/prose/state';
import { Decoration, DecorationSet } from '@milkdown/kit/prose/view';
import { $prose } from '@milkdown/kit/utils';
import type { EditorView } from '@milkdown/kit/prose/view';
import type { EditorState } from '@milkdown/kit/prose/state';

import { getHighlighterApi } from '../../../api';
import type { DecorationSpan } from '../../../lib/Scanner/types';

// =============================================================================
// HELPERS (Same as original)
// =============================================================================

function isCursorInside(
    span: DecorationSpan,
    selection: { from: number; to: number }
): boolean {
    return selection.from >= span.from && selection.to <= span.to;
}

function getEditingStyle(span: DecorationSpan): string {
    const highlighterApi = getHighlighterApi();
    const baseStyle = highlighterApi.getStyle(span);
    return baseStyle.replace(/background[^;]+;?/g, '');
}

function getTooltip(span: DecorationSpan): string {
    const parts: string[] = [];
    if (span.label) parts.push(span.label);
    if (span.kind) parts.push(`(${span.kind})`);
    if (span.matchedText && span.matchedText !== span.label) {
        parts.push(`matched: "${span.matchedText}"`);
    }
    return parts.join(' ');
}

function createWidget(
    span: DecorationSpan,
    highlighterApi: ReturnType<typeof getHighlighterApi>
): HTMLElement {
    const mode = highlighterApi.getMode();
    const widget = document.createElement('span');
    widget.className = highlighterApi.getClass(span);
    widget.style.cssText = highlighterApi.getStyle(span);

    if (mode === 'vivid') {
        widget.classList.add('vivid');
    } else if (mode === 'subtle') {
        widget.classList.add('subtle');
    }

    widget.textContent = span.label || span.matchedText || '';
    widget.title = getTooltip(span);

    widget.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        document.dispatchEvent(new CustomEvent('entity-click', {
            detail: { span, element: widget }
        }));
    });

    return widget;
}

// =============================================================================
// OVERLAY LAYER (For implicit highlights - no PM mutation)
// =============================================================================

interface OverlayState {
    container: HTMLDivElement | null;
    highlights: Map<string, HTMLElement>;
}

function createOverlayContainer(): HTMLDivElement {
    const container = document.createElement('div');
    container.className = 'entity-overlay-layer';
    container.style.cssText = `
        position: absolute;
        top: 0;
        left: 0;
        right: 0;
        bottom: 0;
        pointer-events: none;
        overflow: hidden;
        z-index: 5;
    `;
    return container;
}

function renderOverlayHighlight(
    view: EditorView,
    span: DecorationSpan,
    highlighterApi: ReturnType<typeof getHighlighterApi>,
    containerRect: DOMRect
): HTMLElement | null {
    try {
        const startCoords = view.coordsAtPos(span.from);
        const endCoords = view.coordsAtPos(span.to);

        const pill = document.createElement('span');
        pill.className = highlighterApi.getClass(span);
        pill.setAttribute('data-overlay-id', `${span.type}-${span.label}-${span.from}`);
        pill.title = getTooltip(span);

        // Position absolutely within container
        const left = startCoords.left - containerRect.left;
        const top = startCoords.top - containerRect.top;
        const width = endCoords.right - startCoords.left;
        const height = startCoords.bottom - startCoords.top;

        pill.style.cssText = `
            position: absolute;
            left: ${left}px;
            top: ${top}px;
            width: ${width}px;
            height: ${height}px;
            ${highlighterApi.getStyle(span)}
            pointer-events: auto;
            cursor: pointer;
            border-radius: 4px;
            display: flex;
            align-items: center;
            justify-content: center;
        `;

        // For implicit highlights, we might want to show the text
        // (since we're overlaying, not replacing)
        // pill.textContent = span.label || '';

        return pill;
    } catch (e) {
        return null;
    }
}

// =============================================================================
// EXPERIMENTAL PLUGIN
// =============================================================================

const EXPERIMENTAL_KEY = new PluginKey('ENTITY_HIGHLIGHTER_EXPERIMENTAL');

export const entityHighlighterExperimental = $prose(() => {
    const highlighterApi = getHighlighterApi();
    let unsubscribe: (() => void) | null = null;
    let pendingUpdate = false;
    let lastSpanHash = '';
    let overlayState: OverlayState = { container: null, highlights: new Map() };

    // DEBOUNCE: Only update overlay after typing pauses
    let overlayDebounceTimer: ReturnType<typeof setTimeout> | null = null;
    const OVERLAY_DEBOUNCE_MS = 100;

    /** Quick hash for change detection */
    function hashSpans(spans: DecorationSpan[], mode: string): string {
        if (spans.length === 0) return `empty-${mode}`;
        const first = spans[0];
        const last = spans[spans.length - 1];
        return `${spans.length}-${first.from}-${first.to}-${last.from}-${last.to}-${mode}`;
    }

    /**
     * Separate spans by rendering type:
     * - Overlay: entity_implicit, entity_ref, predicate, entity_candidate
     * - Decoration: wikilink, entity (need syntax hiding)
     */
    function categorizeSpans(spans: DecorationSpan[]): {
        overlay: DecorationSpan[];
        decoration: DecorationSpan[];
    } {
        const overlay: DecorationSpan[] = [];
        const decoration: DecorationSpan[] = [];

        for (const span of spans) {
            // These can be rendered as overlay (no syntax hiding needed)
            if (span.type === 'entity_implicit' ||
                span.type === 'entity_ref' ||
                span.type === 'predicate' ||
                span.type === 'entity_candidate') {
                overlay.push(span);
            }
            // These need decorations (syntax hiding required)
            else {
                decoration.push(span);
            }
        }

        return { overlay, decoration };
    }

    /** Update overlay layer with implicit highlights */
    function updateOverlay(view: EditorView, spans: DecorationSpan[]) {
        if (!overlayState.container) return;

        const containerRect = view.dom.getBoundingClientRect();

        // Clear and rebuild
        overlayState.container.innerHTML = '';
        overlayState.highlights.clear();

        for (const span of spans) {
            const pill = renderOverlayHighlight(view, span, highlighterApi, containerRect);
            if (pill) {
                overlayState.container.appendChild(pill);
                overlayState.highlights.set(`${span.type}-${span.label}-${span.from}`, pill);
            }
        }
    }

    /** Debounced overlay update - keeps last state during typing */
    function scheduleOverlayUpdate(view: EditorView) {
        if (overlayDebounceTimer) {
            clearTimeout(overlayDebounceTimer);
        }
        overlayDebounceTimer = setTimeout(() => {
            const spans = highlighterApi.getDecorations(view.state.doc);
            const { overlay } = categorizeSpans(spans);
            updateOverlay(view, overlay);
            overlayDebounceTimer = null;
        }, OVERLAY_DEBOUNCE_MS);
    }

    /** Build decorations (same logic as original, for syntax-hiding spans) */
    function buildDecorations(
        spans: DecorationSpan[],
        selection: { from: number; to: number },
        doc: EditorState['doc']
    ): DecorationSet {
        if (spans.length === 0) return DecorationSet.empty;

        const currentMode = highlighterApi.getMode();
        const decorations: Decoration[] = [];

        for (const span of spans) {
            if (span.from < 0 || span.to > doc.content.size) continue;

            const isEditing = isCursorInside(span, selection);

            if (isEditing) {
                decorations.push(
                    Decoration.inline(span.from, span.to, {
                        class: 'entity-editing',
                        style: getEditingStyle(span),
                        'data-span-type': span.type,
                    })
                );
            } else {
                // Hide raw text
                decorations.push(
                    Decoration.inline(span.from, span.to, {
                        class: 'entity-hidden',
                        style: 'display: none;',
                    })
                );

                // Show widget
                decorations.push(
                    Decoration.widget(span.from, () => createWidget(span, highlighterApi), {
                        side: 0,
                        key: `widget-${currentMode}-${span.type}-${span.label}`,
                    })
                );
            }
        }

        return DecorationSet.create(doc, decorations);
    }

    return new Plugin({
        key: EXPERIMENTAL_KEY,

        state: {
            init(_, state) {
                const allSpans = highlighterApi.getDecorations(state.doc);
                const { decoration } = categorizeSpans(allSpans);
                lastSpanHash = hashSpans(allSpans, highlighterApi.getMode());
                return buildDecorations(decoration, state.selection, state.doc);
            },

            apply(tr, oldDecorations, oldState, newState) {
                const allSpans = highlighterApi.getDecorations(newState.doc);
                const { decoration } = categorizeSpans(allSpans);
                const currentMode = highlighterApi.getMode();
                const newHash = hashSpans(allSpans, currentMode);

                if (newHash !== lastSpanHash || tr.getMeta('forceDecorationUpdate')) {
                    lastSpanHash = newHash;
                    return buildDecorations(decoration, newState.selection, newState.doc);
                }

                if (tr.docChanged) {
                    return oldDecorations.map(tr.mapping, tr.doc);
                }

                if (!tr.selection.eq(oldState.selection)) {
                    return buildDecorations(decoration, newState.selection, newState.doc);
                }

                return oldDecorations;
            }
        },

        view(editorView: EditorView) {
            // Create overlay container
            overlayState.container = createOverlayContainer();
            const editorParent = editorView.dom.parentElement;
            if (editorParent) {
                editorParent.style.position = 'relative';
                editorParent.appendChild(overlayState.container);
            }

            // Initial overlay render
            const allSpans = highlighterApi.getDecorations(editorView.state.doc);
            const { overlay } = categorizeSpans(allSpans);
            updateOverlay(editorView, overlay);

            // Subscribe to highlighting store changes
            unsubscribe = highlighterApi.subscribe(() => {
                pendingUpdate = true;
                requestAnimationFrame(() => {
                    if (pendingUpdate) {
                        pendingUpdate = false;

                        // Update overlay only - NO transaction dispatch
                        // PM decorations will update naturally on next user keystroke
                        // This eliminates the extra redraw cycle causing flicker
                        const spans = highlighterApi.getDecorations(editorView.state.doc);
                        const { overlay } = categorizeSpans(spans);
                        updateOverlay(editorView, overlay);

                        // NOTE: Removed forceDecorationUpdate transaction dispatch
                        // Syntax-hiding decorations update via apply() on next keystroke
                    }
                });
            });

            // Handle scroll - update overlay positions
            const handleScroll = () => {
                const spans = highlighterApi.getDecorations(editorView.state.doc);
                const { overlay } = categorizeSpans(spans);
                updateOverlay(editorView, overlay);
            };
            editorView.dom.addEventListener('scroll', handleScroll, { passive: true });

            // Handle resize
            const resizeObserver = new ResizeObserver(() => {
                const spans = highlighterApi.getDecorations(editorView.state.doc);
                const { overlay } = categorizeSpans(spans);
                updateOverlay(editorView, overlay);
            });
            resizeObserver.observe(editorView.dom);

            return {
                update(view: EditorView) {
                    // DEBOUNCED: Schedule overlay update after typing pause
                    // This keeps the overlay frozen during typing, preventing flicker
                    scheduleOverlayUpdate(view);
                },

                destroy() {
                    if (unsubscribe) {
                        unsubscribe();
                        unsubscribe = null;
                    }
                    if (overlayDebounceTimer) {
                        clearTimeout(overlayDebounceTimer);
                        overlayDebounceTimer = null;
                    }
                    if (overlayState.container?.parentElement) {
                        overlayState.container.parentElement.removeChild(overlayState.container);
                    }
                    overlayState = { container: null, highlights: new Map() };
                    resizeObserver.disconnect();
                    editorView.dom.removeEventListener('scroll', handleScroll);
                }
            };
        },

        props: {
            decorations(state: EditorState) {
                return EXPERIMENTAL_KEY.getState(state);
            }
        }
    });
});

// =============================================================================
// USAGE: Switch in editor.component.ts
//
// This plugin is 1:1 functionally equivalent to entityHighlighter.ts:
// - Same API calls (getDecorations, getMode, getClass, getStyle)
// - Same span processing logic
// - Same mode support (vivid/clean/subtle)
//
// The difference:
// - Implicit highlights rendered as DOM overlay (no PM mutation)
// - Wikilinks/entities still use decorations (need syntax hiding)
//
// =============================================================================
