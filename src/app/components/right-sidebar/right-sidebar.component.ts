import { Component, inject, signal, OnInit, OnDestroy, computed, effect } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { LucideAngularModule, Sparkles, BarChart3, ChevronDown, BookOpen, Bot, Clock } from 'lucide-angular';
import { RightSidebarService } from '../../lib/services/right-sidebar.service';
import { ChapterService } from '../../lib/services/chapter.service';
import { ScopeService, ActiveScope } from '../../lib/services/scope.service';
import { FactSheetContainerComponent, ParsedEntity } from '../fact-sheets/fact-sheet-container/fact-sheet-container.component';
import { FactSheetService } from '../fact-sheets/fact-sheet.service';
import { AnalyticsPanelComponent } from '../analytics-panel';
import { TimelineViewComponent } from './timeline-view/timeline-view.component';
import { AiChatPanelComponent } from './ai-chat-panel/ai-chat-panel.component';
import { smartGraphRegistry } from '../../lib/registry';
import { db, Entity } from '../../lib/dexie';

type SidebarView = 'entities' | 'analytics' | 'timeline' | 'ai';

interface ViewOption {
    value: SidebarView;
    label: string;
    icon: any; // Lucide icon object
}

const VIEW_OPTIONS: ViewOption[] = [
    { value: 'entities', label: 'Entities', icon: Sparkles },
    { value: 'analytics', label: 'Analytics', icon: BarChart3 },
    { value: 'timeline', label: 'Timeline', icon: Clock },
    { value: 'ai', label: 'AI', icon: Bot },
];

const STORAGE_KEY = 'right-sidebar:tab';

