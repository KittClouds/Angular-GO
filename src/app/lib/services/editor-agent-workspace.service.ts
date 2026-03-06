import { Injectable, inject } from '@angular/core';
import { editorViewCtx } from '@milkdown/kit/core';
import type { EditorView } from '@milkdown/kit/prose/view';
import { EditorService } from '../../services/editor.service';
import { NoteEditorStore } from '../store/note-editor.store';

export interface WorkspaceSelectionSnapshot {
    from: number;
    to: number;
    empty: boolean;
    text: string;
}

export interface WorkspaceBlockSnapshot {
    index: number;
    from: number;
    to: number;
    nodeType: string;
    text: string;
}

export interface WorkspaceDocumentSnapshot {
    noteId: string;
    noteTitle: string | null;
    revision: number;
    markdown: string;
    text: string;
    selection: WorkspaceSelectionSnapshot;
    blocks: WorkspaceBlockSnapshot[];
}

export interface WorkspaceEditResult {
    ok: boolean;
    noteId?: string;
    beforeRevision?: number;
    afterRevision?: number;
    error?: string;
}

@Injectable({ providedIn: 'root' })
export class EditorAgentWorkspaceService {
    private readonly editorService = inject(EditorService);
    private readonly noteEditorStore = inject(NoteEditorStore);

    hasOpenDocument(): boolean {
        return !!this.noteEditorStore.activeNoteId() && !!this.getEditorView();
    }

    getSelection(): WorkspaceSelectionSnapshot | null {
        const view = this.getEditorView();
        if (!view) return null;

        const { selection, doc } = view.state;
        const { from, to, empty } = selection;
        return {
            from,
            to,
            empty,
            text: empty ? '' : doc.textBetween(from, to, ' ', ' '),
        };
    }

    getBlocks(): WorkspaceBlockSnapshot[] {
        const view = this.getEditorView();
        if (!view) return [];

        const blocks: WorkspaceBlockSnapshot[] = [];
        view.state.doc.forEach((node, offset, index) => {
            const from = offset + 1;
            const to = from + node.nodeSize - 1;
            blocks.push({
                index,
                from,
                to,
                nodeType: node.type.name,
                text: node.textBetween(0, node.content.size, ' ', ' '),
            });
        });

        return blocks;
    }

    getSnapshot(): WorkspaceDocumentSnapshot | null {
        const view = this.getEditorView();
        const note = this.noteEditorStore.currentNote();
        if (!view || !note) return null;

        const selection = this.getSelection();
        if (!selection) return null;

        return {
            noteId: note.id,
            noteTitle: note.title ?? null,
            revision: this.computeRevision(view),
            markdown: this.editorService.getCrepe()?.getMarkdown() ?? '',
            text: view.state.doc.textBetween(0, view.state.doc.content.size, '\n\n', ' '),
            selection,
            blocks: this.getBlocks(),
        };
    }

    async replaceText(
        from: number,
        to: number,
        replacement: string,
        expectedRevision?: number
    ): Promise<WorkspaceEditResult> {
        return this.applyTextEdit(
            expectedRevision,
            (view) => {
                const range = this.normalizeRange(view, from, to);
                if (!range) throw new Error('invalid range');
                const tr = view.state.tr.insertText(replacement, range.from, range.to);
                view.dispatch(tr);
            }
        );
    }

    async insertText(
        pos: number,
        text: string,
        expectedRevision?: number
    ): Promise<WorkspaceEditResult> {
        return this.applyTextEdit(
            expectedRevision,
            (view) => {
                const range = this.normalizeRange(view, pos, pos);
                if (!range) throw new Error('invalid position');
                const tr = view.state.tr.insertText(text, range.from, range.to);
                view.dispatch(tr);
            }
        );
    }

    async deleteText(
        from: number,
        to: number,
        expectedRevision?: number
    ): Promise<WorkspaceEditResult> {
        return this.replaceText(from, to, '', expectedRevision);
    }

