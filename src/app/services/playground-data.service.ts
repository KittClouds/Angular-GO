// src/app/services/playground-data.service.ts
// Shared document management for the Research Playground.
// Experimental modules share the same loaded chapters.

import { Injectable, signal, computed } from '@angular/core';
import { PlaygroundLogService } from './playground-log.service';

export interface Chapter {
    id: string;
    title: string;
    text: string;
}

@Injectable({ providedIn: 'root' })
export class PlaygroundDataService {
    private readonly log: PlaygroundLogService;

    readonly chapters = signal<Chapter[]>([]);
    readonly loadedUrl = signal<string | null>(null);
    readonly loading = signal(false);

    readonly documentReady = computed(() => this.chapters().length > 0);
    readonly chapterCount = computed(() => this.chapters().length);
    readonly characterCount = computed(() =>
        this.chapters().reduce((sum, c) => sum + c.text.length, 0)
    );

    constructor(logService: PlaygroundLogService) {
        this.log = logService;
    }

    /** Load a document from a URL and split it into chapters. */
    async loadDocument(url: string): Promise<Chapter[]> {
        if (this.loading()) return this.chapters();
        this.loading.set(true);
        this.log.info('system', `Loading document from ${url}...`);

        try {
            const response = await fetch(url);
            if (!response.ok) throw new Error(`HTTP ${response.status}`);

            const text = await response.text();
            this.log.info('system', `Document loaded: ${text.length.toLocaleString()} characters`);

            const chapters = this.splitIntoChapters(text);
            const substantial = chapters.filter(c => c.text.length >= 200);
            this.chapters.set(substantial);
            this.loadedUrl.set(url);
            this.log.success('system', `Split into ${substantial.length} chapters`);
            return substantial;
        } catch (err) {
            this.log.error('system', `Failed to load document: ${err}`);
            return [];
        } finally {
            this.loading.set(false);
        }
    }

    clear(): void {
        this.chapters.set([]);
        this.loadedUrl.set(null);
        this.log.info('system', 'Document data cleared');
    }

    private splitIntoChapters(text: string): Chapter[] {
        const lines = text.split('\n');
        const chapters: Chapter[] = [];
        let currentLines: string[] = [];
        let currentTitle = 'Prologue';
        let chapterNum = 0;

        for (const line of lines) {
            const match = line.match(/^#+\s*(Chapter\s*\d+|Prologue|Epilogue)/i);
            if (match) {
                if (currentLines.length > 0) {
                    chapters.push({
                        id: `chapter-${chapterNum}`,
                        title: currentTitle,
                        text: currentLines.join('\n'),
                    });
                }
                currentTitle = match[1];
                currentLines = [line];
                chapterNum++;
            } else {
                currentLines.push(line);
            }
        }

        if (currentLines.length > 0) {
            chapters.push({
                id: `chapter-${chapterNum}`,
                title: currentTitle,
                text: currentLines.join('\n'),
            });
        }

        return chapters;
    }
}
