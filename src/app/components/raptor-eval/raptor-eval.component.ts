// src/app/components/raptor-eval/raptor-eval.component.ts
// RAPTOR Evaluation UI Component

import { Component, OnInit, signal, computed } from '@angular/core';
import { CommonModule } from '@angular/common';
import { Button } from 'primeng/button';
import { TableModule } from 'primeng/table';
import { Tabs, TabList, Tab, TabPanels, TabPanel } from 'primeng/tabs';
import { CardModule } from 'primeng/card';
import { Tag } from 'primeng/tag';
import { RaptorEvalService, RaptorStats } from '../../services/raptor-eval.service';
import { EvalRunner, EvalMetrics, EvalSummary, DEFAULT_EVAL_CONFIG } from '../../lib/eval';
import { generateGoldQueries, toTypeScriptCode, toMarkdownReport } from '../../lib/eval/generate-gold-queries';

interface LogEntry {
  timestamp: Date;
  level: 'info' | 'warn' | 'error' | 'success';
  message: string;
}

@Component({
  selector: 'app-raptor-eval',
  standalone: true,
  imports: [
    CommonModule,
    Button,
    TableModule,
    Tabs,
    TabList,
    Tab,
    TabPanels,
    TabPanel,
    CardModule,
    Tag,
  ],
  template: `
    <div class="p-6 max-w-6xl mx-auto">
      <h1 class="text-2xl font-bold mb-6">RAPTOR Evaluation Harness</h1>
      
      <!-- Status Cards -->
      <div class="grid grid-cols-4 gap-4 mb-6">
        <p-card>
          <div class="text-center">
            <div class="text-3xl font-bold text-blue-600">{{ stats().docCount }}</div>
            <div class="text-sm text-gray-500">Documents</div>
          </div>
        </p-card>
        <p-card>
          <div class="text-center">
            <div class="text-3xl font-bold text-green-600">{{ stats().leafCount }}</div>
            <div class="text-sm text-gray-500">Leaf Chunks</div>
          </div>
        </p-card>
        <p-card>
          <div class="text-center">
            <div class="text-3xl font-bold text-purple-600">{{ stats().treeCount }}</div>
            <div class="text-sm text-gray-500">Trees</div>
          </div>
        </p-card>
        <p-card>
          <div class="text-center">
            <div class="text-3xl font-bold text-orange-600">{{ queryCount() }}</div>
            <div class="text-sm text-gray-500">Queries</div>
          </div>
        </p-card>
      </div>
      
      <!-- Control Panel -->
      <p-card header="Controls" class="mb-6">
        <div class="flex gap-4 flex-wrap">
          <p-button 
            label="Initialize" 
            icon="pi pi-play"
            (onClick)="initialize()"
            [loading]="initializing()"
            [disabled]="initialized()">
          </p-button>
          <p-button 
            label="Load Document" 
            icon="pi pi-file"
            (onClick)="loadDocument()"
            [loading]="loading()"
            [disabled]="!initialized() || stats().docCount > 0">
          </p-button>
          <p-button 
            label="Build Tree" 
            icon="pi pi-sitemap"
            (onClick)="buildTree()"
            [loading]="building()"
            [disabled]="!initialized() || stats().docCount === 0">
          </p-button>
          <p-button 
            label="Run Evaluation" 
            icon="pi pi-check-circle"
            (onClick)="runEvaluation()"
            [loading]="evaluating()"
            [disabled]="!initialized() || stats().docCount === 0"
            styleClass="p-button-success">
          </p-button>
          <p-button 
            label="Generate Gold Queries" 
            icon="pi pi-sparkles"
            (onClick)="generateGoldQueries()"
            [loading]="generating()"
            [disabled]="!initialized() || stats().docCount === 0"
            styleClass="p-button-info">
          </p-button>
          <p-button 
            label="Clear" 
            icon="pi pi-trash"
            (onClick)="clearAll()"
            [disabled]="!initialized()"
            styleClass="p-button-danger">
          </p-button>
        </div>
      </p-card>
      
      <!-- Log Panel -->
      <p-card header="Log" class="mb-6">
        <div class="h-48 overflow-y-auto font-mono text-sm bg-gray-50 p-3 rounded">
          @for (entry of logs(); track entry.timestamp) {
            <div [class]="'log-' + entry.level">
              <span class="text-gray-400">[{{ entry.timestamp | date:'HH:mm:ss' }}]</span>
              {{ entry.message }}
            </div>
          }
        </div>
      </p-card>
      
      <!-- Results Panel -->
      @if (summary()) {
        <p-tabs value="0">
          <p-tablist>
            <p-tab value="0">Summary</p-tab>
            <p-tab value="1">Raw Results</p-tab>
            <p-tab value="2">Gold Generation</p-tab>
            <p-tab value="3">Export</p-tab>
          </p-tablist>
          <p-tabpanels>
            <p-tabpanel value="0">
              <div class="p-4">
                  <h3 class="text-lg font-semibold mb-4">By Retrieval Mode</h3>
                <p-table [value]="modeData()" [tableStyle]="{ 'min-width': '60rem' }">
                  <ng-template pTemplate="header">
                    <tr>
                      <th rowspan="2">Mode</th>
                      <th colspan="3" class="text-center bg-blue-50">Router (Doc Level)</th>
                      <th colspan="3" class="text-center bg-green-50">Evidence (Chunk Level)</th>
                      <th rowspan="2">Latency (ms)</th>
                    </tr>
                    <tr>
                      <th class="bg-blue-50">Prec</th>
                      <th class="bg-blue-50">Recall</th>
                      <th class="bg-blue-50">F1</th>
                      <th class="bg-green-50">Prec</th>
                      <th class="bg-green-50">Recall</th>
                      <th class="bg-green-50">F1</th>
                    </tr>
                  </ng-template>
                  <ng-template pTemplate="body" let-row>
                    <tr>
                      <td>
                        <p-tag [value]="row.mode" [severity]="getModeSeverity(row.mode)"></p-tag>
                      </td>
                      <td class="bg-blue-50">{{ row.docPrecision | number:'1.3' }}</td>
                      <td class="bg-blue-50 font-bold">{{ row.docRecall | number:'1.3' }}</td>
                      <td class="bg-blue-50">{{ row.docF1 | number:'1.3' }}</td>
                      <td class="bg-green-50">{{ row.chunkPrecision | number:'1.3' }}</td>
                      <td class="bg-green-50 font-bold">{{ row.chunkRecall | number:'1.3' }}</td>
                      <td class="bg-green-50">{{ row.chunkF1 | number:'1.3' }}</td>
                      <td>{{ row.latency | number:'1.0' }}</td>
                    </tr>
                  </ng-template>
                </p-table>
                
                <h3 class="text-lg font-semibold mt-6 mb-4">By Query Category</h3>
                <p-table [value]="categoryData()" [tableStyle]="{ 'min-width': '60rem' }">
                  <ng-template pTemplate="header">
                    <tr>
                      <th rowspan="2">Category</th>
                      <th colspan="2" class="text-center bg-blue-50">Router</th>
                      <th colspan="2" class="text-center bg-green-50">Evidence</th>
                      <th rowspan="2">Latency (ms)</th>
                    </tr>
                    <tr>
                      <th class="bg-blue-50">Recall</th>
                      <th class="bg-blue-50">F1</th>
                      <th class="bg-green-50">Recall</th>
                      <th class="bg-green-50">F1</th>
                    </tr>
                  </ng-template>
                  <ng-template pTemplate="body" let-row>
                    <tr>
                      <td>
                        <p-tag [value]="row.category" [severity]="getCategorySeverity(row.category)"></p-tag>
                      </td>
                      <td class="bg-blue-50">{{ row.docRecall | number:'1.3' }}</td>
                      <td class="bg-blue-50">{{ row.docF1 | number:'1.3' }}</td>
                      <td class="bg-green-50">{{ row.chunkRecall | number:'1.3' }}</td>
                      <td class="bg-green-50">{{ row.chunkF1 | number:'1.3' }}</td>
                      <td>{{ row.latency | number:'1.0' }}</td>
                    </tr>
                  </ng-template>
                </p-table>
              </div>
            </p-tabpanel>
            
            <p-tabpanel value="1">
              <p-table [value]="results()" [paginator]="true" [rows]="10" [tableStyle]="{ 'min-width': '75rem' }">
                <ng-template pTemplate="header">
                  <tr>
                    <th>Query</th>
                    <th>Mode</th>
                    <th>Chunks</th>
                    <th>Docs</th>
                    <th>Latency</th>
                  </tr>
                </ng-template>
                <ng-template pTemplate="body" let-row>
                  <tr>
                    <td>
                      <div class="font-bold">{{ row.query }}</div>
                      <div class="text-xs text-gray-500">{{ row.category }}</div>
                    </td>
                    <td><p-tag [value]="row.mode" [severity]="getModeSeverity(row.mode)"></p-tag></td>
                    <td>
                      <div>Rec: {{ row.chunkRecall | number:'1.2' }}</div>
                      <div class="text-xs">Count: {{ row.chunkResultCount }} ({{ row.relevantChunkCount }} rel)</div>
                    </td>
                    <td>
                      <div>Rec: {{ row.docRecall | number:'1.2' }}</div>
                      <div class="text-xs">Count: {{ row.docResultCount }} ({{ row.relevantDocCount }} rel)</div>
                    </td>
                    <td>{{ row.latencyMs | number:'1.0' }}ms</td>
                  </tr>
                </ng-template>
              </p-table>
            </p-tabpanel>

            <p-tabpanel value="2">
              <div class="p-4">
                <div class="flex justify-between items-center mb-4">
                  <h3 class="text-lg font-semibold">Generated Gold Queries ({{ generatedQueries().length }})</h3>
                  <div class="text-sm text-gray-500">Run "Generate Gold Queries" to populate</div>
                </div>
                
                <p-table [value]="generatedQueries()" [paginator]="true" [rows]="10" [tableStyle]="{ 'min-width': '75rem' }">
                  <ng-template pTemplate="header">
                    <tr>
                      <th>ID</th>
                      <th>Query</th>
                      <th>Category</th>
                      <th>Found Chunks</th>
                      <th>Found Docs</th>
                      <th>Top Result</th>
                    </tr>
                  </ng-template>
                  <ng-template pTemplate="body" let-row>
                    <tr>
                      <td class="font-mono text-sm">{{ row.id }}</td>
                      <td class="font-bold">{{ row.query }}</td>
                      <td><p-tag [value]="row.category" [severity]="getCategorySeverity(row.category)"></p-tag></td>
                      <td>{{ row.expectedChunks.length }}</td>
                      <td>{{ row.expectedDocs.length }}</td>
                      <td class="text-sm text-gray-600 italic max-w-xs truncate" [title]="row.topResultText">
                        {{ row.topResultText }}
                      </td>
                    </tr>
                  </ng-template>
                  <ng-template pTemplate="emptymessage">
                    <tr>
                      <td colspan="6" class="text-center p-4">No generated queries yet. Click "Generate Gold Queries" to run.</td>
                    </tr>
                  </ng-template>
                </p-table>
              </div>
            </p-tabpanel>

            <p-tabpanel value="3">
              <div class="p-4">
                <p-button label="Download CSV" icon="pi pi-download" (onClick)="downloadCSV()"></p-button>
                <p-button label="Download Markdown" icon="pi pi-download" (onClick)="downloadMarkdown()" styleClass="ml-2"></p-button>
              </div>
            </p-tabpanel>
          </p-tabpanels>
        </p-tabs>
      }
    </div>
  `,
  styles: [`
    :host ::ng-deep .log-info { color: #3b82f6; }
    :host ::ng-deep .log-warn { color: #f59e0b; }
    :host ::ng-deep .log-error { color: #ef4444; }
    :host ::ng-deep .log-success { color: #10b981; }
  `],
})
export class RaptorEvalComponent implements OnInit {
  // State signals
  initialized = signal(false);
  initializing = signal(false);
  loading = signal(false);
  building = signal(false);
  evaluating = signal(false);
  generating = signal(false);

