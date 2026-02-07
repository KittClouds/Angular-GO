import { Component, OnInit, OnDestroy, signal, computed, inject, effect } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ScrollingModule } from '@angular/cdk/scrolling';
import { ButtonModule } from 'primeng/button';
import { TooltipModule } from 'primeng/tooltip';
import { LucideAngularModule, Plus, Trash2, ChevronRight, ChevronDown, User, MapPin, Users, Package, Shield, Calendar, Lightbulb, Sparkles, Globe, Folder, BookOpen, FileText, Wand2 } from 'lucide-angular';
import { smartGraphRegistry } from '../../../../lib/registry';
import type { RegisteredEntity } from '../../../../lib/registry';
import { GraphDetailComponent } from './graph-detail/graph-detail.component';
import { EntityCreatorDialogComponent, EntityCreatorData } from './entity-creator-dialog/entity-creator-dialog.component';
import { ScopeService, GLOBAL_SCOPE, ActiveScope } from '../../../../lib/services/scope.service';
import { LlmEntityExtractorService } from '../../../../lib/services/llm-entity-extractor.service';
import { db } from '../../../../lib/dexie/db';

// Entity styling
const ENTITY_COLORS: Record<string, string> = {
    'CHARACTER': '#a855f7',
    'LOCATION': '#22c55e',
    'NPC': '#f59e0b',
    'ITEM': '#eab308',
    'FACTION': '#ef4444',
    'EVENT': '#3b82f6',
    'CONCEPT': '#8b5cf6',
    'OBJECT': '#6366f1',
    'LORE': '#06b6d4',
    'SPECIES': '#ec4899',
};

const ENTITY_ICONS: Record<string, any> = {
    'CHARACTER': User,
    'LOCATION': MapPin,
    'NPC': Users,
    'ITEM': Package,
    'FACTION': Shield,
    'EVENT': Calendar,
    'CONCEPT': Lightbulb,
};

interface EntityGroup {
    kind: string;
    entities: RegisteredEntity[];
    expanded: boolean;
}

@Component({
    selector: 'app-graph-tab',
    standalone: true,
    imports: [
        CommonModule,
        FormsModule,
        ScrollingModule,
        ButtonModule,
        TooltipModule,
        LucideAngularModule,
        GraphDetailComponent,
        EntityCreatorDialogComponent,
    ],
    templateUrl: './graph-tab.component.html',
    styleUrl: './graph-tab.component.css'
})
export class GraphTabComponent implements OnInit, OnDestroy {
    private scopeService = inject(ScopeService);
    private llmExtractor = inject(LlmEntityExtractorService);

    // Icons
    PlusIcon = Plus;
    Trash2Icon = Trash2;
    ChevronRightIcon = ChevronRight;
    ChevronDownIcon = ChevronDown;
    GlobeIcon = Globe;
    FolderIcon = Folder;
    BookIcon = BookOpen;
    FileIcon = FileText;
    WandIcon = Wand2;

    // State
    entities = signal<RegisteredEntity[]>([]);
    selectedEntity = signal<RegisteredEntity | null>(null);
    expandedKinds = signal<Set<string>>(new Set());
    isCreatorOpen = signal(false);
    editingEntity = signal<EntityCreatorData | undefined>(undefined);

    // Scope state
    activeScope = this.scopeService.activeScope;
    scopeLabel = signal<string>('Global');

    // Dropdown state
    isScopeMenuOpen = signal(false);
    hierarchyOptions = signal<{ label: string, type: string, scope: ActiveScope }[]>([]);

    // LLM Extraction state
    isExtracting = this.llmExtractor.isExtracting;
    extractionProgress = this.llmExtractor.extractionProgress;

    scopeIcon = computed(() => {
        const scope = this.activeScope();
        if (scope.id === 'vault:global') return this.GlobeIcon;
        if (scope.type === 'narrative') return this.BookIcon;
        if (scope.type === 'folder') return this.FolderIcon;
        return this.FileIcon;
    });

    constructor() {
        // React to scope changes
        effect(() => {
            const scope = this.activeScope();
            this.updateScopeLabel(scope);
            this.calculateScopeHierarchy(scope); // Calculate parent scopes
        });
    }

