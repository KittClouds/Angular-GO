
import { Component, computed, inject, signal, effect } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ButtonModule } from 'primeng/button';
import { DialogModule } from 'primeng/dialog';
import { InputTextModule } from 'primeng/inputtext';
import { TextareaModule } from 'primeng/textarea';
import { AccordionModule } from 'primeng/accordion';
import { ChipModule } from 'primeng/chip';
import { SelectButtonModule } from 'primeng/selectbutton';
import { TagModule } from 'primeng/tag';

import { ScopeService, ActiveScope } from '../../../../../lib/services/scope.service';
import { WorldBuildingService, Religion, ReligionOverride, Deity, MythBlock, Sect } from '../../../../../lib/services/world-building.service';
import { FolderService } from '../../../../../lib/services/folder.service';
import { toSignal, toObservable } from '@angular/core/rxjs-interop';
import { map, switchMap, of, from } from 'rxjs';
import { db } from '../../../../../lib/dexie/db';

/**
 * ReligionComponent
 * Tracks myths, beliefs, institutions, and schisms across Acts.
 */
@Component({
  selector: 'app-religion',
  standalone: true,
  imports: [
    CommonModule,
    FormsModule,
    ButtonModule,
    DialogModule,
    InputTextModule,
    TextareaModule,
    TextareaModule,
    AccordionModule,
    ChipModule,
    SelectButtonModule,
    TagModule
  ],
  template: `
    <div class="flex h-full bg-zinc-50 dark:bg-zinc-950 text-zinc-800 dark:text-zinc-300 font-sans selection:bg-purple-500/30 selection:text-purple-700 dark:selection:text-purple-200">
        
        <!-- SIDEBAR (Faiths List) -->
        <div class="w-72 border-r border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 flex flex-col shrink-0">
            <!-- Header -->
            <div class="p-4 border-b border-zinc-200 dark:border-zinc-800 flex items-center justify-between">
                <h2 class="text-sm font-bold uppercase tracking-widest text-zinc-500">Religions</h2>
                <button (click)="createReligion()" [disabled]="!isValidNarrative()" 
                        class="w-7 h-7 flex items-center justify-center rounded-full hover:bg-zinc-100 dark:hover:bg-zinc-800 text-purple-600 transition-colors disabled:opacity-50">
                    <i class="pi pi-plus text-xs"></i>
                </button>
            </div>

            <!-- List -->
            <div class="flex-1 overflow-y-auto p-2 space-y-1 custom-scrollbar">
                
                <div *ngIf="!isValidNarrative()" class="p-4 text-center text-zinc-500 text-sm italic">
                    Select a narrative to view religions.
                </div>

                <div *ngIf="isValidNarrative() && religions().length === 0" class="p-4 text-center text-zinc-400 text-sm italic">
                    No faiths defined yet.
                </div>

                <div *ngFor="let rel of religions()" 
                     (click)="selectReligion(rel)"
                     class="group flex items-center gap-3 p-3 rounded-xl cursor-pointer transition-all border border-transparent"
                     [ngClass]="{
                        'bg-purple-50 dark:bg-purple-500/10 border-purple-200 dark:border-purple-500/20 shadow-sm': selectedReligionId() === rel.id,
                        'hover:bg-zinc-100 dark:hover:bg-zinc-800/50': selectedReligionId() !== rel.id
                     }">
                    
                    <div class="w-8 h-8 rounded-lg flex items-center justify-center text-lg bg-zinc-100 dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700 transition-colors"
                         [ngClass]="{'border-purple-500 text-purple-600': selectedReligionId() === rel.id}">
                        <i class="pi pi-eye"></i> <!-- Default Icon -->
                    </div>
                    
                    <div class="flex-1 min-w-0">
                        <h3 class="text-sm font-bold text-zinc-900 dark:text-zinc-100 truncate group-hover:text-purple-600 dark:group-hover:text-purple-400 transition-colors"
                            [ngClass]="{'text-purple-700 dark:text-purple-300': selectedReligionId() === rel.id}">
                            {{ rel.name }}
                        </h3>
                        <div class="text-[10px] uppercase font-bold tracking-wider opacity-60">{{ rel.type }}</div>
                    </div>
                </div>
            </div>
        </div>

        <!-- MAIN AREA -->
        <div class="flex-1 flex flex-col overflow-hidden relative bg-zinc-50/50 dark:bg-zinc-950/50">
            
            <!-- Context Bar (Sticky) -->
            <div *ngIf="selectedReligion(); else emptyState" class="px-6 py-4 border-b border-zinc-200 dark:border-zinc-800 bg-white/80 dark:bg-zinc-900/80 backdrop-blur flex items-center justify-between sticky top-0 z-20">
                <div class="flex items-center gap-4">
                    <h1 class="text-2xl font-bold font-serif text-zinc-900 dark:text-white flex items-center gap-2">
                        {{ selectedReligion()!.name }}
                        <button (click)="editReligionMeta()" class="text-zinc-300 hover:text-zinc-500 text-sm"><i class="pi pi-pencil"></i></button>
                    </h1>
                </div>

                <div class="flex items-center gap-4">
                     <!-- Act Context -->
                    <div class="flex items-center gap-2 px-3 py-1.5 rounded-full bg-indigo-50 dark:bg-indigo-500/10 border border-indigo-200 dark:border-indigo-500/20">
                        <i class="pi pi-history text-indigo-600 dark:text-indigo-400 text-xs"></i>
                        <span class="text-xs font-semibold text-indigo-800 dark:text-indigo-200">
                             {{ currentActName() || 'Global Context' }}
                        </span>
                    </div>
                    
                    <!-- Act Override Status Pill -->
                    <div *ngIf="currentOverride().status as status" 
                         class="px-3 py-1.5 rounded-full text-xs font-bold border capitalize items-center flex gap-2 cursor-pointer hover:opacity-80 transition-opacity"
                         [ngClass]="getStatusClass(status)"
                         (click)="openOverrideDialog()">
                         {{ status }}
                         <i class="pi pi-pencil text-[10px] opacity-50"></i>
                    </div>

                    <div *ngIf="!currentOverride().status" 
                         class="px-3 py-1.5 rounded-full text-xs font-bold border border-zinc-200 dark:border-zinc-700 text-zinc-400 cursor-pointer hover:text-zinc-600 hover:border-zinc-300 transition-all flex items-center gap-2"
                         (click)="openOverrideDialog()">
                         Stable
                         <i class="pi pi-pencil text-[10px] opacity-50"></i>
                    </div>
                </div>
            </div>

            <!-- CONTENT GRID -->
             <div *ngIf="selectedReligion() as rel" class="flex-1 overflow-y-auto p-8 custom-scrollbar">
                <div class="max-w-[1600px] mx-auto grid grid-cols-12 gap-8">
                    
                    <!-- LEFT RAIL: FAST FACTS -->
                    <div class="col-span-12 lg:col-span-3 space-y-6">
                        
                        <!-- Core Identity -->
                        <div class="p-5 rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 shadow-sm group">
                             <div class="flex justify-between items-center mb-4">
                                <h3 class="text-xs font-bold uppercase tracking-widest text-zinc-400">Identity</h3>
                                <button (click)="editReligionMeta()" class="text-zinc-300 hover:text-purple-500 text-sm opacity-0 group-hover:opacity-100 transition-opacity"><i class="pi pi-pencil"></i></button>
                             </div>
                             
                             <div class="flex flex-wrap gap-2 mb-4">
                                 <span *ngFor="let tag of rel.adjectives" class="text-[10px] font-bold px-2 py-1 rounded bg-zinc-100 dark:bg-zinc-800 text-zinc-600 dark:text-zinc-400 border border-zinc-200 dark:border-zinc-700">
                                     {{ tag }}
                                 </span>
                             </div>

                             <div class="space-y-3 text-sm">
                                 <div>
                                     <span class="block text-[10px] font-bold text-zinc-400 uppercase">Afterlife</span>
                                     <p class="leading-tight text-zinc-700 dark:text-zinc-300">{{ rel.cosmology.afterlife || '?' }}</p>
                                 </div>
                                  <div>
                                     <span class="block text-[10px] font-bold text-zinc-400 uppercase">Values</span>
                                     <p class="leading-tight text-zinc-700 dark:text-zinc-300">{{ rel.cosmology.moralCode || '?' }}</p>
                                 </div>
                             </div>
                        </div>

                        <!-- Practices & Taboos -->
                         <div class="p-5 rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 shadow-sm group">
                             <div class="flex justify-between items-center mb-4">
                                <h3 class="text-xs font-bold uppercase tracking-widest text-zinc-400">Practices</h3>
                                <button (click)="editPractices()" class="text-zinc-300 hover:text-purple-500 text-sm opacity-0 group-hover:opacity-100 transition-opacity"><i class="pi pi-pencil"></i></button>
                             </div>

                             <ul class="space-y-4">
                                 <li class="p-2 rounded bg-zinc-50 dark:bg-zinc-950/50 border border-zinc-100 dark:border-zinc-800">
                                     <span class="block text-[10px] font-bold text-zinc-400 uppercase mb-1">Rituals</span>
                                     <p class="text-sm leading-snug">{{ rel.practices.rituals || 'None defined.'}}</p>
                                 </li>
                                 <li *ngIf="rel.practices.taboos.length > 0">
                                     <span class="block text-[10px] font-bold text-red-400 uppercase mb-1">Taboos</span>
                                     <div class="flex flex-wrap gap-1.5">
                                         <span *ngFor="let t of rel.practices.taboos" class="text-xs px-2 py-0.5 rounded-full bg-red-50 dark:bg-red-900/20 text-red-600 dark:text-red-400 border border-red-100 dark:border-red-900/30">
                                             {{ t }}
                                         </span>
                                     </div>
                                 </li>
                             </ul>
                        </div>

                        <!-- Organization (Mini) -->
                        <div class="p-5 rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 shadow-sm group">
                             <div class="flex justify-between items-center mb-4">
                                <h3 class="text-xs font-bold uppercase tracking-widest text-zinc-400">Structure</h3>
                                <button (click)="editStructure()" class="text-zinc-300 hover:text-purple-500 text-sm opacity-0 group-hover:opacity-100 transition-opacity"><i class="pi pi-pencil"></i></button>
                             </div>
                             <div class="grid grid-cols-2 gap-4 text-center">
                                 <div class="p-2 rounded bg-zinc-50 dark:bg-zinc-950/50">
                                     <div class="text-[10px] text-zinc-400 uppercase">Type</div>
                                     <div class="font-bold text-sm">{{ rel.structure.hierarchy || 'Unknown' }}</div>
                                 </div>
                                  <div class="p-2 rounded bg-zinc-50 dark:bg-zinc-950/50">
                                     <div class="text-[10px] text-zinc-400 uppercase">Head</div>
                                     <div class="font-bold text-sm">{{ rel.structure.leadership || 'Unknown' }}</div>
                                 </div>
                             </div>
                        </div>

                    </div>

                    <!-- CENTER: MYTHS & SCENE SNIPPETS -->
                    <div class="col-span-12 lg:col-span-6 space-y-8">
                        
                        <!-- Scene Snippets (Prayers) -->
                         <div class="bg-gradient-to-r from-purple-50 to-indigo-50 dark:from-purple-900/10 dark:to-indigo-900/10 border border-purple-100 dark:border-purple-900/20 rounded-xl p-5 relative group">
                             <div class="flex justify-between items-center mb-3">
                                 <h3 class="text-sm font-bold text-purple-900 dark:text-purple-100 flex items-center gap-2">
                                     <i class="pi pi-comments decoration-clone"></i> Scene Snippets
                                 </h3>
                                 <button (click)="editSnippets()" class="text-purple-400 hover:text-purple-600 text-sm opacity-0 group-hover:opacity-100 transition-opacity"><i class="pi pi-pencil"></i></button>
                             </div>
                             <div class="space-y-2">
                                 <div *ngFor="let p of rel.prayers" class="flex gap-3 items-start p-2 hover:bg-white/50 dark:hover:bg-white/5 rounded cursor-copy transition-colors relative group/item" 
                                      [title]="'Click to copy'">
                                     <i class="pi pi-clone mt-1 text-xs text-purple-300 group-hover/item:text-purple-500"></i>
                                     <p class="font-serif italic text-lg text-zinc-700 dark:text-zinc-300 leading-snug">"{{p}}"</p>
                                 </div>
                                 <p *ngIf="rel.prayers.length === 0" class="text-sm text-purple-400/60 italic">Add prayers, oaths, or common sayings...</p>
                             </div>
                         </div>

                        <!-- Myths -->
                         <div>
                             <div class="flex items-center justify-between mb-4">
                                 <h3 class="text-lg font-bold text-zinc-900 dark:text-white">Mythos</h3>
                                 <button (click)="addMyth()" class="text-xs font-bold uppercase tracking-wider text-zinc-500 hover:text-purple-600 transition-colors flex items-center gap-1">
                                     <i class="pi pi-plus"></i> Add Myth
                                 </button>
                             </div>
                             
                             <div class="space-y-4">
                                 <div *ngFor="let myth of rel.myths" class="bg-white dark:bg-zinc-900 rounded-xl border border-zinc-200 dark:border-zinc-800 overflow-hidden group">
                                     <div class="px-6 py-4 flex items-center justify-between cursor-pointer hover:bg-zinc-50 dark:hover:bg-zinc-800/50 transition-colors" (click)="toggleMyth(myth.id)">
                                         <div class="flex items-center gap-3">
                                             <i class="pi text-zinc-400" [ngClass]="isMythOpen(myth.id) ? 'pi-chevron-down' : 'pi-chevron-right'"></i>
                                             <div>
                                                 <h4 class="font-bold text-zinc-900 dark:text-zinc-100">{{ myth.title }}</h4>
                                                 <span class="text-[10px] uppercase font-bold tracking-wider text-zinc-400">{{ myth.type }}</span>
                                             </div>
                                         </div>
                                         <div class="flex items-center gap-2">
                                            <button (click)="editMyth(myth); $event.stopPropagation()" class="text-zinc-300 hover:text-zinc-500 p-2"><i class="pi pi-pencil"></i></button>
                                            <button (click)="deleteMyth(myth.id); $event.stopPropagation()" class="text-zinc-300 hover:text-red-500 p-2"><i class="pi pi-trash"></i></button>
                                         </div>
                                     </div>
                                     <div *ngIf="isMythOpen(myth.id)" class="px-6 pb-6 pt-0 animate-fade-in">
                                         <div class="prose prose-sm prose-zinc dark:prose-invert max-w-none border-t border-zinc-100 dark:border-zinc-800 pt-4">
                                             <p class="whitespace-pre-wrap">{{ myth.content }}</p>
                                         </div>
                                     </div>
                                 </div>
                                 <div *ngIf="rel.myths.length === 0" class="p-8 text-center border-2 border-dashed border-zinc-200 dark:border-zinc-800 rounded-xl text-zinc-400">
                                     No myths recorded.
                                 </div>
                             </div>
                         </div>
                    </div>

                    <!-- RIGHT RAIL: PANTHEON & INSTITUTIONS -->
                    <div class="col-span-12 lg:col-span-3 space-y-6">
                        
                        <!-- Pantheon -->
                         <div>
                             <div class="flex items-center justify-between mb-4">
                                 <h3 class="text-xs font-bold uppercase tracking-widest text-zinc-400">Pantheon</h3>
                                 <button (click)="addDeity()" class="text-zinc-400 hover:text-purple-600"><i class="pi pi-plus"></i></button>
                             </div>
                             <div class="space-y-3">
                                 <div *ngFor="let deity of rel.deities" 
                                      (click)="editDeity(deity)"
                                      class="p-4 rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 hover:border-purple-300 dark:hover:border-purple-700 transition-all cursor-pointer group">
                                     <div class="flex items-start justify-between mb-1">
                                         <h4 class="font-bold text-zinc-900 dark:text-zinc-100">{{ deity.name }}</h4>
                                         <span class="text-lg">{{ deity.symbol }}</span>
                                     </div>
                                     <div class="flex flex-wrap gap-1 mb-2">
                                         <span *ngFor="let d of deity.domains" class="text-[9px] uppercase tracking-wide font-bold text-purple-600 dark:text-purple-400 bg-purple-50 dark:bg-purple-900/20 px-1.5 py-0.5 rounded">
                                             {{ d }}
                                         </span>
                                     </div>
                                     <p class="text-xs text-zinc-500 dark:text-zinc-400 line-clamp-2">{{ deity.description }}</p>
                                 </div>
                             </div>
                         </div>

                         <!-- Sects -->
                        <div>
                             <div class="flex items-center justify-between mb-4">
                                 <h3 class="text-xs font-bold uppercase tracking-widest text-zinc-400">Sects & Reformers</h3>
                                 <button (click)="addSect()" class="text-zinc-400 hover:text-purple-600"><i class="pi pi-plus"></i></button>
                             </div>
                             <div class="space-y-3">
                                 <div *ngFor="let sect of rel.sects" 
                                      (click)="editSect(sect)"
                                      class="p-4 rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 hover:border-purple-300 dark:hover:border-purple-700 transition-all cursor-pointer group">
                                     <h4 class="font-bold text-zinc-900 dark:text-zinc-100 mb-1">{{ sect.name }}</h4>
                                     <p class="text-xs text-zinc-500 dark:text-zinc-400 mb-2">{{ sect.description }}</p>
                                     <div class="text-[10px] text-red-500 dark:text-red-400 border-t border-zinc-100 dark:border-zinc-800 pt-2">
                                         <span class="font-bold">Split:</span> {{ sect.divergence }}
                                     </div>
                                 </div>
                                  <div *ngIf="(!rel.sects || rel.sects.length === 0)" class="text-center text-xs text-zinc-400 italic py-2">
                                     No known schisms.
                                 </div>
                             </div>
                        </div>

                        <!-- Act Changes Log (If Act active) -->
                        <div *ngIf="currentActName()" class="p-5 rounded-xl border border-amber-200 dark:border-amber-800/30 bg-amber-50 dark:bg-amber-900/10">
                            <h3 class="text-xs font-bold uppercase tracking-widest text-amber-700 dark:text-amber-500 mb-3 flex items-center gap-2">
                                <i class="pi pi-history"></i> {{ currentActName() }} Log
                            </h3>
                            <ul class="space-y-2 text-sm text-amber-900 dark:text-amber-200/80">
                                <li *ngFor="let change of currentOverride().changes" class="flex gap-2 items-start">
                                    <span class="mt-1.5 w-1 h-1 rounded-full bg-amber-500 shrink-0"></span>
                                    <span>{{ change }}</span>
                                </li>
                                <li *ngIf="(!currentOverride().changes || currentOverride().changes.length === 0)" class="italic text-amber-900/50 dark:text-amber-200/40 text-xs">
                                    No changes recorded for this act.
                                </li>
                            </ul>
                            <div class="mt-3 pt-3 border-t border-amber-200 dark:border-amber-800/30">
                                <button (click)="openOverrideDialog()" class="text-xs font-bold text-amber-700 hover:text-amber-900 dark:hover:text-amber-300 w-full text-center">
                                    Log Change
                                </button>
                            </div>
                        </div>

                    </div>

                </div>
             </div>

             <!-- Empty State -->
            <ng-template #emptyState>
                <div class="flex flex-col items-center justify-center h-full text-zinc-400">
                    <i class="pi pi-eye text-4xl mb-4 opacity-20"></i>
                    <p class="text-sm">Select or create a Religion.</p>
                </div>
            </ng-template>

        </div>
    </div>

    <!-- DIALOGS -->

    <!-- Create/Edit Religion Meta -->
    <p-dialog header="{{ isCreating ? 'New Religion' : 'Edit Identity' }}" [(visible)]="showMetaDialog" [modal]="true" [style]="{width: '35vw'}">
        <ng-template pTemplate="content">
        <div class="flex flex-col gap-4 py-2">
            <div class="flex flex-col gap-2">
                <label class="text-sm font-bold">Name</label>
                <input pInputText [(ngModel)]="tempReligion.name" placeholder="e.g. The Order of the Sun" />
            </div>
            <div class="flex flex-col gap-2">
                <label class="text-sm font-bold">Type</label>
                <input pInputText [(ngModel)]="tempReligion.type" placeholder="e.g. Monotheistic, Cult, Animist" />
            </div>
             <div class="flex flex-col gap-2">
                <label class="text-sm font-bold">Adjectives (enter to add)</label>
                <div class="flex flex-wrap gap-2 p-2 border border-zinc-300 dark:border-zinc-700 rounded-md bg-white dark:bg-zinc-900">
                    <p-chip *ngFor="let item of tempReligion.adjectives; let i=index" [label]="item" [removable]="true" (onRemove)="removeArrayItem(tempReligion.adjectives, i)" styleClass="text-xs"></p-chip>
                    <input #adjInput type="text" class="flex-1 min-w-[100px] border-none outline-none bg-transparent text-sm p-1" placeholder="Add..." (keydown.enter)="addArrayItem(tempReligion.adjectives, adjInput.value); adjInput.value=''" />
                </div>
            </div>
            <div class="flex flex-col gap-2">
                <label class="text-sm font-bold">Concept / Description</label>
                <textarea pInputTextarea [(ngModel)]="tempReligion.description" rows="3"></textarea>
            </div>
            <div class="grid grid-cols-2 gap-4">
                <div class="flex flex-col gap-2">
                    <label class="text-sm font-bold">Afterlife</label>
                    <input pInputText [(ngModel)]="tempReligion.cosmology.afterlife" placeholder="Reincarnation, The Void..." />
                </div>
                <div class="flex flex-col gap-2">
                    <label class="text-sm font-bold">Moral Code (Short)</label>
                    <input pInputText [(ngModel)]="tempReligion.cosmology.moralCode" placeholder="Truth above all..." />
                </div>
            </div>
        </div>
        </ng-template>
        <ng-template pTemplate="footer">
            <button pButton label="Cancel" (click)="showMetaDialog=false" class="p-button-text"></button>
            <button pButton label="Save" (click)="saveMeta()" class="p-button-primary"></button>
        </ng-template>
    </p-dialog>

    <!-- Practices Dialog -->
    <p-dialog header="Edit Practices" [(visible)]="showPracticesDialog" [modal]="true" [style]="{width: '35vw'}">
        <ng-template pTemplate="content">
        <div class="flex flex-col gap-4 py-2">
            <div class="flex flex-col gap-2">
                <label class="text-sm font-bold">Rituals</label>
                <textarea pInputTextarea [(ngModel)]="tempReligion.practices.rituals" rows="4" placeholder="Daily prayers, seasonal sacrifices..."></textarea>
            </div>
             <div class="flex flex-col gap-2">
                <label class="text-sm font-bold">Taboos</label>
                 <div class="flex flex-wrap gap-2 p-2 border border-zinc-300 dark:border-zinc-700 rounded-md bg-white dark:bg-zinc-900">
                    <p-chip *ngFor="let item of tempReligion.practices.taboos; let i=index" [label]="item" [removable]="true" (onRemove)="removeArrayItem(tempReligion.practices.taboos, i)" styleClass="text-xs"></p-chip>
                    <input #tabInput type="text" class="flex-1 min-w-[100px] border-none outline-none bg-transparent text-sm p-1" placeholder="Add taboo..." (keydown.enter)="addArrayItem(tempReligion.practices.taboos, tabInput.value); tabInput.value=''" />
                </div>
            </div>
             <div class="flex flex-col gap-2">
                <label class="text-sm font-bold">Holidays</label>
                 <div class="flex flex-wrap gap-2 p-2 border border-zinc-300 dark:border-zinc-700 rounded-md bg-white dark:bg-zinc-900">
                    <p-chip *ngFor="let item of tempReligion.practices.holidays; let i=index" [label]="item" [removable]="true" (onRemove)="removeArrayItem(tempReligion.practices.holidays, i)" styleClass="text-xs"></p-chip>
                    <input #holInput type="text" class="flex-1 min-w-[100px] border-none outline-none bg-transparent text-sm p-1" placeholder="Add holiday..." (keydown.enter)="addArrayItem(tempReligion.practices.holidays, holInput.value); holInput.value=''" />
                </div>
            </div>
        </div>
         </ng-template>
         <ng-template pTemplate="footer">
            <button pButton label="Cancel" (click)="showPracticesDialog=false" class="p-button-text"></button>
            <button pButton label="Save" (click)="savePractices()" class="p-button-primary"></button>
        </ng-template>
    </p-dialog>

    <!-- Structure Dialog -->
    <p-dialog header="Edit Structure" [(visible)]="showStructureDialog" [modal]="true" [style]="{width: '30vw'}">
         <ng-template pTemplate="content">
         <div class="flex flex-col gap-4 py-2">
            <div class="flex flex-col gap-2">
                <label class="text-sm font-bold">Hierarchy Type</label>
                <input pInputText [(ngModel)]="tempReligion.structure.hierarchy" placeholder="e.g. Strict Top-Down, Decentralized Cells" />
            </div>
             <div class="flex flex-col gap-2">
                <label class="text-sm font-bold">Leadership Head</label>
                <input pInputText [(ngModel)]="tempReligion.structure.leadership" placeholder="e.g. The Pontiff, The Council of Elders" />
            </div>
         </div>
          </ng-template>
          <ng-template pTemplate="footer">
            <button pButton label="Cancel" (click)="showStructureDialog=false" class="p-button-text"></button>
            <button pButton label="Save" (click)="saveStructure()" class="p-button-primary"></button>
        </ng-template>
    </p-dialog>

    <!-- Snippets Dialog -->
    <p-dialog header="Edit Scene Snippets" [(visible)]="showSnippetsDialog" [modal]="true" [style]="{width: '30vw'}">
        <ng-template pTemplate="content">
        <div class="flex flex-col gap-4 py-2">
             <label class="text-sm text-zinc-500">Short prayers, greetings, or oaths for easy use in scenes.</label>
             <div class="flex gap-2">
                 <input pInputText [(ngModel)]="newSnippet" placeholder="New snippet..." class="flex-1" (keydown.enter)="addSnippet()" />
                 <button pButton icon="pi pi-plus" (click)="addSnippet()"></button>
             </div>
             <div class="max-h-60 overflow-y-auto space-y-2">
                 <div *ngFor="let s of tempReligion.prayers; let i = index" class="flex justify-between items-center p-2 bg-zinc-50 dark:bg-zinc-800 rounded">
                     <span class="italic">"{{s}}"</span>
                     <i class="pi pi-times text-zinc-400 hover:text-red-500 cursor-pointer" (click)="removeSnippet(i)"></i>
                 </div>
             </div>
        </div>
         </ng-template>
         <ng-template pTemplate="footer">
            <button pButton label="Done" (click)="saveSnippets()" class="p-button-primary"></button>
        </ng-template>
    </p-dialog>

    <!-- Myth Dialog -->
    <p-dialog header="Edit Myth" [(visible)]="showMythDialog" [modal]="true" [style]="{width: '50vw'}">
        <ng-template pTemplate="content">
        <div class="flex flex-col gap-4 py-2">
            <div class="flex flex-col gap-2">
                <label class="text-sm font-bold">Title</label>
                <input pInputText [(ngModel)]="tempMyth.title" class="w-full" />
            </div>
            <div class="flex flex-col gap-2">
                <label class="text-sm font-bold">Type</label>
                <p-selectButton [options]="[{label:'Creation', value:'creation'}, {label:'Prophecy', value:'prophecy'}, {label:'Hero', value:'hero'}, {label:'Cautionary', value:'cautionary'}, {label:'Endtimes', value:'endtimes'}]" 
                                [(ngModel)]="tempMyth.type" optionLabel="label" optionValue="value"></p-selectButton>
            </div>
            <div class="flex flex-col gap-2">
                <label class="text-sm font-bold">Content</label>
                <textarea pInputTextarea [(ngModel)]="tempMyth.content" rows="12" class="font-serif leading-relaxed"></textarea>
            </div>
        </div>
        </ng-template>
        <ng-template pTemplate="footer">
            <button pButton label="Cancel" (click)="showMythDialog=false" class="p-button-text"></button>
            <button pButton label="Save" (click)="saveMyth()" class="p-button-primary"></button>
        </ng-template>
    </p-dialog>

    <!-- Deity Dialog -->
    <p-dialog header="Edit Deity" [(visible)]="showDeityDialog" [modal]="true" [style]="{width: '35vw'}">
        <ng-template pTemplate="content">
        <div class="flex flex-col gap-4 py-2">
             <div class="grid grid-cols-2 gap-4">
                <div class="flex flex-col gap-2">
                    <label class="text-sm font-bold">Name</label>
                    <input pInputText [(ngModel)]="tempDeity.name" />
                </div>
                 <div class="flex flex-col gap-2">
                    <label class="text-sm font-bold">Symbol (Emoji)</label>
                    <input pInputText [(ngModel)]="tempDeity.symbol" class="w-16 text-center" />
                </div>
            </div>
             <div class="flex flex-col gap-2">
                <label class="text-sm font-bold">Domains</label>
                <div class="flex flex-wrap gap-2 p-2 border border-zinc-300 dark:border-zinc-700 rounded-md bg-white dark:bg-zinc-900">
                    <p-chip *ngFor="let item of tempDeity.domains; let i=index" [label]="item" [removable]="true" (onRemove)="removeArrayItem(tempDeity.domains, i)" styleClass="text-xs"></p-chip>
                    <input #domInput type="text" class="flex-1 min-w-[100px] border-none outline-none bg-transparent text-sm p-1" placeholder="War, Peace..." (keydown.enter)="addArrayItem(tempDeity.domains, domInput.value); domInput.value=''" />
                </div>
            </div>
             <div class="flex flex-col gap-2">
                <label class="text-sm font-bold">Description</label>
                <textarea pInputTextarea [(ngModel)]="tempDeity.description" rows="4"></textarea>
            </div>
        </div>
        </ng-template>
        <ng-template pTemplate="footer">
            <button pButton label="Cancel" (click)="showDeityDialog=false" class="p-button-text"></button>
            <button pButton label="Save" (click)="saveDeity()" class="p-button-primary"></button>
        </ng-template>
    </p-dialog>

    <!-- Sect Dialog -->
    <p-dialog header="Edit Sect" [(visible)]="showSectDialog" [modal]="true" [style]="{width: '35vw'}">
        <ng-template pTemplate="content">
        <div class="flex flex-col gap-4 py-2">
            <div class="flex flex-col gap-2">
                <label class="text-sm font-bold">Name</label>
                <input pInputText [(ngModel)]="tempSect.name" placeholder="e.g. The Purists" />
            </div>
             <div class="flex flex-col gap-2">
                <label class="text-sm font-bold">Description</label>
                <textarea pInputTextarea [(ngModel)]="tempSect.description" rows="3"></textarea>
            </div>
             <div class="flex flex-col gap-2">
                <label class="text-sm font-bold">Point of Divergence</label>
                <textarea pInputTextarea [(ngModel)]="tempSect.divergence" rows="2" placeholder="Why did they split?"></textarea>
            </div>
        </div>
        </ng-template>
        <ng-template pTemplate="footer">
            <button pButton label="Cancel" (click)="showSectDialog=false" class="p-button-text"></button>
            <button pButton label="Save" (click)="saveSect()" class="p-button-primary"></button>
        </ng-template>
    </p-dialog>

    <!-- Override Dialog (Act Changes) -->
    <p-dialog header="Act Log & Status" [(visible)]="showOverrideDialog" [modal]="true" [style]="{width: '35vw'}">
         <ng-template pTemplate="content">
         <div class="flex flex-col gap-4 py-2">
             <div class="flex flex-col gap-2">
                <label class="text-sm font-bold">Status in {{ currentActName() }}</label>
                <p-selectButton [options]="[{label:'Stable', value:'Stable'}, {label:'Schism', value:'Schism'}, {label:'Reform', value:'Reform'}, {label:'Persecuted', value:'Persecuted'}, {label:'Dominant', value:'Dominant'}]" 
                                [(ngModel)]="tempOverride.status" optionLabel="label" optionValue="value"></p-selectButton>
            </div>
            
            <div class="flex flex-col gap-2">
                <label class="text-sm font-bold">Log Event</label>
                <div class="flex gap-2">
                     <input pInputText [(ngModel)]="newOverrideChange" placeholder="e.g. High Priest assassinated..." class="flex-1" (keydown.enter)="addOverrideChange()" />
                    <button pButton icon="pi pi-plus" (click)="addOverrideChange()"></button>
                </div>
                <div class="space-y-2 mt-2 max-h-40 overflow-y-auto">
                    <div *ngFor="let c of tempOverride.changes; let i = index" class="flex justify-between items-center p-2 rounded bg-amber-50 dark:bg-amber-900/10 border border-amber-100 dark:border-amber-900/20 text-sm">
                        <span>{{ c }}</span>
                        <i class="pi pi-times text-zinc-400 hover:text-red-500 cursor-pointer" (click)="removeOverrideChange(i)"></i>
                    </div>
                </div>
            </div>
         </div>
         </ng-template>
         <ng-template pTemplate="footer">
            <button pButton label="Cancel" (click)="showOverrideDialog=false" class="p-button-text"></button>
            <button pButton label="Save" (click)="saveOverride()" class="p-button-primary"></button>
        </ng-template>
    </p-dialog>
  `
})
export class ReligionComponent {
  private scopeService = inject(ScopeService);
  private worldService = inject(WorldBuildingService);
  private folderService = inject(FolderService);

