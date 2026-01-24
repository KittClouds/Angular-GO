import { Component, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { smartGraphRegistry } from '../../../../lib/registry';
import type { RegisteredEntity } from '../../../../lib/registry';
import { GraphDetailComponent } from './graph-detail/graph-detail.component';

@Component({
    selector: 'app-graph-tab',
    standalone: true,
    imports: [CommonModule, GraphDetailComponent],
    templateUrl: './graph-tab.component.html',
    styleUrl: './graph-tab.component.css'
})
export class GraphTabComponent implements OnInit {
    entities: RegisteredEntity[] = [];
    selectedEntity: RegisteredEntity | null = null;

    constructor() { }

    ngOnInit() {
        console.log('[GraphTab] Requesting initial entity refresh...');
        this.refreshEntities();
        if (typeof window !== 'undefined') {
            window.addEventListener('entities-changed', () => {
                console.log('[GraphTab] entities-changed event received. Refreshing list.');
                this.refreshEntities();
            });
        }
    }

    refreshEntities() {
        const allEntities = smartGraphRegistry.getAllEntities();
        console.log(`[GraphTab] refreshEntities called. Registry has ${allEntities.length} entities.`);
        this.entities = allEntities.sort((a, b) => a.label.localeCompare(b.label));
    }

    selectEntity(entity: RegisteredEntity) {
        this.selectedEntity = entity;
    }

    getKindColor(kind: string): string {
        const colors: Record<string, string> = {
            'CHARACTER': '#ef4444',
            'LOCATION': '#22c55e',
            'EVENT': '#eab308',
            'FACTION': '#a855f7',
            'NOTE': '#3b82f6'
        };
        return colors[kind] || '#6b7280';
    }
}
