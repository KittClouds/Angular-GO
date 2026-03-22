// src/app/components/memory-module/memory-module.component.ts
// Memory/OM eval module - observer context only.

import { Component, OnInit, signal, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Button } from 'primeng/button';
import { CardModule } from 'primeng/card';
import { InputTextModule } from 'primeng/inputtext';
import { Divider } from 'primeng/divider';
import { GoKittService } from '../../services/gokitt.service';
import { PlaygroundLogService } from '../../services/playground-log.service';

interface OMSnapshot {
    threadId: string;
    observations: string;
}

@Component({
    selector: 'app-memory-module',
    standalone: true,
    imports: [
        CommonModule,
        FormsModule,
        Button,
        CardModule,
        InputTextModule,
        Divider,
    ],
    template: `
    <div class="module-memory">
      <div class="module-stats">
        <div class="stat-pill">
          <span class="stat-value text-purple-400">{{ snapshot()?.observations?.length ?? 0 }}</span>
          <span class="stat-label">Obs Chars</span>
        </div>
      </div>

      <div class="setup-row">
        <div class="field-group">
          <label class="field-label" for="mem-thread-id">Thread ID</label>
          <input id="mem-thread-id" pInputText [(ngModel)]="threadId" placeholder="eval-thread-01" class="field-input">
        </div>
      </div>

      <div class="module-controls">
        <p-button
          label="Get Context"
          icon="pi pi-eye"
          (onClick)="getContext()"
          [loading]="loadingCtx()"
          [disabled]="!threadId.trim() || !wasmReady()"
          severity="secondary"
          size="small">
        </p-button>
        <p-button
          label="Clear"
          icon="pi pi-trash"
          (onClick)="clearAll()"
          severity="danger"
          size="small">
        </p-button>
      </div>

      <p-divider></p-divider>

      <div class="om-panel">
        <h4 class="section-heading">Observations</h4>
        <div class="om-text">{{ snapshot()?.observations || 'No observations yet.' }}</div>
      </div>

      @if (!wasmReady()) {
        <div class="not-ready-banner">
          <i class="pi pi-info-circle"></i>
          GoKitt WASM not ready - start the main app first.
        </div>
      }
    </div>
  `,
    styles: [`
    .module-memory { padding: 1rem 0; }
    .module-stats { display: flex; gap: 1rem; margin-bottom: 1.25rem; flex-wrap: wrap; }
    .stat-pill {
      display: flex; flex-direction: column; align-items: center;
      background: var(--surface-card); border: 1px solid var(--surface-border);
      border-radius: 0.75rem; padding: 0.6rem 1.2rem; min-width: 80px;
    }
    .stat-value { font-size: 1.5rem; font-weight: 700; line-height: 1.2; }
    .stat-label { font-size: 0.7rem; color: var(--text-color-secondary); text-transform: uppercase; letter-spacing: 0.05em; margin-top: 2px; }
    .setup-row { display: flex; gap: 1rem; margin-bottom: 1rem; flex-wrap: wrap; }
    .field-group { display: flex; flex-direction: column; gap: 0.3rem; flex: 1; min-width: 200px; }
    .field-label { font-size: 0.75rem; color: var(--text-color-secondary); font-weight: 500; }
    .field-input { width: 100%; }
    .module-controls { display: flex; gap: 0.5rem; flex-wrap: wrap; margin-top: 0.75rem; }
    .section-heading { font-size: 0.75rem; font-weight: 600; color: var(--text-color-secondary); text-transform: uppercase; letter-spacing: 0.05em; margin-bottom: 0.5rem; }
    .om-panel { background: var(--surface-ground); border-radius: 0.5rem; padding: 0.75rem; }
    .om-text { font-size: 0.82rem; line-height: 1.6; color: var(--text-color); white-space: pre-wrap; max-height: 320px; overflow-y: auto; }
    .not-ready-banner {
      margin-top: 1rem; padding: 0.75rem 1rem; border-radius: 0.5rem;
      background: color-mix(in srgb, var(--orange-500) 15%, transparent);
      border: 1px solid var(--orange-500); color: var(--orange-300);
      font-size: 0.85rem; display: flex; gap: 0.5rem; align-items: center;
    }
  `],
})
export class MemoryModuleComponent implements OnInit {
    protected readonly goKitt = inject(GoKittService);
    private readonly logService = inject(PlaygroundLogService);

    readonly wasmReady = signal(this.goKitt.isReady);
    readonly loadingCtx = signal(false);
    readonly snapshot = signal<OMSnapshot | null>(null);

    threadId = 'eval-thread-01';

    private log = (level: 'info' | 'warn' | 'error' | 'success', msg: string) =>
        this.logService.log(level, 'memory', msg);

    constructor() {
        setTimeout(() => {
            this.wasmReady.set(this.goKitt.isReady);
            if (!this.goKitt.isReady) {
                this.goKitt.onReady(() => this.wasmReady.set(true));
            }
        });
    }

    ngOnInit(): void {
        this.logService.info('memory', 'Memory/OM module ready');
    }

    async getContext(): Promise<void> {
        this.loadingCtx.set(true);
        try {
            const ctx = await this.goKitt.chatGetContext(this.threadId);
            this.log('info', `Context loaded (${ctx.length} chars)`);
            this.snapshot.set({
                threadId: this.threadId,
                observations: ctx,
            });
        } catch (err) {
            this.log('error', `Get context failed: ${err}`);
        } finally {
            this.loadingCtx.set(false);
        }
    }

    clearAll(): void {
        this.snapshot.set(null);
        this.log('info', 'Memory eval cleared');
    }
}