  stats = signal<RaptorStats>({ docCount: 0, leafCount: 0, treeCount: 0 });
  logs = signal<LogEntry[]>([]);
  results = signal<EvalMetrics[]>([]);
  summary = signal<EvalSummary | null>(null);

  // Computed
  queryCount = computed(() => {
    const config = DEFAULT_EVAL_CONFIG;
    return config.sampleSize > 0 ? config.sampleSize : 100;
  });

  modeData = computed(() => {
    const s = this.summary();
    if (!s) return [];
    return Object.entries(s.byMode).map(([mode, metrics]) => ({
      mode,
      docPrecision: metrics.avgDocPrecision,
      docRecall: metrics.avgDocRecall,
      docF1: metrics.avgDocF1,
      chunkPrecision: metrics.avgChunkPrecision,
      chunkRecall: metrics.avgChunkRecall,
      chunkF1: metrics.avgChunkF1,
      latency: metrics.avgLatencyMs,
    }));
  });

  categoryData = computed(() => {
    const s = this.summary();
    if (!s) return [];
    return Object.entries(s.byCategory).map(([category, metrics]) => ({
      category,
      docRecall: metrics.avgDocRecall,
      docF1: metrics.avgDocF1,
      chunkRecall: metrics.avgChunkRecall,
      chunkF1: metrics.avgChunkF1,
      latency: metrics.avgLatencyMs,
    }));
  });