  // ======================
  // DATA SOURCE
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
  religions = toSignal(
    toObservable(this.narrativeId).pipe(
      switchMap(nid => (nid && nid !== 'vault:global') ? this.worldService.getReligions$(nid) : of([]))
    ),
    { initialValue: [] }
  );

  overrideMap = toSignal(
    toObservable(this.selectedActId).pipe(
      switchMap(aid => aid ? this.worldService.getActReligionOverrides$(aid) : of({} as Record<string, ReligionOverride>))
    ),
    { initialValue: {} as Record<string, ReligionOverride> }
  );

  // ======================
  // VIEW STATE
  // ======================
  selectedReligionId = signal<string | null>(null);
  selectedReligion = computed(() => this.religions().find(r => r.id === this.selectedReligionId()));

  currentOverride = computed(() => {
    const rid = this.selectedReligionId();
    if (!rid) return { status: 'Stable', changes: [] } as ReligionOverride;
    return this.overrideMap()[rid] || ({ status: 'Stable', changes: [] } as ReligionOverride);
  });

  openMyths = signal<Set<string>>(new Set());

  // ======================
  // HELPERS
  // ======================
  isMythOpen(id: string) { return this.openMyths().has(id); }
  toggleMyth(id: string) {
    const set = new Set(this.openMyths());
    if (set.has(id)) set.delete(id); else set.add(id);
    this.openMyths.set(set);
  }

