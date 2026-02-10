
import { Component, computed, inject, signal, effect } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ButtonModule } from 'primeng/button';
import { DialogModule } from 'primeng/dialog';
import { InputTextModule } from 'primeng/inputtext';
import { TextareaModule } from 'primeng/textarea';

import { ScopeService } from '../../../../../lib/services/scope.service';
import { WorldBuildingService, WorldSnapshot, CanonConstraint, WorldPillar, ActDelta, DEFAULT_SNAPSHOT } from '../../../../../lib/services/world-building.service';
import { FolderService } from '../../../../../lib/services/folder.service';
import { toSignal, toObservable } from '@angular/core/rxjs-interop';
import { map, switchMap, of } from 'rxjs';

@Component({
    selector: 'app-world-overview',
    standalone: true,
    imports: [
        CommonModule,
        FormsModule,
        ButtonModule,
        DialogModule,
        InputTextModule,
        TextareaModule
    ],
    template: `
    <div class="flex flex-col h-full bg-zinc-50 dark:bg-zinc-950 text-zinc-800 dark:text-zinc-300 font-sans selection:bg-teal-500/30 selection:text-teal-700 dark:selection:text-teal-200 transition-colors duration-300">
        <!-- Top Strip -->
        <div class="flex items-center justify-between px-6 py-4 border-b border-zinc-200 dark:border-zinc-800/50 bg-white/50 dark:bg-zinc-900/50 backdrop-blur-md sticky top-0 z-10 shadow-sm">
            <div class="flex items-center gap-4">
                <!-- Scope/Act Selector -->
                <div class="flex items-center gap-2 px-3 py-1.5 rounded-full bg-teal-50 dark:bg-teal-500/10 border border-teal-200 dark:border-teal-500/20 shadow-[0_0_10px_rgba(20,184,166,0.1)] transition-all hover:bg-teal-100 dark:hover:bg-teal-500/20 hover:border-teal-300 dark:hover:border-teal-500/30 cursor-pointer"
                     (click)="cycleActs()">
                    <i class="pi pi-globe text-teal-600 dark:text-teal-400 text-xs"></i>
                    <span class="text-sm font-semibold text-teal-800 dark:text-teal-100 tracking-wide">
                        {{ currentActName() || 'Global Overview' }}
                    </span>
                </div>
                
                <!-- Changes Indicator -->
                <div class="flex items-center gap-1.5 px-2 py-1 rounded text-[11px] font-medium text-amber-600 dark:text-amber-500 bg-amber-50 dark:bg-amber-500/5 border border-amber-200 dark:border-amber-500/10">
                    <i class="pi pi-history text-[10px]"></i>
                    <span>{{ (deltas() || []).length }} Deltas</span>
                </div>
            </div>
            
            <div class="flex items-center gap-3">
                <button (click)="openConstraintDialog()" class="flex items-center gap-2 px-3 py-1.5 rounded-md text-xs font-medium text-zinc-500 dark:text-zinc-400 hover:text-zinc-900 dark:hover:text-white hover:bg-zinc-200 dark:hover:bg-zinc-800 transition-all">
                    <i class="pi pi-plus text-[10px]"></i> Rule
                </button>
                <button (click)="openPillarDialog()" class="flex items-center gap-2 px-3 py-1.5 rounded-md text-xs font-medium text-zinc-500 dark:text-zinc-400 hover:text-zinc-900 dark:hover:text-white hover:bg-zinc-200 dark:hover:bg-zinc-800 transition-all">
                    <i class="pi pi-plus text-[10px]"></i> Pillar
                </button>
                <div class="h-4 w-px bg-zinc-200 dark:bg-zinc-800 mx-1"></div>
                <button (click)="openDeltaDialog()" class="flex items-center gap-2 px-3 py-1.5 rounded-md text-xs font-medium text-zinc-500 dark:text-zinc-400 border border-zinc-200 dark:border-zinc-700 hover:border-zinc-300 dark:hover:border-zinc-500 hover:text-zinc-900 dark:hover:text-white bg-white dark:bg-zinc-900/50 transition-all shadow-sm">
                    <i class="pi pi-history text-[10px]"></i> Log Change
                </button>
            </div>
        </div>

        <div class="flex-1 overflow-y-auto custom-scrollbar p-6 lg:p-8">
            <div class="grid grid-cols-12 gap-8 max-w-[1600px] mx-auto">
                
                <!-- LEFT RAIL (Quick Scan) -->
                <div class="col-span-12 lg:col-span-4 xl:col-span-3 space-y-6">
                    
                    <!-- Snapshot Card -->
                    <div class="p-6 rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900/60 shadow-lg hover:border-teal-500/30 hover:shadow-teal-900/10 transition-all duration-300 group relative overflow-hidden">
                        <div class="absolute top-0 right-0 w-24 h-24 bg-gradient-to-br from-teal-500/10 to-transparent rounded-bl-full pointer-events-none"></div>
                        
                        <div class="flex items-center justify-between mb-4">
                            <h3 class="text-xs font-bold text-teal-600 dark:text-teal-500 uppercase tracking-widest flex items-center gap-2">
                                <i class="pi pi-camera text-[10px]"></i> Snapshot
                            </h3>
                            <button (click)="openSnapshotDialog()" class="opacity-0 group-hover:opacity-100 transition-opacity text-zinc-400 dark:text-zinc-500 hover:text-zinc-900 dark:hover:text-white p-1 rounded hover:bg-zinc-100 dark:hover:bg-zinc-800">
                                <i class="pi pi-pencil text-xs"></i>
                            </button>
                        </div>
                        
                        <div class="mb-5 relative z-10">
                            <h2 class="text-xl font-bold text-zinc-900 dark:text-white leading-tight mb-3 font-serif tracking-tight">
                                {{ snapshot().logline || "No logline set." }}
                            </h2>
                            <p class="text-sm text-zinc-500 dark:text-zinc-400 italic leading-relaxed font-light border-l-2 border-zinc-200 dark:border-zinc-700 pl-3">
                                {{ snapshot().description || "Add a description..." }}
                            </p>
                        </div>

                        <div class="flex flex-wrap gap-2 text-[11px] font-medium tracking-wide">
                            <span *ngFor="let t of snapshot().tone" class="px-2.5 py-1 rounded-md bg-zinc-100 dark:bg-zinc-800 text-zinc-600 dark:text-zinc-300 border border-zinc-200 dark:border-zinc-700/50 hover:border-zinc-300 dark:hover:border-zinc-500 transition-colors cursor-default">
                                {{ t }}
                            </span>
                             <span *ngIf="snapshot().tone.length === 0" class="text-xs text-zinc-400 italic">No tone tags</span>
                        </div>
                    </div>

                    <!-- Rules Card -->
                    <div class="p-6 rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900/60 shadow-lg relative group">
                        <div class="flex items-center justify-between mb-5">
                            <h3 class="text-xs font-bold text-zinc-500 uppercase tracking-widest">Canon Constraints</h3>
                            <span class="text-[10px] bg-zinc-100 dark:bg-zinc-800 text-zinc-500 dark:text-zinc-400 px-2 py-0.5 rounded-full border border-zinc-200 dark:border-zinc-700">{{ activeConstraintsCount() }} Active</span>
                        </div>

                        <ul class="space-y-3.5">
                            <li *ngFor="let rule of constraints()" class="flex gap-3 items-start group/item">
                                <div class="mt-0.5 w-1.5 h-1.5 rounded-full bg-red-500/70 dark:bg-red-500/50 shadow-[0_0_8px_rgba(239,68,68,0.4)] shrink-0 group-hover/item:bg-red-500 dark:group-hover/item:bg-red-400 transition-colors"></div>
                                <span class="text-sm text-zinc-600 dark:text-zinc-300 font-light leading-snug group-hover/item:text-zinc-900 dark:group-hover/item:text-zinc-100 transition-colors flex-1">{{ rule.text }}</span>
                                <button (click)="deleteConstraint(rule.id)" class="opacity-0 group-hover/item:opacity-100 text-zinc-400 hover:text-red-500 transition-opacity">
                                    <i class="pi pi-trash text-[10px]"></i>
                                </button>
                            </li>
                             <li *ngIf="constraints().length === 0" class="text-sm text-zinc-400 italic">No constraints added.</li>
                        </ul>
                        
                        <div class="mt-5 pt-4 border-t border-zinc-100 dark:border-zinc-800/50 flex justify-center">
                            <button (click)="openConstraintDialog()" class="text-xs text-zinc-500 hover:text-teal-600 dark:hover:text-teal-400 transition-colors flex items-center gap-1.5">
                                Add Constraint <i class="pi pi-plus text-[10px]"></i>
                            </button>
                        </div>
                    </div>

                    <!-- Stakes Card (Static Mock for now) -->
                    <div class="p-6 rounded-xl border border-red-500/20 dark:border-red-500/10 bg-gradient-to-b from-red-500/5 to-transparent shadow-lg relative overflow-hidden">
                         <!-- Background noise/pattern (using CSS pattern instead of external URL for COEP compliance) -->
                        <div class="absolute inset-0 opacity-[0.03]" style="background-image: repeating-linear-gradient(45deg, transparent, transparent 2px, rgba(0,0,0,0.1) 2px, rgba(0,0,0,0.1) 4px);"></div>
                        
                        <h3 class="text-xs font-bold text-red-600 dark:text-red-500/80 uppercase tracking-widest mb-5 flex items-center gap-2">
                            <i class="pi pi-bolt"></i> Stakes & Pressure
                        </h3>
                        
                        <div class="space-y-5 relative z-10">
                            <!-- Clock 1 -->
                            <div class="flex gap-4 items-start">
                                <div class="w-1 bg-red-500/20 rounded-full h-12 flex flex-col justify-end overflow-hidden">
                                    <div class="bg-red-500 h-3/4 w-full shadow-[0_0_10px_#ef4444]"></div>
                                </div>
                                <div>
                                    <h4 class="text-sm font-bold text-zinc-900 dark:text-red-100">The Eclipse Clock</h4>
                                    <p class="text-xs text-zinc-500 dark:text-red-200/50 mt-1 font-light">
                                        4 days until the barrier fails. Magic becomes volatile.
                                    </p>
                                </div>
                            </div>
                        </div>
                    </div>
                </div>

                <!-- MAIN COLUMN (Deep Work) -->
                <div class="col-span-12 lg:col-span-8 xl:col-span-9 space-y-10">
                    
                    <!-- Status Quo -->
                    <section class="animate-fade-in">
                        <h3 class="text-lg font-bold text-zinc-900 dark:text-white mb-4 flex items-center gap-2">
                             Status Quo
                             <div class="h-px bg-zinc-200 dark:bg-zinc-800 flex-1 ml-4"></div>
                        </h3>
                        <div class="p-8 rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900/40 hover:bg-zinc-50 dark:hover:bg-zinc-900/60 hover:border-zinc-300 dark:hover:border-zinc-700 transition-all group relative">
                            <div class="prose prose-sm prose-invert max-w-none text-zinc-600 dark:text-zinc-300 text-base leading-7 font-light whitespace-pre-wrap">
                                {{ statusQuo() || "Describe the status quo of this act..." }}
                            </div>
                            
                            <div class="absolute top-4 right-4 opacity-0 group-hover:opacity-100 transition-all transform translate-x-2 group-hover:translate-x-0">
                                <button (click)="openStatusQuoDialog()" class="p-2 rounded-lg bg-zinc-100 dark:bg-zinc-800 text-zinc-400 hover:text-white hover:bg-teal-600 transition-colors shadow-lg">
                                    <i class="pi pi-pencil"></i>
                                </button>
                            </div>
                        </div>
                    </section>

                    <!-- Act Deltas -->
                    <section>
                        <div class="flex items-center justify-between mb-6">
                            <h3 class="text-lg font-bold text-zinc-900 dark:text-white flex items-center gap-2">
                                Act Deltas
                            </h3>
                            <button (click)="openDeltaDialog()" class="text-xs text-zinc-500 hover:text-teal-600 dark:hover:text-teal-400 transition-colors uppercase tracking-wider font-bold">Add Delta</button>
                        </div>
                        
                        <div class="space-y-4">
                            <div *ngFor="let delta of deltas()" class="relative group">
                                <!-- Connector Line -->
                                <div class="absolute left-[19px] top-8 bottom-[-18px] w-px bg-zinc-200 dark:bg-zinc-800 group-last:hidden"></div>
                                
                                <div class="flex gap-6 items-start">
                                    <div class="w-10 h-10 rounded-full flex items-center justify-center shrink-0 border-2 z-10 bg-white dark:bg-zinc-950 transition-colors duration-300 shadow-xl"
                                         [ngClass]="{
                                            'border-green-500/30 text-green-600 dark:text-green-500 group-hover:border-green-500 group-hover:bg-green-500/10': delta.type === 'new',
                                            'border-amber-500/30 text-amber-600 dark:text-amber-500 group-hover:border-amber-500 group-hover:bg-amber-500/10': delta.type === 'changed',
                                            'border-red-500/30 text-red-600 dark:text-red-500 group-hover:border-red-500 group-hover:bg-red-500/10': delta.type === 'removed'
                                         }">
                                        <i class="pi text-sm"
                                            [ngClass]="{
                                                'pi-plus': delta.type === 'new',
                                                'pi-pencil': delta.type === 'changed',
                                                'pi-trash': delta.type === 'removed'
                                            }"></i>
                                    </div>
                                    
                                    <div class="flex-1 p-4 rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900/30 hover:bg-zinc-50 dark:hover:bg-zinc-900 hover:border-zinc-300 dark:hover:border-zinc-700 transition-all flex justify-between">
                                        <div>
                                            <div class="flex items-center gap-3 mb-1">
                                                <h4 class="font-bold text-zinc-800 dark:text-zinc-200 text-sm">{{ delta.title }}</h4>
                                                <span class="text-[10px] uppercase font-bold tracking-wider opacity-60 px-2 py-0.5 rounded bg-zinc-100 dark:bg-zinc-950/50"
                                                  [ngClass]="{
                                                    'text-green-600 dark:text-green-400': delta.type === 'new',
                                                    'text-amber-600 dark:text-amber-400': delta.type === 'changed',
                                                    'text-red-600 dark:text-red-400': delta.type === 'removed'
                                                  }">{{ delta.type }}</span>
                                            </div>
                                            <p class="text-sm text-zinc-500 dark:text-zinc-400 font-light">{{ delta.description }}</p>
                                        </div>
                                         <button (click)="deleteDelta(delta.id)" class="text-zinc-500 hover:text-red-500 opacity-0 group-hover:opacity-100 transition-opacity">
                                            <i class="pi pi-trash"></i>
                                         </button>
                                    </div>
                                </div>
                            </div>
                            <div *ngIf="deltas().length === 0" class="p-8 text-center text-zinc-400 italic">No timeline changes logged for this act.</div>
                        </div>
                    </section>
                    
                    <!-- World Pillars -->
                    <section>
                        <h3 class="text-lg font-bold text-zinc-900 dark:text-white mb-6 flex items-center gap-2">
                             World Pillars
                             <div class="h-px bg-zinc-200 dark:bg-zinc-800 flex-1 ml-4"></div>
                        </h3>
                        
                        <div class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5">
                            <div *ngFor="let pillar of pillars()" 
                                 class="p-5 rounded-2xl border border-zinc-200 dark:border-zinc-800 bg-gradient-to-b from-white to-zinc-50 dark:from-zinc-900 dark:to-zinc-900/50 hover:to-white dark:hover:to-zinc-800 hover:border-zinc-300 dark:hover:border-zinc-600 hover:-translate-y-1 transition-all duration-300 cursor-pointer shadow-sm group relative">
                                <div class="w-12 h-12 rounded-xl bg-zinc-50 dark:bg-zinc-950 flex items-center justify-center mb-4 text-2xl border border-zinc-200 dark:border-zinc-800 group-hover:border-teal-500/50 group-hover:shadow-[0_0_15px_rgba(20,184,166,0.15)] transition-all">
                                    <i [class]="pillar.icon"></i>
                                </div>
                                <h4 class="font-bold text-zinc-900 dark:text-zinc-200 mb-2 group-hover:text-teal-600 dark:group-hover:text-teal-300 transition-colors">{{ pillar.title }}</h4>
                                <p class="text-xs text-zinc-500 dark:text-zinc-400 leading-normal">{{ pillar.description }}</p>

                                <button (click)="deletePillar(pillar.id)" class="absolute top-3 right-3 text-zinc-500 hover:text-red-500 opacity-0 group-hover:opacity-100 transition-opacity">
                                    <i class="pi pi-trash"></i>
                                </button>
                            </div>
                            
                            <!-- Add Pillar Button -->
                            <button (click)="openPillarDialog()" class="flex flex-col items-center justify-center p-5 rounded-2xl border border-dashed border-zinc-300 dark:border-zinc-800 bg-zinc-50 dark:bg-zinc-900/20 hover:bg-white dark:hover:bg-zinc-900 hover:border-zinc-400 dark:hover:border-zinc-600 hover:text-teal-600 dark:hover:text-teal-400 transition-all text-zinc-500 dark:text-zinc-600 gap-3 min-h-[160px] group">
                                <div class="w-10 h-10 rounded-full bg-white dark:bg-zinc-900 flex items-center justify-center group-hover:bg-zinc-100 dark:group-hover:bg-zinc-800 transition-colors border border-zinc-200 dark:border-transparent">
                                    <i class="pi pi-plus text-sm"></i>
                                </div>
                                <span class="text-sm font-medium">Add Structure</span>
                            </button>
                        </div>
                    </section>

                </div>
            </div>
        </div>
        
        <!-- DIALOGS -->
        
        <!-- Snapshot Edit Dialog -->
        <p-dialog header="Edit World Snapshot" [(visible)]="showSnapshotDialog" [modal]="true" [style]="{width: '50vw'}" styleClass="dark:bg-zinc-900 dark:text-white">
            <div class="flex flex-col gap-4 py-2">
                <div class="flex flex-col gap-2">
                    <label class="text-sm font-bold">Logline</label>
                    <input pInputText [(ngModel)]="editSnapshot.logline" placeholder="A one-sentence hook..." class="w-full" />
                </div>
                <div class="flex flex-col gap-2">
                    <label class="text-sm font-bold">Description</label>
                    <textarea pInputTextarea [(ngModel)]="editSnapshot.description" rows="5" placeholder="The elevator pitch..." class="w-full"></textarea>
                </div>
                <div class="flex flex-col gap-2">
                    <label class="text-sm font-bold">Tone Tags</label>
                     <div class="flex gap-2">
                        <input pInputText [(ngModel)]="newToneTag" placeholder="Add tag (enter)" (keydown.enter)="addToneTag()" class="w-full" />
                        <button pButton icon="pi pi-plus" (click)="addToneTag()"></button>
                     </div>
                     <div class="flex flex-wrap gap-2 mt-2">
                        <span *ngFor="let t of editSnapshot.tone" class="bg-zinc-100 dark:bg-zinc-800 px-2 py-1 rounded flex items-center gap-2">
                            {{t}} <i class="pi pi-times cursor-pointer hover:text-red-500" (click)="removeToneTag(t)"></i>
                        </span>
                     </div>
                </div>
            </div>
            <ng-template pTemplate="footer">
                <button pButton label="Cancel" (click)="showSnapshotDialog = false" class="p-button-text"></button>
                <button pButton label="Save" (click)="saveSnapshot()" class="p-button-primary"></button>
            </ng-template>
        </p-dialog>

        <!-- Constraint Dialog -->
        <p-dialog header="Add Canon Constraint" [(visible)]="showConstraintDialog" [modal]="true" [style]="{width: '30vw'}">
            <div class="flex flex-col gap-4 py-2">
                <div class="flex flex-col gap-2">
                    <label class="text-sm font-bold">Rule</label>
                    <input pInputText [(ngModel)]="newConstraintText" placeholder="e.g. Magic requires blood..." class="w-full" (keydown.enter)="saveConstraint()" />
                </div>
            </div>
            <ng-template pTemplate="footer">
                <button pButton label="Cancel" (click)="showConstraintDialog = false" class="p-button-text"></button>
                <button pButton label="Save" (click)="saveConstraint()" class="p-button-primary"></button>
            </ng-template>
        </p-dialog>

        <!-- Status Quo Dialog -->
        <p-dialog header="Edit Status Quo" [(visible)]="showStatusQuoDialog" [modal]="true" [style]="{width: '50vw'}">
            <div class="flex flex-col gap-4 py-2">
                <div class="flex flex-col gap-2">
                    <label class="text-sm font-bold">Status Quo</label>
                    <textarea pInputTextarea [(ngModel)]="editStatusQuo" rows="8" class="w-full"></textarea>
                </div>
            </div>
            <ng-template pTemplate="footer">
                <button pButton label="Cancel" (click)="showStatusQuoDialog = false" class="p-button-text"></button>
                <button pButton label="Save" (click)="saveStatusQuo()" class="p-button-primary"></button>
            </ng-template>
        </p-dialog>
        
        <!-- Pillar Dialog -->
        <p-dialog header="Add World Pillar" [(visible)]="showPillarDialog" [modal]="true" [style]="{width: '30vw'}">
            <div class="flex flex-col gap-4 py-2">
                <div class="flex flex-col gap-2">
                    <label class="text-sm font-bold">Title</label>
                    <input pInputText [(ngModel)]="newPillar.title" placeholder="e.g. The Eternal Storm" class="w-full" />
                </div>
                <div class="flex flex-col gap-2">
                    <label class="text-sm font-bold">Icon (PrimeIcons)</label>
                    <input pInputText [(ngModel)]="newPillar.icon" placeholder="e.g. pi pi-stop" class="w-full" />
                </div>
                <div class="flex flex-col gap-2">
                    <label class="text-sm font-bold">Description</label>
                    <textarea pInputTextarea [(ngModel)]="newPillar.description" rows="3" class="w-full"></textarea>
                </div>
            </div>
            <ng-template pTemplate="footer">
                <button pButton label="Cancel" (click)="showPillarDialog = false" class="p-button-text"></button>
                <button pButton label="Save" (click)="savePillar()" class="p-button-primary"></button>
            </ng-template>
        </p-dialog>

        <!-- Delta Dialog -->
        <p-dialog header="Log Act Change (Delta)" [(visible)]="showDeltaDialog" [modal]="true" [style]="{width: '30vw'}">
             <div class="flex flex-col gap-4 py-2">
                <div class="flex flex-col gap-2">
                    <label class="text-sm font-bold">Type</label>
                    <div class="flex gap-2">
                        <div *ngFor="let t of ['new','changed','removed']" 
                             class="px-3 py-1 rounded border cursor-pointer capitalize"
                             [class.bg-teal-500]="newDelta.type == t"
                             [class.text-white]="newDelta.type == t"
                             (click)="newDelta.type = $any(t)">
                             {{t}}
                        </div>
                    </div>
                </div>
                <div class="flex flex-col gap-2">
                    <label class="text-sm font-bold">Title</label>
                    <input pInputText [(ngModel)]="newDelta.title" placeholder="What changed?" class="w-full" />
                </div>
                <div class="flex flex-col gap-2">
                    <label class="text-sm font-bold">Description</label>
                    <textarea pInputTextarea [(ngModel)]="newDelta.description" rows="3" class="w-full"></textarea>
                </div>
            </div>
            <ng-template pTemplate="footer">
                <button pButton label="Cancel" (click)="showDeltaDialog = false" class="p-button-text"></button>
                <button pButton label="Save" (click)="saveDelta()" class="p-button-primary"></button>
            </ng-template>
        </p-dialog>

    </div>
    `,
    styles: [`
        :host { display: block; height: 100%; }
        .custom-scrollbar::-webkit-scrollbar { width: 6px; }
        .custom-scrollbar::-webkit-scrollbar-track { background: transparent; }
        .custom-scrollbar::-webkit-scrollbar-thumb { background: rgba(155, 155, 155, 0.2); border-radius: 3px; }
        .custom-scrollbar::-webkit-scrollbar-thumb:hover { background: rgba(155, 155, 155, 0.4); }
    `]
})
export class WorldOverviewComponent {
    private scopeService = inject(ScopeService);
    private worldService = inject(WorldBuildingService);
    private folderService = inject(FolderService);

