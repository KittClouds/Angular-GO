
import { Component, computed, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ButtonModule } from 'primeng/button';
import { TagModule } from 'primeng/tag';
import { DialogModule } from 'primeng/dialog';
import { InputTextModule } from 'primeng/inputtext';
import { TextareaModule } from 'primeng/textarea';
import { TooltipModule } from 'primeng/tooltip';

import { ScopeService, ActiveScope } from '../../../../../lib/services/scope.service';
import { WorldBuildingService, LoreThread, ThreadStatus } from '../../../../../lib/services/world-building.service';
import { toSignal, toObservable } from '@angular/core/rxjs-interop';
import { db } from '../../../../../lib/dexie/db';
import { switchMap, of, from } from 'rxjs';

@Component({
  selector: 'app-mystery',
  standalone: true,
  imports: [
    CommonModule,
    FormsModule,
    ButtonModule,
    TagModule,
    DialogModule,
    InputTextModule,
    TextareaModule,
    TooltipModule
  ],
  template: `
    <div class="flex flex-col h-full bg-zinc-50 dark:bg-zinc-950 text-zinc-800 dark:text-zinc-300 font-sans">
      
      <!-- HEADER -->
      <div class="p-4 border-b border-zinc-200 dark:border-zinc-800 flex items-center justify-between shrink-0 bg-white dark:bg-zinc-900">
        <div class="flex items-center gap-3">
          <div class="w-10 h-10 rounded-xl bg-gradient-to-br from-violet-500 to-purple-600 flex items-center justify-center shadow-lg shadow-violet-500/20">
            <i class="pi pi-question-circle text-white text-lg"></i>
          </div>
          <div>
            <h2 class="text-lg font-bold text-zinc-800 dark:text-zinc-100">Lore Threads</h2>
            <p class="text-xs text-zinc-500">Unanswered questions in your world</p>
          </div>
        </div>

        <button (click)="createThread()" [disabled]="!isValidNarrative()" 
                class="flex items-center gap-2 px-4 py-2.5 bg-gradient-to-r from-violet-500 to-purple-600 text-white rounded-xl hover:opacity-90 disabled:opacity-50 transition-all font-semibold text-sm shadow-lg shadow-violet-500/20 hover:shadow-violet-500/30">
            <i class="pi pi-plus"></i> New Thread
        </button>
      </div>

      <!-- STATUS FILTER PILLS -->
      <div class="px-4 py-3 flex items-center gap-2 border-b border-zinc-200 dark:border-zinc-800 bg-zinc-50/50 dark:bg-zinc-900/50">
        <button (click)="filterStatus.set(null)"
                class="px-3 py-1.5 rounded-full text-xs font-semibold transition-all"
                [ngClass]="filterStatus() === null ? 'bg-zinc-800 dark:bg-zinc-200 text-white dark:text-zinc-900' : 'bg-zinc-200 dark:bg-zinc-800 text-zinc-600 dark:text-zinc-400 hover:bg-zinc-300 dark:hover:bg-zinc-700'">
          All <span class="ml-1 opacity-70">{{ threads().length }}</span>
        </button>
        <button *ngFor="let s of statuses" (click)="filterStatus.set(s.value)"
                class="px-3 py-1.5 rounded-full text-xs font-semibold transition-all flex items-center gap-1.5"
                [ngClass]="filterStatus() === s.value ? 'text-white ' + s.bgActive : 'bg-zinc-200 dark:bg-zinc-800 text-zinc-600 dark:text-zinc-400 hover:bg-zinc-300 dark:hover:bg-zinc-700'">
          <span class="w-2 h-2 rounded-full" [ngClass]="s.dot"></span>
          {{ s.label }}
          <span class="opacity-70">{{ getCountByStatus(s.value) }}</span>
        </button>
      </div>

      <!-- THREADS LIST -->
      <div class="flex-1 overflow-auto p-4 custom-scrollbar">
        
        <!-- Empty State -->
        <div *ngIf="filteredThreads().length === 0" class="flex flex-col items-center justify-center h-full text-center">
          <div class="w-20 h-20 rounded-2xl bg-zinc-100 dark:bg-zinc-800 flex items-center justify-center mb-4">
            <i class="pi pi-question-circle text-4xl text-zinc-300 dark:text-zinc-600"></i>
          </div>
          <h3 class="text-lg font-semibold text-zinc-600 dark:text-zinc-400 mb-1">No threads yet</h3>
          <p class="text-sm text-zinc-400 dark:text-zinc-500 max-w-xs">
            Track the mysteries and unanswered questions in your story.
          </p>
        </div>

        <!-- Thread Cards -->
        <div class="grid gap-3">
          <div *ngFor="let thread of filteredThreads(); trackBy: trackById"
               (click)="editThread(thread)"
               class="group bg-white dark:bg-zinc-900 rounded-xl p-4 border border-zinc-200 dark:border-zinc-800 hover:border-violet-400 dark:hover:border-violet-500 transition-all cursor-pointer shadow-sm hover:shadow-md">
            
            <!-- Top Row: Status + Question -->
            <div class="flex items-start gap-3">
              <span class="shrink-0 w-2.5 h-2.5 rounded-full mt-2" [ngClass]="getStatusDot(thread.status)"></span>
              <div class="flex-1 min-w-0">
                <p class="font-semibold text-zinc-800 dark:text-zinc-100 leading-snug">{{ thread.question }}</p>
                
                <!-- Planted In + Entities -->
                <div class="flex flex-wrap items-center gap-2 mt-2 text-xs text-zinc-500">
                  <span *ngIf="thread.plantedIn" class="flex items-center gap-1 bg-zinc-100 dark:bg-zinc-800 px-2 py-0.5 rounded">
                    <i class="pi pi-file text-[10px]"></i> Planted
                  </span>
                  <span *ngFor="let entityId of thread.connectedEntities.slice(0, 3)" 
                        class="bg-violet-50 dark:bg-violet-900/20 text-violet-600 dark:text-violet-400 px-2 py-0.5 rounded">
                    {{ entityId }}
                  </span>
                  <span *ngIf="thread.connectedEntities.length > 3" class="text-zinc-400">
                    +{{ thread.connectedEntities.length - 3 }} more
                  </span>
                </div>
              </div>
              
              <!-- Status Badge -->
              <span class="shrink-0 px-2 py-1 rounded-lg text-[10px] font-bold uppercase tracking-wider" 
                    [ngClass]="getStatusBadgeClass(thread.status)">
                {{ thread.status }}
              </span>
            </div>

            <!-- Answer (shown only if revealed) -->
            <div *ngIf="thread.status === 'revealed' && thread.answer" 
                 class="mt-3 pt-3 border-t border-zinc-100 dark:border-zinc-800">
              <div class="flex items-start gap-2">
                <i class="pi pi-check-circle text-green-500 text-sm mt-0.5"></i>
                <p class="text-sm text-zinc-600 dark:text-zinc-400 italic">{{ thread.answer }}</p>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>

    <!-- CREATE/EDIT DRAWER (Dialog for now) -->
    <p-dialog [header]="isCreating ? 'New Thread' : 'Edit Thread'" [(visible)]="showDialog" [modal]="true" 
              [style]="{width: '32rem'}" [draggable]="false" styleClass="lore-thread-dialog">
      <div class="flex flex-col gap-5" *ngIf="tempThread">
        
        <!-- Question -->
        <div class="flex flex-col gap-2">
          <label class="text-xs font-bold uppercase tracking-wide text-zinc-500">The Question</label>
          <textarea pInputTextarea [(ngModel)]="tempThread.question" 
                    placeholder="e.g. Who killed the old king?"
                    rows="2"
                    class="w-full text-base font-medium resize-none"></textarea>
        </div>

        <!-- Status -->
        <div class="flex flex-col gap-2">
          <label class="text-xs font-bold uppercase tracking-wide text-zinc-500">Status</label>
          <div class="flex gap-2">
            <button *ngFor="let s of statuses" (click)="tempThread.status = s.value"
                    class="flex-1 px-3 py-2.5 rounded-lg text-xs font-semibold transition-all flex flex-col items-center gap-1"
                    [ngClass]="tempThread.status === s.value ? 'text-white ' + s.bgActive : 'bg-zinc-100 dark:bg-zinc-800 text-zinc-600 dark:text-zinc-400 hover:bg-zinc-200 dark:hover:bg-zinc-700'">
              <span class="w-3 h-3 rounded-full" [ngClass]="s.dot"></span>
              {{ s.label }}
            </button>
          </div>
        </div>

        <!-- Answer (progressive disclosure) -->
        <div *ngIf="tempThread.status === 'revealed' || tempThread.status === 'dropped'" class="flex flex-col gap-2">
          <label class="text-xs font-bold uppercase tracking-wide text-zinc-500">The Answer</label>
          <textarea pInputTextarea [(ngModel)]="tempThread.answer" 
                    placeholder="What's the resolution?"
                    rows="2"
                    class="w-full text-sm resize-none"></textarea>
        </div>

        <!-- Connected Entities (simple text for now) -->
        <div class="flex flex-col gap-2">
          <label class="text-xs font-bold uppercase tracking-wide text-zinc-500">Connected Entities</label>
          <input pInputText [(ngModel)]="entityInputText" 
                 placeholder="Type entity names, separated by commas"
                 class="w-full text-sm" />
          <p class="text-[10px] text-zinc-400">e.g. King Aldric, The Shadow Council, Throne Room</p>
        </div>
      </div>

      <ng-template pTemplate="footer">
        <div class="flex justify-between w-full">
          <button *ngIf="!isCreating" (click)="deleteThread()" 
                  class="px-4 py-2 text-red-500 hover:bg-red-50 dark:hover:bg-red-900/20 rounded-lg text-sm font-medium transition-colors">
            Delete
          </button>
          <div class="flex gap-2 ml-auto">
            <button pButton label="Cancel" class="p-button-text" (click)="showDialog=false"></button>
            <button pButton label="Save" class="p-button-primary" (click)="saveThread()"></button>
          </div>
        </div>
      </ng-template>
    </p-dialog>
  `,
  styles: [`
    :host ::ng-deep .lore-thread-dialog .p-dialog-content {
      padding: 1.5rem;
    }
    :host ::ng-deep .lore-thread-dialog .p-dialog-header {
      padding: 1rem 1.5rem;
    }
  `]
})
export class MysteryComponent {
  private scopeService = inject(ScopeService);
  private worldService = inject(WorldBuildingService);

