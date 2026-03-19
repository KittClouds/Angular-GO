
import { Component, computed, inject, signal, effect } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ButtonModule } from 'primeng/button';
import { DialogModule } from 'primeng/dialog';
import { InputTextModule } from 'primeng/inputtext';
import { TextareaModule } from 'primeng/textarea';
import { SelectButtonModule } from 'primeng/selectbutton';

import { ScopeService, ActiveScope } from '../../../../../lib/services/scope.service';
import { WorldBuildingService, PowerSystem, PowerCapability, PowerProgression } from '../../../../../lib/services/world-building.service';
import { FolderService } from '../../../../../lib/services/folder.service';
import { toSignal, toObservable } from '@angular/core/rxjs-interop';
import { map, switchMap, of, from } from 'rxjs';
import { db } from '../../../../../lib/dexie/db';

/**
 * MagicSystemComponent
 * Manages Magic, Tech, and Hybrid power systems.
 * Supports "Codex" (Edit/List) and "Map" (Tree/Graph) views.
 * Tracks Act-specific progression (Unlocked, Unknown, etc).
 */
@Component({
  selector: 'app-magic-system',
  standalone: true,
  imports: [
    CommonModule,
    FormsModule,
    ButtonModule,
    DialogModule,
    InputTextModule,
    TextareaModule,
    SelectButtonModule
  ],
  template: `
    <div class="flex h-full bg-zinc-50 dark:bg-zinc-950 text-zinc-800 dark:text-zinc-300 font-sans selection:bg-teal-500/30 selection:text-teal-700 dark:selection:text-teal-200">
        
        <!-- SIDEBAR (Systems List) -->
        <div class="w-72 border-r border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 flex flex-col shrink-0">
            <!-- Header -->
            <div class="p-4 border-b border-zinc-200 dark:border-zinc-800 flex items-center justify-between">
                <h2 class="text-sm font-bold uppercase tracking-widest text-zinc-500">Systems</h2>
                <button (click)="createSystem()" [disabled]="!isValidNarrative()" 
                        class="w-7 h-7 flex items-center justify-center rounded-full hover:bg-zinc-100 dark:hover:bg-zinc-800 text-teal-600 transition-colors disabled:opacity-50">
                    <i class="pi pi-plus text-xs"></i>
                </button>
            </div>

            <!-- List -->
            <div class="flex-1 overflow-y-auto p-2 space-y-1 custom-scrollbar">
                
                <div *ngIf="!isValidNarrative()" class="p-4 text-center text-zinc-500 text-sm italic">
                    Select a narrative to view systems.
                </div>

                <div *ngIf="isValidNarrative() && systems().length === 0" class="p-4 text-center text-zinc-400 text-sm italic">
                    No magic or tech systems defined yet.
                </div>

                <div *ngFor="let sys of systems()" 
                     (click)="selectSystem(sys)"
                     class="group flex items-center gap-3 p-3 rounded-xl cursor-pointer transition-all border border-transparent"
                     [ngClass]="{
                        'bg-teal-50 dark:bg-teal-500/10 border-teal-200 dark:border-teal-500/20 shadow-sm': selectedSystemId() === sys.id,
                        'hover:bg-zinc-100 dark:hover:bg-zinc-800/50': selectedSystemId() !== sys.id
                     }">
                    
                    <div class="w-8 h-8 rounded-lg flex items-center justify-center text-lg bg-zinc-100 dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700 transition-colors"
                         [ngClass]="{'border-teal-500 text-teal-600': selectedSystemId() === sys.id}">
                        <i class="pi" [ngClass]="getSystemIcon(sys.type)"></i>
                    </div>
                    
                    <div class="flex-1 min-w-0">
                        <h3 class="text-sm font-bold text-zinc-900 dark:text-zinc-100 truncate group-hover:text-teal-600 dark:group-hover:text-teal-400 transition-colors"
                            [ngClass]="{'text-teal-700 dark:text-teal-300': selectedSystemId() === sys.id}">
                            {{ sys.name }}
                        </h3>
                        <div class="text-[10px] uppercase font-bold tracking-wider opacity-60">{{ sys.type }}</div>
                    </div>
                </div>
            </div>
        </div>

        <!-- MAIN AREA -->
        <div class="flex-1 flex flex-col overflow-hidden relative bg-zinc-50/50 dark:bg-zinc-950/50">
            
            <!-- Context Bar (Sticky) -->
            <div *ngIf="selectedSystem(); else emptyState" class="px-6 py-4 border-b border-zinc-200 dark:border-zinc-800 bg-white/80 dark:bg-zinc-900/80 backdrop-blur flex items-center justify-between sticky top-0 z-20">
                <div class="flex items-center gap-4">
                    <h1 class="text-2xl font-bold font-serif text-zinc-900 dark:text-white flex items-center gap-2">
                        {{ selectedSystem()!.name }}
                        <button (click)="editSystemMeta()" class="text-zinc-300 hover:text-zinc-500 text-sm"><i class="pi pi-pencil"></i></button>
                    </h1>
                     <!-- View Mode Toggle -->
                    <div class="bg-zinc-100 dark:bg-zinc-800 p-1 rounded-lg flex text-xs font-semibold">
                        <button (click)="viewMode.set('codex')" 
                                class="px-3 py-1 rounded-md transition-all"
                                [ngClass]="viewMode() === 'codex' ? 'bg-white dark:bg-zinc-700 shadow-sm text-zinc-900 dark:text-white' : 'text-zinc-500 hover:text-zinc-700'">
                            <i class="pi pi-book mr-1"></i> Codex
                        </button>
                        <button (click)="viewMode.set('map')"
                                class="px-3 py-1 rounded-md transition-all"
                                [ngClass]="viewMode() === 'map' ? 'bg-white dark:bg-zinc-700 shadow-sm text-zinc-900 dark:text-white' : 'text-zinc-500 hover:text-zinc-700'">
                            <i class="pi pi-sitemap mr-1"></i> Map
                        </button>
                    </div>
                </div>

                <div class="flex items-center gap-4">
                     <!-- Act Context -->
                    <div class="flex items-center gap-2 px-3 py-1.5 rounded-full bg-indigo-50 dark:bg-indigo-500/10 border border-indigo-200 dark:border-indigo-500/20">
                        <i class="pi pi-history text-indigo-600 dark:text-indigo-400 text-xs"></i>
                        <span class="text-xs font-semibold text-indigo-800 dark:text-indigo-200">
                             {{ currentActName() || 'Global Context' }}
                        </span>
                    </div>
                    
                    <button (click)="createCapability()" class="bg-teal-600 hover:bg-teal-700 text-white px-4 py-1.5 rounded-lg text-sm font-semibold shadow-lg shadow-teal-900/20 transition-all flex items-center gap-2">
                        <i class="pi pi-plus text-xs"></i> New Capability
                    </button>
                </div>
            </div>

            <!-- CONTENT: CODEX MODE -->
            <div *ngIf="selectedSystem() && viewMode() === 'codex'" class="flex-1 overflow-y-auto p-8 custom-scrollbar">
                <div class="max-w-6xl mx-auto space-y-8">
                    
                    <!-- Rules Section -->
                    <section class="grid grid-cols-1 md:grid-cols-3 gap-6">
                        <div class="p-5 rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 shadow-sm group">
                            <h3 class="text-xs font-bold uppercase tracking-widest text-zinc-500 mb-2 flex justify-between">
                                Hard Limits 
                                <button (click)="editRules('limits')" class="opacity-0 group-hover:opacity-100 text-teal-600"><i class="pi pi-pencil"></i></button>
                            </h3>
                            <p class="text-sm text-zinc-700 dark:text-zinc-300 leading-relaxed whitespace-pre-line">{{ selectedSystem()!.rules.limits || 'No limits defined.' }}</p>
                        </div>
                        <div class="p-5 rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 shadow-sm group">
                            <h3 class="text-xs font-bold uppercase tracking-widest text-zinc-500 mb-2 flex justify-between">
                                Costs 
                                <button (click)="editRules('costs')" class="opacity-0 group-hover:opacity-100 text-teal-600"><i class="pi pi-pencil"></i></button>
                            </h3>
                            <p class="text-sm text-zinc-700 dark:text-zinc-300 leading-relaxed whitespace-pre-line">{{ selectedSystem()!.rules.costs || 'No cost system defined.' }}</p>
                        </div>
                        <div class="p-5 rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 shadow-sm group">
                            <h3 class="text-xs font-bold uppercase tracking-widest text-zinc-500 mb-2 flex justify-between">
                                Failure Modes 
                                <button (click)="editRules('failureModes')" class="opacity-0 group-hover:opacity-100 text-teal-600"><i class="pi pi-pencil"></i></button>
                            </h3>
                            <p class="text-sm text-zinc-700 dark:text-zinc-300 leading-relaxed whitespace-pre-line">{{ selectedSystem()!.rules.failureModes || 'No failure consequences defined.' }}</p>
                        </div>
                    </section>
                    
                    <div class="h-px bg-zinc-200 dark:bg-zinc-800 w-full"></div>

                    <!-- Capabilities Grid -->
                    <section>
                         <h3 class="text-lg font-bold text-zinc-900 dark:text-white mb-6">Capabilities</h3>
                         <div class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
                            <div *ngFor="let cap of selectedSystem()!.capabilities" 
                                 (click)="editCapability(cap)"
                                 class="relative group p-4 rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 hover:border-teal-400 dark:hover:border-teal-600 hover:shadow-lg transition-all cursor-pointer flex flex-col h-full overflow-hidden">
                                
                                <!-- Status Stripe -->
                                <div class="absolute top-0 left-0 right-0 h-1" [ngClass]="getStatusColorBg(getProgression(cap.id)?.status)"></div>

                                <div class="flex items-start justify-between mb-2">
                                    <h4 class="font-bold text-zinc-900 dark:text-zinc-100">{{ cap.name }}</h4>
                                    <!-- Status Badge -->
                                    <span class="text-[10px] uppercase font-bold px-1.5 py-0.5 rounded border"
                                          [ngClass]="getStatusBadge(getProgression(cap.id)?.status)">
                                          {{ getProgression(cap.id)?.status || 'Unknown' }}
                                    </span>
                                </div>
                                
                                <p class="text-xs text-zinc-500 dark:text-zinc-400 line-clamp-3 mb-3 flex-1">{{ cap.description }}</p>
                                
                                <div class="flex flex-wrap gap-1 mt-auto">
                                    <span class="text-[10px] px-1.5 py-0.5 bg-zinc-100 dark:bg-zinc-800 rounded text-zinc-500 border border-zinc-200 dark:border-zinc-700" *ngFor="let c of cap.cost">{{c}}</span>
                                    <span class="text-[10px] px-1.5 py-0.5 bg-red-50 dark:bg-red-900/20 rounded text-red-500 border border-red-100 dark:border-red-900/30" *ngFor="let r of cap.risks">{{r}}</span>
                                </div>
                            </div>
                         </div>
                    </section>
                </div>
            </div>
            
            <!-- CONTENT: MAP MODE -->
            <div *ngIf="selectedSystem() && viewMode() === 'map'" class="flex-1 relative bg-zinc-100/50 dark:bg-zinc-950/50 overflow-hidden" 
                 style="background-image: radial-gradient(#cbd5e1 1px, transparent 1px); background-size: 20px 20px;">
                 
                 <!-- Simple Visualize Message -->
                 <div class="absolute inset-0 flex items-center justify-center pointer-events-none opacity-10">
                     <i class="pi pi-sitemap text-9xl"></i>
                 </div>

                 <!-- Node Container (draggable in future, static for now) -->
                 <div class="w-full h-full p-20 relative overflow-auto custom-scrollbar">
                     <!-- 
                         Tech Tree Visualization 
                         Ideally this would be an SVG with lines. For this prototype, I'll use a CSS Grid-like structure 
                         or absolute positioning based on a simulated layout if coordinates exist.
                     -->
                     <ng-container *ngFor="let cap of selectedSystem()!.capabilities; let i = index">
                        <!-- Simulated Grid Layout: Simple Wrap if no coords -->
                        <!-- If we had coords, we'd use [style.left.px]="cap.position.x" etc. -->
                        <div class="inline-block m-8 relative group" 
                             (click)="editCapability(cap)">
                            
                            <!-- Connector Lines (Fake Stubs) -->
                            <div class="absolute -top-8 left-1/2 w-px h-8 bg-zinc-300 dark:bg-zinc-700" *ngIf="i > 0"></div>

                            <!-- Node -->
                            <div class="w-16 h-16 rounded-full border-2 flex items-center justify-center bg-white dark:bg-zinc-900 shadow-xl cursor-pointer hover:scale-110 transition-transform z-10 relative"
                                 [ngClass]="getStatusBorder(getProgression(cap.id)?.status)">
                                <i class="pi" [ngClass]="getHeaderIcon(selectedSystem()!.type)"></i>
                            </div>

                             <!-- Label -->
                            <div class="absolute top-100 left-1/2 -translate-x-1/2 mt-2 text-center w-32">
                                <span class="text-xs font-bold text-zinc-900 dark:text-zinc-100 bg-white/80 dark:bg-zinc-900/80 px-2 rounded">{{ cap.name }}</span>
                                <div class="text-[9px] uppercase font-bold text-zinc-500 mt-0.5">{{ getProgression(cap.id)?.status }}</div>
                            </div>

                             <!-- Hover Tooltip/Card -->
                             <div class="absolute top-0 left-20 w-48 p-3 bg-white dark:bg-zinc-900 rounded-lg shadow-xl border border-zinc-200 dark:border-zinc-700 hidden group-hover:block z-50 animate-fade-in text-left">
                                 <h4 class="font-bold text-xs mb-1">{{ cap.name }}</h4>
                                 <p class="text-[10px] text-zinc-500 leading-tight mb-2">{{ cap.description }}</p>
                                 <div class="flex flex-wrap gap-1">
                                     <span class="text-[9px] text-red-500" *ngIf="cap.risks.length">⚠ {{cap.risks[0]}}</span>
                                     <span class="text-[9px] text-zinc-400" *ngIf="cap.cost.length">💎 {{cap.cost[0]}}</span>
                                 </div>
                             </div>
                        </div>
                     </ng-container>
                     
                     <div class="absolute bottom-10 right-10 p-4 bg-white/90 dark:bg-zinc-900/90 rounded-lg shadow-lg border border-zinc-200 dark:border-zinc-800 text-xs">
                         <h4 class="font-bold mb-2 uppercase tracking-wider text-zinc-400">Legend</h4>
                         <div class="space-y-1">
                             <div class="flex items-center gap-2"><div class="w-2 h-2 rounded-full bg-green-500"></div> Unlocked</div>
                             <div class="flex items-center gap-2"><div class="w-2 h-2 rounded-full bg-amber-500"></div> Rumored</div>
                             <div class="flex items-center gap-2"><div class="w-2 h-2 rounded-full bg-zinc-400"></div> Unknown</div>
                         </div>
                     </div>
                 </div>
            </div>

            <!-- Empty State -->
            <ng-template #emptyState>
                <div class="flex flex-col items-center justify-center h-full text-zinc-400">
                    <i class="pi pi-bolt text-4xl mb-4 opacity-20"></i>
                    <p class="text-sm">Select or create a Power System.</p>
                </div>
            </ng-template>

        </div>

    </div>

    <!-- DIALOGS -->

    <!-- Create/Edit System -->
    <p-dialog header="{{ isCreating ? 'New System' : 'Edit System' }}" [(visible)]="showSystemDialog" [modal]="true" [style]="{width: '30vw'}">
        <ng-template pTemplate="content">
        <div class="flex flex-col gap-4 py-2">
            <div class="flex flex-col gap-2">
                <label class="text-sm font-bold">Name</label>
                <input pInputText [(ngModel)]="tempSystem.name" placeholder="e.g. Blood Magic" />
            </div>
            <div class="flex flex-col gap-2">
                <label class="text-sm font-bold">Type</label>
                <p-selectButton [options]="[{label:'Magic', value:'magic'}, {label:'Tech', value:'tech'}, {label:'Hybrid', value:'hybrid'}]" 
                                [(ngModel)]="tempSystem.type" optionLabel="label" optionValue="value"></p-selectButton>
            </div>
            <div class="flex flex-col gap-2">
                <label class="text-sm font-bold">Description</label>
                <textarea pInputTextarea [(ngModel)]="tempSystem.description" rows="3"></textarea>
            </div>
        </div>
        </ng-template>
        <ng-template pTemplate="footer">
            <button pButton label="Cancel" (click)="showSystemDialog=false" class="p-button-text"></button>
            <button pButton label="Save" (click)="saveSystem()" class="p-button-primary"></button>
        </ng-template>
    </p-dialog>
    
    <!-- Edit Rules -->
    <p-dialog header="Edit Rules" [(visible)]="showRulesDialog" [modal]="true" [style]="{width: '40vw'}">
        <ng-template pTemplate="content">
        <div class="flex flex-col gap-4 py-2">
            <div *ngIf="activeRuleField === 'limits'" class="flex flex-col gap-2">
                <label class="text-sm font-bold">Hard Limits</label>
                <textarea pInputTextarea [(ngModel)]="tempRuleValue" rows="6" placeholder="What can this system NEVER do?"></textarea>
            </div>
            <div *ngIf="activeRuleField === 'costs'" class="flex flex-col gap-2">
                <label class="text-sm font-bold">Costs & Resources</label>
                <textarea pInputTextarea [(ngModel)]="tempRuleValue" rows="6" placeholder="What must be paid?"></textarea>
            </div>
             <div *ngIf="activeRuleField === 'failureModes'" class="flex flex-col gap-2">
                <label class="text-sm font-bold">Failure Modes</label>
                <textarea pInputTextarea [(ngModel)]="tempRuleValue" rows="6" placeholder="What happens when it goes wrong?"></textarea>
            </div>
        </div>
        </ng-template>
         <ng-template pTemplate="footer">
            <button pButton label="Cancel" (click)="showRulesDialog=false" class="p-button-text"></button>
            <button pButton label="Save" (click)="saveRules()" class="p-button-primary"></button>
        </ng-template>
    </p-dialog>

    <!-- Capability Editor -->
    <p-dialog header="Capability Details" [(visible)]="showCapDialog" [modal]="true" [style]="{width: '35vw'}">
        <ng-template pTemplate="content">
        <div class="flex flex-col gap-4 py-2">
             <div class="flex flex-col gap-2">
                <label class="text-sm font-bold">Name</label>
                <input pInputText [(ngModel)]="tempCapability.name" placeholder="e.g. Fireball or Warp Drive" />
            </div>
            <div class="grid grid-cols-2 gap-4">
                 <div class="flex flex-col gap-2">
                    <label class="text-sm font-bold">Costs (comma sep)</label>
                    <input pInputText [(ngModel)]="tempCapCosts" placeholder="Mana, 5 Gold" />
                </div>
                 <div class="flex flex-col gap-2">
                    <label class="text-sm font-bold">Risks (comma sep)</label>
                    <input pInputText [(ngModel)]="tempCapRisks" placeholder="Burn, Explosion" />
                </div>
            </div>
             <div class="flex flex-col gap-2">
                <label class="text-sm font-bold">Description</label>
                <textarea pInputTextarea [(ngModel)]="tempCapability.description" rows="4"></textarea>
            </div>
            
            <div class="p-4 bg-zinc-50 dark:bg-zinc-900 rounded border border-zinc-200 dark:border-zinc-800">
                <h4 class="text-xs font-bold uppercase tracking-widest text-zinc-500 mb-2">Act Progression</h4>
                <div class="flex flex-col gap-2">
                    <label class="text-sm font-medium">Status in {{ currentActName() }}</label>
                    <div class="flex flex-wrap gap-2">
                        <div *ngFor="let s of ['unknown','rumored','known','unlocked','forbidden']"
                             class="px-2 py-1 rounded text-xs border cursor-pointer capitalize"
                             [ngClass]="getProgressionClass(s, tempProgression.status)"
                             (click)="tempProgression.status = $any(s)">
                             {{s}}
                        </div>
                    </div>
                </div>
                 <div class="flex flex-col gap-2 mt-3">
                    <label class="text-sm font-medium">Context / Notes</label>
                     <input pInputText [(ngModel)]="tempProgression.note" placeholder="Why is it forbidden?" class="text-sm"/>
                </div>
            </div>
        </div>
        </ng-template>
        <ng-template pTemplate="footer">
            <button pButton label="Cancel" (click)="showCapDialog=false" class="p-button-text"></button>
            <button pButton label="Save" (click)="saveCapability()" class="p-button-primary"></button>
        </ng-template>
    </p-dialog>
    `
})
export class MagicSystemComponent {
  private scopeService = inject(ScopeService);
  private worldService = inject(WorldBuildingService);
  private folderService = inject(FolderService);