  getStatusClass(status: string): string {
    switch (status) {
      case 'Stable': return 'bg-zinc-100 text-zinc-600 border-zinc-200 dark:bg-zinc-800 dark:text-zinc-400 dark:border-zinc-700';
      case 'Schism': return 'bg-orange-100 text-orange-700 border-orange-200 dark:bg-orange-900/30 dark:text-orange-300 dark:border-orange-800';
      case 'Reform': return 'bg-blue-100 text-blue-700 border-blue-200 dark:bg-blue-900/30 dark:text-blue-300 dark:border-blue-800';
      case 'Persecuted': return 'bg-red-100 text-red-700 border-red-200 dark:bg-red-900/30 dark:text-red-300 dark:border-red-800';
      case 'Dominant': return 'bg-purple-100 text-purple-700 border-purple-200 dark:bg-purple-900/30 dark:text-purple-300 dark:border-purple-800';
      default: return '';
    }
  }

  // ======================
  // ACTIONS
  // ======================
  selectReligion(r: Religion) { this.selectedReligionId.set(r.id); }

  // META
  showMetaDialog = false;
  isCreating = false;
  tempReligion: Religion = this.getEmptyReligion();

  getEmptyReligion(): Religion {
    return {
      id: '', name: '', type: '', description: '', symbols: [], adjectives: [],
      cosmology: { creation: '', afterlife: '', moralCode: '' },
      practices: { rituals: '', holidays: [], taboos: [] },
      deities: [], sects: [], structure: { hierarchy: '', leadership: '' },
      scriptures: [], myths: [], prayers: []
    };
  }