    // ===================================
    // DATA SOURCE
    // ===================================

    // 1. Current Narrative ID
    narrativeId = this.scopeService.activeNarrativeId;

    // 2. Available Acts
    actFolders = toSignal(
        toObservable(this.narrativeId).pipe(
            switchMap(nid => nid ? this.folderService.getFoldersByNarrative$(nid) : of([])),
            map(folders => (folders || []).filter(f => f.entityKind === 'ACT'))
        ),
        { initialValue: [] }
    );

    // 3. Selected Act ID (default to first one found)
    selectedActId = signal<string | null>(null);

    // Effect to select first act by default
    constructor() {
        effect(() => {
            const acts = this.actFolders();
            if (acts && acts.length > 0 && !this.selectedActId()) {
                this.selectedActId.set(acts[0].id);
            }
        });
    }

    currentActName = computed(() => {
        const id = this.selectedActId();
        const acts = this.actFolders();
        const found = acts?.find(a => a.id === id);
        return found ? found.name : '';
    });

    // 4. World Data (Global)
    worldData = toSignal(
        toObservable(this.narrativeId).pipe(
            switchMap(nid => nid ? this.worldService.getWorldData$(nid) : of(null))
        ),
        { initialValue: { snapshot: DEFAULT_SNAPSHOT, constraints: [], pillars: [], cultures: [], powerSystems: [], religions: [], mysteries: [], loreThreads: [] } }
    );

