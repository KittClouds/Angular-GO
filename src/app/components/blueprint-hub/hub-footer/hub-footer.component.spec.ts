import '@angular/compiler';
import { Injector, createEnvironmentInjector, runInInjectionContext, signal, type EnvironmentInjector } from '@angular/core';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { HubFooterComponent } from './hub-footer.component';
import { BlueprintHubService } from '../blueprint-hub.service';
import { FooterStatsService } from '../../../services/footer-stats.service';
import { TtsService } from '../../../services/tts.service';
import { ScopeService } from '../../../lib/services/scope.service';
import { NoteEditorStore } from '../../../lib/store/note-editor.store';
import { ThemeService } from '../../../lib/services/theme.service';

describe('HubFooterComponent', () => {
    let injector: EnvironmentInjector;
    let component: HubFooterComponent;

    const backlinks = signal(0);
    const wordCount = signal(0);
    const charCount = signal(0);
    const totalNotes = signal(1);
    const isSaved = signal(true);
    const isDark = signal(true);
    const isHubOpen = signal(false);
    const scopedEntityCount = signal(0);
    const modelState = signal<'idle' | 'loading' | 'ready' | 'error'>('idle');
    const loadProgress = signal(0);
    const isPlaying = signal(false);
    const activeNoteId = signal<string | null>('note-1');
    const currentNote = signal<{ markdownContent?: string } | null>({ markdownContent: 'hello world' });
    const templatePath = join(dirname(fileURLToPath(import.meta.url)), 'hub-footer.component.html');

    beforeEach(() => {
        backlinks.set(0);
        wordCount.set(0);
        charCount.set(0);
        totalNotes.set(1);
        isSaved.set(true);
        isDark.set(true);
        isHubOpen.set(false);
        scopedEntityCount.set(0);
        modelState.set('idle');
        loadProgress.set(0);
        isPlaying.set(false);
        activeNoteId.set('note-1');
        currentNote.set({ markdownContent: 'hello world' });

        injector = createEnvironmentInjector([
            {
                provide: BlueprintHubService,
                useValue: {
                    toggle: vi.fn(),
                    isHubOpen,
                },
            },
            {
                provide: FooterStatsService,
                useValue: {
                    backlinks,
                    wordCount,
                    charCount,
                    totalNotes,
                    isSaved,
                },
            },
            {
                provide: TtsService,
                useValue: {
                    modelState,
                    loadProgress,
                    isPlaying,
                    loadModel: vi.fn(),
                    stop: vi.fn(),
                    speak: vi.fn(),
                },
            },
            {
                provide: ScopeService,
                useValue: {
                    scopedEntityCount,
                },
            },
            {
                provide: NoteEditorStore,
                useValue: {
                    activeNoteId,
                    currentNote,
                },
            },
            {
                provide: ThemeService,
                useValue: {
                    isDark,
                },
            },
        ], Injector.create({ providers: [] }));

        component = runInInjectionContext(injector, () => new HubFooterComponent());
    });

    afterEach(() => {
        injector.destroy();
    });

    it('uses gradient text markup for both words and chars in the footer template', () => {
        const template = readFileSync(templatePath, 'utf8');

        expect(template.match(/<om-gradient-text/g)).toHaveLength(2);
        expect(template).toContain('[text]="wordCountText()"');
        expect(template).toContain('[gradientStart]="wordGradientStart()"');
        expect(template).toContain('[gradientEnd]="wordGradientEnd()"');
        expect(template).not.toContain('{{ statsService.wordCount() }} words');
    });

    it('formats the words and chars text labels for the footer', () => {
        wordCount.set(2832);
        charCount.set(17264);

        expect(component.wordCountText()).toBe('2832 words');
        expect(component.charCountText()).toBe('17264 chars');
    });

    it.each([
        { count: 0, start: '#32CD32', end: '#00FF7F' },
        { count: 2999, start: '#32CD32', end: '#00FF7F' },
        { count: 3000, start: '#9ACD32', end: '#ADFF2F' },
        { count: 4500, start: '#FFA500', end: '#FFD700' },
        { count: 6000, start: '#FFA500', end: '#FF6347' },
        { count: 7499, start: '#FFA500', end: '#FF6347' },
        { count: 7500, start: '#FF4500', end: '#FF0000' },
        { count: 9000, start: '#FF4500', end: '#FF0000' },
    ])('uses the requested dark-mode word gradient thresholds at $count words', ({ count, start, end }) => {
        isDark.set(true);
        wordCount.set(count);

        expect(component.wordGradientStart()).toBe(start);
        expect(component.wordGradientEnd()).toBe(end);
    });

    it.each([
        { count: 0, start: '#16a34a', end: '#15803d' },
        { count: 2999, start: '#16a34a', end: '#15803d' },
        { count: 3000, start: '#65a30d', end: '#65a30d' },
        { count: 4500, start: '#ca8a04', end: '#d97706' },
        { count: 6000, start: '#ea580c', end: '#dc2626' },
        { count: 7499, start: '#ea580c', end: '#dc2626' },
        { count: 7500, start: '#b91c1c', end: '#b91c1c' },
        { count: 9000, start: '#b91c1c', end: '#b91c1c' },
    ])('uses the requested light-mode word gradient thresholds at $count words', ({ count, start, end }) => {
        isDark.set(false);
        wordCount.set(count);

        expect(component.wordGradientStart()).toBe(start);
        expect(component.wordGradientEnd()).toBe(end);
    });

    it.each([
        { dark: true, count: 14999, start: '#32CD32', end: '#00FF7F' },
        { dark: true, count: 15000, start: '#32CD32', end: '#7CFC00' },
        { dark: true, count: 25000, start: '#9ACD32', end: '#ADFF2F' },
        { dark: true, count: 40000, start: '#FFA500', end: '#FFD700' },
        { dark: true, count: 50000, start: '#FFA500', end: '#FF0000' },
        { dark: false, count: 14999, start: '#16a34a', end: '#15803d' },
        { dark: false, count: 15000, start: '#16a34a', end: '#16a34a' },
        { dark: false, count: 25000, start: '#ca8a04', end: '#65a30d' },
        { dark: false, count: 40000, start: '#ea580c', end: '#d97706' },
        { dark: false, count: 50000, start: '#ea580c', end: '#b91c1c' },
    ])('keeps the existing char gradient output unchanged for $count chars in dark=$dark', ({ dark, count, start, end }) => {
        isDark.set(dark);
        charCount.set(count);

        expect(component.charGradientStart()).toBe(start);
        expect(component.charGradientEnd()).toBe(end);
    });
});
