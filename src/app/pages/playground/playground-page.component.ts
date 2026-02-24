// src/app/pages/playground/playground-page.component.ts
// Research Playground — modular eval shell for all Go subsystems.

import { Component, OnInit, signal, computed, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { Button } from 'primeng/button';
import { Tabs, TabList, Tab, TabPanels, TabPanel } from 'primeng/tabs';

import { SelectModule } from 'primeng/select';
import { FormsModule } from '@angular/forms';

import { PlaygroundLogService, LogLevel, LogSource } from '../../services/playground-log.service';
import { PlaygroundDataService } from '../../services/playground-data.service';
import { RaptorModuleComponent } from '../../components/raptor-module/raptor-module.component';
import { GraptorModuleComponent } from '../../components/graptor-module/graptor-module.component';
import { MemoryModuleComponent } from '../../components/memory-module/memory-module.component';
import { RlmModuleComponent } from '../../components/rlm-module/rlm-module.component';

const DOC_URL = '/docs/shortrun.md';

const FILTER_OPTIONS: { label: string; value: LogSource | null }[] = [
  { label: 'All Sources', value: null },
  { label: '🔵 RAPTOR', value: 'raptor' },
  { label: '🟢 Graptor', value: 'graptor' },
  { label: '🟣 Memory/OM', value: 'memory' },
  { label: '🟠 RLM', value: 'rlm' },
  { label: '⚙️  System', value: 'system' },
];

@Component({
  selector: 'app-playground-page',
  standalone: true,
  imports: [
    CommonModule,
    FormsModule,
    Button,
    Tabs, TabList, Tab, TabPanels, TabPanel,
    SelectModule,
    RaptorModuleComponent,
    GraptorModuleComponent,
    MemoryModuleComponent,
    RlmModuleComponent,
  ],
  template: `
    <div class="playground-root">

      <!-- ===== HEADER ===== -->
      <header class="playground-header">
        <div class="header-brand">
          <div class="brand-icon">
            <i class="pi pi-microchip-ai"></i>
          </div>
          <div>
            <h1 class="brand-title">Research Playground</h1>
            <p class="brand-sub">KittClouds · Go/WASM Eval Harness</p>
          </div>
        </div>

        <div class="header-controls">
          <!-- Document loader -->
          <div class="doc-status" [class.ready]="dataService.documentReady()">
            @if (dataService.documentReady()) {
              <i class="pi pi-check-circle"></i>
              <span>{{ dataService.chapterCount() }} chapters · {{ (dataService.characterCount() / 1000 | number:'1.0') }}k chars</span>
            } @else {
              <i class="pi pi-file"></i>
              <span>No document loaded</span>
            }
          </div>

          <p-button
            [label]="dataService.documentReady() ? 'Reload Doc' : 'Load Document'"
            icon="pi pi-upload"
            (onClick)="loadDocument()"
            [loading]="dataService.loading()"
            size="small"
            severity="secondary">
          </p-button>

          <p-button
            label="Clear All"
            icon="pi pi-trash"
            (onClick)="clearAll()"
            size="small"
            severity="danger"
            [outlined]="true">
          </p-button>
        </div>
      </header>

      <!-- ===== MODULE TABS ===== -->
      <div class="playground-body">
        <p-tabs [value]="activeTab()" (valueChange)="onTabChange($event)" styleClass="module-tabs">
          <p-tablist>
            <p-tab value="raptor">
              <span class="tab-dot raptor-dot"></span>
              RAPTOR
            </p-tab>
            <p-tab value="graptor">
              <span class="tab-dot graptor-dot"></span>
              Graptor
            </p-tab>
            <p-tab value="memory">
              <span class="tab-dot memory-dot"></span>
              Memory / OM
            </p-tab>
            <p-tab value="rlm">
              <span class="tab-dot rlm-dot"></span>
              RLM Workspace
            </p-tab>
          </p-tablist>

          <p-tabpanels>
            <p-tabpanel value="raptor">
              <app-raptor-module></app-raptor-module>
            </p-tabpanel>
            <p-tabpanel value="graptor">
              <app-graptor-module></app-graptor-module>
            </p-tabpanel>
            <p-tabpanel value="memory">
              <app-memory-module></app-memory-module>
            </p-tabpanel>
            <p-tabpanel value="rlm">
              <app-rlm-module></app-rlm-module>
            </p-tabpanel>
          </p-tabpanels>
        </p-tabs>
      </div>

      <!-- ===== LOG PANEL ===== -->
      <div class="log-panel">
        <div class="log-header">
          <span class="log-title">
            <i class="pi pi-terminal"></i>
            Log
            <span class="log-badge">{{ logService.visible().length }}</span>
          </span>
          <div class="log-actions">
            <p-select
              [options]="filterOptions"
              [(ngModel)]="selectedFilter"
              (ngModelChange)="onFilterChange($event)"
              optionLabel="label"
              optionValue="value"
              [style]="{ height: '28px', fontSize: '0.75rem' }"
              styleClass="log-filter-select">
            </p-select>
            <p-button
              icon="pi pi-trash"
              (onClick)="clearLog()"
              size="small"
              severity="secondary"
              [text]="true"
              pTooltip="Clear log">
            </p-button>
          </div>
        </div>

        <div class="log-body" #logBody>
          @for (entry of logService.visible(); track entry.id) {
            <div class="log-line">
              <span class="log-ts">{{ entry.timestamp | date:'HH:mm:ss' }}</span>
              <span class="log-src" [class]="'src-' + entry.source">{{ entry.source }}</span>
              <span class="log-msg" [class]="'lvl-' + entry.level">{{ entry.message }}</span>
            </div>
          }
          @if (logService.visible().length === 0) {
            <div class="log-empty">No log entries yet.</div>
          }
        </div>
      </div>

    </div>
  `,
  styles: [`
    /* ======== Layout ======== */
    .playground-root {
      display: flex;
      flex-direction: column;
      height: 100vh;
      background: var(--surface-ground);
      overflow: hidden;
    }

    /* ======== Header ======== */
    .playground-header {
      display: flex;
      align-items: center;
      justify-content: space-between;
      padding: 0.75rem 1.5rem;
      background: var(--surface-card);
      border-bottom: 1px solid var(--surface-border);
      flex-shrink: 0;
      gap: 1rem;
      backdrop-filter: blur(10px);
    }

    .header-brand { display: flex; align-items: center; gap: 0.75rem; }
    .brand-icon {
      width: 42px; height: 42px; border-radius: 10px;
      background: linear-gradient(135deg, var(--primary-800), var(--primary-600));
      display: flex; align-items: center; justify-content: center;
      box-shadow: 0 0 20px color-mix(in srgb, var(--primary-500) 30%, transparent);
    }
    .brand-icon i { font-size: 1.2rem; color: white; }
    .brand-title { font-size: 1.1rem; font-weight: 700; color: var(--text-color); margin: 0; }
    .brand-sub { font-size: 0.7rem; color: var(--text-color-secondary); margin: 0; letter-spacing: 0.04em; }

    .header-controls { display: flex; align-items: center; gap: 0.75rem; flex-wrap: wrap; }

    .doc-status {
      display: flex; align-items: center; gap: 0.4rem;
      font-size: 0.8rem; color: var(--text-color-secondary);
      padding: 0.3rem 0.75rem; border-radius: 20px;
      background: var(--surface-ground); border: 1px solid var(--surface-border);
    }
    .doc-status.ready { color: var(--green-400); border-color: var(--green-800); }

    /* ======== Body ======== */
    .playground-body {
      flex: 1;
      overflow-y: auto;
      padding: 0 1.5rem;
    }

    /* module tab dots */
    .tab-dot {
      display: inline-block; width: 8px; height: 8px; border-radius: 50%; margin-right: 6px;
    }
    .raptor-dot  { background: #60a5fa; }
    .graptor-dot { background: #34d399; }
    .memory-dot  { background: #c084fc; }
    .rlm-dot     { background: #fb923c; }

    /* Shared stat pill (used in all modules via global) */
    :host ::ng-deep .module-stats .stat-pill {
      background: var(--surface-card) !important;
    }

    /* ======== Log Panel ======== */
    .log-panel {
      flex-shrink: 0;
      height: 180px;
      border-top: 1px solid var(--surface-border);
      display: flex; flex-direction: column;
      background: var(--surface-card);
    }
    .log-header {
      display: flex; align-items: center; justify-content: space-between;
      padding: 0.35rem 1rem; border-bottom: 1px solid var(--surface-border); flex-shrink: 0;
    }
    .log-title {
      display: flex; align-items: center; gap: 0.5rem;
      font-size: 0.78rem; font-weight: 600; color: var(--text-color-secondary);
      text-transform: uppercase; letter-spacing: 0.06em;
    }
    .log-badge {
      background: var(--surface-border); color: var(--text-color-secondary);
      border-radius: 10px; padding: 0 0.4rem; font-size: 0.7rem; font-weight: 700;
    }
    .log-actions { display: flex; align-items: center; gap: 0.25rem; }
    .log-body {
      flex: 1; overflow-y: auto; padding: 0.25rem 0.75rem;
      font-family: 'JetBrains Mono', 'Fira Code', monospace;
      font-size: 0.74rem; line-height: 1.6;
    }
    .log-line { display: flex; gap: 0.6rem; align-items: baseline; }
    .log-ts { color: var(--surface-400); white-space: nowrap; flex-shrink: 0; }
    .log-src {
      font-size: 0.68rem; font-weight: 700; letter-spacing: 0.04em;
      text-transform: uppercase; white-space: nowrap; flex-shrink: 0; min-width: 52px;
    }
    .src-raptor  { color: #60a5fa; }
    .src-graptor { color: #34d399; }
    .src-memory  { color: #c084fc; }
    .src-rlm     { color: #fb923c; }
    .src-system  { color: #94a3b8; }
    .log-msg { flex: 1; }
    .lvl-info    { color: var(--text-color); }
    .lvl-success { color: var(--green-400); }
    .lvl-warn    { color: var(--yellow-400); }
    .lvl-error   { color: var(--red-400); }
    .log-empty   { color: var(--surface-400); font-size: 0.75rem; padding: 0.5rem; }

    :host ::ng-deep .log-filter-select .p-select-label { padding: 2px 6px !important; }
  `],
})
export class PlaygroundPageComponent implements OnInit {
  protected readonly logService = inject(PlaygroundLogService);
  protected readonly dataService = inject(PlaygroundDataService);

  readonly activeTab = signal<string>('raptor');
  readonly filterOptions = FILTER_OPTIONS;
  selectedFilter: LogSource | null = null;

  ngOnInit(): void {
    this.logService.info('system', 'Research Playground ready 🚀');
  }

  async loadDocument(): Promise<void> {
    await this.dataService.loadDocument(DOC_URL);
  }

  clearAll(): void {
    this.dataService.clear();
    this.logService.clear();
    this.logService.info('system', 'All data cleared');
  }

  clearLog(): void {
    this.logService.clear(this.selectedFilter ?? undefined);
  }

  onTabChange(value: string | number | undefined): void {
    if (typeof value === 'string') this.activeTab.set(value);
  }

  onFilterChange(value: LogSource | null): void {
    this.logService.filter.set(value);
  }
}