  createReligion() {
    this.isCreating = true;
    this.tempReligion = this.getEmptyReligion();
    this.showMetaDialog = true;
  }

  editReligionMeta() {
    if (!this.selectedReligion()) return;
    this.isCreating = false;
    this.tempReligion = JSON.parse(JSON.stringify(this.selectedReligion()!));
    this.showMetaDialog = true;
  }

  async saveMeta() {
    const nid = this.narrativeId();
    if (!nid) return;
    let list = [...this.religions()];
    if (this.isCreating) {
      this.tempReligion.id = this.worldService.generateId();
      list.push(this.tempReligion);
      this.selectedReligionId.set(this.tempReligion.id);
    } else {
      const idx = list.findIndex(r => r.id === this.tempReligion.id);
      if (idx > -1) {
        // Preserve deeply nested or other fields not edited in meta?
        // Since we load the full object, overwriting is fine, BUT we must ensure
        // we didn't lose data if we only partial loaded?
        // Current implementation loads full object into temp, so it's safe.
        list[idx] = this.tempReligion;
      }
    }
    await this.worldService.updateReligions(nid, list);
    this.showMetaDialog = false;
  }

  // PRACTICES
  showPracticesDialog = false;
  editPractices() {
    if (!this.selectedReligion()) return;
    this.tempReligion = JSON.parse(JSON.stringify(this.selectedReligion()!));
    this.showPracticesDialog = true;
  }
  async savePractices() {
    if (this.selectedReligion()) {
      // We're just updating the current selected one with the Temp one's practice fields
      // But temp is a full copy, so we can just save it like meta
      await this.saveMeta();
      this.showPracticesDialog = false;
    }
  }