    // 5. Act Data (Scoped)
    actData = toSignal(
        toObservable(this.selectedActId).pipe(
            switchMap(aid => aid ? this.worldService.getActData$(aid) : of(null))
        ),
        { initialValue: { statusQuo: '', deltas: [], cultureOverrides: {}, powerProgression: {}, religionOverrides: {} } }
    );

    // ===================================
    // COMPUTED VIEW MODELS
    // ===================================
    snapshot = computed(() => this.worldData()?.snapshot || DEFAULT_SNAPSHOT);
    constraints = computed(() => this.worldData()?.constraints || []);
    pillars = computed(() => this.worldData()?.pillars || []);
    statusQuo = computed(() => this.actData()?.statusQuo || '');
    deltas = computed(() => this.actData()?.deltas || []);

    activeConstraintsCount = computed(() => this.constraints().filter(c => c.isActive).length);

    // ===================================
    // UI ACTIONS & STATE
    // ===================================

    // Snapshot
    showSnapshotDialog = false;
    editSnapshot: WorldSnapshot = { ...DEFAULT_SNAPSHOT };
    newToneTag = '';

    openSnapshotDialog() {
        const current = this.snapshot();
        // Deep copy safely
        this.editSnapshot = {
            logline: current.logline,
            description: current.description,
            tone: [...current.tone]
        };
        this.showSnapshotDialog = true;
    }