  // State
  private async resolveNarrativeIdFromScope(scope: ActiveScope): Promise<string | null> {
    if (scope.narrativeId) return scope.narrativeId;

    if (scope.type === 'narrative' && scope.id && scope.id !== 'vault:global') {
      return scope.id;
    }

    if (scope.id && scope.id !== 'vault:global') {
      const scopedFolder = await db.folders.get(scope.id);
      if (scopedFolder?.isNarrativeRoot) return scopedFolder.id;
      if (scopedFolder?.narrativeId) return scopedFolder.narrativeId;
    }

    const firstNarrative = await db.folders
      .where('entityKind')
      .equals('NARRATIVE')
      .first();

    return firstNarrative?.id ?? null;
  }

  narrativeId = toSignal(
    toObservable(this.scopeService.activeScope).pipe(
      switchMap(scope => from(this.resolveNarrativeIdFromScope(scope)))
    ),
    { initialValue: null as string | null }
  );

  filterStatus = signal<ThreadStatus | null>(null);
  showDialog = false;
  isCreating = false;
  tempThread: LoreThread | null = null;
  entityInputText = '';

  isValidNarrative = computed(() => {
    const nid = this.narrativeId();
    return !!nid && nid !== 'vault:global';
  });

  // Data
  threads = toSignal(
    toObservable(this.narrativeId).pipe(
      switchMap(nid => (nid && nid !== 'vault:global') ? this.worldService.getLoreThreads$(nid) : of([]))
    ),
    { initialValue: [] }
  );

