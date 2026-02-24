// src/app/components/memory-module/memory-module.component.ts
// Memory/OM eval module — Observer pipeline + Workspace tool sandbox.

import { Component, OnInit, signal, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Button } from 'primeng/button';
import { CardModule } from 'primeng/card';
import { Tag } from 'primeng/tag';
import { InputTextModule } from 'primeng/inputtext';
import { TextareaModule } from 'primeng/textarea';
import { Divider } from 'primeng/divider';
import { TimelineModule } from 'primeng/timeline';
import { ProgressBarModule } from 'primeng/progressbar';
import { GoKittService } from '../../services/gokitt.service';
import { PlaygroundLogService } from '../../services/playground-log.service';

interface OMSnapshot {
    threadId: string;
    observations: string;
    reflections: string;
    tokenCount: number;
    messageCount: number;
}

interface ToolEvent {
    icon: string;
    color: string;
    tool: string;
    ok: boolean;
    latMs: number;
    preview: string;
}

@Component({
    selector: 'app-memory-module',
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
        TimelineModule,
        ProgressBarModule,
    ],
    template: `
    <div class="module-memory">

      <!-- Stats -->
      <div class="module-stats">
        <div class="stat-pill">
          <span class="stat-value text-purple-400">{{ snapshot()?.observations?.length ?? 0 }}</span>
          <span class="stat-label">Obs Chars</span>
        </div>
        <div class="stat-pill">
          <span class="stat-value text-pink-400">{{ snapshot()?.reflections?.length ?? 0 }}</span>
          <span class="stat-label">Ref Chars</span>
        </div>
        <div class="stat-pill">
          <span class="stat-value text-orange-400">{{ toolEvents().length }}</span>
          <span class="stat-label">Tool Calls</span>
        </div>
        <div class="stat-pill">
          <span class="stat-value text-rose-400">{{ missScore() | number:'1.2' }}</span>
          <span class="stat-label">Miss Score</span>
        </div>
      </div>

      <!-- Thread Setup -->
      <div class="setup-row">
        <div class="field-group">
          <label class="field-label" for="mem-thread-id">Thread ID</label>
          <input id="mem-thread-id" pInputText [(ngModel)]="threadId" placeholder="eval-thread-01" class="field-input">
        </div>
        <div class="field-group">
          <label class="field-label" for="mem-scope-id">Scope ID</label>
          <input id="mem-scope-id" pInputText [(ngModel)]="scopeId" placeholder="world-1" class="field-input">
        </div>
      </div>

      <!-- Message Input -->
      <div class="field-group">
        <label class="field-label" for="mem-prompt">User Prompt (triggers workspace miss-signal check)</label>
        <textarea id="mem-prompt" pTextarea [(ngModel)]="promptText" rows="3"
                  placeholder="Ask about something the agent may have forgotten…"
                  class="w-full"></textarea>
      </div>

      <!-- Controls -->
      <div class="module-controls">
        <p-button
          label="Process + Workspace"
          icon="pi pi-bolt"
          (onClick)="runProcessWithWorkspace()"
          [loading]="processing()"
          [disabled]="!threadId.trim() || !promptText.trim() || !goKitt.isReady"
          size="small">
        </p-button>
        <p-button
          label="Get Context"
          icon="pi pi-eye"
          (onClick)="getContext()"
          [loading]="loadingCtx()"
          [disabled]="!threadId.trim() || !goKitt.isReady"
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

      <!-- Side-by-side OM view -->
      <div class="om-view">
        <div class="om-panel">
          <h4 class="section-heading">Observations</h4>
          <div class="om-text">{{ snapshot()?.observations || 'No observations yet.' }}</div>
        </div>
        <div class="om-panel">
          <h4 class="section-heading">Reflections</h4>
          <div class="om-text">{{ snapshot()?.reflections || 'No reflections yet.' }}</div>
        </div>
      </div>

      <!-- Tool call timeline -->
      @if (toolEvents().length > 0) {
        <p-divider></p-divider>
        <h4 class="section-heading">Workspace Tool Timeline</h4>
        <p-timeline [value]="toolEvents()" styleClass="tool-timeline">
          <ng-template pTemplate="marker" let-event>
            <div class="tool-marker" [style.background]="event.color">
              <i [class]="'pi ' + event.icon"></i>
            </div>
          </ng-template>
          <ng-template pTemplate="content" let-event>
            <div class="tool-event">
              <div class="tool-event-header">
                <p-tag [value]="event.tool" [severity]="event.ok ? 'success' : 'danger'" styleClass="text-xs"></p-tag>
                <span class="tool-latency">{{ event.latMs }}ms</span>
              </div>
              <div class="tool-preview">{{ event.preview }}</div>
            </div>
          </ng-template>
        </p-timeline>
      }

      @if (!goKitt.isReady) {
        <div class="not-ready-banner">
          <i class="pi pi-info-circle"></i>
          GoKitt WASM not ready — start the main app first.
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
    .om-view { display: grid; grid-template-columns: 1fr 1fr; gap: 1rem; margin-top: 0.5rem; }
    .om-panel { background: var(--surface-ground); border-radius: 0.5rem; padding: 0.75rem; }
    .om-text { font-size: 0.82rem; line-height: 1.6; color: var(--text-color); white-space: pre-wrap; max-height: 200px; overflow-y: auto; }
    .tool-marker { width: 28px; height: 28px; border-radius: 50%; display: flex; align-items: center; justify-content: center; }
    .tool-marker i { font-size: 0.75rem; color: white; }
    .tool-event { padding: 0.25rem 0 0.5rem; }
    .tool-event-header { display: flex; align-items: center; gap: 0.5rem; margin-bottom: 0.25rem; }
    .tool-latency { font-size: 0.75rem; color: var(--text-color-secondary); font-family: monospace; }
    .tool-preview { font-size: 0.78rem; color: var(--text-color-secondary); padding-left: 0.25rem; }
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

    readonly processing = signal(false);
    readonly loadingCtx = signal(false);
    readonly snapshot = signal<OMSnapshot | null>(null);
    readonly toolEvents = signal<ToolEvent[]>([]);
    readonly missScore = signal(0);

    threadId = 'eval-thread-01';
    scopeId = 'world-1';
    promptText = '';

    private log = (level: 'info' | 'warn' | 'error' | 'success', msg: string) =>
        this.logService.log(level, 'memory', msg);

    ngOnInit(): void {
        this.logService.info('memory', 'Memory/OM module ready');
    }

    async runProcessWithWorkspace(): Promise<void> {
        this.processing.set(true);
        this.toolEvents.set([]);
        this.log('info', `Processing thread "${this.threadId}" with workspace…`);

        try {
            const raw = await this.goKitt.chatProcessWithWorkspace(
                this.threadId, this.scopeId, this.promptText
            );
            const result = JSON.parse(raw);

            if (result.triggered) {
                this.log('success', `Workspace activated — ${result.miss_reason}`);
                const events: ToolEvent[] = (result.tool_calls ?? []).map((tc: any) => ({
                    icon: this.toolIcon(tc.tool),
                    color: tc.ok ? '#10b981' : '#ef4444',
                    tool: tc.tool,
                    ok: tc.ok,
                    latMs: tc.lat_ms,
                    preview: tc.error ?? JSON.stringify(tc.data).slice(0, 120),
                }));
                this.toolEvents.set(events);

                if (result.new_observation) {
                    this.snapshot.update(s => s
                        ? { ...s, observations: result.new_observation }
                        : { threadId: this.threadId, observations: result.new_observation, reflections: '', tokenCount: 0, messageCount: 0 }
                    );
                }
            } else {
                this.log('info', 'Workspace did not activate (no miss signal)');
            }

            // Refresh context view
            await this.getContext();
        } catch (err) {
            this.log('error', `Process failed: ${err}`);
        } finally {
            this.processing.set(false);
        }
    }

    async getContext(): Promise<void> {
        this.loadingCtx.set(true);
        try {
            const ctx = await this.goKitt.chatGetContext(this.threadId);
            this.log('info', `Context loaded (${ctx.length} chars)`);
            this.snapshot.update(s => s
                ? { ...s, observations: ctx }
                : { threadId: this.threadId, observations: ctx, reflections: '', tokenCount: 0, messageCount: 0 }
            );
        } catch (err) {
            this.log('error', `Get context failed: ${err}`);
        } finally {
            this.loadingCtx.set(false);
        }
    }

    clearAll(): void {
        this.snapshot.set(null);
        this.toolEvents.set([]);
        this.missScore.set(0);
        this.promptText = '';
        this.log('info', 'Memory eval cleared');
    }

    private toolIcon(tool: string): string {
        const icons: Record<string, string> = {
            search_notes: 'pi-search',
            search_blocks_gdr: 'pi-database',
            fetch_episodes: 'pi-list',
            get_artifact: 'pi-file',
            put_artifact: 'pi-save',
        };
        return icons[tool] ?? 'pi-cog';
    }
}