    async rewriteBlock(
        blockIndex: number,
        replacement: string,
        expectedRevision?: number
    ): Promise<WorkspaceEditResult> {
        return this.applyTextEdit(
            expectedRevision,
            (view) => {
                let targetFrom = -1;
                let targetTo = -1;

                view.state.doc.forEach((node, offset, index) => {
                    if (index !== blockIndex) return;
                    targetFrom = offset + 1;
                    targetTo = targetFrom + node.nodeSize - 1;
                });

                if (targetFrom < 0 || targetTo < 0) throw new Error('block not found');
                const tr = view.state.tr.insertText(replacement, targetFrom, targetTo);
                view.dispatch(tr);
            }
        );
    }

    async saveCurrentNote(): Promise<WorkspaceEditResult> {
        const note = this.noteEditorStore.currentNote();
        const view = this.getEditorView();
        const crepe = this.editorService.getCrepe();
        if (!note || !view || !crepe) {
            return { ok: false, error: 'no open note/editor' };
        }

        try {
            await this.noteEditorStore.saveContentNow(
                view.state.doc.toJSON(),
                crepe.getMarkdown(),
                note.id
            );
            const rev = this.computeRevision(view);
            return {
                ok: true,
                noteId: note.id,
                beforeRevision: rev,
                afterRevision: rev,
            };
        } catch (err) {
            return { ok: false, noteId: note.id, error: this.toErrorMessage(err) };
        }
    }

    private async applyTextEdit(
        expectedRevision: number | undefined,
        mutate: (view: EditorView) => void
    ): Promise<WorkspaceEditResult> {
        const note = this.noteEditorStore.currentNote();
        const view = this.getEditorView();
        const crepe = this.editorService.getCrepe();
        if (!note || !view || !crepe) {
            return { ok: false, error: 'no open note/editor' };
        }

        const beforeRevision = this.computeRevision(view);
        if (expectedRevision !== undefined && expectedRevision !== beforeRevision) {
            return {
                ok: false,
                noteId: note.id,
                beforeRevision,
                error: `revision mismatch: expected ${expectedRevision}, got ${beforeRevision}`,
            };
        }

        try {
            mutate(view);
            const afterRevision = this.computeRevision(view);
            await this.noteEditorStore.saveContentNow(
                view.state.doc.toJSON(),
                crepe.getMarkdown(),
                note.id
            );
            return {
                ok: true,
                noteId: note.id,
                beforeRevision,
                afterRevision,
            };
        } catch (err) {
            return {
                ok: false,
                noteId: note.id,
                beforeRevision,
                error: this.toErrorMessage(err),
            };
        }
    }

    private normalizeRange(
        view: EditorView,
        from: number,
        to: number
    ): { from: number; to: number } | null {
        const max = view.state.doc.content.size;
        if (!Number.isFinite(from) || !Number.isFinite(to)) return null;

        const safeFrom = Math.max(0, Math.min(Math.floor(from), max));
        const safeTo = Math.max(0, Math.min(Math.floor(to), max));
        if (safeFrom > safeTo) return null;

        return { from: safeFrom, to: safeTo };
    }

    private getEditorView(): EditorView | null {
        const crepe = this.editorService.getCrepe();
        if (!crepe) return null;
        try {
            return crepe.editor.ctx.get(editorViewCtx);
        } catch {
            return null;
        }
    }

    private computeRevision(view: EditorView): number {
        return this.hashString(JSON.stringify(view.state.doc.toJSON()));
    }

    private hashString(value: string): number {
        let hash = 2166136261;
        for (let i = 0; i < value.length; i++) {
            hash ^= value.charCodeAt(i);
            hash = Math.imul(hash, 16777619);
        }
        return hash >>> 0;
    }

    private toErrorMessage(err: unknown): string {
        return err instanceof Error ? err.message : String(err);
    }
}