    private async updateScopeLabel(scope: ActiveScope) {
        if (scope.id === 'vault:global') {
            this.scopeLabel.set('Global');
        } else if (scope.type === 'folder' || scope.type === 'narrative') {
            const folder = await db.folders.get(scope.id);
            this.scopeLabel.set(folder?.name || 'Folder');
        } else if (scope.type === 'note') {
            const note = await db.notes.get(scope.id);
            this.scopeLabel.set(note?.title || 'Note');
        }
        // Refresh entities when scope changes
        this.refreshEntities();
    }

    /**
     * Build the hierarchy options for the dropdown
     * e.g. "My Note" -> "My Folder" -> "My Narrative" -> "Global"
     */
    private async calculateScopeHierarchy(scope: ActiveScope) {
        const options: { label: string, type: string, scope: ActiveScope }[] = [];

        // 1. Current Scope
        // (Skipping current scope in the list as it's already selected, 
        //  but maybe useful to show as "active")

        // 2. Parents
        if (scope.type === 'note') {
            const note = await db.notes.get(scope.id);
            if (note && note.folderId) {
                const folder = await db.folders.get(note.folderId);
                if (folder) {
                    options.push({
                        label: folder.name,
                        type: 'Folder',
                        scope: { type: 'folder', id: folder.id, narrativeId: folder.narrativeId }
                    });
                }
            }
        }

        // Narrative level validation (if current isn't already narrative)
        if (scope.type !== 'narrative' && scope.narrativeId) {
            // Usually narrativeId maps to a root folder
            const narrativeFolder = await db.folders.get(scope.narrativeId);
            if (narrativeFolder) {
                // Check if we haven't added it yet (e.g. if parent folder IS the narrative root)
                if (!options.find(o => o.scope.id === narrativeFolder.id)) {
                    options.push({
                        label: narrativeFolder.name,
                        type: 'Narrative',
                        scope: { type: 'narrative', id: narrativeFolder.id, narrativeId: narrativeFolder.id }
                    });
                }
            }
        }

        // 3. Global (Always available at bottom)
        options.push({
            label: 'Global Scope',
            type: 'Vault',
            scope: GLOBAL_SCOPE
        });

        this.hierarchyOptions.set(options);
    }

    toggleScopeMenu() {
        this.isScopeMenuOpen.update(v => !v);
    }

    closeScopeMenu() {
        this.isScopeMenuOpen.set(false);
    }

    switchToScope(option: { scope: ActiveScope }) {
        this.scopeService.setScope(option.scope);
        this.closeScopeMenu();
    }

    // Computed: Group entities by kind
    groupedEntities = computed<EntityGroup[]>(() => {
        const groups: Record<string, RegisteredEntity[]> = {};
        for (const entity of this.entities()) {
            if (!groups[entity.kind]) {
                groups[entity.kind] = [];
            }
            groups[entity.kind].push(entity);
        }

        const expanded = this.expandedKinds();
        return Object.entries(groups)
            .sort(([a], [b]) => a.localeCompare(b))
            .map(([kind, entities]) => ({
                kind,
                entities: entities.sort((a, b) => a.label.localeCompare(b.label)),
                expanded: expanded.has(kind),
            }));
    });

    totalEntities = computed(() => this.entities().length);

    private unsubscribeRegistry: (() => void) | null = null;

    ngOnInit() {
        this.refreshEntities();
        // Expand all groups by default
        const allKinds = new Set(this.entities().map(e => e.kind));
        this.expandedKinds.set(allKinds);

        // Subscribe to registry changes
        this.unsubscribeRegistry = smartGraphRegistry.subscribe(() => {
            this.refreshEntities();
        });

        if (typeof window !== 'undefined') {
            window.addEventListener('entities-changed', () => this.refreshEntities());
        }
    }

    ngOnDestroy() {
        this.unsubscribeRegistry?.();
    }