  // ======================
  // Data Source
  // ======================
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

  isValidNarrative = computed(() => {
    const nid = this.narrativeId();
    return !!nid && nid !== 'vault:global';
  });

  // Act Context
  actFolders = toSignal(
    toObservable(this.narrativeId).pipe(
      switchMap(nid => (nid && nid !== 'vault:global') ? this.folderService.getFoldersByNarrative$(nid) : of([])),
      map(folders => (folders || []).filter(f => f.entityKind === 'ACT'))
    ),
    { initialValue: [] }
  );

  selectedActId = signal<string | null>(null);

  constructor() {
    effect(() => {
      const acts = this.actFolders() || [];
      const scope = this.scopeService.activeScope();
      const scopedActId = scope.type === 'act' ? (scope.actId || scope.id) : null;

      if (scopedActId && acts.some(a => a.id === scopedActId)) {
        if (this.selectedActId() !== scopedActId) {
          this.selectedActId.set(scopedActId);
        }
        return;
      }

      if (acts.length === 0) {
        if (this.selectedActId() !== null) {
          this.selectedActId.set(null);
        }
        return;
      }

      const current = this.selectedActId();
      if (!current || !acts.some(a => a.id === current)) {
        this.selectedActId.set(acts[0].id);
      }
    });
  }