@Component({
    selector: 'app-right-sidebar',
    standalone: true,
    imports: [CommonModule, FormsModule, LucideAngularModule, FactSheetContainerComponent, AnalyticsPanelComponent, TimelineViewComponent, AiChatPanelComponent],
    template: `
        <aside
            class="h-full border-l border-sidebar-border bg-sidebar text-sidebar-foreground flex flex-col transition-all duration-300 ease-in-out overflow-hidden"
            [class.w-80]="service.isOpen()"
            [class.w-0]="service.isClosed()">
            
            @if (service.isOpen()) {
                <!-- View Selector Header -->
                <div class="shrink-0 h-10 border-b border-teal-900/40 bg-gradient-to-r from-[#134e4a] via-[#113a35] to-[#18181b] px-2 flex items-center shadow-sm text-white">
                    <div class="view-selector-wrapper h-8 relative">
                        <!-- Trigger Button -->
                        <div class="view-selector-display" (click)="toggleDropdown()">
                            <lucide-icon [img]="currentViewIcon()" class="h-4 w-4"></lucide-icon>
                            <span>{{ currentViewLabel() }}</span>
                            <lucide-icon name="chevron-down" class="h-4 w-4 ml-auto opacity-50 transition-transform duration-200"
                                [class.rotate-180]="isDropdownOpen()"></lucide-icon>
                        </div>

                        <!-- Dropdown Menu -->
                        @if (isDropdownOpen()) {
                            <!-- Backdrop -->
                            <div class="fixed inset-0 z-40" (click)="closeDropdown()"></div>
                            
                            <!-- Menu -->
                            <div class="absolute top-full left-0 right-0 mt-1 z-50 bg-[#18181b] border border-teal-900/50 rounded-md shadow-xl py-1 overflow-hidden animate-in fade-in slide-in-from-top-2 duration-150">
                                @for (opt of viewOptions; track opt.value) {
                                    <button
                                        class="w-full px-3 py-2 text-sm flex items-center gap-2 text-left hover:bg-teal-900/20 transition-colors"
                                        [class.text-teal-400]="activeView() === opt.value"
                                        [class.bg-teal-900-10]="activeView() === opt.value"
                                        (click)="onViewChange(opt.value)"
                                    >
                                        <lucide-icon [img]="opt.icon" class="h-4 w-4 opacity-70"></lucide-icon>
                                        {{ opt.label }}
                                    </button>
                                }
                            </div>
                        }
                    </div>
                </div>

                <!-- Content Area -->
                <div class="flex-1 min-h-0 overflow-hidden flex flex-col">
                    @switch (activeView()) {
                        @case ('entities') {
                            <!-- Entity Selector (only for entities view) -->
                            <div class="p-2 border-b border-border/50 shrink-0 space-y-2">
                                <!-- Scope Indicator (READ-ONLY, shows current entity scope) -->
                                <div class="flex items-center gap-2 px-1 py-1 text-xs text-muted-foreground bg-muted/30 rounded">
                                    <i class="pi text-[10px]" [ngClass]="scopeIcon()"></i>
                                    <span class="truncate">{{ scopeLabel() }}</span>
                                    <span class="text-[10px] opacity-60 ml-auto">scope</span>
                                </div>

                                <!-- Chapter Context Selector (for attribute inheritance, NOT entity filtering) -->
                                <div class="flex items-center gap-2">
                                    <div class="relative w-full">
                                        <select
                                            class="w-full pl-8 pr-2 py-1.5 text-xs bg-background/50 border border-border rounded-md focus:outline-none focus:ring-1 focus:ring-primary appearance-none"
                                            [ngModel]="chapterService.activeChapterId()"
                                            (ngModelChange)="onChapterSelect($event)"
                                        >
                                            <option value="global">Base Attributes</option>
                                            @for (chap of chapterService.chapters(); track chap.id) {
                                                <option [value]="chap.id">{{ chap.title }}</option>
                                            }
                                        </select>
                                        <lucide-icon name="book-open" class="absolute left-2.5 top-1.5 h-3.5 w-3.5 text-muted-foreground pointer-events-none"></lucide-icon>
                                        <lucide-icon name="chevron-down" class="absolute right-2 top-1.5 h-3.5 w-3.5 text-muted-foreground pointer-events-none opacity-50"></lucide-icon>
                                    </div>
                                </div>

                                <!-- Entity Selector -->
                                @if (entities().length > 0) {
                                    <select
                                        class="w-full px-2 py-1.5 text-sm bg-background border border-border rounded-md focus:outline-none focus:ring-1 focus:ring-primary"
                                        [ngModel]="selectedEntityId()"
                                        (ngModelChange)="onEntitySelect($event)"
                                    >
                                        @for (ent of entities(); track ent.id) {
                                            <option [value]="ent.id">{{ ent.kind }} | {{ ent.label }}</option>
                                        }
                                    </select>

                                }
                            </div>
                            
                            <!-- Fact Sheet -->
                            <div class="flex-1 overflow-hidden">
                                <app-fact-sheet-container 
                                    [entity]="selectedEntity()" 
                                    [contextId]="chapterService.activeChapterId()"
                                />
                            </div>

                            <!-- Empty state for entities -->
                            @if (entities().length === 0 && !loading()) {
                                <div class="flex-1 flex flex-col items-center justify-center p-6 text-center">
                                    <lucide-icon name="sparkles" class="h-12 w-12 text-muted-foreground/50 mb-4"></lucide-icon>
                                    <p class="text-sm text-muted-foreground">No entities registered</p>
                                    <p class="text-xs text-muted-foreground/70 mt-1">
                                        Create entities in your notes to see them here
                                    </p>
                                </div>
                            }
                        }

                        @case ('analytics') {
                            <!-- Analytics Panel -->
                            <div class="flex-1 overflow-auto custom-scrollbar p-3">
                                <app-analytics-panel />
                            </div>
                        }

                        @case ('timeline') {
                            <!-- Timeline View -->
                            <div class="flex-1 overflow-auto custom-scrollbar">
                                <app-timeline-view />
                            </div>
                        }

                        @case ('ai') {
                            <!-- AI Chat Panel -->
                            <div class="flex-1 overflow-hidden">
                                <app-ai-chat-panel />
                            </div>
                        }
                    }
                </div>

                <!-- Footer -->
                <div class="h-8 flex items-center px-3 border-t border-sidebar-border shrink-0 text-xs bg-gradient-to-r from-[#115e59] via-[#134e4a] to-[#0f2a2e] text-slate-200 shadow-[0_-4px_6px_-1px_rgba(0,0,0,0.1),0_-2px_4px_-1px_rgba(0,0,0,0.06)] relative z-10 transition-colors duration-300">
                    @if (activeView() === 'entities') {
                        <span>{{ entities().length }} entities</span>
                    } @else if (activeView() === 'ai') {
                        <span>Kammi AI</span>
                    } @else {
                        <span>Real-time analysis</span>
                    }
                </div>
            }
        </aside>
    `,
    styles: [`
        .view-selector-wrapper {
            position: relative;
            width: 100%;
        }

        /* Replaced native select hack with real interaction */

        .view-selector-display {
            display: flex;
            align-items: center;
            gap: 0.5rem;
            height: 100%; /* Fill wrapper height (h-8 = 32px) */
            padding: 0 0.75rem;
            background: rgba(255, 255, 255, 0.05); /* Transparent block */
            border: 1px solid rgba(255, 255, 255, 0.1);
            border-radius: 0.375rem;
            font-size: 0.875rem;
            font-weight: 500;
            color: #f1f5f9; /* Slate-100/White */
            cursor: pointer;
            transition: all 0.2s ease;
        }

        .view-selector-display:hover {
            background: rgba(255, 255, 255, 0.1);
            border-color: rgba(255, 255, 255, 0.2);
        }
        .custom-scrollbar {
            scrollbar-width: thin;
            scrollbar-color: rgba(255, 255, 255, 0.1) transparent;
        }

        .custom-scrollbar::-webkit-scrollbar {
            width: 6px;
        }

        .custom-scrollbar::-webkit-scrollbar-track {
            background: transparent;
        }

        .custom-scrollbar::-webkit-scrollbar-thumb {
            background-color: rgba(255, 255, 255, 0.1);
            border-radius: 3px;
        }

        .custom-scrollbar::-webkit-scrollbar-thumb:hover {
            background-color: rgba(255, 255, 255, 0.2);
        }
    `]
})
export class RightSidebarComponent implements OnInit, OnDestroy {
    service = inject(RightSidebarService);
    chapterService = inject(ChapterService);
    private factSheetService = inject(FactSheetService);
    private scopeService = inject(ScopeService);

