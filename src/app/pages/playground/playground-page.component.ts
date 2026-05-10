// src/app/pages/playground/playground-page.component.ts
// Research Playground - native-safe experimental tools shell.

import { Component, OnInit, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { Button } from 'primeng/button';

import { PlaygroundLogService, LogSource } from '../../services/playground-log.service';
import { PlaygroundDataService } from '../../services/playground-data.service';
import { NumerologyModuleComponent } from '../../components/numerology-module/numerology-module.component';

const DOC_URL = '/docs/shortrun.md';

@Component({
  selector: 'app-playground-page',
  standalone: true,
  imports: [CommonModule, Button, NumerologyModuleComponent],
  template: `
    <div class="playground-root">
      <header class="playground-header">
        <div class="header-brand">
          <div class="brand-icon">
            <i class="pi pi-microchip-ai"></i>
          </div>
          <div>
            <h1 class="brand-title">Research Playground</h1>
            <p class="brand-sub">Phoenix native lab · Numerology</p>
          </div>
        </div>

        <div class="header-controls">
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
            label="Clear"
            icon="pi pi-trash"
            (onClick)="clearAll()"
            size="small"
            severity="danger"
            [outlined]="true">
          </p-button>
        </div>
      </header>

      <main class="playground-body">
        <section class="module-card">
          <div class="module-header">
            <span class="tab-dot numerology-dot"></span>
            <div>
              <h2>Numerology</h2>
              <p>Frontend tool for annotating text files. Rust numerology remains available in the native workspace but is not wired to Tauri yet.</p>
            </div>
          </div>
          <app-numerology-module></app-numerology-module>
        </section>
      </main>

      <section class="log-panel">
        <div class="log-header">
          <span class="log-title">
            <i class="pi pi-terminal"></i>
            Log
            <span class="log-badge">{{ logService.visible().length }}</span>
          </span>
          <div class="log-actions">
            <button type="button" class="filter-chip" [class.active]="selectedFilter === null" (click)="onFilterChange(null)">All</button>
            <button type="button" class="filter-chip" [class.active]="selectedFilter === 'numerology'" (click)="onFilterChange('numerology')">Numerology</button>
            <button type="button" class="filter-chip" [class.active]="selectedFilter === 'system'" (click)="onFilterChange('system')">System</button>
            <p-button icon="pi pi-trash" (onClick)="clearLog()" size="small" severity="secondary" [text]="true"></p-button>
          </div>
        </div>

        <div class="log-body">
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
      </section>
    </div>
  `,
  styles: [`
    .playground-root {
      display: flex;
      flex-direction: column;
      height: 100vh;
      background: var(--surface-ground);
      overflow: hidden;
    }

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

    .playground-body {
      flex: 1;
      overflow-y: auto;
      padding: 1.5rem;
    }

    .module-card {
      border: 1px solid var(--surface-border);
      border-radius: 14px;
      background: var(--surface-card);
      padding: 1rem 1.25rem 1.25rem;
      box-shadow: 0 18px 50px rgba(0, 0, 0, 0.18);
    }

    .module-header {
      display: flex;
      align-items: flex-start;
      gap: 0.75rem;
      border-bottom: 1px solid var(--surface-border);
      padding-bottom: 0.85rem;
      margin-bottom: 0.25rem;
    }
    .module-header h2 { margin: 0; font-size: 1rem; color: var(--text-color); }
    .module-header p { margin: 0.2rem 0 0; font-size: 0.78rem; color: var(--text-color-secondary); }

    .tab-dot {
      display: inline-block; width: 10px; height: 10px; border-radius: 50%; margin-top: 0.35rem;
    }
    .numerology-dot { background: #22d3ee; box-shadow: 0 0 16px rgba(34, 211, 238, 0.45); }

    :host ::ng-deep .module-stats .stat-pill { background: var(--surface-ground) !important; }

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
      gap: 1rem;
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
    .filter-chip {
      border: 1px solid var(--surface-border);
      border-radius: 999px;
      background: transparent;
      color: var(--text-color-secondary);
      cursor: pointer;
      font-size: 0.7rem;
      padding: 0.2rem 0.55rem;
    }
    .filter-chip.active { border-color: #22d3ee; color: #22d3ee; background: rgba(34, 211, 238, 0.08); }
    .log-body {
      flex: 1; overflow-y: auto; padding: 0.25rem 0.75rem;
      font-family: 'JetBrains Mono', 'Fira Code', monospace;
      font-size: 0.74rem; line-height: 1.6;
    }
    .log-line { display: flex; gap: 0.6rem; align-items: baseline; }
    .log-ts { color: var(--surface-400); white-space: nowrap; flex-shrink: 0; }
    .log-src {
      font-size: 0.68rem; font-weight: 700; letter-spacing: 0.04em;
      text-transform: uppercase; white-space: nowrap; flex-shrink: 0; min-width: 70px;
    }
    .src-numerology { color: #22d3ee; }
    .src-system { color: #94a3b8; }
    .log-msg { flex: 1; }
    .lvl-info { color: var(--text-color); }
    .lvl-success { color: var(--green-400); }
    .lvl-warn { color: var(--yellow-400); }
    .lvl-error { color: var(--red-400); }
    .log-empty { color: var(--surface-400); font-size: 0.75rem; padding: 0.5rem; }
  `],
})
export class PlaygroundPageComponent implements OnInit {
  protected readonly logService = inject(PlaygroundLogService);
  protected readonly dataService = inject(PlaygroundDataService);

  selectedFilter: LogSource | null = null;

  ngOnInit(): void {
    this.logService.info('system', 'Research Playground ready');
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

  onFilterChange(value: LogSource | null): void {
    this.selectedFilter = value;
    this.logService.filter.set(value);
  }
}
