import { Component, inject, signal, effect, computed, ViewChild, ElementRef } from '@angular/core';
import { CommonModule } from '@angular/common';
import { TabsModule } from 'primeng/tabs';
import { ButtonModule } from 'primeng/button';
import { LucideAngularModule, X, FileText } from 'lucide-angular';
import { TabStore } from '../../../lib/store/tab.store';
import { NoteEditorStore } from '../../../lib/store/note-editor.store';
import { FormsModule } from '@angular/forms';

@Component({
    selector: 'app-editor-tabs',
    standalone: true,
    imports: [CommonModule, TabsModule, ButtonModule, LucideAngularModule, FormsModule],
    template: `
        <div class="h-full w-full flex items-center overflow-hidden bg-transparent" style="background: transparent !important;">
            <p-tabs [value]="activeTabValue()" (valueChange)="onTabChange($event)" class="w-full h-full custom-tabs bg-transparent" style="background: transparent !important;">
                <p-tablist class="h-full bg-transparent border-0" style="background: transparent !important;">
                    @for (tab of tabStore.tabs(); track tab.id) {
                        <p-tab [value]="tab.id" 
                            class="h-[38px] flex items-center gap-2 px-3 text-xs border-r border-white/10 text-white/80 hover:text-white hover:bg-white/5 transition-colors cursor-pointer select-none group min-w-[120px] max-w-[200px]"
                            [class.bg-teal-900/30]="tab.active"
                            [class.text-white]="tab.active"
                            [class.border-t-2]="tab.active"
                            [class.border-t-teal-400]="tab.active">
                            
                            <lucide-icon [img]="FileText" size="12" class="text-teal-400"></lucide-icon>
                            
                            <!-- Title or Rename Input -->
                            <div class="flex-1 truncate relative" (dblclick)="startRenaming(tab.id, tab.title)">
                                <span *ngIf="renamingId() !== tab.id">{{ tab.title }}</span>
                                <input *ngIf="renamingId() === tab.id"
                                    #renameInput
                                    type="text"
                                    [ngModel]="renamingTitle()"
                                    (ngModelChange)="renamingTitle.set($event)"
                                    (blur)="finishRenaming()"
                                    (keydown.enter)="finishRenaming()"
                                    (keydown.escape)="cancelRenaming()"
                                    class="w-full bg-slate-800 text-white px-1 rounded outline-none border border-teal-500/50"
                                    (click)="$event.stopPropagation()"
                                >
                            </div>

                            <!-- Close Button (visible on hover or active) -->
                            <button 
                                class="opacity-0 group-hover:opacity-100 p-0.5 rounded-full hover:bg-white/20 text-white/60 hover:text-white transition-all ml-1"
                                (click)="closeTab($event, tab.id)">
                                <lucide-icon [img]="X" size="10"></lucide-icon>
                            </button>
                        </p-tab>
                    }
                </p-tablist>
            </p-tabs>
        </div>
    `,
    styles: [`
        :host {
            display: block;
            height: 100%;
            overflow: hidden;
            flex: 1;
            background: transparent !important;
        }
        
        /* ══════════════════════════════════════════════════════════════
           AGGRESSIVE PrimeNG Tabs transparency overrides
           Make EVERYTHING transparent so header gradient shows through
           ══════════════════════════════════════════════════════════════ */
        
        /* Root tabs container */
        ::ng-deep .custom-tabs,
        ::ng-deep .custom-tabs .p-tabs,
        ::ng-deep .custom-tabs .p-component {
            background: transparent !important;
            background-color: transparent !important;
        }

        /* Tab list wrapper */
        ::ng-deep .custom-tabs .p-tablist,
        ::ng-deep .custom-tabs .p-tablist-content,
        ::ng-deep .custom-tabs .p-tablist-tab-list,
        ::ng-deep .custom-tabs .p-tablist-viewport {
            background: transparent !important;
            background-color: transparent !important;
            border: none !important;
            height: 100%;
            gap: 0 !important;
        }
        
        /* Individual tabs */
        ::ng-deep .custom-tabs .p-tab {
            margin: 0 !important;
            border: none !important;
            background: transparent !important;
            background-color: transparent !important;
            color: inherit !important;
        }

        /* Active bar indicator - hide it, we use our own */
        ::ng-deep .custom-tabs .p-tablist-active-bar {
            display: none !important;
        }

        /* Navigation buttons if they appear */
        ::ng-deep .custom-tabs .p-tablist-nav-button {
            background: transparent !important;
            color: white !important;
        }
    `]
})
export class EditorTabsComponent {
    tabStore = inject(TabStore);
    noteEditorStore = inject(NoteEditorStore); // Needed for rename logic usually, but here just updating TabStore title? 
    // Actually, renaming a tab should rename the note. TabStore should handle calling db update or NoteEditorStore.rename

    readonly X = X;
    readonly FileText = FileText;

    // View State
    renamingId = signal<string | null>(null);
    renamingTitle = signal<string>('');

    elementRef = inject(ElementRef);

    // Computed active tab value for p-tabs
    // We derive this from the store's active tab state
    activeTabValue = computed(() => {
        const activeTab = this.tabStore.tabs().find(t => t.active);
        return activeTab ? activeTab.id : undefined; // undefined if no tab active
    });

    onTabChange(tabId: string | number | null | undefined) {
        if (typeof tabId === 'string' && tabId !== this.activeTabValue()) {
            this.tabStore.activateTab(tabId);
        }
    }

    closeTab(event: Event, tabId: string) {
        event.stopPropagation();
        this.tabStore.closeTab(tabId);
    }

    // Rename Logic
    startRenaming(id: string, currentTitle: string) {
        this.renamingId.set(id);
        this.renamingTitle.set(currentTitle);
        // Focus input
        setTimeout(() => {
            const input = this.elementRef.nativeElement.querySelector('input');
            if (input) input.focus();
        });
    }

    finishRenaming() {
        const id = this.renamingId();
        const title = this.renamingTitle();
        if (id && title.trim()) {
            this.noteEditorStore.renameNote(id, title);
            // TabStore will update title via effect or manual sync?
            // NoteEditorStore.renameNote should update DB. 
            // We need to ensure TabStore updates the title in its list.
            this.tabStore.updateTabTitle(id, title);
        }
        this.renamingId.set(null);
    }

    cancelRenaming() {
        this.renamingId.set(null);
    }
}
