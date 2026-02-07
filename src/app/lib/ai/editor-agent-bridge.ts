/**
 * EditorAgentBridge - Bridges agent tool calls to editor operations
 * 
 * Provides surgical edit capabilities for the AI agent:
 * - Get current selection
 * - Replace selection
 * - Insert at position
 * - Append to document
 * 
 * Soft errors if editor is not ready (no fallback).
 */

import { Injectable, inject } from '@angular/core';
import { EditorService } from '../../services/editor.service';
import { NoteEditorStore } from '../store/note-editor.store';

// Milkdown imports for editor context
import { editorViewCtx } from '@milkdown/kit/core';

export interface SelectionInfo {
    from: number;
    to: number;
    text: string;
    empty: boolean;
}

export interface EditResult {
    success: boolean;
    error?: string;
}

@Injectable({ providedIn: 'root' })
export class EditorAgentBridge {
    private editorService = inject(EditorService);
    private noteEditorStore = inject(NoteEditorStore);

    /**
     * Check if editor is ready for operations
     */
    isEditorReady(): boolean {
        return this.editorService.hasEditor();
    }

    /**
     * Get current selection info
     */
    getSelection(): SelectionInfo | null {
        const crepe = this.editorService.getCrepe();
        if (!crepe) {
            return null;
        }

        try {
            const view = crepe.editor.ctx.get(editorViewCtx);
            const { from, to, empty } = view.state.selection;
            const text = empty ? '' : view.state.doc.textBetween(from, to, ' ');

            return { from, to, text, empty };
        } catch (e) {
            console.error('[EditorAgentBridge] getSelection failed:', e);
            return null;
        }
    }

    /**
     * Replace currently selected text with new content
     */
    replaceSelection(newText: string): EditResult {
        const crepe = this.editorService.getCrepe();
        if (!crepe) {
            return { success: false, error: 'Editor is not open' };
        }

        try {
            const view = crepe.editor.ctx.get(editorViewCtx);
            const { from, to, empty } = view.state.selection;

            if (empty) {
                return { success: false, error: 'No text is selected' };
            }

            const tr = view.state.tr.replaceWith(from, to, view.state.schema.text(newText));
            view.dispatch(tr);
            return { success: true };
        } catch (e) {
            console.error('[EditorAgentBridge] replaceSelection failed:', e);
            return { success: false, error: String(e) };
        }
    }

    /**
     * Insert text at a specific position
     */
    insertAt(position: number, text: string): EditResult {
        const crepe = this.editorService.getCrepe();
        if (!crepe) {
            return { success: false, error: 'Editor is not open' };
        }

        try {
            const view = crepe.editor.ctx.get(editorViewCtx);
            const docSize = view.state.doc.content.size;

            // Clamp position to valid range
            const pos = Math.max(0, Math.min(position, docSize));
            const tr = view.state.tr.insertText(text, pos);
            view.dispatch(tr);
            return { success: true };
        } catch (e) {
            console.error('[EditorAgentBridge] insertAt failed:', e);
            return { success: false, error: String(e) };
        }
    }

    /**
     * Append text to end of document
     */
    append(text: string): EditResult {
        const crepe = this.editorService.getCrepe();
        if (!crepe) {
            return { success: false, error: 'Editor is not open' };
        }

        try {
            const view = crepe.editor.ctx.get(editorViewCtx);
            const endPos = view.state.doc.content.size;
            const tr = view.state.tr.insertText('\n\n' + text, endPos);
            view.dispatch(tr);
            return { success: true };
        } catch (e) {
            console.error('[EditorAgentBridge] append failed:', e);
            return { success: false, error: String(e) };
        }
    }

    /**
     * Get current note info (ID, title)
     */
    getCurrentNoteInfo(): { id: string | null; title: string | null } {
        const note = this.noteEditorStore.currentNote();
        return {
            id: note?.id || null,
            title: note?.title || null
        };
    }
}
