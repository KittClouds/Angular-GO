import { Component, computed, inject, signal, ViewChild } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ButtonModule } from 'primeng/button';
import { Menu } from 'primeng/menu';
import { ToggleSwitch } from 'primeng/toggleswitch';
import { ConfirmDialog } from 'primeng/confirmdialog';
import { ConfirmationService, MenuItem } from 'primeng/api';
import { PatternRegistryService } from '../../../../lib/refs/patterns/registry';
import { PatternDefinition } from '../../../../lib/refs/patterns/schema';
import { RefKind } from '../../../../lib/refs/types';
import { PatternEditorComponent } from './pattern-editor/pattern-editor.component';

@Component({
    selector: 'app-patterns-tab',
    standalone: true,
    imports: [
        CommonModule,
        FormsModule,
        ButtonModule,
        Menu,
        ToggleSwitch,
        ConfirmDialog,
        PatternEditorComponent
    ],
    providers: [ConfirmationService],
    templateUrl: './patterns-tab.component.html',
    styles: [`
    :host { display: block; height: 100%; }
  `]
})
export class PatternsTabComponent {
    private registry = inject(PatternRegistryService);
    private confirmationService = inject(ConfirmationService);

    @ViewChild('menu') menu!: Menu;

    // State
    view = signal<'list' | 'editor' | 'tester'>('list');
    editingPattern = signal<PatternDefinition | null>(null);
    isCreating = signal(false);

    // Menu State
    menuPattern = signal<PatternDefinition | null>(null);

    menuItems = computed(() => {
        const pattern = this.menuPattern();
        if (!pattern) return [];

        const items: MenuItem[] = [
            {
                label: 'Test Pattern',
                icon: 'pi pi-code',
                command: () => { /* TODO: Test */ }
            },
            {
                label: 'Edit',
                icon: 'pi pi-pencil',
                command: () => this.handleEdit(pattern)
            }
        ];

        if (!pattern.isBuiltIn) {
            items.push({
                label: 'Delete',
                icon: 'pi pi-trash',
                styleClass: 'text-red-500',
                command: () => this.handleDelete(pattern)
            });
        }

        return items;
    });

    // Patterns list signal
    patterns = signal<PatternDefinition[]>(this.registry.getAllPatterns());

    // Computed: Grouped Patterns
    groupedPatterns = computed(() => {
        const groups: Record<string, PatternDefinition[]> = {};
        const all = this.patterns();

        for (const p of all) {
            if (!groups[p.kind]) {
                groups[p.kind] = [];
            }
            groups[p.kind].push(p);
        }

        // Sort by priority
        for (const kind of Object.keys(groups)) {
            groups[kind].sort((a, b) => b.priority - a.priority);
        }

        return groups;
    });

    // Computed: Stats
    stats = computed(() => {
        const all = this.patterns();
        return {
            total: all.length,
            enabled: all.filter(p => p.enabled).length,
            custom: all.filter(p => !p.isBuiltIn).length
        };
    });

    kindColors: Record<RefKind, string> = {
        entity: 'bg-emerald-500/20 text-emerald-600 border-emerald-500/30',
        wikilink: 'bg-blue-500/20 text-blue-600 border-blue-500/30',
        backlink: 'bg-purple-500/20 text-purple-600 border-purple-500/30',
        tag: 'bg-sky-500/20 text-sky-600 border-sky-500/30',
        mention: 'bg-violet-500/20 text-violet-600 border-violet-500/30',
        triple: 'bg-amber-500/20 text-amber-600 border-amber-500/30',
        temporal: 'bg-orange-500/20 text-orange-600 border-orange-500/30',
        custom: 'bg-gray-500/20 text-gray-600 border-gray-500/30',
    };

    refreshPatterns() {
        this.patterns.set(this.registry.getAllPatterns());
    }

    handleToggle(id: string, enabled: boolean) {
        this.registry.togglePattern(id, enabled);
        this.refreshPatterns();
    }

    handleCreateNew() {
        const newPattern: PatternDefinition = {
            id: `custom:${Date.now()}`,
            name: 'New Pattern',
            description: '',
            kind: 'custom',
            enabled: true,
            priority: 50,
            pattern: '',
            flags: 'g',
            captures: {},
            rendering: {
                widgetMode: false,
            },
            isBuiltIn: false,
            createdAt: Date.now(),
        };
        this.editingPattern.set(newPattern);
        this.isCreating.set(true);
        this.view.set('editor');
    }

    handleEdit(pattern: PatternDefinition) {
        this.editingPattern.set({ ...pattern });
        this.isCreating.set(false);
        this.view.set('editor');
    }

    handleDelete(pattern: PatternDefinition) {
        this.confirmationService.confirm({
            message: `Are you sure you want to delete "${pattern.name}"?`,
            header: 'Delete Pattern',
            icon: 'pi pi-exclamation-triangle',
            accept: () => {
                this.registry.unregister(pattern.id);
                this.refreshPatterns();
            }
        });
    }

    handleSave(pattern: PatternDefinition) {
        this.registry.register(pattern);
        this.refreshPatterns();
        this.view.set('list');
        this.editingPattern.set(null);
    }

    handleCancelEdit() {
        this.view.set('list');
        this.editingPattern.set(null);
    }

    handleReset() {
        this.confirmationService.confirm({
            message: 'Are you sure you want to reset all patterns to default? Custom patterns will be lost.',
            header: 'Reset Patterns',
            icon: 'pi pi-exclamation-triangle',
            accept: () => {
                this.registry.reset();
                this.refreshPatterns();
            }
        });
    }

    openMenu(event: Event, pattern: PatternDefinition) {
        this.menuPattern.set(pattern);
        this.menu.toggle(event);
    }
}
