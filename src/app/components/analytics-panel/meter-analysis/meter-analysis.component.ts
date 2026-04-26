import { Component, computed, inject, input, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { LucideAngularModule, BookOpen, Target, X } from 'lucide-angular';

import { getPrettyTextApi } from '../../../api/pretty-text-api';
import { EditorService } from '../../../services/editor.service';
import { analyzeMeter, MeterLanguage, MeterLine } from '../../../lib/analytics/meter-analysis';

type MeterScope = 'note' | 'selection';

@Component({
    selector: 'app-meter-analysis',
    standalone: true,
    imports: [CommonModule, FormsModule, LucideAngularModule],
    template: `
        <div class="meter-shell">
            <section class="meter-section">
                <div class="meter-header">
                    <div class="meter-title">
                        <lucide-icon [img]="BookOpen" class="h-4 w-4 text-primary"></lucide-icon>
                        <span>Meter Analysis</span>
                    </div>
                    @if (selectedLine()) {
                        <button class="ghost-btn" (click)="clearSelection()" title="Clear meter line">
                            <lucide-icon [img]="X" class="h-3 w-3"></lucide-icon>
                            Clear
                        </button>
                    }
                </div>

                <div class="meter-controls">
                    <label class="control-field">
                        <span>Mode</span>
                        <select [ngModel]="language()" (ngModelChange)="setLanguage($event)">
                            <option value="auto">Auto</option>
                            <option value="en">English syllables</option>
                            <option value="ja">Japanese morae</option>
                        </select>
                    </label>
                    <label class="control-field">
                        <span>Target</span>
                        <input
                            [ngModel]="targetPattern()"
                            (ngModelChange)="targetPattern.set($event)"
                            placeholder="8 or 7-7-8-6"
                        />
                    </label>
                    <label class="control-field">
                        <span>Scope</span>
                        <select [ngModel]="scope()" (ngModelChange)="setScope($event)">
                            <option value="note">Note</option>
                            <option value="selection" disabled>Selection soon</option>
                        </select>
                    </label>
                </div>
            </section>

            @if (!hasContent()) {
                <div class="meter-empty">
                    <lucide-icon [img]="BookOpen" class="h-9 w-9 text-muted-foreground/50"></lucide-icon>
                    <p>Write lyric lines to tune vocal rhythm.</p>
                </div>
            } @else {
                <section class="meter-section">
                    <div class="overview-grid">
                        <div class="overview-card">
                            <span class="overview-label">Lines</span>
                            <strong>{{ analysis().countedLines }}</strong>
                        </div>
                        <div class="overview-card">
                            <span class="overview-label">Avg.</span>
                            <strong>{{ analysis().averageUnits }}</strong>
                        </div>
                        <div class="overview-card">
                            <span class="overview-label">Range</span>
                            <strong>{{ analysis().minUnits }}-{{ analysis().maxUnits }}</strong>
                        </div>
                        <div class="overview-card warn">
                            <span class="overview-label">Review</span>
                            <strong>{{ analysis().reviewLines }}</strong>
                        </div>
                    </div>
                </section>

                <section class="meter-section">
                    <div class="meter-header">
                        <div class="meter-title">
                            <lucide-icon [img]="Target" class="h-4 w-4 text-primary"></lucide-icon>
                            <span>Line Map</span>
                        </div>
                        @if (analysis().targetPattern.length) {
                            <span class="pattern-pill">{{ analysis().targetPattern.join(' / ') }}</span>
                        }
                    </div>

                    <div class="line-list">
                        @for (line of analysis().lines; track line.id) {
                            <button
                                class="line-row"
                                [class.selected]="selectedLineId() === line.id"
                                [class.review]="line.status === 'review'"
                                [class.dense]="line.status === 'dense' || line.status === 'dragging'"
                                [class.clipped]="line.status === 'clipped'"
                                (click)="selectLine(line)"
                            >
                                <span class="line-number">{{ line.lineNumber }}</span>
                                <span class="line-units">{{ line.units }}</span>
                                <span class="line-status">{{ statusLabel(line) }}</span>
                                <span class="line-text">{{ line.text.trim() }}</span>
                                @if (line.delta !== null) {
                                    <span class="line-delta" [class.over]="line.delta > 0" [class.under]="line.delta < 0">
                                        {{ formatDelta(line.delta) }}
                                    </span>
                                }
                            </button>
                        }
                    </div>
                </section>

                @if (selectedLine(); as line) {
                    <section class="meter-section selected-panel">
                        <div class="meter-header">
                            <div class="meter-title">
                                <span>Line {{ line.lineNumber }}</span>
                            </div>
                            <span class="confidence-pill" [class.low]="line.confidence < 0.8">
                                {{ confidenceLabel(line.confidence) }}
                            </span>
                        </div>

                        <div class="selected-summary">
                            <div>
                                <span class="muted">Count</span>
                                <strong>{{ line.units }} {{ line.unitKind === 'mora' ? 'morae' : 'syllables' }}</strong>
                            </div>
                            <div>
                                <span class="muted">Target</span>
                                <strong>{{ line.targetUnits ?? 'none' }}</strong>
                            </div>
                            <div>
                                <span class="muted">Density</span>
                                <strong>{{ line.density }}</strong>
                            </div>
                        </div>

                        <div class="token-list">
                            @for (token of line.tokens; track token.from) {
                                <span class="token-pill" [class.review]="token.confidence < 0.75" [title]="token.warnings.join('; ')">
                                    {{ token.text }}<b>{{ token.unitCount }}</b>
                                </span>
                            }
                        </div>

                        @if (line.warnings.length) {
                            <div class="warning-list">
                                @for (warning of line.warnings; track warning) {
                                    <p>{{ warning }}</p>
                                }
                            </div>
                        }
                    </section>
                }
            }
        </div>
    `,
    styles: [`
        .meter-shell {
            display: flex;
            flex-direction: column;
            gap: 1rem;
        }

        .meter-section {
            display: flex;
            flex-direction: column;
            gap: 0.65rem;
        }

        .meter-header,
        .meter-title {
            display: flex;
            align-items: center;
            gap: 0.5rem;
        }

        .meter-header {
            justify-content: space-between;
        }

        .meter-title {
            color: hsl(var(--foreground));
            font-size: 0.9rem;
            font-weight: 600;
        }

        .ghost-btn,
        .pattern-pill,
        .confidence-pill {
            border: 1px solid rgba(255, 255, 255, 0.1);
            border-radius: 0.25rem;
            background: rgba(255, 255, 255, 0.04);
            color: hsl(var(--muted-foreground));
            font-size: 0.7rem;
            padding: 0.25rem 0.45rem;
        }

        .ghost-btn {
            display: flex;
            align-items: center;
            gap: 0.25rem;
            cursor: pointer;
        }

        .ghost-btn:hover {
            color: hsl(var(--foreground));
            border-color: rgba(45, 212, 191, 0.45);
        }

        .meter-controls,
        .overview-grid,
        .selected-summary {
            display: grid;
            grid-template-columns: repeat(3, minmax(0, 1fr));
            gap: 0.5rem;
        }

        .control-field {
            display: flex;
            flex-direction: column;
            gap: 0.3rem;
            min-width: 0;
        }

        .control-field span,
        .overview-label,
        .muted {
            color: hsl(var(--muted-foreground));
            font-size: 0.68rem;
            text-transform: uppercase;
            letter-spacing: 0;
        }

        .control-field input,
        .control-field select {
            width: 100%;
            min-width: 0;
            height: 2rem;
            border: 1px solid rgba(255, 255, 255, 0.1);
            border-radius: 0.25rem;
            background: rgba(255, 255, 255, 0.05);
            color: hsl(var(--foreground));
            font-size: 0.75rem;
            padding: 0 0.45rem;
            outline: none;
        }

        .overview-card {
            border: 1px solid rgba(255, 255, 255, 0.08);
            border-radius: 0.25rem;
            background: rgba(255, 255, 255, 0.035);
            padding: 0.55rem;
            display: flex;
            flex-direction: column;
            gap: 0.15rem;
        }

        .overview-card strong {
            color: hsl(var(--foreground));
            font-size: 1.2rem;
            line-height: 1.2;
        }

        .overview-card.warn strong {
            color: rgb(251, 191, 36);
        }

        .line-list {
            display: flex;
            flex-direction: column;
            gap: 0.25rem;
            max-height: 17rem;
            overflow: auto;
            padding-right: 0.2rem;
        }

        .line-row {
            display: grid;
            grid-template-columns: 1.8rem 2rem 4.2rem minmax(0, 1fr) 2.2rem;
            align-items: center;
            gap: 0.35rem;
            width: 100%;
            border: 1px solid rgba(255, 255, 255, 0.07);
            border-radius: 0.25rem;
            background: rgba(255, 255, 255, 0.025);
            color: hsl(var(--foreground));
            cursor: pointer;
            padding: 0.4rem;
            text-align: left;
        }

        .line-row:hover,
        .line-row.selected {
            border-color: rgba(45, 212, 191, 0.55);
            background: rgba(20, 184, 166, 0.12);
        }

        .line-row.review {
            border-color: rgba(251, 191, 36, 0.35);
        }

        .line-row.dense {
            border-color: rgba(248, 113, 113, 0.35);
        }

        .line-row.clipped {
            border-color: rgba(96, 165, 250, 0.35);
        }

        .line-number,
        .line-status,
        .line-delta {
            color: hsl(var(--muted-foreground));
            font-size: 0.7rem;
        }

        .line-units {
            color: hsl(var(--foreground));
            font-family: ui-monospace, monospace;
            font-weight: 700;
        }

        .line-text {
            min-width: 0;
            overflow: hidden;
            text-overflow: ellipsis;
            white-space: nowrap;
            font-size: 0.78rem;
        }

        .line-delta.over { color: rgb(248, 113, 113); }
        .line-delta.under { color: rgb(96, 165, 250); }

        .selected-panel {
            border-top: 1px solid rgba(255, 255, 255, 0.08);
            padding-top: 0.75rem;
        }

        .confidence-pill.low {
            color: rgb(251, 191, 36);
        }

        .selected-summary > div {
            display: flex;
            flex-direction: column;
            gap: 0.15rem;
        }

        .selected-summary strong {
            color: hsl(var(--foreground));
            font-size: 0.82rem;
        }

        .token-list {
            display: flex;
            flex-wrap: wrap;
            gap: 0.35rem;
        }

        .token-pill {
            display: inline-flex;
            align-items: center;
            gap: 0.3rem;
            border: 1px solid rgba(255, 255, 255, 0.09);
            border-radius: 0.25rem;
            background: rgba(255, 255, 255, 0.04);
            color: hsl(var(--foreground));
            font-size: 0.75rem;
            padding: 0.25rem 0.4rem;
        }

        .token-pill.review {
            border-color: rgba(251, 191, 36, 0.4);
        }

        .token-pill b {
            color: rgb(45, 212, 191);
            font-family: ui-monospace, monospace;
        }

        .warning-list {
            border: 1px solid rgba(251, 191, 36, 0.25);
            border-radius: 0.25rem;
            background: rgba(251, 191, 36, 0.08);
            color: rgb(253, 224, 71);
            font-size: 0.75rem;
            padding: 0.5rem 0.65rem;
        }

        .warning-list p {
            margin: 0.2rem 0;
        }

        .meter-empty {
            display: flex;
            flex-direction: column;
            align-items: center;
            justify-content: center;
            gap: 0.5rem;
            padding: 2rem 1rem;
            text-align: center;
            color: hsl(var(--muted-foreground));
            font-size: 0.82rem;
        }
    `],
})
export class MeterAnalysisComponent {
    private editorService = inject(EditorService);
    private prettyTextApi = getPrettyTextApi();

    readonly text = input('');
    readonly noteId = input<string | null>(null);

    readonly BookOpen = BookOpen;
    readonly Target = Target;
    readonly X = X;

    readonly language = signal<MeterLanguage>('auto');
    readonly scope = signal<MeterScope>('note');
    readonly targetPattern = signal('');
    readonly selectedLineId = signal<string | null>(null);

    readonly analysis = computed(() => analyzeMeter(this.text(), {
        language: this.language(),
        targetPattern: this.targetPattern(),
    }));

    readonly hasContent = computed(() => this.analysis().countedLines > 0);
    readonly selectedLine = computed(() => {
        const selectedId = this.selectedLineId();
        if (!selectedId) return null;
        return this.analysis().lines.find(line => line.id === selectedId) ?? null;
    });

    setLanguage(value: string): void {
        this.language.set(value === 'en' || value === 'ja' ? value : 'auto');
        this.clearSelection();
    }

    setScope(value: string): void {
        this.scope.set(value === 'selection' ? 'selection' : 'note');
    }

    selectLine(line: MeterLine): void {
        const noteId = this.noteId();
        this.selectedLineId.set(line.id);
        if (!noteId || line.to <= line.from) return;

        this.prettyTextApi.setAnalyticsHighlights(noteId, line.id, 'meter', `Line ${line.lineNumber}`, [{
            from: line.from,
            to: line.to,
            text: line.text,
        }], 'meter');
        this.editorService.selectProjectedRange(line.from, line.to);
    }

    clearSelection(): void {
        this.selectedLineId.set(null);
        this.prettyTextApi.clearAnalyticsDetailHighlights();
    }

    statusLabel(line: MeterLine): string {
        if (line.status === 'dragging') return 'long';
        return line.status;
    }

    formatDelta(delta: number): string {
        if (delta === 0) return '0';
        return delta > 0 ? `+${delta}` : `${delta}`;
    }

    confidenceLabel(confidence: number): string {
        return `${Math.round(confidence * 100)}%`;
    }
}