    addToneTag() {
        if (this.newToneTag.trim()) {
            this.editSnapshot.tone.push(this.newToneTag.trim());
            this.newToneTag = '';
        }
    }

    removeToneTag(tag: string) {
        this.editSnapshot.tone = this.editSnapshot.tone.filter(t => t !== tag);
    }

    async saveSnapshot() {
        const nid = this.narrativeId();
        if (nid) {
            await this.worldService.updateWorldData(nid, { snapshot: this.editSnapshot });
            this.showSnapshotDialog = false;
        }
    }

    // Constraints
    showConstraintDialog = false;
    newConstraintText = '';

    openConstraintDialog() {
        this.newConstraintText = '';
        this.showConstraintDialog = true;
    }

    async saveConstraint() {
        if (!this.newConstraintText.trim()) return;
        const nid = this.narrativeId();
        if (nid) {
            const newConstraints = [...this.constraints(), {
                id: this.worldService.generateId(),
                text: this.newConstraintText,
                isActive: true
            }];
            await this.worldService.updateWorldData(nid, { constraints: newConstraints });
            this.showConstraintDialog = false;
        }
    }

    async deleteConstraint(id: string) {
        const nid = this.narrativeId();
        if (nid) {
            const newConstraints = this.constraints().filter(c => c.id !== id);
            await this.worldService.updateWorldData(nid, { constraints: newConstraints });
        }
    }

