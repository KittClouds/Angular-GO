import { Component, computed, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ScopeService, ScopeType } from '../../../lib/services/scope.service';
import { liveQuery } from 'dexie';
import { db } from '../../../lib/dexie/db';
import { from } from 'rxjs';
import { toSignal } from '@angular/core/rxjs-interop';

@Component({
    selector: 'app-scope-indicator',
    standalone: true,
    imports: [CommonModule],
    template: `
    <button (click)="resetScope()" 
            class="flex items-center gap-1.5 text-white/80 hover:text-white transition-colors focus:outline-none group"
            [title]="tooltip()">
      <!-- Icon based on scope type -->
      <i class="pi text-[10px]" 
         [class.pi-globe]="scopeType() === 'folder' && isGlobal()"
         [class.pi-folder]="scopeType() === 'folder' && !isGlobal()"
         [class.pi-book]="scopeType() === 'narrative'"
         [class.pi-file]="scopeType() === 'note'"></i>
      
      <span class="max-w-[150px] truncate">{{ displayLabel() }}</span>
      
      <!-- Reset X (only if not global) -->
      <i *ngIf="!isGlobal()" class="pi pi-times text-[9px] opacity-0 group-hover:opacity-100 transition-opacity ml-1"></i>
    </button>
  `
})
export class ScopeIndicatorComponent {
    private scopeService = inject(ScopeService);

    // Expose active scope signal
    activeScope = this.scopeService.activeScope;

    // Computed helpers
    scopeType = computed(() => this.activeScope().type);
    scopeId = computed(() => this.activeScope().id);
    isGlobal = computed(() => this.activeScope().id === 'vault:global');

    // Async signal to look up names from DB based on ID
    // This re-runs whenever scopeId() changes
    scopeName = toSignal(
        from(liveQuery(async () => {
            const scope = this.activeScope();
            if (scope.id === 'vault:global') return 'Global';

            if (scope.type === 'folder') {
                const folder = await db.folders.get(scope.id);
                return folder?.name || 'Unknown Folder';
            }

            if (scope.type === 'narrative') {
                // Narrative ID usually maps to a Root Folder or a specific entity
                // For now, let's assume it maps to a Folder with that ID (the vault root)
                const folder = await db.folders.get(scope.id);
                return folder?.name || 'Narrative Vault';
            }

            if (scope.type === 'note') {
                const note = await db.notes.get(scope.id);
                return note?.title || 'Untitled Note';
            }

            return scope.id;
        })),
        { initialValue: 'Global' }
    );

    displayLabel = computed(() => {
        return this.scopeName() || 'Global';
    });

    tooltip = computed(() => {
        if (this.isGlobal()) return 'Global Scope (All Entities)';
        return `Click to reset to Global Scope`;
    });

    resetScope() {
        this.scopeService.resetToGlobal();
    }
}