  // STRUCTURE
  showStructureDialog = false;
  editStructure() {
    if (!this.selectedReligion()) return;
    this.tempReligion = JSON.parse(JSON.stringify(this.selectedReligion()!));
    this.showStructureDialog = true;
  }
  async saveStructure() {
    await this.saveMeta();
    this.showStructureDialog = false;
  }

  // SNIPPETS
  showSnippetsDialog = false;
  newSnippet = '';
  editSnippets() {
    if (!this.selectedReligion()) return;
    this.tempReligion = JSON.parse(JSON.stringify(this.selectedReligion()!));
    this.showSnippetsDialog = true;
  }
  addSnippet() {
    if (this.newSnippet.trim()) {
      this.tempReligion.prayers.push(this.newSnippet.trim());
      this.newSnippet = '';
    }
  }
  removeSnippet(i: number) {
    this.tempReligion.prayers.splice(i, 1);
  }
  async saveSnippets() {
    await this.saveMeta();
    this.showSnippetsDialog = false;
  }

  // MYTHS
  showMythDialog = false;
  tempMyth: MythBlock = { id: '', title: '', content: '', type: 'creation' };

  addMyth() {
    this.tempMyth = { id: '', title: '', content: '', type: 'creation' };
    this.showMythDialog = true;
  }
  editMyth(m: MythBlock) {
    this.tempMyth = { ...m };
    this.showMythDialog = true;
  }
  async saveMyth() {
    if (!this.selectedReligion()) return;
    const rel = JSON.parse(JSON.stringify(this.selectedReligion()!)) as Religion;

    if (!this.tempMyth.id) {
      this.tempMyth.id = this.worldService.generateId();
      rel.myths.push(this.tempMyth);
    } else {
      const idx = rel.myths.findIndex(m => m.id === this.tempMyth.id);
      if (idx > -1) rel.myths[idx] = this.tempMyth;
    }

    const nid = this.narrativeId();
    if (nid) {
      const list = [...this.religions()];
      const rIdx = list.findIndex(r => r.id === rel.id);
      if (rIdx > -1) list[rIdx] = rel;
      await this.worldService.updateReligions(nid, list);
    }
    this.showMythDialog = false;
  }
  async deleteMyth(id: string) {
    if (!this.selectedReligion()) return;
    const rel = JSON.parse(JSON.stringify(this.selectedReligion()!)) as Religion;
    rel.myths = rel.myths.filter(m => m.id !== id);

    const nid = this.narrativeId();
    if (nid) {
      const list = [...this.religions()];
      const rIdx = list.findIndex(r => r.id === rel.id);
      if (rIdx > -1) list[rIdx] = rel;
      await this.worldService.updateReligions(nid, list);
    }
  }