    // Status Quo
    showStatusQuoDialog = false;
    editStatusQuo = '';

    openStatusQuoDialog() {
        this.editStatusQuo = this.statusQuo();
        this.showStatusQuoDialog = true;
    }

    async saveStatusQuo() {
        const aid = this.selectedActId();
        if (aid) {
            await this.worldService.updateActData(aid, { statusQuo: this.editStatusQuo });
            this.showStatusQuoDialog = false;
        }
    }

    // Deltas
    showDeltaDialog = false;
    newDelta: Omit<ActDelta, 'id'> = { title: '', description: '', type: 'changed' };

    openDeltaDialog() {
        this.newDelta = { title: '', description: '', type: 'changed' };
        this.showDeltaDialog = true;
    }

    async saveDelta() {
        const aid = this.selectedActId();
        if (aid && this.newDelta.title) {
            const delta: ActDelta = {
                id: this.worldService.generateId(),
                ...this.newDelta
            } as ActDelta;
            const newDeltas = [delta, ...this.deltas()]; // Prepend
            await this.worldService.updateActData(aid, { deltas: newDeltas });
            this.showDeltaDialog = false;
        }
    }

    async deleteDelta(id: string) {
        const aid = this.selectedActId();
        if (aid) {
            const newDeltas = this.deltas().filter(d => d.id !== id);
            await this.worldService.updateActData(aid, { deltas: newDeltas });
        }
    }

    // Pillars
    showPillarDialog = false;
    newPillar: Omit<WorldPillar, 'id'> = { title: '', description: '', icon: '' };

    openPillarDialog() {
        this.newPillar = { title: '', description: '', icon: 'pi pi-bolt' };
        this.showPillarDialog = true;
    }

    async savePillar() {
        const nid = this.narrativeId();
        if (nid && this.newPillar.title) {
            const pillar: WorldPillar = {
                id: this.worldService.generateId(),
                ...this.newPillar
            } as WorldPillar;
            const newPillars = [...this.pillars(), pillar];
            await this.worldService.updateWorldData(nid, { pillars: newPillars });
            this.showPillarDialog = false;
        }
    }

    async deletePillar(id: string) {
        const nid = this.narrativeId();
        if (nid) {
            const newPillars = this.pillars().filter(p => p.id !== id);
            await this.worldService.updateWorldData(nid, { pillars: newPillars });
        }
    }

    // Helpers
    cycleActs() {
        const acts = this.actFolders();
        const current = this.selectedActId();
        if (!acts || acts.length === 0) return;

        const idx = acts.findIndex(a => a.id === current);
        const nextIdx = (idx + 1) % acts.length;
        this.selectedActId.set(acts[nextIdx].id);
    }
}
