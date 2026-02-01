
import { Component, computed, inject, signal, effect } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ButtonModule } from 'primeng/button';
import { DialogModule } from 'primeng/dialog';
import { InputTextModule } from 'primeng/inputtext';
import { TextareaModule } from 'primeng/textarea';
import { TooltipModule } from 'primeng/tooltip';
import { TagModule } from 'primeng/tag';
import { AccordionModule } from 'primeng/accordion';
import { AvatarModule } from 'primeng/avatar';
import { ChipModule } from 'primeng/chip';

import { ScopeService } from '../../../../../lib/services/scope.service';
import { WorldBuildingService, Culture, CultureOverride } from '../../../../../lib/services/world-building.service';
import { FolderService } from '../../../../../lib/services/folder.service';
import { toSignal, toObservable } from '@angular/core/rxjs-interop';
import { map, switchMap, of } from 'rxjs';

/**
 * CulturesTab
 * Two-pane layout: Quick List (Left) + Detailed Editor (Right).
 * Highlights: Act-scoped status overrides & rich modular fields.
 */
@Component({
    selector: 'app-cultures',
    standalone: true,
    imports: [
        CommonModule,
        FormsModule,
        ButtonModule,
        DialogModule,
        InputTextModule,
        TextareaModule,
        TooltipModule,
        TagModule,
        AccordionModule,
        AvatarModule,
        ChipModule
    ],
    template: `
    <div class="flex h-full bg-zinc-50 dark:bg-zinc-950 text-zinc-800 dark:text-zinc-300 font-sans selection:bg-teal-500/30 selection:text-teal-700 dark:selection:text-teal-200">
        
        <!-- SIDEBAR (List) -->
        <div class="w-80 border-r border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 flex flex-col shrink-0">
            <!-- Header -->
            <div class="p-4 border-b border-zinc-200 dark:border-zinc-800 flex items-center justify-between">
                <h2 class="text-sm font-bold uppercase tracking-widest text-zinc-500">Cultures</h2>
                <button (click)="createNewCulture()" [disabled]="!isValidNarrative()" 
                        class="w-7 h-7 flex items-center justify-center rounded-full hover:bg-zinc-100 dark:hover:bg-zinc-800 text-teal-600 transition-colors disabled:opacity-50 disabled:cursor-not-allowed">
                    <i class="pi pi-plus text-xs"></i>
                </button>
            </div>

            <!-- List -->
            <div class="flex-1 overflow-y-auto p-2 space-y-1 custom-scrollbar">
                
                <div *ngIf="!isValidNarrative()" class="p-4 text-center text-zinc-500 text-sm italic">
                    Select a narrative to view cultures.
                </div>

                <div *ngFor="let culture of cultures()" 
                     (click)="selectCulture(culture)"
                     class="group flex items-center gap-3 p-3 rounded-xl cursor-pointer transition-all border border-transparent"
                     [ngClass]="{
                        'bg-teal-50 dark:bg-teal-500/10 border-teal-200 dark:border-teal-500/20 shadow-sm': selectedCultureId() === culture.id,
                        'hover:bg-zinc-100 dark:hover:bg-zinc-800/50': selectedCultureId() !== culture.id
                     }">
                    
                    <div class="w-10 h-10 rounded-full flex items-center justify-center text-lg bg-zinc-100 dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700 transition-colors"
                         [style.border-color]="selectedCultureId() === culture.id ? culture.color : ''"
                         [style.color]="selectedCultureId() === culture.id ? culture.color : ''">
                        {{ culture.icon }}
                    </div>
                    
                    <div class="flex-1 min-w-0">
                        <h3 class="text-sm font-bold text-zinc-900 dark:text-zinc-100 truncate group-hover:text-teal-600 dark:group-hover:text-teal-400 transition-colors"
                            [ngClass]="{'text-teal-700 dark:text-teal-300': selectedCultureId() === culture.id}">
                            {{ culture.name }}
                        </h3>
                         <!-- Show Act Status if available -->
                        <div class="text-[10px] uppercase font-bold tracking-wider mt-0.5"
                             [ngClass]="getStatusColor(getOverride(culture.id)?.status)">
                            {{ getOverride(culture.id)?.status || 'Stable' }}
                        </div>
                    </div>
                </div>
            </div>
        </div>

        <!-- MAIN (Detail) -->
        <div class="flex-1 flex flex-col overflow-hidden relative">
            
            <div *ngIf="isValidNarrative() && selectedCulture(); else emptyState" class="flex flex-col h-full">

                <!-- Header Banner -->
                <div class="px-8 py-6 border-b border-zinc-200 dark:border-zinc-800 bg-white/80 dark:bg-zinc-900/80 backdrop-blur sticky top-0 z-10">
                    <div class="flex items-start justify-between">
                        <div class="flex items-center gap-4">
                            <div class="w-16 h-16 rounded-2xl flex items-center justify-center text-3xl shadow-lg border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-800"
                                  [style.color]="selectedCulture()!.color">
                                {{ selectedCulture()!.icon }}
                            </div>
                            <div>
                                <h1 class="text-3xl font-bold font-serif text-zinc-900 dark:text-white mb-1 flex items-center gap-2">
                                    {{ selectedCulture()!.name }}
                                    <button class="text-zinc-300 hover:text-zinc-500 dark:hover:text-zinc-400 text-sm transition-colors" (click)="openEditMeta()">
                                        <i class="pi pi-pencil"></i>
                                    </button>
                                </h1>
                                <!-- Act Selector / Context -->
                                <div class="flex items-center gap-2 text-sm text-zinc-500">
                                    <span class="bg-zinc-100 dark:bg-zinc-800 px-2 py-0.5 rounded text-xs">
                                        {{ currentActName() || 'Global Context' }}
                                    </span>
                                </div>
                            </div>
                        </div>

                        <!-- Act Status Override Control -->
                        <div class="flex flex-col items-end gap-2">
                            <span class="text-[10px] uppercase tracking-widest text-zinc-400 font-bold">Current Status</span>
                            <div class="relative group cursor-pointer" (click)="openOverrideDialog()">
                                <div class="px-3 py-1.5 rounded-lg border flex items-center gap-2 font-bold text-xs uppercase tracking-wide transition-all shadow-sm group-hover:shadow-md bg-white dark:bg-zinc-900"
                                     [ngClass]="getStatusBorder(getOverride(selectedCulture()!.id)?.status)">
                                    <i class="pi pi-circle-fill text-[8px]" [ngClass]="getStatusText(getOverride(selectedCulture()!.id)?.status)"></i>
                                    <span [ngClass]="getStatusText(getOverride(selectedCulture()!.id)?.status)">
                                        {{ getOverride(selectedCulture()!.id)?.status || 'Stable' }}
                                    </span>
                                    <i class="pi pi-chevron-down text-[10px] opacity-50 ml-1"></i>
                                </div>
                                <div class="absolute right-0 top-full mt-2 w-64 bg-white dark:bg-zinc-900 p-3 rounded-lg shadow-xl border border-zinc-200 dark:border-zinc-800 z-20 hidden group-hover:block animate-fade-in pointer-events-none">
                                    <p class="text-xs text-zinc-500 italic">
                                        {{ getOverride(selectedCulture()!.id)?.changelog || 'No recent changes reported.' }}
                                    </p>
                                </div>
                            </div>
                        </div>
                    </div>
                </div>

                <!-- Scrollable Content -->
                <div class="flex-1 overflow-y-auto p-8 custom-scrollbar">
                    <div class="max-w-5xl mx-auto space-y-8">

                        <!-- Module 1: Identity -->
                        <div class="grid grid-cols-1 md:grid-cols-2 gap-8">
                            <section class="bg-white dark:bg-zinc-900/50 rounded-xl border border-zinc-200 dark:border-zinc-800 p-6 shadow-sm hover:shadow-md transition-shadow">
                                <h3 class="text-sm font-bold uppercase tracking-widest text-zinc-500 mb-4 flex justify-between items-center">
                                    Identity & Values
                                    <button class="text-teal-600 hover:text-teal-500" (click)="editModule('identity')"><i class="pi pi-pencil"></i></button>
                                </h3>
                                
                                <div class="space-y-4">
                                    <div>
                                        <label class="text-xs font-semibold text-zinc-400">Core Values</label>
                                        <div class="flex flex-wrap gap-2 mt-1">
                                            <span *ngFor="let v of selectedCulture()!.identity.values" class="px-2 py-1 bg-zinc-100 dark:bg-zinc-800 text-zinc-600 dark:text-zinc-300 rounded text-xs font-medium border border-zinc-200 dark:border-zinc-700">
                                                {{v}}
                                            </span>
                                        </div>
                                    </div>
                                    <div class="grid grid-cols-2 gap-4">
                                        <div>
                                            <label class="text-xs font-semibold text-green-600/70 dark:text-green-500/70">Virtues (Admired)</label>
                                            <ul class="mt-1 space-y-1">
                                                <li *ngFor="let v of selectedCulture()!.identity.virtues" class="text-sm text-zinc-600 dark:text-zinc-300 flex items-center gap-2">
                                                    <i class="pi pi-check text-[10px] text-green-500"></i> {{v}}
                                                </li>
                                            </ul>
                                        </div>
                                        <div>
                                            <label class="text-xs font-semibold text-red-600/70 dark:text-red-500/70">Vices (Shamed)</label>
                                            <ul class="mt-1 space-y-1">
                                                <li *ngFor="let v of selectedCulture()!.identity.vices" class="text-sm text-zinc-600 dark:text-zinc-300 flex items-center gap-2">
                                                    <i class="pi pi-times text-[10px] text-red-500"></i> {{v}}
                                                </li>
                                            </ul>
                                        </div>
                                    </div>
                                </div>
                            </section>

                            <!-- Module 2: Social Structure -->
                            <section class="bg-white dark:bg-zinc-900/50 rounded-xl border border-zinc-200 dark:border-zinc-800 p-6 shadow-sm hover:shadow-md transition-shadow">
                                <h3 class="text-sm font-bold uppercase tracking-widest text-zinc-500 mb-4 flex justify-between items-center">
                                    Social Structure
                                    <button class="text-teal-600 hover:text-teal-500" (click)="editModule('structure')"><i class="pi pi-pencil"></i></button>
                                </h3>
                                <div class="space-y-4">
                                    <div class="group/item">
                                        <label class="text-xs font-semibold text-zinc-400 group-hover/item:text-teal-500 transition-colors">Hierarchy</label>
                                        <p class="text-sm text-zinc-700 dark:text-zinc-300 mt-0.5 leading-relaxed">{{ selectedCulture()!.structure.hierarchy }}</p>
                                    </div>
                                    <div class="group/item">
                                        <label class="text-xs font-semibold text-zinc-400 group-hover/item:text-teal-500 transition-colors">Family Unit</label>
                                        <p class="text-sm text-zinc-700 dark:text-zinc-300 mt-0.5 leading-relaxed">{{ selectedCulture()!.structure.family }}</p>
                                    </div>
                                </div>
                            </section>
                        </div>

                        <!-- Module 3: Customs & Taboos -->
                         <section class="bg-white dark:bg-zinc-900/50 rounded-xl border border-zinc-200 dark:border-zinc-800 p-6 shadow-sm hover:shadow-md transition-shadow">
                                <h3 class="text-sm font-bold uppercase tracking-widest text-zinc-500 mb-4 flex justify-between items-center">
                                    Customs & Rituals
                                    <button class="text-teal-600 hover:text-teal-500" (click)="editModule('customs')"><i class="pi pi-pencil"></i></button>
                                </h3>
                                <div class="grid grid-cols-1 md:grid-cols-3 gap-6">
                                    <div class="p-4 rounded-lg bg-zinc-50 dark:bg-zinc-950/50 border border-zinc-100 dark:border-zinc-800">
                                        <div class="flex items-center gap-2 mb-2 text-teal-700 dark:text-teal-400 font-semibold text-sm">
                                            <i class="pi pi-comments"></i> Greetings
                                        </div>
                                        <p class="text-sm text-zinc-600 dark:text-zinc-400 font-light">{{ selectedCulture()!.customs.greetings }}</p>
                                    </div>
                                    <div class="p-4 rounded-lg bg-zinc-50 dark:bg-zinc-950/50 border border-zinc-100 dark:border-zinc-800">
                                        <div class="flex items-center gap-2 mb-2 text-indigo-700 dark:text-indigo-400 font-semibold text-sm">
                                            <i class="pi pi-calendar"></i> Rituals
                                        </div>
                                        <p class="text-sm text-zinc-600 dark:text-zinc-400 font-light">{{ selectedCulture()!.customs.rituals }}</p>
                                    </div>
                                    <div class="p-4 rounded-lg bg-red-50 dark:bg-red-950/10 border border-red-100 dark:border-red-900/20">
                                        <div class="flex items-center gap-2 mb-2 text-red-700 dark:text-red-400 font-semibold text-sm">
                                            <i class="pi pi-ban"></i> Taboos
                                        </div>
                                        <div class="flex flex-wrap gap-2">
                                            <span *ngFor="let t of selectedCulture()!.customs.taboos" class="px-2 py-0.5 bg-white dark:bg-red-900/20 text-red-600 dark:text-red-300 rounded text-xs border border-red-200 dark:border-red-800">
                                                {{t}}
                                            </span>
                                        </div>
                                    </div>
                                </div>
                        </section>

                        <!-- Module 4: Story Hooks (Scene Fuel) -->
                        <section>
                            <h3 class="text-lg font-bold text-zinc-900 dark:text-white mb-4 flex items-center gap-2">
                                <i class="pi pi-bolt text-teal-500"></i> Scene Fuel (Story Hooks)
                                <div class="h-px bg-zinc-200 dark:bg-zinc-800 flex-1 ml-4 shadow-[0_1px_0_white] dark:shadow-none"></div>
                                <button class="text-xs font-semibold text-teal-600 uppercase tracking-widest hover:underline" (click)="editModule('hooks')">Edit</button>
                            </h3>
                            
                            <div class="grid grid-cols-1 md:grid-cols-3 gap-6">
                                <!-- Misunderstandings -->
                                <div class="group relative">
                                    <div class="absolute -left-3 top-0 bottom-0 w-1 bg-gradient-to-b from-amber-400 to-transparent rounded-full opacity-0 group-hover:opacity-100 transition-opacity"></div>
                                    <h4 class="text-sm font-bold text-zinc-900 dark:text-zinc-100 mb-2">Common Misunderstandings</h4>
                                    <ul class="space-y-2">
                                        <li *ngFor="let h of selectedCulture()!.hooks.misunderstandings" class="text-sm text-zinc-600 dark:text-zinc-400 pl-4 relative before:content-['•'] before:absolute before:left-0 before:text-zinc-300">
                                            {{h}}
                                        </li>
                                    </ul>
                                </div>
                                <!-- Interruptible Rituals -->
                                <div class="group relative">
                                    <div class="absolute -left-3 top-0 bottom-0 w-1 bg-gradient-to-b from-teal-400 to-transparent rounded-full opacity-0 group-hover:opacity-100 transition-opacity"></div>
                                    <h4 class="text-sm font-bold text-zinc-900 dark:text-zinc-100 mb-2">Interruptible Rituals</h4>
                                    <ul class="space-y-2">
                                        <li *ngFor="let h of selectedCulture()!.hooks.rituals" class="text-sm text-zinc-600 dark:text-zinc-400 pl-4 relative before:content-['•'] before:absolute before:left-0 before:text-zinc-300">
                                            {{h}}
                                        </li>
                                    </ul>
                                </div>
                                <!-- Obligations -->
                                <div class="group relative">
                                    <div class="absolute -left-3 top-0 bottom-0 w-1 bg-gradient-to-b from-purple-400 to-transparent rounded-full opacity-0 group-hover:opacity-100 transition-opacity"></div>
                                    <h4 class="text-sm font-bold text-zinc-900 dark:text-zinc-100 mb-2">Deadly Obligations</h4>
                                    <ul class="space-y-2">
                                        <li *ngFor="let h of selectedCulture()!.hooks.obligations" class="text-sm text-zinc-600 dark:text-zinc-400 pl-4 relative before:content-['•'] before:absolute before:left-0 before:text-zinc-300">
                                            {{h}}
                                        </li>
                                    </ul>
                                </div>
                            </div>
                        </section>

                    </div>
                </div>

            </div>

            <!-- Empty State -->
            <ng-template #emptyState>
                <div class="flex flex-col items-center justify-center h-full text-zinc-400 animate-fade-in pb-20">
                    <div class="w-24 h-24 rounded-full bg-zinc-100 dark:bg-zinc-800/50 flex items-center justify-center mb-6 border border-zinc-200 dark:border-zinc-800">
                        <i class="pi" [ngClass]="isValidNarrative() ? 'pi-users' : 'pi-globe'"></i>
                    </div>
                    
                    <ng-container *ngIf="isValidNarrative(); else globalState">
                        <h3 class="text-lg font-medium text-zinc-600 dark:text-zinc-300">No Culture Selected</h3>
                        <p class="max-w-xs text-center mt-2 text-sm leading-relaxed">Select a culture from the index or create a new one to define the societies of your world.</p>
                        <button (click)="createNewCulture()" class="mt-6 px-6 py-2 bg-teal-600 hover:bg-teal-700 text-white rounded-full text-sm font-semibold transition-all shadow-lg shadow-teal-900/20">
                            Create Culture
                        </button>
                    </ng-container>

                    <ng-template #globalState>
                        <h3 class="text-lg font-medium text-zinc-600 dark:text-zinc-300">Global Overview</h3>
                        <p class="max-w-xs text-center mt-2 text-sm leading-relaxed">
                            You are currently in the <strong>Global Vault Scope</strong>. <br/>
                            Worldbuilding requires a specific Narrative context.
                        </p>
                    </ng-template>

                </div>
            </ng-template>

        </div>

        <!-- DIALOGS -->
        
        <!-- Create/Edit Meta Dialog -->
        <p-dialog header="{{ isCreating ? 'New Culture' : 'Edit Culture' }}" [(visible)]="showMetaDialog" [modal]="true" [style]="{width: '30vw'}">
            <div class="flex flex-col gap-4 py-2">
                <div class="flex flex-col gap-2">
                    <label class="text-sm font-bold">Name</label>
                    <input pInputText [(ngModel)]="tempCulture.name" placeholder="E.g. The Iron-Bound" />
                </div>
                <div class="grid grid-cols-2 gap-4">
                     <div class="flex flex-col gap-2">
                        <label class="text-sm font-bold">Icon</label>
                        <input pInputText [(ngModel)]="tempCulture.icon" placeholder="Emoji or Icon" />
                    </div>
                    <div class="flex flex-col gap-2">
                        <label class="text-sm font-bold">Color</label>
                        <input pInputText type="color" [(ngModel)]="tempCulture.color" class="w-full h-9 p-1" />
                    </div>
                </div>
            </div>
            <ng-template pTemplate="footer">
                <button pButton label="Cancel" (click)="showMetaDialog = false" class="p-button-text"></button>
                <button pButton label="Save" (click)="saveMeta()" class="p-button-primary"></button>
            </ng-template>
        </p-dialog>
        
        <!-- Generic Edit Module Dialog (Dynamic content would be better, but keeping it simple for now) -->
         <p-dialog [header]="'Edit ' + activeEditModule" [(visible)]="showModuleDialog" [modal]="true" [style]="{width: '50vw'}">
             <!-- Dnamically render fields based on activeEditModule -->
             <!-- Simplified for Prototype: Just JSON TextAreas or specific fields based on switch -->
             <div class="py-2" [ngSwitch]="activeEditModule">
                
                <div *ngSwitchCase="'identity'" class="space-y-4">
                    <div class="flex flex-col gap-2">
                        <label class="text-sm font-bold">Values (comma sep)</label>
                        <input pInputText [(ngModel)]="tempIdentityValues" placeholder="Honor, Strength, etc." />
                    </div>
                     <div class="flex flex-col gap-2">
                        <label class="text-sm font-bold">Virtues (comma sep)</label>
                         <input pInputText [(ngModel)]="tempIdentityVirtues" />
                    </div>
                     <div class="flex flex-col gap-2">
                        <label class="text-sm font-bold">Vices (comma sep)</label>
                        <input pInputText [(ngModel)]="tempIdentityVices" />
                    </div>
                </div>

                <div *ngSwitchCase="'structure'" class="space-y-4">
                    <div class="flex flex-col gap-2">
                        <label class="text-sm font-bold">Hierarchy</label>
                        <textarea pInputTextarea [(ngModel)]="tempCulture.structure.hierarchy" rows="3"></textarea>
                    </div>
                    <div class="flex flex-col gap-2">
                        <label class="text-sm font-bold">Family Unit</label>
                        <textarea pInputTextarea [(ngModel)]="tempCulture.structure.family" rows="2"></textarea>
                    </div>
                </div>

                 <div *ngSwitchCase="'customs'" class="space-y-4">
                    <div class="flex flex-col gap-2">
                        <label class="text-sm font-bold">Greetings</label>
                        <textarea pInputTextarea [(ngModel)]="tempCulture.customs.greetings" rows="2"></textarea>
                    </div>
                    <div class="flex flex-col gap-2">
                        <label class="text-sm font-bold">Rituals</label>
                        <textarea pInputTextarea [(ngModel)]="tempCulture.customs.rituals" rows="3"></textarea>
                    </div>
                     <div class="flex flex-col gap-2">
                        <label class="text-sm font-bold">Taboos (comma sep)</label>
                        <input pInputText [(ngModel)]="tempCustomsTaboos" />
                    </div>
                </div>
                 
                 <div *ngSwitchCase="'hooks'" class="space-y-4">
                     <p class="text-xs text-zinc-500 mb-2">Separate items with newlines</p>
                    <div class="flex flex-col gap-2">
                        <label class="text-sm font-bold">Misunderstandings</label>
                        <textarea pInputTextarea [(ngModel)]="tempHooksMisunderstandings" rows="3"></textarea>
                    </div>
                    <div class="flex flex-col gap-2">
                        <label class="text-sm font-bold">Interruptible Rituals</label>
                        <textarea pInputTextarea [(ngModel)]="tempHooksRituals" rows="3"></textarea>
                    </div>
                     <div class="flex flex-col gap-2">
                        <label class="text-sm font-bold">Deadly Obligations</label>
                         <textarea pInputTextarea [(ngModel)]="tempHooksObligations" rows="3"></textarea>
                    </div>
                </div>

             </div>
             <ng-template pTemplate="footer">
                <button pButton label="Cancel" (click)="showModuleDialog = false" class="p-button-text"></button>
                <button pButton label="Save" (click)="saveModule()" class="p-button-primary"></button>
            </ng-template>
        </p-dialog>
        
        <!-- Override Dialog -->
        <p-dialog header="Update Act Status" [(visible)]="showOverrideDialog" [modal]="true" [style]="{width: '30vw'}">
            <div class="flex flex-col gap-4 py-2">
                 <div class="flex flex-col gap-2">
                    <label class="text-sm font-bold">Status</label>
                     <div class="flex flex-wrap gap-2">
                        <div *ngFor="let s of ['Stable','Reforming','Fragmenting','Occupied','Extinct']" 
                             class="px-3 py-1 rounded border cursor-pointer border-zinc-200 dark:border-zinc-700 hover:bg-zinc-100"
                             [ngClass]="{'bg-teal-500 text-white border-teal-600': tempOverride.status === s}"
                             (click)="tempOverride.status = $any(s)">
                             {{s}}
                        </div>
                    </div>
                </div>
                <div class="flex flex-col gap-2">
                    <label class="text-sm font-bold">What Changed?</label>
                    <textarea pInputTextarea [(ngModel)]="tempOverride.changelog" rows="4" placeholder="Since the last act, the guild has collapsed..."></textarea>
                </div>
            </div>
             <ng-template pTemplate="footer">
                <button pButton label="Cancel" (click)="showOverrideDialog = false" class="p-button-text"></button>
                <button pButton label="Save" (click)="saveOverride()" class="p-button-primary"></button>
            </ng-template>
        </p-dialog>

    </div>
    `,
    styles: [`
        :host { display: block; height: 100%; }
        .custom-scrollbar::-webkit-scrollbar { width: 4px; }
        .custom-scrollbar::-webkit-scrollbar-track { background: transparent; }
        .custom-scrollbar::-webkit-scrollbar-thumb { background: rgba(155, 155, 155, 0.2); border-radius: 2px; }
        .custom-scrollbar::-webkit-scrollbar-thumb:hover { background: rgba(155, 155, 155, 0.4); }
    `]
})
export class CulturesComponent {
    private scopeService = inject(ScopeService);
    private worldService = inject(WorldBuildingService);
    private folderService = inject(FolderService);

