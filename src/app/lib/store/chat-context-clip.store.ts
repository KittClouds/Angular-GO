import { Injectable, computed, signal } from '@angular/core';

export interface ChatContextClip {
    id: string;
    noteId: string | null;
    from: number;
    to: number;
    text: string;
    source: 'selection';
    createdAt: number;
}

export interface AddClipInput {
    noteId?: string | null;
    from: number;
    to: number;
    text: string;
}

@Injectable({ providedIn: 'root' })
export class ChatContextClipStore {
    private readonly clipsSignal = signal<ChatContextClip[]>([]);

    readonly clips = computed(() => this.clipsSignal());
    readonly clipCount = computed(() => this.clipsSignal().length);
    readonly latestClip = computed(() => {
        const all = this.clipsSignal();
        return all.length > 0 ? all[all.length - 1] : null;
    });

    addSelectionClip(input: AddClipInput): ChatContextClip {
        const clip: ChatContextClip = {
            id: this.newId(),
            noteId: input.noteId ?? null,
            from: input.from,
            to: input.to,
            text: input.text,
            source: 'selection',
            createdAt: Date.now(),
        };

        this.clipsSignal.update((items) => [...items, clip]);
        return clip;
    }

    removeClip(id: string): void {
        this.clipsSignal.update((items) => items.filter((clip) => clip.id !== id));
    }

    clear(): void {
        this.clipsSignal.set([]);
    }

    consumeAll(): ChatContextClip[] {
        const all = this.clipsSignal();
        this.clipsSignal.set([]);
        return all;
    }

    formatForPrompt(clips: ChatContextClip[]): string {
        if (clips.length === 0) return '';

        const lines: string[] = ['[Highlighted Text Context]'];
        clips.forEach((clip, index) => {
            const noteSegment = clip.noteId ? ` note=${clip.noteId}` : '';
            lines.push(`- Clip ${index + 1}:${noteSegment} range=${clip.from}-${clip.to}`);
            lines.push(clip.text);
        });
        lines.push('[End Highlighted Text Context]');

        return lines.join('\n');
    }

    private newId(): string {
        if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
            return crypto.randomUUID();
        }
        return `clip-${Date.now()}-${Math.random().toString(16).slice(2)}`;
    }
}
