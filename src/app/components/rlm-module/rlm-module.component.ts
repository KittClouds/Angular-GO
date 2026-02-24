// src/app/components/rlm-module/rlm-module.component.ts
// RLM Workspace eval module — miss-signal scoring + tool sandbox evaluation.

import { Component, OnInit, signal, computed, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Button } from 'primeng/button';
import { CardModule } from 'primeng/card';
import { Tag } from 'primeng/tag';
import { InputTextModule } from 'primeng/inputtext';
import { TextareaModule } from 'primeng/textarea';
import { Divider } from 'primeng/divider';
import { ChartModule } from 'primeng/chart';
import { ProgressBarModule } from 'primeng/progressbar';
import { RlmOrchestratorService, ActivationResult, ToolCallResult } from '../../lib/rlm/services/rlm-orchestrator.service';
import { PlaygroundLogService } from '../../services/playground-log.service';

interface ActivationRun {
    id: number;
    prompt: string;
    triggered: boolean;
    missReason?: string;
    toolCount: number;
    latencyMs: number;
    timestamp: Date;
}

@Component({
    selector: 'app-rlm-module',
    standalone: true,
    imports: [
        CommonModule,
        FormsModule,
        Button,
        CardModule,
        Tag,
        InputTextModule,
        TextareaModule,
        Divider,
        ChartModule,
        ProgressBarModule,
    ],
    template: `
    <div class="module-rlm">

      <!-- Stats -->
      <div class="module-stats">
        <div class="stat-pill">
          <span class="stat-value text-orange-400">{{ activationRuns().length }}</span>
          <span class="stat-label">Total Runs</span>
        </div>
        <div class="stat-pill">
          <span class="stat-value text-red-400">{{ triggerCount() }}</span>
          <span class="stat-label">Activations</span>
        </div>
        <div class="stat-pill">
          <span class="stat-value text-yellow-400">{{ hitRate() | percent:'1.0' }}</span>
          <span class="stat-label">Hit Rate</span>
        </div>
        <div class="stat-pill">
          <span class="stat-value text-amber-400">{{ avgLatency() | number:'1.0' }}ms</span>
          <span class="stat-label">Avg Latency</span>
        </div>
      </div>

      <!-- Prompt Input -->
      <div class="setup-row">
        <div class="field-group">
          <label class="field-label" for="rlm-thread">Thread ID</label>
          <input id="rlm-thread" pInputText [(ngModel)]="threadId" placeholder="eval-thread-01" class="field-input">
        </div>
        <div class="field-group">
          <label class="field-label" for="rlm-scope">Scope ID</label>
          <input id="rlm-scope" pInputText [(ngModel)]="scopeId" placeholder="world-1" class="field-input">
        </div>
      </div>

      <div class="field-group">
        <label class="field-label" for="rlm-prompt">User Prompt</label>
        <textarea id="rlm-prompt" pTextarea [(ngModel)]="promptText" rows="3"
                  placeholder="Enter a prompt to test miss-signal detection…"
                  class="w-full"></textarea>
      </div>

      <!-- Controls -->
      <div class="module-controls">
        <p-button
          label="Run Workspace"
          icon="pi pi-bolt"
          (onClick)="runWorkspace()"
          [loading]="rlmOrchestrator.isActivating()"
          [disabled]="!threadId.trim() || !promptText.trim()"
          size="small">
        </p-button>
        <p-button
          label="Batch (5x)"
          icon="pi pi-forward"
          (onClick)="runBatch()"
          [loading]="batching()"
          [disabled]="!threadId.trim() || !promptText.trim()"
          severity="secondary"
          size="small">
        </p-button>
        <p-button
          label="Clear History"
          icon="pi pi-trash"
          (onClick)="clearHistory()"
          severity="danger"
          size="small">
        </p-button>
      </div>

      <!-- Latest result -->
      @if (lastResult()) {
        <p-divider></p-divider>

        <div class="result-card" [class.triggered]="lastResult()!.triggered">
          <div class="result-header">
            <p-tag
              [value]="lastResult()!.triggered ? 'WORKSPACE ACTIVATED' : 'NO MISS'"
              [severity]="lastResult()!.triggered ? 'danger' : 'success'"
              styleClass="text-sm">
            </p-tag>
            @if (lastResult()!.miss_reason) {
              <span class="miss-reason">{{ lastResult()!.miss_reason }}</span>
            }
          </div>

          @if (lastResult()!.tool_calls?.length) {
            <div class="tool-calls-grid">
              @for (tc of lastResult()!.tool_calls; track tc.tool) {
                <div class="tool-call-chip" [class.ok]="tc.ok" [class.err]="!tc.ok">
                  <i [class]="'pi ' + toolIcon(tc.tool) + ' tool-icon'"></i>
                  <span class="tool-name">{{ tc.tool }}</span>
                  <span class="tool-lat">{{ tc.lat_ms }}ms</span>
                  <p-tag [value]="tc.ok ? 'ok' : 'err'" [severity]="tc.ok ? 'success' : 'danger'" styleClass="text-xs ml-auto"></p-tag>
                </div>
              }
            </div>
          }

          @if (lastResult()!.summary) {
            <div class="result-summary">
              <span class="section-heading">Summary</span>
              <p>{{ lastResult()!.summary }}</p>
            </div>
          }
        </div>
      }

      <!-- Run history -->
      @if (activationRuns().length > 0) {
        <p-divider></p-divider>
        <h4 class="section-heading">Run History</h4>
        <div class="run-history">
          @for (run of activationRuns().slice().reverse(); track run.id) {
            <div class="run-row">
              <p-tag
                [value]="run.triggered ? '⚡ FIRED' : '○ PASS'"
                [severity]="run.triggered ? 'danger' : 'secondary'"
                styleClass="text-xs w-20 text-center">
              </p-tag>
              <span class="run-prompt">{{ run.prompt | slice:0:60 }}{{ run.prompt.length > 60 ? '…' : '' }}</span>
              <span class="run-tools text-surface-400">{{ run.toolCount }} tools</span>
              <span class="run-lat font-mono text-xs text-surface-400">{{ run.latencyMs | number:'1.0' }}ms</span>
            </div>
          }
        </div>
      }
    </div>
  `,
    styles: [`
    .module-rlm { padding: 1rem 0; }
    .module-stats { display: flex; gap: 1rem; margin-bottom: 1.25rem; flex-wrap: wrap; }
    .stat-pill {
      display: flex; flex-direction: column; align-items: center;
      background: var(--surface-card); border: 1px solid var(--surface-border);
      border-radius: 0.75rem; padding: 0.6rem 1.2rem; min-width: 80px;
    }
    .stat-value { font-size: 1.5rem; font-weight: 700; line-height: 1.2; }
    .stat-label { font-size: 0.7rem; color: var(--text-color-secondary); text-transform: uppercase; letter-spacing: 0.05em; margin-top: 2px; }
    .setup-row { display: flex; gap: 1rem; margin-bottom: 1rem; flex-wrap: wrap; }
    .field-group { display: flex; flex-direction: column; gap: 0.3rem; flex: 1; min-width: 200px; margin-bottom: 0.75rem; }
    .field-label { font-size: 0.75rem; color: var(--text-color-secondary); font-weight: 500; }
    .field-input { width: 100%; }
    .module-controls { display: flex; gap: 0.5rem; flex-wrap: wrap; }
    .result-card {
      margin-top: 0.75rem; padding: 1rem; border-radius: 0.75rem;
      background: var(--surface-ground); border: 1px solid var(--surface-border);
      transition: border-color 0.3s;
    }
    .result-card.triggered { border-color: var(--red-500); }
    .result-header { display: flex; align-items: center; gap: 0.75rem; margin-bottom: 0.75rem; }
    .miss-reason { font-size: 0.8rem; color: var(--text-color-secondary); font-family: monospace; }
    .tool-calls-grid { display: flex; flex-direction: column; gap: 0.4rem; margin-bottom: 0.75rem; }
    .tool-call-chip {
      display: flex; align-items: center; gap: 0.5rem; padding: 0.4rem 0.75rem;
      border-radius: 0.5rem; font-size: 0.82rem;
      background: var(--surface-card); border: 1px solid var(--surface-border);
    }
    .tool-call-chip.ok { border-color: var(--green-800); }
    .tool-call-chip.err { border-color: var(--red-800); }
    .tool-icon { font-size: 0.85rem; color: var(--primary-400); }
    .tool-name { font-weight: 600; }
    .tool-lat { font-family: monospace; font-size: 0.75rem; color: var(--text-color-secondary); }
    .result-summary { margin-top: 0.5rem; }
    .result-summary p { font-size: 0.85rem; color: var(--text-color); margin: 0.25rem 0 0; }
    .section-heading { font-size: 0.75rem; font-weight: 600; color: var(--text-color-secondary); text-transform: uppercase; letter-spacing: 0.05em; margin-bottom: 0.5rem; display: block; }
    .run-history { display: flex; flex-direction: column; gap: 0.35rem; }
    .run-row {
      display: flex; align-items: center; gap: 0.75rem; padding: 0.35rem 0.5rem;
      border-radius: 0.375rem;
    }
    .run-row:hover { background: var(--surface-hover); }
    .run-prompt { flex: 1; font-size: 0.82rem; color: var(--text-color); }
    .run-tools { font-size: 0.75rem; white-space: nowrap; }
    .run-lat { font-size: 0.75rem; white-space: nowrap; }
  `],
})
export class RlmModuleComponent implements OnInit {
    protected readonly rlmOrchestrator = inject(RlmOrchestratorService);
    private readonly logService = inject(PlaygroundLogService);