    // =============================
    // DATA SOURCE
    // =============================
    narrativeId = this.scopeService.activeNarrativeId;

    // Check if we are in a valid narrative scope
    isValidNarrative = computed(() => {
        const id = this.narrativeId();
        return id && id !== 'vault:global';
    });

    // Available Acts
    actFolders = toSignal(
        toObservable(this.narrativeId).pipe(
            // Guard: Only fetch acts if we have a valid narrative
            switchMap(nid => (nid && nid !== 'vault:global') ? this.folderService.getFoldersByNarrative$(nid) : of([])),
            map(folders => (folders || []).filter(f => f.entityKind === 'ACT'))
        ),
        { initialValue: [] }
    );
    // Auto-select first act
    constructor() {
        effect(() => {
            const acts = this.actFolders();
            if (acts && acts.length > 0 && !this.selectedActId()) {
                this.selectedActId.set(acts[0].id);
            }
        });
    }

    selectedActId = signal<string | null>(null);
    currentActName = computed(() => {
        const id = this.selectedActId();
        const acts = this.actFolders();
        return acts?.find(a => a.id === id)?.name || '';
    });

    // Cultures List
    cultures = toSignal(
        toObservable(this.narrativeId).pipe(
            switchMap(nid => (nid && nid !== 'vault:global') ? this.worldService.getCultures$(nid) : of([]))
        ),
        { initialValue: [] }
    );