  currentActName = computed(() => {
    const id = this.selectedActId();
    const acts = this.actFolders();
    return acts?.find(a => a.id === id)?.name || '';
  });

  // Data Signals
  systems = toSignal(
    toObservable(this.narrativeId).pipe(
      switchMap(nid => (nid && nid !== 'vault:global') ? this.worldService.getPowerSystems$(nid) : of([]))
    ),
    { initialValue: [] }
  );

  progressionMap = toSignal(
    toObservable(this.selectedActId).pipe(
      switchMap(aid => aid ? this.worldService.getActPowerProgression$(aid) : of({} as Record<string, PowerProgression>))
    ),
    { initialValue: {} as Record<string, PowerProgression> }
  );

  // ======================
  // View State
  // ======================
  selectedSystemId = signal<string | null>(null);
  selectedSystem = computed(() => this.systems().find(s => s.id === this.selectedSystemId()));
  viewMode = signal<'codex' | 'map'>('codex');

  // ======================
  // Helpers
  // ======================
  getSystemIcon(type: string) {
    if (type === 'magic') return 'pi-bolt';
    if (type === 'tech') return 'pi-cog';
    return 'pi-code'; // hybrid
  }

  getHeaderIcon(type: string) {
    if (type === 'magic') return 'pi-star';
    if (type === 'tech') return 'pi-box';
    return 'pi-code';
  }