  // DEITIES
  showDeityDialog = false;
  tempDeity: Deity = { id: '', name: '', symbol: '', description: '', domains: [] };

  addDeity() {
    this.tempDeity = { id: '', name: '', symbol: '', description: '', domains: [] };
    this.showDeityDialog = true;
  }
  editDeity(d: Deity) {
    this.tempDeity = JSON.parse(JSON.stringify(d));
    this.showDeityDialog = true;
  }
  async saveDeity() {
    if (!this.selectedReligion()) return;
    const rel = JSON.parse(JSON.stringify(this.selectedReligion()!)) as Religion;

    if (!this.tempDeity.id) {
      this.tempDeity.id = this.worldService.generateId();
      rel.deities.push(this.tempDeity);
    } else {
      const idx = rel.deities.findIndex(d => d.id === this.tempDeity.id);
      if (idx > -1) rel.deities[idx] = this.tempDeity;
    }

    const nid = this.narrativeId();
    if (nid) {
      const list = [...this.religions()];
      const rIdx = list.findIndex(r => r.id === rel.id);
      if (rIdx > -1) list[rIdx] = rel;
      await this.worldService.updateReligions(nid, list);
    }
    this.showDeityDialog = false;
  }

  // SECTS
  showSectDialog = false;
  tempSect: Sect = { id: '', name: '', description: '', divergence: '' };