    // Overrides for Current Act
    overrides = toSignal(
        toObservable(this.selectedActId).pipe(
            switchMap(aid => (aid) ? this.worldService.getActCultureOverrides$(aid) : of({} as Record<string, CultureOverride>))
        ),
        { initialValue: {} as Record<string, CultureOverride> }
    );

    // Selection State
    selectedCultureId = signal<string | null>(null);
    selectedCulture = computed(() =>
        this.cultures().find(c => c.id === this.selectedCultureId())
    );

    // Helpers
    getOverride(cultureId: string | undefined): CultureOverride | undefined {
        if (!cultureId) return undefined;
        return this.overrides()?.[cultureId];
    }

    getStatusColor(status: string | undefined): string {
        switch (status) {
            case 'Stable': return 'text-green-600 dark:text-green-400';
            case 'Reforming': return 'text-teal-600 dark:text-teal-400';
            case 'Fragmenting': return 'text-amber-600 dark:text-amber-400';
            case 'Occupied': return 'text-red-600 dark:text-red-400';
            case 'Extinct': return 'text-zinc-400';
            default: return 'text-zinc-400';
        }
    }

    getStatusText(status: string | undefined): string {
        switch (status) {
            case 'Stable': return 'text-green-700 dark:text-green-300';
            case 'Reforming': return 'text-teal-700 dark:text-teal-300';
            case 'Fragmenting': return 'text-amber-700 dark:text-amber-300';
            case 'Occupied': return 'text-red-700 dark:text-red-300';
            case 'Extinct': return 'text-zinc-500';
            default: return 'text-zinc-500';
        }
    }