  getProgression(capId: string): PowerProgression | undefined {
    return this.progressionMap()?.[capId];
  }

  getStatusColorBg(status: string | undefined): string {
    if (!status || status === 'unknown') return 'bg-zinc-300 dark:bg-zinc-700';
    if (status === 'unlocked') return 'bg-green-500';
    if (status === 'known') return 'bg-teal-500';
    if (status === 'rumored') return 'bg-amber-500';
    if (status === 'forbidden') return 'bg-red-600';
    return 'bg-zinc-300';
  }

  getStatusBadge(status: string | undefined): string {
    if (!status || status === 'unknown') return 'text-zinc-400 border-zinc-200';
    if (status === 'unlocked') return 'text-green-600 border-green-200 bg-green-50';
    if (status === 'known') return 'text-teal-600 border-teal-200 bg-teal-50';
    if (status === 'rumored') return 'text-amber-600 border-amber-200 bg-amber-50';
    if (status === 'forbidden') return 'text-red-600 border-red-200 bg-red-50';
    return 'text-zinc-400 border-zinc-200';
  }

  getStatusBorder(status: string | undefined): string {
    if (!status || status === 'unknown') return 'border-zinc-300 dark:border-zinc-700 opacity-50';
    if (status === 'unlocked') return 'border-green-500 shadow-[0_0_10px_rgba(34,197,94,0.3)]';
    if (status === 'known') return 'border-teal-500';
    if (status === 'rumored') return 'border-amber-500 border-dashed';
    if (status === 'forbidden') return 'border-red-600';
    return 'border-zinc-300';
  }

