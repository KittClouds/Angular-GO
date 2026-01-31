import { Component, signal, inject, OnInit, OnDestroy, computed, effect } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ButtonModule } from 'primeng/button';
import { TagModule } from 'primeng/tag';
import { ScrollPanelModule } from 'primeng/scrollpanel';
import { MessageService } from 'primeng/api';
import { ToastModule } from 'primeng/toast';
import { DialogModule } from 'primeng/dialog';
import { InputTextModule } from 'primeng/inputtext';
import { TextareaModule } from 'primeng/textarea';
import { AccordionModule } from 'primeng/accordion';
import { Subscription } from 'rxjs';

import { CodexService, WORLDBUILDING_CATEGORIES, CategoryDef } from '../../../../lib/services/codex.service';
import { ScopeService } from '../../../../lib/services/scope.service';
import { CodexEntry } from '../../../../lib/dexie/db';

interface CategoryWithFacts {
    category: CategoryDef;
    facts: CodexEntry[];
}

@Component({
    selector: 'app-worldbuilding-tab',
    standalone: true,
    imports: [
        CommonModule,
        FormsModule,
        ButtonModule,
        TagModule,
        ScrollPanelModule,
        ToastModule,
        DialogModule,
        InputTextModule,
        TextareaModule,
        AccordionModule
    ],
    providers: [MessageService],
    templateUrl: './worldbuilding-tab.component.html',
    styles: [`
        :host { display: block; height: 100%; }
    `]
})
export class WorldbuildingTabComponent implements OnInit, OnDestroy {
    private codexService = inject(CodexService);
    private scopeService = inject(ScopeService);
    private messageService = inject(MessageService);
    private subscription?: Subscription;

    // Data
    allFacts = signal<CodexEntry[]>([]);
    categories = signal<CategoryDef[]>(WORLDBUILDING_CATEGORIES);

    // Computed: Group facts by category with counts
    categoriesWithFacts = computed<CategoryWithFacts[]>(() => {
        const facts = this.allFacts();
        return this.categories().map(category => ({
            category,
            facts: facts.filter(f => f.category === category.id).sort((a, b) => a.order - b.order)
        }));
    });

    // Selected category for expanded view
    selectedCategory = signal<string | null>(null);

    // Entity focus
    hasEntityFocus = signal(false);
    focusedEntityLabel = signal<string | null>(null);

    // Add fact dialog
    showAddDialog = signal(false);
    newFactTitle = '';
    newFactDescription = '';
    addingToCategory: CategoryDef | null = null;

    constructor() {
        effect(() => {
            const narrativeId = this.scopeService.activeNarrativeId() || '';
            this.loadFacts(narrativeId);
        });
    }

    ngOnInit() {
        // Initial load handled by effect
    }

    ngOnDestroy() {
        this.subscription?.unsubscribe();
    }

    private loadFacts(narrativeId: string) {
        this.subscription?.unsubscribe();
        this.subscription = this.codexService.getFacts$(narrativeId).subscribe(facts => {
            this.allFacts.set(facts);
        });
    }

    getIconContainerStyle(category: CategoryDef): any {
        return { backgroundColor: `${category.color}15` };
    }

    getIconStyle(category: CategoryDef): any {
        return { color: category.color };
    }

    getFactCount(categoryId: string): number {
        return this.categoriesWithFacts().find(c => c.category.id === categoryId)?.facts.length || 0;
    }

    // ─── Actions ────────────────────────────────────────────

    onCategoryClick(category: CategoryDef) {
        // Toggle expanded view
        if (this.selectedCategory() === category.id) {
            this.selectedCategory.set(null);
        } else {
            this.selectedCategory.set(category.id);
        }
    }

    openAddFactDialog(category: CategoryDef, event: Event) {
        event.stopPropagation();
        this.addingToCategory = category;
        this.newFactTitle = '';
        this.newFactDescription = '';
        this.showAddDialog.set(true);
    }

    async createFact() {
        if (!this.newFactTitle.trim() || !this.addingToCategory) {
            return;
        }

        const narrativeId = this.scopeService.activeNarrativeId() || '';

        try {
            await this.codexService.createEntry({
                narrativeId,
                entryType: 'fact',
                title: this.newFactTitle.trim(),
                description: this.newFactDescription.trim(),
                status: 'draft',
                category: this.addingToCategory.id,
                order: this.getFactCount(this.addingToCategory.id) + 1,
                entityIds: [],
            });

            this.messageService.add({
                severity: 'success',
                summary: 'Fact Added',
                detail: `"${this.newFactTitle}" added to ${this.addingToCategory.label}`
            });

            this.showAddDialog.set(false);
            this.resetForm();
        } catch (err) {
            console.error('[WorldbuildingTab] Error creating fact:', err);
            this.messageService.add({
                severity: 'error',
                summary: 'Error',
                detail: 'Failed to create fact'
            });
        }
    }

    cancelAdd() {
        this.showAddDialog.set(false);
        this.resetForm();
    }

    private resetForm() {
        this.newFactTitle = '';
        this.newFactDescription = '';
        this.addingToCategory = null;
    }

    async deleteFact(factId: string, event: Event) {
        event.stopPropagation();
        try {
            await this.codexService.deleteEntry(factId);
            this.messageService.add({
                severity: 'success',
                summary: 'Deleted',
                detail: 'Fact removed'
            });
        } catch (err) {
            console.error('[WorldbuildingTab] Error deleting fact:', err);
        }
    }

    getFactsForCategory(categoryId: string): CodexEntry[] {
        return this.categoriesWithFacts().find(c => c.category.id === categoryId)?.facts || [];
    }
}
