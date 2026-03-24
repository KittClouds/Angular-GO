// src/app/components/graptor-module/graptor-module.component.ts
// Graptor eval module — tests GLDR (graph-based lexical document retrieval).

import { Component, OnInit, signal, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Button } from 'primeng/button';
import { TableModule } from 'primeng/table';
import { CardModule } from 'primeng/card';
import { Tag } from 'primeng/tag';
import { InputTextModule } from 'primeng/inputtext';
import { ProgressBarModule } from 'primeng/progressbar';
import { Divider } from 'primeng/divider';
import { PhoenixUiApiService } from '../../services/phoenix-ui-api.service';
import { PlaygroundLogService } from '../../services/playground-log.service';
import { PlaygroundDataService } from '../../services/playground-data.service';

export interface GraptorSearchResult {
    chunkId: string;
    chunkScore: number;
    lexScore: number;
    graphScore: number;
    matchedEntities: { entityId: string; proximity: number; mentionCount: number }[];
}

export interface GraptorNodeResult {
    entityId: string;
    nodeScore: number;
    topChunks: string[];
    proximityFromQuery: number;
}

export interface GraptorStats {
    entities: number;
    chunks: number;
    edges: number;
}

@Component({
    selector: 'app-graptor-module',
    standalone: true,
    imports: [
        CommonModule,
        FormsModule,
        Button,
        TableModule,
        CardModule,
        Tag,
        InputTextModule,
        ProgressBarModule,
        Divider,
    ],
    template: `
    <div class="module-graptor">

      <!-- Stats -->
      <div class="module-stats">
        <div class="stat-pill">
          <span class="stat-value text-teal-400">{{ stats().entities }}</span>
          <span class="stat-label">Entities</span>
        </div>
        <div class="stat-pill">
          <span class="stat-value text-cyan-400">{{ stats().chunks }}</span>
          <span class="stat-label">Chunks</span>
        </div>
        <div class="stat-pill">
          <span class="stat-value text-green-400">{{ stats().edges }}</span>
          <span class="stat-label">Graph Edges</span>
        </div>
        <div class="stat-pill">
          <span class="stat-value text-lime-400">{{ chunkResults().length }}</span>
          <span class="stat-label">Results</span>
        </div>
      </div>

      <!-- Controls -->
      <div class="module-controls">
        <p-button
          label="Init GLDR"
          icon="pi pi-bolt"
          (onClick)="initGLDR()"
          [loading]="initializing()"
          [disabled]="initialized()"
          size="small">
        </p-button>
        <p-button
          label="Index Chapters"
          icon="pi pi-upload"
          (onClick)="indexChapters()"
          [loading]="indexing()"
          [disabled]="!initialized() || !dataService.documentReady() || stats().chunks > 0"
          severity="secondary"
          size="small">
        </p-button>
        <p-button
          label="Load Co-Occurrences"
          icon="pi pi-share-alt"
          (onClick)="loadCooccurrences()"
          [loading]="loadingGraph()"
          [disabled]="!initialized() || stats().chunks === 0"
          severity="secondary"
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

      @if (initialized()) {
        <p-divider></p-divider>

        <!-- Search playground -->
        <div class="search-bar">
          <input
            id="gldr-query-input"
            pInputText
            [(ngModel)]="queryText"
            placeholder="Search with GLDR (entity-aware)…"
            class="search-input"
            (keydown.enter)="runSearch()">
          <p-button
            label="Search"
            icon="pi pi-search"
            (onClick)="runSearch()"
            [loading]="searching()"
            [disabled]="!queryText.trim()"
            size="small">
          </p-button>
          <p-button
            label="Entity Search"
            icon="pi pi-sitemap"
            (onClick)="runEntitySearch()"
            [loading]="searching()"
            [disabled]="!queryText.trim()"
            severity="secondary"
            size="small">
          </p-button>
        </div>

        <!-- Chunk results -->
        @if (chunkResults().length > 0) {
          <div class="results-section">
            <h4 class="section-heading">Chunk Results ({{ chunkResults().length }})</h4>
            <p-table [value]="chunkResults()" [paginator]="true" [rows]="10"
                     [tableStyle]="{ 'min-width': '44rem' }" styleClass="p-datatable-sm">
              <ng-template pTemplate="header">
                <tr>
                  <th>Chunk ID</th>
                  <th>Fused Score</th>
                  <th>Lex Score</th>
                  <th>Graph Score</th>
                  <th>Matched Entities</th>
                </tr>
              </ng-template>
              <ng-template pTemplate="body" let-row>
                <tr>
                  <td class="font-mono text-xs">{{ row.chunkId }}</td>
                  <td>
                    <div class="score-bar-wrap">
                      <div class="score-bar" [style.width.%]="row.chunkScore * 100"></div>
                      <span class="score-label">{{ row.chunkScore | number:'1.3' }}</span>
                    </div>
                  </td>
                  <td>{{ row.lexScore | number:'1.2' }}</td>
                  <td>{{ row.graphScore | number:'1.2' }}</td>
                  <td>
                    @for (e of row.matchedEntities; track e.entityId) {
                      <p-tag [value]="e.entityId + ' (' + (e.proximity | number:'1.2') + ')'"
                             severity="secondary" styleClass="text-xs mr-1 mb-1">
                      </p-tag>
                    }
                  </td>
                </tr>
              </ng-template>
            </p-table>
          </div>
        }

        <!-- Node results -->
        @if (nodeResults().length > 0) {
          <div class="results-section">
            <h4 class="section-heading">Entity Node Ranking ({{ nodeResults().length }})</h4>
            <p-table [value]="nodeResults()" [tableStyle]="{ 'min-width': '36rem' }" styleClass="p-datatable-sm">
              <ng-template pTemplate="header">
                <tr>
                  <th>Entity</th>
                  <th>Node Score</th>
                  <th>Proximity</th>
                  <th>Top Chunks</th>
                </tr>
              </ng-template>
              <ng-template pTemplate="body" let-row>
                <tr>
                  <td><p-tag [value]="row.entityId" severity="info"></p-tag></td>
                  <td>
                    <div class="score-bar-wrap">
                      <div class="score-bar" [style.width.%]="row.nodeScore * 100"></div>
                      <span class="score-label">{{ row.nodeScore | number:'1.3' }}</span>
                    </div>
                  </td>
                  <td>{{ row.proximityFromQuery | number:'1.3' }}</td>
                  <td class="font-mono text-xs">{{ row.topChunks.slice(0, 2).join(', ') }}</td>
                </tr>
              </ng-template>
            </p-table>
          </div>
        }
      } @else {
        <div class="empty-state">
          <i class="pi pi-share-alt empty-icon"></i>
          <p>Initialize GLDR to explore graph-based retrieval.</p>
          <p class="text-sm text-surface-400">GLDR fuses BM25 lexical scoring with entity graph proximity — no embeddings needed.</p>
        </div>
      }
    </div>
  `,
    styles: [`
    .module-graptor { padding: 1rem 0; }
    .module-stats { display: flex; gap: 1rem; margin-bottom: 1.25rem; flex-wrap: wrap; }
    .stat-pill {
      display: flex; flex-direction: column; align-items: center;
      background: var(--surface-card); border: 1px solid var(--surface-border);
      border-radius: 0.75rem; padding: 0.6rem 1.2rem; min-width: 80px;
    }
    .stat-value { font-size: 1.5rem; font-weight: 700; line-height: 1.2; }
    .stat-label { font-size: 0.7rem; color: var(--text-color-secondary); text-transform: uppercase; letter-spacing: 0.05em; margin-top: 2px; }
    .module-controls { display: flex; gap: 0.5rem; flex-wrap: wrap; }
    .search-bar { display: flex; gap: 0.5rem; margin: 1rem 0; align-items: center; }
    .search-input { flex: 1; }
    .results-section { margin-top: 1.25rem; }
    .section-heading { font-size: 0.75rem; font-weight: 600; color: var(--text-color-secondary); text-transform: uppercase; letter-spacing: 0.05em; margin-bottom: 0.5rem; }
    .score-bar-wrap { display: flex; align-items: center; gap: 0.5rem; }
    .score-bar {
      height: 6px; border-radius: 3px; max-width: 80px;
      background: linear-gradient(90deg, var(--primary-400), var(--primary-600));
      transition: width 0.3s;
    }
    .score-label { font-size: 0.8rem; font-family: monospace; }
    .empty-state {
      text-align: center; padding: 2rem;
      color: var(--text-color-secondary);
    }
    .empty-icon { font-size: 2.5rem; margin-bottom: 0.75rem; display: block; color: var(--primary-400); }
  `],
})
export class GraptorModuleComponent implements OnInit {
    protected readonly dataService = inject(PlaygroundDataService);
    private readonly logService = inject(PlaygroundLogService);
    private readonly phoenixUiApi = inject(PhoenixUiApiService);