  getProgressionClass(status: string, current: string): string {
    const isActive = status === current;
    if (status === 'unlocked') return isActive ? 'bg-green-600 text-white' : 'hover:bg-green-100 text-green-700';
    if (status === 'known') return isActive ? 'bg-teal-600 text-white' : 'hover:bg-teal-100 text-teal-700';
    if (status === 'rumored') return isActive ? 'bg-amber-500 text-white' : 'hover:bg-amber-100 text-amber-700';
    if (status === 'forbidden') return isActive ? 'bg-red-600 text-white' : 'hover:bg-red-100 text-red-700';
    return isActive ? 'bg-zinc-600 text-white' : 'hover:bg-zinc-200 text-zinc-700';
  }

  // ======================
  // Actions
  // ======================

  selectSystem(s: PowerSystem) {
    this.selectedSystemId.set(s.id);
  }

  // System CRUD
  showSystemDialog = false;
  isCreating = false;
  tempSystem: PowerSystem = this.getEmptySystem();

  getEmptySystem(): PowerSystem {
    return {
      id: '', name: '', type: 'magic', description: '',
      rules: { limits: '', costs: '', failureModes: '' },
      capabilities: []
    };
  }

  createSystem() {
    this.isCreating = true;
    this.tempSystem = this.getEmptySystem();
    this.showSystemDialog = true;
  }

