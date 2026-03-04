import { Component, computed, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ScopeService } from '../../../lib/services/scope.service';

@Component({
    selector: 'app-scope-indicator',
    standalone: true,
    imports: [CommonModule],
    template: `
    <button (click)="resetScope()" 
            class="flex items-center gap-1.5 text-white/80 hover:text-white transition-colors focus:outline-none group"
            [title]="tooltip()">
      <!-- Icon based on scope type -->
      <i class="pi text-[10px]" [ngClass]="scopeService.scopeIcon()"></i>
      
      <span class="max-w-[150px] truncate">{{ scopeService.scopeLabel() }}</span>
      
      <!-- Reset X (only if not global) -->
      <i *ngIf="!scopeService.isGlobal()" class="pi pi-times text-[9px] opacity-0 group-hover:opacity-100 transition-opacity ml-1"></i>
    </button>
  `
})
export class ScopeIndicatorComponent {
    scopeService = inject(ScopeService);

    tooltip = computed(() => {
        if (this.scopeService.isGlobal()) return 'Global Scope (All Entities)';
        return `Click to reset to Global Scope`;
    });

    resetScope() {
        this.scopeService.resetToGlobal();
    }
}