    getStatusBorder(status: string | undefined): string {
        switch (status) {
            case 'Stable': return 'border-green-200 dark:border-green-800 bg-green-50 dark:bg-green-900/10';
            case 'Reforming': return 'border-teal-200 dark:border-teal-800 bg-teal-50 dark:bg-teal-900/10';
            case 'Fragmenting': return 'border-amber-200 dark:border-amber-800 bg-amber-50 dark:bg-amber-900/10';
            case 'Occupied': return 'border-red-200 dark:border-red-800 bg-red-50 dark:bg-red-900/10';
            case 'Extinct': return 'border-zinc-200 dark:border-zinc-800 bg-zinc-50 dark:bg-zinc-900/10';
            default: return 'border-zinc-200 dark:border-zinc-800';
        }
    }

    // =============================
    // ACTIONS
    // =============================

    selectCulture(c: Culture) {
        this.selectedCultureId.set(c.id);
    }

    // Meta Dialog (Create/Edit Identity)
    showMetaDialog = false;
    isCreating = false;
    tempCulture: Culture = this.getEmptyCulture();

    getEmptyCulture(): Culture {
        return {
            id: '',
            name: '',
            icon: '🌍',
            color: '#14b8a6',
            identity: { values: [], virtues: [], vices: [] },
            structure: { hierarchy: '', family: '', gender: '' },
            customs: { greetings: '', rituals: '', taboos: [] },
            language: { name: '', description: '' },
            hooks: { misunderstandings: [], rituals: [], obligations: [] }
        };
    }