  addSect() {
    this.tempSect = { id: '', name: '', description: '', divergence: '' };
    this.showSectDialog = true;
  }
  editSect(s: Sect) {
    this.tempSect = JSON.parse(JSON.stringify(s));
    this.showSectDialog = true;
  }
  async saveSect() {
    if (!this.selectedReligion()) return;
    const rel = JSON.parse(JSON.stringify(this.selectedReligion()!)) as Religion;

    if (!this.tempSect.id) {
      this.tempSect.id = this.worldService.generateId();
      if (!rel.sects) rel.sects = [];
      rel.sects.push(this.tempSect);
    } else {
      const idx = rel.sects.findIndex(s => s.id === this.tempSect.id);
      if (idx > -1) rel.sects[idx] = this.tempSect;
    }

    const nid = this.narrativeId();
    if (nid) {
      const list = [...this.religions()];
      const rIdx = list.findIndex(r => r.id === rel.id);
      if (rIdx > -1) list[rIdx] = rel;
      await this.worldService.updateReligions(nid, list);
    }
    this.showSectDialog = false;
  }

  // OVERRIDES
  showOverrideDialog = false;
  tempOverride: ReligionOverride = { status: 'Stable', changes: [] };
  newOverrideChange = '';

  openOverrideDialog() {
    this.tempOverride = JSON.parse(JSON.stringify(this.currentOverride()));
    this.newOverrideChange = '';
    this.showOverrideDialog = true;
  }

  addOverrideChange() {
    if (this.newOverrideChange.trim()) {
      this.tempOverride.changes.push(this.newOverrideChange.trim());
      this.newOverrideChange = '';
    }
  }
  removeOverrideChange(i: number) {
    this.tempOverride.changes.splice(i, 1);
  }
  async saveOverride() {
    const aid = this.selectedActId();
    const rid = this.selectedReligionId();
    if (!aid || !rid) return;

    const map = { ...this.overrideMap() };
    map[rid] = this.tempOverride;
    await this.worldService.updateActReligionOverrides(aid, map);
    this.showOverrideDialog = false;
  }

  // ======================
  // GENERIC HELPERS (Chip replacers)
  // ======================
  addArrayItem(arr: string[], value: string) {
    const v = value.trim();
    if (v && !arr.includes(v)) {
      arr.push(v);
    }
  }
  removeArrayItem(arr: string[], index: number) {
    arr.splice(index, 1);
  }
}