    readonly batching = signal(false);
    readonly activationRuns = signal<ActivationRun[]>([]);
    readonly lastResult = signal<ActivationResult | null>(null);

    private runIdSeq = 0;

    threadId = 'eval-thread-01';
    scopeId = 'world-1';
    promptText = '';

    readonly triggerCount = computed(() => this.activationRuns().filter(r => r.triggered).length);
    readonly hitRate = computed(() => {
        const runs = this.activationRuns();
        return runs.length ? this.triggerCount() / runs.length : 0;
    });
    readonly avgLatency = computed(() => {
        const runs = this.activationRuns();
        return runs.length ? runs.reduce((s, r) => s + r.latencyMs, 0) / runs.length : 0;
    });

    private log = (level: 'info' | 'warn' | 'error' | 'success', msg: string) =>
        this.logService.log(level, 'rlm', msg);

    ngOnInit(): void {
        this.logService.info('rlm', 'RLM module ready');
    }

    async runWorkspace(): Promise<void> {
        const prompt = this.promptText;
        this.log('info', `Running workspace for: "${prompt.slice(0, 60)}…"`);
        const t0 = Date.now();

        try {
            const result = await this.rlmOrchestrator.processWithWorkspace(
                this.threadId, this.scopeId, prompt
            );
            const latencyMs = Date.now() - t0;
            this.lastResult.set(result);

            const run: ActivationRun = {
                id: ++this.runIdSeq,
                prompt,
                triggered: result.triggered,
                missReason: result.miss_reason,
                toolCount: result.tool_calls?.length ?? 0,
                latencyMs,
                timestamp: new Date(),
            };
            this.activationRuns.update(runs => [...runs, run]);

            if (result.triggered) {
                this.log('success', `Workspace fired! ${run.toolCount} tool(s) in ${latencyMs}ms`);
            } else {
                this.log('info', `No miss detected (${latencyMs}ms)`);
            }
        } catch (err) {
            this.log('error', `Workspace run failed: ${err}`);
        }
    }

    async runBatch(): Promise<void> {
        this.batching.set(true);
        this.log('info', 'Running 5 workspace iterations…');
        for (let i = 0; i < 5; i++) {
            await this.runWorkspace();
        }
        this.log('success', `Batch complete — hit rate: ${(this.hitRate() * 100).toFixed(0)}%`);
        this.batching.set(false);
    }

    clearHistory(): void {
        this.activationRuns.set([]);
        this.lastResult.set(null);
        this.log('info', 'Run history cleared');
    }

    toolIcon(tool: string): string {
        const m: Record<string, string> = {
            search_notes: 'pi-search',
            search_blocks_gdr: 'pi-database',
            fetch_episodes: 'pi-list',
            get_artifact: 'pi-file',
            put_artifact: 'pi-save',
        };
        return m[tool] ?? 'pi-cog';
    }
}