    createNewCulture() {
        this.isCreating = true;
        this.tempCulture = this.getEmptyCulture();
        this.showMetaDialog = true;
    }

    openEditMeta() {
        const c = this.selectedCulture();
        if (!c) return;
        this.isCreating = false;
        this.tempCulture = JSON.parse(JSON.stringify(c));
        this.showMetaDialog = true;
    }

    async saveMeta() {
        const nid = this.narrativeId();
        if (!nid || nid === 'vault:global') return; // Valid check

        let list = [...this.cultures()];

        if (this.isCreating) {
            this.tempCulture.id = this.worldService.generateId();
            list.push(this.tempCulture);
            this.selectedCultureId.set(this.tempCulture.id);
        } else {
            const idx = list.findIndex(c => c.id === this.tempCulture.id);
            if (idx > -1) list[idx] = this.tempCulture;
        }

        await this.worldService.updateCultures(nid, list);
        this.showMetaDialog = false;
    }

    // Module Dialog
    showModuleDialog = false;
    activeEditModule: 'identity' | 'structure' | 'customs' | 'hooks' = 'identity';

    // Temp fields for comma-sep strings or textareas
    tempIdentityValues = '';
    tempIdentityVirtues = '';
    tempIdentityVices = '';
    tempCustomsTaboos = '';
    tempHooksMisunderstandings = '';
    tempHooksRituals = '';
    tempHooksObligations = '';

