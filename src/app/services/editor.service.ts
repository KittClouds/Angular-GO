import { Injectable } from '@angular/core';
import { Subject } from 'rxjs';
import { Crepe } from '@milkdown/crepe';
import { commandsCtx } from '@milkdown/kit/core';
import { undoCommand, redoCommand } from '@milkdown/kit/plugin/history';

@Injectable({
    providedIn: 'root'
})
export class EditorService {
    private crepe?: Crepe;
    private undoTrigger = new Subject<void>();
    private redoTrigger = new Subject<void>();

    undo$ = this.undoTrigger.asObservable();
    redo$ = this.redoTrigger.asObservable();

    constructor() { }

    registerEditor(crepe: Crepe) {
        this.crepe = crepe;
    }

    /**
     * Get the Crepe editor instance (for EditorAgentBridge)
     */
    getCrepe(): Crepe | undefined {
        return this.crepe;
    }

    /**
     * Check if editor is registered and ready
     */
    hasEditor(): boolean {
        return !!this.crepe;
    }

    undo() {
        if (this.crepe) {
            try {
                this.crepe.editor.ctx.get(commandsCtx).call(undoCommand.key);
            } catch (e) {
                console.error('Undo failed', e);
            }
        }
    }

    redo() {
        if (this.crepe) {
            try {
                this.crepe.editor.ctx.get(commandsCtx).call(redoCommand.key);
            } catch (e) {
                console.error('Redo failed', e);
            }
        }
    }

    private contentSubject = new Subject<{ json: object; markdown: string }>();
    content$ = this.contentSubject.asObservable();

    updateContent(content: { json: object; markdown: string }) {
        this.contentSubject.next(content);
    }
}
