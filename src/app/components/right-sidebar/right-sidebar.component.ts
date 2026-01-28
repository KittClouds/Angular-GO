import { Component, inject, signal, OnInit, OnDestroy, computed } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { LucideAngularModule, Sparkles, BarChart3, ChevronDown } from 'lucide-angular';
import { RightSidebarService } from '../../lib/services/right-sidebar.service';
import { FactSheetContainerComponent, ParsedEntity } from '../fact-sheets/fact-sheet-container/fact-sheet-container.component';
import { FactSheetService } from '../fact-sheets/fact-sheet.service';
import { AnalyticsPanelComponent } from '../analytics-panel';
import { smartGraphRegistry } from '../../lib/registry';
import { db } from '../../lib/dexie';

type SidebarView = 'entities' | 'analytics';

interface ViewOption {
    value: SidebarView;
    label: string;
    icon: string;
}

const VIEW_OPTIONS: ViewOption[] = [
    { value: 'entities', label: 'Entities', icon: 'sparkles' },
    { value: 'analytics', label: 'Analytics', icon: 'bar-chart-3' },
];

const STORAGE_KEY = 'right-sidebar:tab';

@Component({
    selector: 'app-right-sidebar',
    standalone: true,
    imports: [CommonModule, FormsModule, LucideAngularModule, FactSheetContainerComponent, AnalyticsPanelComponent],
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
                            <lucide-icon [name]="currentViewIcon()" class="h-4 w-4"></lucide-icon>
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
                                        <lucide-icon [name]="opt.icon" class="h-4 w-4 opacity-70"></lucide-icon>
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
                            @if (entities().length > 0) {
                                <div class="p-2 border-b border-border/50 shrink-0">
                                    <select
                                        class="w-full px-2 py-1.5 text-sm bg-background border border-border rounded-md focus:outline-none focus:ring-1 focus:ring-primary"
                                        [ngModel]="selectedEntityId()"
                                        (ngModelChange)="onEntitySelect($event)"
                                    >
                                        @for (ent of entities(); track ent.id) {
                                            <option [value]="ent.id">{{ ent.kind }} | {{ ent.label }}</option>
                                        }
                                    </select>
                                </div>
                            }
                            
                            <!-- Fact Sheet -->
                            <div class="flex-1 overflow-hidden">
                                <app-fact-sheet-container [entity]="selectedEntity()" />
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
                    }
                </div>

                <!-- Footer -->
                <div class="h-8 flex items-center px-3 border-t border-sidebar-border shrink-0 text-xs bg-gradient-to-r from-[#115e59] via-[#134e4a] to-[#0f2a2e] text-slate-200 shadow-[0_-4px_6px_-1px_rgba(0,0,0,0.1),0_-2px_4px_-1px_rgba(0,0,0,0.06)] relative z-10 transition-colors duration-300">
                    @if (activeView() === 'entities') {
                        <span>{{ entities().length }} entities</span>
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
    private factSheetService = inject(FactSheetService);

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
        return opt?.icon || 'sparkles';
    });

    private loadSavedView(): SidebarView {
        const saved = localStorage.getItem(STORAGE_KEY);
        if (saved === 'entities' || saved === 'analytics') {
            return saved;
        }
        return 'entities';
    }

    private unsubscribeRegistry: (() => void) | null = null;

    async ngOnInit() {
        await this.loadEntities();
        this.loading.set(false);

        // Subscribe to registry changes to keep entity list in sync
        this.unsubscribeRegistry = smartGraphRegistry.subscribe(() => {
            this.refreshEntitiesFromRegistry();
        });
    }

    ngOnDestroy() {
        this.unsubscribeRegistry?.();
    }

    /**
     * Refresh entity list from registry (called on registry changes)
     */
    private refreshEntitiesFromRegistry(): void {
        const registryEntities = smartGraphRegistry.getAllEntities();
        const parsed: ParsedEntity[] = registryEntities.map(e => ({
            id: e.id,
            kind: e.kind,
            label: e.label,
            subtype: e.subtype,
            noteId: e.firstNote,
        }));
        this.entities.set(parsed);

        // Auto-select first if none selected
        if (parsed.length > 0 && !this.selectedEntityId()) {
            this.selectedEntityId.set(parsed[0].id);
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
    async loadEntities() {
        try {
            // Try registry first (in-memory cache)
            const registryEntities = smartGraphRegistry.getAllEntities();

            if (registryEntities.length > 0) {
                const parsed: ParsedEntity[] = registryEntities.map(e => ({
                    id: e.id,
                    kind: e.kind,
                    label: e.label,
                    subtype: e.subtype,
                    noteId: e.firstNote,
                }));
                this.entities.set(parsed);

                // Auto-select first
                if (parsed.length > 0 && !this.selectedEntityId()) {
                    this.selectedEntityId.set(parsed[0].id);
                }
                return;
            }

            // Fall back to Dexie directly
            const dexieEntities = await db.entities.toArray();
            const parsed: ParsedEntity[] = dexieEntities.map(e => ({
                id: e.id,
                kind: e.kind,
                label: e.label,
                subtype: e.subtype,
                noteId: e.firstNote,
            }));
            this.entities.set(parsed);

            // Auto-select first
            if (parsed.length > 0 && !this.selectedEntityId()) {
                this.selectedEntityId.set(parsed[0].id);
            }
        } catch (err) {
            console.error('[RightSidebar] Error loading entities:', err);
        }
    }

    onEntitySelect(entityId: string) {
        this.selectedEntityId.set(entityId);
    }
}