  editSystemMeta() {
    if (!this.selectedSystem()) return;
    this.isCreating = false;
    this.tempSystem = JSON.parse(JSON.stringify(this.selectedSystem()!));
    this.showSystemDialog = true;
  }

  async saveSystem() {
    const nid = this.narrativeId();
    if (!nid || nid === 'vault:global') return;

    let list = [...this.systems()];
    if (this.isCreating) {
      this.tempSystem.id = this.worldService.generateId();
      list.push(this.tempSystem);
      this.selectedSystemId.set(this.tempSystem.id);
    } else {
      const idx = list.findIndex(s => s.id === this.tempSystem.id);
      if (idx > -1) list[idx] = this.tempSystem;
    }

    await this.worldService.updatePowerSystems(nid, list);
    this.showSystemDialog = false;
  }

  // Rules CRUD
  showRulesDialog = false;
  activeRuleField: 'limits' | 'costs' | 'failureModes' = 'limits';
  tempRuleValue = '';

  editRules(field: 'limits' | 'costs' | 'failureModes') {
    const sys = this.selectedSystem();
    if (!sys) return;
    this.activeRuleField = field;
    this.tempRuleValue = sys.rules[field];
    this.showRulesDialog = true;
  }

  async saveRules() {
    const nid = this.narrativeId();
    const sys = this.selectedSystem();
    if (!nid || !sys) return;

    const updatedSys = JSON.parse(JSON.stringify(sys));
    updatedSys.rules[this.activeRuleField] = this.tempRuleValue;

    const list = [...this.systems()];
    const idx = list.findIndex(s => s.id === updatedSys.id);
    if (idx > -1) list[idx] = updatedSys;

    await this.worldService.updatePowerSystems(nid, list);
    this.showRulesDialog = false;
  }