    async refreshEntities() {
        const scope = this.activeScope();
        let allEntities: RegisteredEntity[];

        if (scope.id === 'vault:global') {
            // Global: show all entities from the registry
            allEntities = smartGraphRegistry.getAllEntities();
        } else {
            // Scoped: get entities that are MENTIONED in notes within this scope
            // This uses the mentions table, not just firstNote
            const scopedDbEntities = await this.scopeService.getEntitiesInScope(scope);
            const scopedEntityIds = new Set(scopedDbEntities.map(e => e.id));

            // Filter registry entities by the scoped IDs
            allEntities = smartGraphRegistry.getAllEntities().filter(e =>
                scopedEntityIds.has(e.id)
            );
        }

        this.entities.set(allEntities);

        // Expand any new kinds
        const newKinds = new Set(allEntities.map(e => e.kind));
        this.expandedKinds.update(current => new Set([...current, ...newKinds]));
    }

    resetToGlobal() {
        this.scopeService.resetToGlobal();
    }

    toggleKind(kind: string) {
        this.expandedKinds.update(current => {
            const next = new Set(current);
            if (next.has(kind)) {
                next.delete(kind);
            } else {
                next.add(kind);
            }
            return next;
        });
    }

    selectEntity(entity: RegisteredEntity) {
        this.selectedEntity.set(entity);
    }

    openCreator() {
        this.editingEntity.set(undefined);
        this.isCreatorOpen.set(true);
    }

    editEntity(entity: RegisteredEntity, event: MouseEvent) {
        event.stopPropagation();
        this.editingEntity.set({
            id: entity.id,
            label: entity.label,
            kind: entity.kind,
            aliases: entity.aliases || [],
        });
        this.isCreatorOpen.set(true);
    }

    async deleteEntity(entity: RegisteredEntity, event: MouseEvent) {
        event.stopPropagation();
        await smartGraphRegistry.deleteEntity(entity.id);
        this.refreshEntities();
        if (this.selectedEntity()?.id === entity.id) {
            this.selectedEntity.set(null);
        }
    }

    async onSaveEntity(data: EntityCreatorData) {
        if (data.id) {
            // Editing
            await smartGraphRegistry.updateEntity(data.id, {
                label: data.label,
                kind: data.kind as any,
                aliases: data.aliases,
            });
        } else {
            // Creating
            await smartGraphRegistry.registerEntity(
                data.label,
                data.kind as any,
                'manual',
                { source: 'user', aliases: data.aliases }
            );
        }
        this.refreshEntities();
    }

    async flushRegistry() {
        if (confirm(`Delete all ${this.totalEntities()} entities? This cannot be undone.`)) {
            await smartGraphRegistry.clearAll();
            this.refreshEntities();
            this.selectedEntity.set(null);
        }
    }

    getColor(kind: string): string {
        return ENTITY_COLORS[kind] || '#6b7280';
    }

    getIcon(kind: string): any {
        return ENTITY_ICONS[kind] || Sparkles;
    }

    /**
     * Extract entities from all notes in current narrative using LLM
     * Shows confirmation with count before committing
     */
    async extractAllFromNarrative() {
        const scope = this.activeScope();

        // Must be in a narrative or folder scope
        if (scope.id === 'vault:global') {
            alert('Please select a narrative or folder scope first.');
            return;
        }

        const narrativeId = scope.narrativeId || scope.id;

        // Confirm action
        if (!confirm(`Extract entities from all notes in "${this.scopeLabel()}" using LLM?\n\nThis may take a moment for large folders.`)) {
            return;
        }

        try {
            // Extract
            const result = await this.llmExtractor.extractFromNarrative(narrativeId);

            if (result.entities.length === 0) {
                alert(`No new entities found in ${result.notesProcessed} notes.`);
                return;
            }

            // Show count confirmation
            const proceed = confirm(
                `Found ${result.entities.length} entities in ${result.notesProcessed} notes.\n\n` +
                `Click OK to add them to the registry.\n` +
                `(Already registered entities will be skipped.)`
            );

            if (!proceed) return;

            // Commit to registry
            const commitResult = await this.llmExtractor.commitToRegistry(result.entities, narrativeId);

            // Show result
            alert(
                `✅ Extraction complete!\n\n` +
                `• ${commitResult.created} new entities added\n` +
                `• ${commitResult.skipped} already registered (skipped)\n` +
                `• ${commitResult.updated} updated`
            );

            // Refresh entity list
            this.refreshEntities();

        } catch (err) {
            console.error('[GraphTab] Extraction failed:', err);
            alert(`Extraction failed: ${err}`);
        }
    }
}