  private evalRunner: EvalRunner | null = null;

  ngOnInit(): void {
    // Service will initialize its own worker connection
    this.log('info', 'RAPTOR eval component ready');
  }

  async initialize(): Promise<void> {
    this.initializing.set(true);
    this.log('info', 'Initializing RAPTOR evaluation service...');

    try {
      await this.raptorEvalService.initialize();
      this.initialized.set(true);
      this.log('success', 'RAPTOR service initialized');
      await this.updateStats();
    } catch (error) {
      this.log('error', `Failed to initialize: ${error}`);
    } finally {
      this.initializing.set(false);
    }
  }

  async loadDocument(): Promise<void> {
    this.loading.set(true);
    this.log('info', 'Loading "Short Run" test document...');

    try {
      // Fetch the document (using shorter test document for faster testing)
      const response = await fetch('/docs/shortrun.md');
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }
      const text = await response.text();
      this.log('info', `Document loaded: ${text.length} characters`);

      // Split into chapters (rough split by headers)
      const chapters = this.splitIntoChapters(text);
      this.log('info', `Split into ${chapters.length} chapters`);

      // Ingest each chapter
      let ingestedCount = 0;
      for (let i = 0; i < chapters.length; i++) {
        const chapter = chapters[i];

        // Skip short chapters (likely TOC or empty placeholders)
        if (chapter.text.length < 200) {
          continue;
        }

        ingestedCount++;
        if (i % 5 === 0 || i === chapters.length - 1) {
          this.log('info', `Ingesting chapter ${i + 1}/${chapters.length} (${chapter.id})`);
        }
        await this.raptorEvalService.ingestDocumentStreaming(chapter.id, chapter.text,
          (progress) => {
            // Update UI state but don't log every micro-step to the console log
            // The service handles detailed state, we just want big picture here
          },
          128 // Larger batch size for streaming 
        );
      }

      if (ingestedCount === 0) {
        this.log('warn', 'No substantial chapters found to ingest');
      } else {
        this.log('success', `Ingested ${ingestedCount} chapters`);
      }

      await this.updateStats();
    } catch (error) {
      this.log('error', `Failed to load document: ${error}`);
    } finally {
      this.loading.set(false);
    }
  }

  async buildTree(): Promise<void> {
    this.building.set(true);
    this.log('info', 'Building RAPTOR tree...');

    try {
      await this.raptorEvalService.buildTree();
      this.log('success', 'RAPTOR tree built');
      await this.updateStats();
    } catch (error) {
      this.log('error', `Failed to build tree: ${error}`);
    } finally {
      this.building.set(false);
    }
  }

  // Signal for generated gold queries
  readonly generatedQueries = signal<any[]>([]);

  async runEvaluation(): Promise<void> {
    this.evaluating.set(true);
    this.log('info', 'Running evaluation...');

    try {
      // Create eval runner with logger
      this.evalRunner = new EvalRunner(this.raptorEvalService, {
        ...DEFAULT_EVAL_CONFIG,
        sampleSize: 20, // Quick test with 20 queries
        onLog: (msg) => this.log('info', msg.replace('[EvalRunner] ', '')),
      });

      // Run evaluation
      const results = await this.evalRunner.runEvaluation();
      this.results.set(results);

      // Generate summary
      const summary = this.evalRunner.summarize();
      this.summary.set(summary);

      this.log('success', `Evaluation complete: ${results.length} query-mode combinations`);
    } catch (error) {
      this.log('error', `Evaluation failed: ${error}`);
    } finally {
      this.evaluating.set(false);
    }
  }

  async clearAll(): Promise<void> {
    this.raptorEvalService.clear();
    this.results.set([]);
    this.summary.set(null);
    this.generatedQueries.set([]); // Clear generated queries
    await this.updateStats();
    this.log('info', 'Index cleared');
  }

  downloadCSV(): void {
    if (!this.evalRunner) return;
    const csv = this.evalRunner.toCSV();
    this.downloadFile(csv, 'raptor-eval-results.csv', 'text/csv');
    this.log('success', 'CSV downloaded');
  }

  downloadMarkdown(): void {
    if (!this.evalRunner) return;
    const md = this.evalRunner.toMarkdown(this.summary()!);
    this.downloadFile(md, 'raptor-eval-results.md', 'text/markdown');
    this.log('success', 'Markdown downloaded');
  }

  async generateGoldQueries(): Promise<void> {
    this.generating.set(true);
    this.log('info', 'Generating gold queries from search results...');

    try {
      // Pass logger callback to avoid console spam
      const generated = await generateGoldQueries(
        this.raptorEvalService,
        10,
        (msg) => this.log('info', msg)
      );

      this.generatedQueries.set(generated);

      const tsCode = toTypeScriptCode(generated);
      // const mdReport = toMarkdownReport(generated); // Optional download

      // Download TS file only, present data in UI
      this.downloadFile(tsCode, 'gold-queries.generated.ts', 'text/typescript');
      this.log('success', `Generated ${generated.length} gold queries`);
    } catch (error) {
      this.log('error', `Failed to generate: ${error}`);
    } finally {
      this.generating.set(false);
    }
  }

  private async updateStats(): Promise<void> {
    const stats = await this.raptorEvalService.getStatsAsync();
    this.stats.set(stats);
  }

  private log(level: LogEntry['level'], message: string): void {
    this.logs.update(logs => [...logs, { timestamp: new Date(), level, message }]);
  }

  private splitIntoChapters(text: string): { id: string; title: string; text: string }[] {
    // Split by chapter headers (## Chapter or # Chapter)
    const lines = text.split('\n');
    const chapters: { id: string; title: string; text: string }[] = [];
    let currentChapter: string[] = [];
    let currentTitle = 'Prologue';
    let chapterNum = 0;

    for (const line of lines) {
      // Check for chapter header
      const match = line.match(/^#+\s*(Chapter\s*\d+|Prologue|Epilogue)/i);
      if (match) {
        // Save previous chapter
        if (currentChapter.length > 0) {
          chapters.push({
            id: `chapter-${chapterNum}`,
            title: currentTitle,
            text: currentChapter.join('\n'),
          });
        }
        currentTitle = match[1];
        currentChapter = [line];
        chapterNum++;
      } else {
        currentChapter.push(line);
      }
    }

    // Save last chapter
    if (currentChapter.length > 0) {
      chapters.push({
        id: `chapter-${chapterNum}`,
        title: currentTitle,
        text: currentChapter.join('\n'),
      });
    }

    return chapters;
  }

  private downloadFile(content: string, filename: string, mimeType: string): void {
    const blob = new Blob([content], { type: mimeType });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    a.click();
    URL.revokeObjectURL(url);
  }

  getModeSeverity(mode: string): 'success' | 'info' | 'warn' | 'secondary' {
    switch (mode) {
      case 'leaf-only': return 'secondary';
      case 'collapsed-tree': return 'info';
      case 'aggregated': return 'success';
      default: return 'info';
    }
  }

  getCategorySeverity(category: string): 'success' | 'info' | 'warn' | 'danger' {
    switch (category) {
      case 'exact': return 'success';
      case 'paraphrase': return 'info';
      case 'thematic': return 'warn';
      case 'cross-chapter': return 'danger';
      default: return 'info';
    }
  }

  constructor(private raptorEvalService: RaptorEvalService) { }
}