  filteredThreads = computed(() => {
    const status = this.filterStatus();
    const all = this.threads();
    if (!status) return all;
    return all.filter(t => t.status === status);
  });

  // Status config
  statuses: { value: ThreadStatus; label: string; dot: string; bgActive: string }[] = [
    { value: 'open', label: 'Open', dot: 'bg-blue-500', bgActive: 'bg-blue-500' },
    { value: 'hinted', label: 'Hinted', dot: 'bg-amber-500', bgActive: 'bg-amber-500' },
    { value: 'revealed', label: 'Revealed', dot: 'bg-green-500', bgActive: 'bg-green-500' },
    { value: 'dropped', label: 'Dropped', dot: 'bg-zinc-400', bgActive: 'bg-zinc-500' }
  ];

  getCountByStatus(status: ThreadStatus): number {
    return this.threads().filter(t => t.status === status).length;
  }

  getStatusDot(status: ThreadStatus): string {
    return this.statuses.find(s => s.value === status)?.dot || 'bg-zinc-400';
  }

  getStatusBadgeClass(status: ThreadStatus): string {
    switch (status) {
      case 'open': return 'bg-blue-100 dark:bg-blue-900/30 text-blue-600 dark:text-blue-400';
      case 'hinted': return 'bg-amber-100 dark:bg-amber-900/30 text-amber-600 dark:text-amber-400';
      case 'revealed': return 'bg-green-100 dark:bg-green-900/30 text-green-600 dark:text-green-400';
      case 'dropped': return 'bg-zinc-100 dark:bg-zinc-800 text-zinc-500 dark:text-zinc-400';
      default: return 'bg-zinc-100 text-zinc-500';
    }
  }