  // Capability CRUD
  showCapDialog = false;
  tempCapability: PowerCapability = this.getEmptyCapability();
  tempCapCosts = '';
  tempCapRisks = '';
  tempProgression: PowerProgression = { status: 'unknown', note: '' };

  getEmptyCapability(): PowerCapability {
    return { id: '', name: '', type: 'spell', description: '', cost: [], risks: [], prerequisites: [] };
  }

  createCapability() {
    this.tempCapability = this.getEmptyCapability();
    this.tempCapCosts = '';
    this.tempCapRisks = '';
    this.tempProgression = { status: 'unknown', note: '' }; // Default
    this.showCapDialog = true;
  }

  editCapability(cap: PowerCapability) {
    this.tempCapability = JSON.parse(JSON.stringify(cap));
    this.tempCapCosts = this.tempCapability.cost.join(', ');
    this.tempCapRisks = this.tempCapability.risks.join(', ');

    const currentProg = this.getProgression(cap.id);
    this.tempProgression = currentProg ? { ...currentProg } : { status: 'unknown', note: '' };

    this.showCapDialog = true;
  }

  async saveCapability() {
    const nid = this.narrativeId();
    const aid = this.selectedActId();
    const sys = this.selectedSystem();
    if (!nid || !aid || !sys) return;

    // Process flat fields
    this.tempCapability.cost = this.tempCapCosts.split(',').map(s => s.trim()).filter(s => !!s);
    this.tempCapability.risks = this.tempCapRisks.split(',').map(s => s.trim()).filter(s => !!s);

    // 1. Update Capability in System List
    const updatedSys = JSON.parse(JSON.stringify(sys));
    if (!this.tempCapability.id) {
      this.tempCapability.id = this.worldService.generateId();
      updatedSys.capabilities.push(this.tempCapability);
    } else {
      const cx = updatedSys.capabilities.findIndex((c: any) => c.id === this.tempCapability.id);
      if (cx > -1) updatedSys.capabilities[cx] = this.tempCapability;
    }

    const sysList = [...this.systems()];
    const sx = sysList.findIndex(s => s.id === updatedSys.id);
    if (sx > -1) sysList[sx] = updatedSys;

    await this.worldService.updatePowerSystems(nid, sysList);

    // 2. Update Progression in Act Data
    const progMap = { ...this.progressionMap() };
    progMap[this.tempCapability.id] = this.tempProgression;
    await this.worldService.updateActPowerProgression(aid, progMap);

    this.showCapDialog = false;
  }

}