    editModule(module: 'identity' | 'structure' | 'customs' | 'hooks') {
        const c = this.selectedCulture();
        if (!c) return;

        this.activeEditModule = module;
        this.tempCulture = JSON.parse(JSON.stringify(c)); // Working copy

        // Hydrate flat fields
        if (module === 'identity') {
            this.tempIdentityValues = this.tempCulture.identity.values.join(', ');
            this.tempIdentityVirtues = this.tempCulture.identity.virtues.join(', ');
            this.tempIdentityVices = this.tempCulture.identity.vices.join(', ');
        }
        if (module === 'customs') {
            this.tempCustomsTaboos = this.tempCulture.customs.taboos.join(', ');
        }
        if (module === 'hooks') {
            this.tempHooksMisunderstandings = this.tempCulture.hooks.misunderstandings.join('\\n');
            this.tempHooksRituals = this.tempCulture.hooks.rituals.join('\\n');
            this.tempHooksObligations = this.tempCulture.hooks.obligations.join('\\n');
        }

        this.showModuleDialog = true;
    }

    async saveModule() {
        const nid = this.narrativeId();
        if (!nid || nid === 'vault:global') return;

        // Dehydrate flat fields back to arrays
        if (this.activeEditModule === 'identity') {
            this.tempCulture.identity.values = this.tempIdentityValues.split(',').map(s => s.trim()).filter(s => !!s);
            this.tempCulture.identity.virtues = this.tempIdentityVirtues.split(',').map(s => s.trim()).filter(s => !!s);
            this.tempCulture.identity.vices = this.tempIdentityVices.split(',').map(s => s.trim()).filter(s => !!s);
        }
        if (this.activeEditModule === 'customs') {
            this.tempCulture.customs.taboos = this.tempCustomsTaboos.split(',').map(s => s.trim()).filter(s => !!s);
        }
        if (this.activeEditModule === 'hooks') {
            this.tempCulture.hooks.misunderstandings = this.tempHooksMisunderstandings.split('\\n').map(s => s.trim()).filter(s => !!s);
            this.tempCulture.hooks.rituals = this.tempHooksRituals.split('\\n').map(s => s.trim()).filter(s => !!s);
            this.tempCulture.hooks.obligations = this.tempHooksObligations.split('\\n').map(s => s.trim()).filter(s => !!s);
        }

        const list = [...this.cultures()];
        const idx = list.findIndex(c => c.id === this.tempCulture.id);
        if (idx > -1) list[idx] = this.tempCulture;

        await this.worldService.updateCultures(nid, list);
        this.showModuleDialog = false;
    }

    // Override Dialog
    showOverrideDialog = false;
    tempOverride: CultureOverride = { status: 'Stable', changelog: '' };

    openOverrideDialog() {
        const c = this.selectedCulture();
        if (!c) return;
        const current = this.getOverride(c.id);
        this.tempOverride = current ? { ...current } : { status: 'Stable', changelog: '' };
        this.showOverrideDialog = true;
    }

    async saveOverride() {
        const aid = this.selectedActId();
        const cid = this.selectedCultureId();
        if (!aid || !cid) return;

        const overrides = { ...this.overrides() };
        overrides[cid] = this.tempOverride;

        await this.worldService.updateActCultureOverrides(aid, overrides);
        this.showOverrideDialog = false;
    }

}
