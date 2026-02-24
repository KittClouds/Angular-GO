// src/app/components/raptor-module/raptor-module.component.ts
// RAPTOR eval module — slim version wired to shared Playground services.

import { Component, OnInit, signal, computed, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { Button } from 'primeng/button';
import { TableModule } from 'primeng/table';
import { CardModule } from 'primeng/card';
import { Tag } from 'primeng/tag';
import { Tabs, TabList, Tab, TabPanels, TabPanel } from 'primeng/tabs';
import { ProgressBarModule } from 'primeng/progressbar';
import { RaptorEvalService, RaptorStats } from '../../services/raptor-eval.service';
import { PlaygroundLogService } from '../../services/playground-log.service';
import { PlaygroundDataService } from '../../services/playground-data.service';
import { EvalRunner, EvalMetrics, EvalSummary, DEFAULT_EVAL_CONFIG } from '../../lib/eval';
import { generateGoldQueries, toTypeScriptCode } from '../../lib/eval/generate-gold-queries';

@Component({
    selector: 'app-raptor-module',
    standalone: true,
    imports: [
        CommonModule,
        Button,
        TableModule,
        CardModule,
        Tag,
        Tabs, TabList, Tab, TabPanels, TabPanel,
        ProgressBarModule,
    ],
    template: `
    <div class="module-raptor">

      <!-- Status bar -->
      <div class="module-stats">
        <div class="stat-pill">
          <span class="stat-value text-blue-400">{{ stats().docCount }}</span>
          <span class="stat-label">Docs</span>
        </div>
        <div class="stat-pill">
          <span class="stat-value text-emerald-400">{{ stats().leafCount }}</span>
          <span class="stat-label">Leaves</span>
        </div>
        <div class="stat-pill">
          <span class="stat-value text-violet-400">{{ stats().treeCount }}</span>
          <span class="stat-label">Trees</span>
        </div>
        <div class="stat-pill">
          <span class="stat-value text-amber-400">{{ queryCount() }}</span>
          <span class="stat-label">Queries</span>
        </div>
      </div>

      <!-- Controls -->
      <div class="module-controls">
        <p-button
          label="Initialize"
          icon="pi pi-power-off"
          (onClick)="initialize()"
          [loading]="initializing()"
          [disabled]="initialized()"
          size="small">
        </p-button>
        <p-button
          label="Ingest Chapters"
          icon="pi pi-upload"
          (onClick)="ingestChapters()"
          [loading]="ingesting()"
          [disabled]="!initialized() || !dataService.documentReady() || stats().docCount > 0"
          severity="secondary"
          size="small">
        </p-button>
        <p-button
          label="Build Tree"
          icon="pi pi-sitemap"
          (onClick)="buildTree()"
          [loading]="building()"
          [disabled]="!initialized() || stats().docCount === 0"
          severity="secondary"
          size="small">
        </p-button>
        <p-button
          label="Run Eval"
          icon="pi pi-check-circle"
          (onClick)="runEvaluation()"
          [loading]="evaluating()"
          [disabled]="!initialized() || stats().docCount === 0"
          severity="success"
          size="small">
        </p-button>
        <p-button
          label="Gold Queries"
          icon="pi pi-sparkles"
          (onClick)="generateGoldQueries()"
          [loading]="generating()"
          [disabled]="!initialized() || stats().docCount === 0"
          severity="info"
          size="small">
        </p-button>
        <p-button
          label="Clear"
          icon="pi pi-trash"
          (onClick)="clearIndex()"
          [disabled]="!initialized()"
          severity="danger"
          size="small">
        </p-button>
      </div>

      <!-- Results -->
      @if (summary()) {
        <p-tabs value="0" class="mt-4">
          <p-tablist>
            <p-tab value="0">Summary</p-tab>
            <p-tab value="1">Raw Results</p-tab>
            <p-tab value="2">Export</p-tab>
          </p-tablist>
          <p-tabpanels>
            <p-tabpanel value="0">
              <div class="results-section">
                <h4 class="section-heading">By Mode</h4>
                <p-table [value]="modeData()" [tableStyle]="{ 'min-width': '40rem' }" styleClass="p-datatable-sm">
                  <ng-template pTemplate="header">
                    <tr>
                      <th>Mode</th>
                      <th>Doc Recall</th>
                      <th>Doc F1</th>
                      <th>Chunk Recall</th>
                      <th>Chunk F1</th>
                      <th>Latency (ms)</th>
                    </tr>
                  </ng-template>
                  <ng-template pTemplate="body" let-row>
                    <tr>
                      <td><p-tag [value]="row.mode" [severity]="getModeSeverity(row.mode)"></p-tag></td>
                      <td>{{ row.docRecall | number:'1.3' }}</td>
                      <td>{{ row.docF1 | number:'1.3' }}</td>
                      <td>{{ row.chunkRecall | number:'1.3' }}</td>
                      <td>{{ row.chunkF1 | number:'1.3' }}</td>
                      <td>{{ row.latency | number:'1.0' }}</td>
                    </tr>
                  </ng-template>
                </p-table>
              </div>
            </p-tabpanel>

            <p-tabpanel value="1">
              <p-table [value]="results()" [paginator]="true" [rows]="10"
                       [tableStyle]="{ 'min-width': '50rem' }" styleClass="p-datatable-sm">
                <ng-template pTemplate="header">
                  <tr>
                    <th>Query</th>
                    <th>Mode</th>
                    <th>Chunk Recall</th>
                    <th>Doc Recall</th>
                    <th>Latency</th>
                  </tr>
                </ng-template>
                <ng-template pTemplate="body" let-row>
                  <tr>
                    <td class="font-medium">{{ row.query }}</td>
                    <td><p-tag [value]="row.mode" [severity]="getModeSeverity(row.mode)"></p-tag></td>
                    <td>{{ row.chunkRecall | number:'1.2' }}</td>
                    <td>{{ row.docRecall | number:'1.2' }}</td>
                    <td>{{ row.latencyMs | number:'1.0' }}ms</td>
                  </tr>
                </ng-template>
              </p-table>
            </p-tabpanel>

            <p-tabpanel value="2">
              <div class="export-controls">
                <p-button label="Download CSV" icon="pi pi-download" (onClick)="downloadCSV()" size="small"></p-button>
                <p-button label="Download Markdown" icon="pi pi-download" (onClick)="downloadMarkdown()" size="small" styleClass="ml-2"></p-button>
              </div>
            </p-tabpanel>
          </p-tabpanels>
        </p-tabs>
      } @else if (evaluating()) {
        <div class="eval-progress">
          <p-progressBar mode="indeterminate" styleClass="mt-4" [style]="{ height: '4px' }"></p-progressBar>
          <p class="text-sm text-surface-400 mt-2">Running evaluation suite…</p>
        </div>
      }
    </div>
  `,
    styles: [`
    .module-raptor { padding: 1rem 0; }
    .module-stats {
      display: flex; gap: 1rem; margin-bottom: 1.25rem; flex-wrap: wrap;
    }
    .stat-pill {
      display: flex; flex-direction: column; align-items: center;
      background: var(--surface-card); border: 1px solid var(--surface-border);
      border-radius: 0.75rem; padding: 0.6rem 1.2rem; min-width: 80px;
    }
    .stat-value { font-size: 1.5rem; font-weight: 700; line-height: 1.2; }
    .stat-label { font-size: 0.7rem; color: var(--text-color-secondary); text-transform: uppercase; letter-spacing: 0.05em; margin-top: 2px; }
    .module-controls { display: flex; gap: 0.5rem; flex-wrap: wrap; }
    .results-section { padding: 0.75rem 0; }
    .section-heading { font-size: 0.875rem; font-weight: 600; color: var(--text-color-secondary); text-transform: uppercase; letter-spacing: 0.05em; margin-bottom: 0.75rem; }
    .export-controls { padding: 1rem 0; }
    .eval-progress { text-align: center; }
  `],
})
export class RaptorModuleComponent implements OnInit {
    protected readonly dataService = inject(PlaygroundDataService);
    private readonly logService = inject(PlaygroundLogService);
    private readonly raptorEvalService = inject(RaptorEvalService);

    // State
    readonly initialized = signal(false);
    readonly initializing = signal(false);
    readonly ingesting = signal(false);
    readonly building = signal(false);
    readonly evaluating = signal(false);
    readonly generating = signal(false);
    readonly stats = signal<RaptorStats>({ docCount: 0, leafCount: 0, treeCount: 0 });
    readonly results = signal<EvalMetrics[]>([]);
    readonly summary = signal<EvalSummary | null>(null);

    private evalRunner: EvalRunner | null = null;

    readonly queryCount = computed(() => {
        const cfg = DEFAULT_EVAL_CONFIG;
        return cfg.sampleSize > 0 ? cfg.sampleSize : 100;
    });

    readonly modeData = computed(() => {
        const s = this.summary();
        if (!s) return [];
        return Object.entries(s.byMode).map(([mode, m]) => ({
            mode,
            docRecall: m.avgDocRecall,
            docF1: m.avgDocF1,
            chunkRecall: m.avgChunkRecall,
            chunkF1: m.avgChunkF1,
            latency: m.avgLatencyMs,
        }));
    });

    ngOnInit(): void {
        this.logService.info('raptor', 'RAPTOR module ready');
    }

    private log = (level: 'info' | 'warn' | 'error' | 'success', msg: string) =>
        this.logService.log(level, 'raptor', msg);

    async initialize(): Promise<void> {
        this.initializing.set(true);
        this.log('info', 'Initializing RAPTOR service…');
        try {
            await this.raptorEvalService.initialize();
            this.initialized.set(true);
            this.log('success', 'RAPTOR ready');
            await this.refreshStats();
        } catch (err) {
            this.log('error', `Init failed: ${err}`);
        } finally {
            this.initializing.set(false);
        }
    }

    async ingestChapters(): Promise<void> {
        const chapters = this.dataService.chapters();
        if (!chapters.length) {
            this.log('warn', 'No chapters loaded — use the Load Document button');
            return;
        }
        this.ingesting.set(true);
        this.log('info', `Ingesting ${chapters.length} chapters…`);
        try {
            let count = 0;
            for (let i = 0; i < chapters.length; i++) {
                const ch = chapters[i];
                if (i % 10 === 0 || i === chapters.length - 1) {
                    this.log('info', `Chapter ${i + 1}/${chapters.length} (${ch.id})`);
                }
                await this.raptorEvalService.ingestDocumentStreaming(ch.id, ch.text, undefined, 128);
                count++;
            }
            this.log('success', `Ingested ${count} chapters`);
            await this.refreshStats();
        } catch (err) {
            this.log('error', `Ingestion error: ${err}`);
        } finally {
            this.ingesting.set(false);
        }
    }

    async buildTree(): Promise<void> {
        this.building.set(true);
        this.log('info', 'Building RAPTOR tree…');
        try {
            await this.raptorEvalService.buildTree();
            this.log('success', 'Tree built');
            await this.refreshStats();
        } catch (err) {
            this.log('error', `Build failed: ${err}`);
        } finally {
            this.building.set(false);
        }
    }

    async runEvaluation(): Promise<void> {
        this.evaluating.set(true);
        this.log('info', 'Running evaluation…');
        try {
            this.evalRunner = new EvalRunner(this.raptorEvalService, {
                ...DEFAULT_EVAL_CONFIG,
                sampleSize: 20,
                onLog: msg => this.log('info', msg.replace('[EvalRunner] ', '')),
            });
            const results = await this.evalRunner.runEvaluation();
            this.results.set(results);
            this.summary.set(this.evalRunner.summarize());
            this.log('success', `Done — ${results.length} query-mode results`);
        } catch (err) {
            this.log('error', `Eval failed: ${err}`);
        } finally {
            this.evaluating.set(false);
        }
    }

    async generateGoldQueries(): Promise<void> {
        this.generating.set(true);
        this.log('info', 'Generating gold queries…');
        try {
            const gen = await generateGoldQueries(this.raptorEvalService, 10, msg => this.log('info', msg));
            const ts = toTypeScriptCode(gen);
            this.downloadFile(ts, 'gold-queries.generated.ts', 'text/typescript');
            this.log('success', `Generated ${gen.length} gold queries`);
        } catch (err) {
            this.log('error', `Gold query gen failed: ${err}`);
        } finally {
            this.generating.set(false);
        }
    }

    clearIndex(): void {
        this.raptorEvalService.clear();
        this.results.set([]);
        this.summary.set(null);
        this.log('info', 'RAPTOR index cleared');
        this.refreshStats();
    }

    downloadCSV(): void {
        if (!this.evalRunner) return;
        this.downloadFile(this.evalRunner.toCSV(), 'raptor-eval.csv', 'text/csv');
        this.log('success', 'CSV exported');
    }

    downloadMarkdown(): void {
        if (!this.evalRunner || !this.summary()) return;
        this.downloadFile(this.evalRunner.toMarkdown(this.summary()!), 'raptor-eval.md', 'text/markdown');
        this.log('success', 'Markdown exported');
    }

    private async refreshStats(): Promise<void> {
        const s = await this.raptorEvalService.getStatsAsync();
        this.stats.set(s);
    }

    private downloadFile(content: string, name: string, mime: string): void {
        const blob = new Blob([content], { type: mime });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url; a.download = name; a.click();
        URL.revokeObjectURL(url);
    }

    getModeSeverity(mode: string): 'success' | 'info' | 'warn' | 'secondary' {
        const m: Record<string, 'success' | 'info' | 'warn' | 'secondary'> = {
            'leaf-only': 'secondary',
            'collapsed-tree': 'info',
            'aggregated': 'success',
        };
        return m[mode] ?? 'info';
    }
}