    readonly initialized = signal(false);
    readonly initializing = signal(false);
    readonly indexing = signal(false);
    readonly loadingGraph = signal(false);
    readonly searching = signal(false);

    readonly stats = signal<GraptorStats>({ entities: 0, chunks: 0, edges: 0 });
    readonly chunkResults = signal<GraptorSearchResult[]>([]);
    readonly nodeResults = signal<GraptorNodeResult[]>([]);

    queryText = '';

    private log = (level: 'info' | 'warn' | 'error' | 'success', msg: string) =>
        this.logService.log(level, 'graptor', msg);

    ngOnInit(): void {
        this.logService.info('graptor', 'Graptor module ready');
    }

    async initGLDR(): Promise<void> {
        this.initializing.set(true);
        this.log('info', 'Initializing GLDR index…');
        try {
            await this.phoenixUiApi.gldrInit();
            this.initialized.set(true);
            this.log('success', 'GLDR initialized');
            await this.refreshStats();
        } catch (err) {
            this.log('error', `GLDR init failed: ${err}`);
        } finally {
            this.initializing.set(false);
        }
    }

    async indexChapters(): Promise<void> {
        const chapters = this.dataService.chapters();
        if (!chapters.length) {
            this.log('warn', 'No chapters to index — load a document first');
            return;
        }
        this.indexing.set(true);
        this.log('info', `Indexing ${chapters.length} chapters in GLDR…`);
        try {
            for (let i = 0; i < chapters.length; i++) {
                const ch = chapters[i];
                if (i % 10 === 0) this.log('info', `Chapter ${i + 1}/${chapters.length}`);
                await this.phoenixUiApi.gldrIndexChunk(ch.id, { content: ch.text }, []);
            }
            this.log('success', `Indexed ${chapters.length} chunks`);
            await this.refreshStats();
        } catch (err) {
            this.log('error', `Indexing failed: ${err}`);
        } finally {
            this.indexing.set(false);
        }
    }