  trackById(index: number, thread: LoreThread): string {
    return thread.id;
  }

  // CRUD
  getEmptyThread(): LoreThread {
    const now = Date.now();
    return {
      id: '',
      question: '',
      status: 'open',
      plantedIn: undefined,
      answer: undefined,
      connectedEntities: [],
      createdAt: now,
      updatedAt: now
    };
  }

  createThread(): void {
    this.isCreating = true;
    this.tempThread = this.getEmptyThread();
    this.entityInputText = '';
    this.showDialog = true;
  }

  editThread(thread: LoreThread): void {
    this.isCreating = false;
    this.tempThread = JSON.parse(JSON.stringify(thread));
    this.entityInputText = thread.connectedEntities.join(', ');
    this.showDialog = true;
  }

  async saveThread(): Promise<void> {
    if (!this.tempThread) return;
    const nid = this.narrativeId();
    if (!nid) return;

    // Parse entities from input
    this.tempThread.connectedEntities = this.entityInputText
      .split(',')
      .map(s => s.trim())
      .filter(s => s.length > 0);
    this.tempThread.updatedAt = Date.now();

    let list = [...this.threads()];
    if (this.isCreating) {
      this.tempThread.id = this.worldService.generateId();
      list.push(this.tempThread);
    } else {
      const idx = list.findIndex(t => t.id === this.tempThread!.id);
      if (idx > -1) list[idx] = this.tempThread;
    }

    await this.worldService.updateLoreThreads(nid, list);
    this.showDialog = false;
  }

  async deleteThread(): Promise<void> {
    if (!this.tempThread) return;
    if (!confirm('Delete this thread?')) return;

    const nid = this.narrativeId();
    if (!nid) return;

    const list = this.threads().filter(t => t.id !== this.tempThread!.id);
    await this.worldService.updateLoreThreads(nid, list);
    this.showDialog = false;
  }
}