    // Expose scope for template
    activeScope = this.scopeService.activeScope;

    // Scope display helpers
    scopeIcon = computed(() => {
        const scope = this.activeScope();
        if (scope.id === 'vault:global') return 'pi-globe';
        if (scope.type === 'act') return 'pi-bookmark';  // ACT scope icon
        if (scope.type === 'narrative') return 'pi-book';
        if (scope.type === 'folder') return 'pi-folder';
        return 'pi-file';
    });

    scopeLabel = signal<string>('Global');

    readonly viewOptions = VIEW_OPTIONS;

    /** Active view (persisted) */
    activeView = signal<SidebarView>(this.loadSavedView());

    /** Dropdown state */
    isDropdownOpen = signal(false);

    /** Loading state */
    loading = signal(true);

    /** All entities from registry + Dexie */
    entities = signal<ParsedEntity[]>([]);

    /** Currently selected entity ID */
    selectedEntityId = signal<string>('');

    /** Computed selected entity */
    selectedEntity = computed(() => {
        const id = this.selectedEntityId();
        return this.entities().find(e => e.id === id) || null;
    });

    /** Current view display helpers */
    currentViewLabel = computed(() => {
        const opt = VIEW_OPTIONS.find(o => o.value === this.activeView());
        return opt?.label || 'Entities';
    });

    currentViewIcon = computed(() => {
        const opt = VIEW_OPTIONS.find(o => o.value === this.activeView());
        return opt?.icon || Sparkles;
    });

    private loadSavedView(): SidebarView {
        const saved = localStorage.getItem(STORAGE_KEY);
        if (saved === 'entities' || saved === 'analytics' || saved === 'timeline' || saved === 'ai') {
            return saved as SidebarView;
        }
        return 'entities';
    }

    private unsubscribeRegistry: (() => void) | null = null;

    constructor() {
        // React to scope changes
        effect(() => {
            const scope = this.activeScope();
            this.updateScopeLabel(scope);
            this.refreshEntitiesByScope(scope);
        });
    }

    async ngOnInit() {
        // Initial load handled by effect
        this.loading.set(false);

        // Subscribe to registry changes to refresh entities
        this.unsubscribeRegistry = smartGraphRegistry.subscribe(() => {
            this.refreshEntitiesByScope(this.activeScope());
        });
    }

    ngOnDestroy() {
        this.unsubscribeRegistry?.();
    }

    private async updateScopeLabel(scope: ActiveScope) {
        if (scope.id === 'vault:global') {
            this.scopeLabel.set('Global');
        } else if (scope.type === 'act') {
            // ACT scope: Get the ACT folder name
            const actId = scope.actId || scope.id;
            const folder = await db.folders.get(actId);
            this.scopeLabel.set(folder?.name || 'Act');
        } else if (scope.type === 'folder' || scope.type === 'narrative') {
            const folder = await db.folders.get(scope.id);
            this.scopeLabel.set(folder?.name || 'Folder');
        } else if (scope.type === 'note') {
            const note = await db.notes.get(scope.id);
            this.scopeLabel.set(note?.title || 'Note');
        }
    }

    /**
     * Refresh entity list using ScopeService (respects active scope)
     */
    private async refreshEntitiesByScope(scope: ActiveScope): Promise<void> {
        try {
            const scopedEntities = await this.scopeService.getEntitiesInScope(scope);
            const parsed: ParsedEntity[] = scopedEntities.map((e: Entity) => ({
                id: e.id,
                kind: e.kind,
                label: e.label,
                subtype: e.subtype,
                noteId: e.firstNote,
            }));
            this.entities.set(parsed);

            // Auto-select first if current selection is no longer in scope
            const currentId = this.selectedEntityId();
            if (parsed.length > 0 && !parsed.find(e => e.id === currentId)) {
                this.selectedEntityId.set(parsed[0].id);
            }
        } catch (err) {
            console.error('[RightSidebar] Error loading scoped entities:', err);
        }
    }

    onViewChange(view: SidebarView) {
        this.activeView.set(view);
        localStorage.setItem(STORAGE_KEY, view);
        this.closeDropdown();
    }

    toggleDropdown() {
        this.isDropdownOpen.update(v => !v);
    }

    closeDropdown() {
        this.isDropdownOpen.set(false);
    }

    /**
     * Load entities from Dexie (source of truth)
     * FactSheetService already creates demo entity if none exist
     */
    /**
     * Load entities is now handled by the scope effect.
     * This method is kept for backwards compatibility but delegates to scope-based loading.
     */
    async loadEntities() {
        await this.refreshEntitiesByScope(this.activeScope());
    }

    onEntitySelect(entityId: string) {
        this.selectedEntityId.set(entityId);
    }

    onChapterSelect(chapterId: string) {
        const val = chapterId === 'global' ? 'global' : chapterId;
        this.chapterService.setManualChapter(val);
    }
}