    async loadCooccurrences(): Promise<void> {
        this.loadingGraph.set(true);
        this.log('info', 'Loading entity co-occurrence graph…');
        try {
            await this.phoenixUiApi.gldrLoadCooccurrences(2);
            this.log('success', 'Co-occurrence graph loaded');
            await this.refreshStats();
        } catch (err) {
            this.log('error', `Co-occurrence load failed: ${err}`);
        } finally {
            this.loadingGraph.set(false);
        }
    }

    async runSearch(): Promise<void> {
        if (!this.queryText.trim()) return;
        this.searching.set(true);
        this.nodeResults.set([]);
        this.log('info', `Searching: "${this.queryText}"`);
        try {
            const raw = await this.phoenixUiApi.gldrSearch(this.queryText, {});
            const results: GraptorSearchResult[] = JSON.parse(raw);
            this.chunkResults.set(results);
            this.log('success', `${results.length} chunk results`);
        } catch (err) {
            this.log('error', `Search failed: ${err}`);
        } finally {
            this.searching.set(false);
        }
    }

    async runEntitySearch(): Promise<void> {
        if (!this.queryText.trim()) return;
        this.searching.set(true);
        this.chunkResults.set([]);
        this.log('info', `Entity search: "${this.queryText}"`);
        try {
            const raw = await this.phoenixUiApi.gldrSearchNodes(this.queryText, {});
            const results: GraptorNodeResult[] = JSON.parse(raw);
            this.nodeResults.set(results);
            this.log('success', `${results.length} entity node results`);
        } catch (err) {
            this.log('error', `Entity search failed: ${err}`);
        } finally {
            this.searching.set(false);
        }
    }

    clearIndex(): void {
        this.stats.set({ entities: 0, chunks: 0, edges: 0 });
        this.chunkResults.set([]);
        this.nodeResults.set([]);
        this.initialized.set(false);
        this.log('info', 'GLDR index cleared');
    }

    private async refreshStats(): Promise<void> {
        try {
            const raw = await this.phoenixUiApi.gldrStats();
            this.stats.set(JSON.parse(raw));
        } catch { /* ignore */ }
    }
}
