import { Component, Input, OnChanges, SimpleChanges } from '@angular/core';
import { CommonModule } from '@angular/common';
import { LucideAngularModule, User, Users, MapPin, Calendar, Hash, FileText, Zap, Tag } from 'lucide-angular';
import { smartGraphRegistry } from '../../../../../lib/registry';
import type { RegisteredEntity } from '../../../../../lib/registry';
import { ConnectionGroup, ConnectionGroupComponent } from './connection-group/connection-group.component';
import { EntityKind } from '../../../../../lib/Scanner/types';

// Replicating entity types and colors locally for now
const ENTITY_ICONS: Record<string, any> = {
    'CHARACTER': User,
    'FACTION': Users,
    'LOCATION': MapPin,
    'EVENT': Calendar,
    'OBJECT': Hash,
    'LORE': FileText,
    'SPECIES': Users,
    'ABILITY': Zap,
    'UNKNOWN': Tag
};

const ENTITY_COLORS: Record<string, string> = {
    'CHARACTER': '#ef4444',
    'FACTION': '#8b5cf6',
    'LOCATION': '#10b981',
    'EVENT': '#f59e0b',
    'OBJECT': '#6366f1',
    'LORE': '#06b6d4',
    'SPECIES': '#ec4899',
    'ABILITY': '#eab308',
    'UNKNOWN': '#64748b'
};

@Component({
    selector: 'app-graph-detail',
    standalone: true,
    imports: [CommonModule, LucideAngularModule, ConnectionGroupComponent],
    template: `
        <div class="p-4 space-y-6 animate-in fade-in duration-300">
            <!-- Entity Focus Node -->
            <div class="flex flex-col items-center">
                <div class="relative w-20 h-20 rounded-2xl flex items-center justify-center shadow-lg transition-transform hover:scale-105"
                     [style.backgroundColor]="getBgColor(entity.kind)"
                     [style.border]="'2px solid ' + getBorderColor(entity.kind)">
                    
                    <lucide-icon [img]="getIcon(entity.kind)" [class]="'w-10 h-10'" [style.color]="getColor(entity.kind)"></lucide-icon>
                    
                    <div class="absolute -bottom-1 -right-1 w-6 h-6 rounded-full bg-background border-2 flex items-center justify-center text-[10px] font-bold"
                         [style.borderColor]="getColor(entity.kind)"
                         [style.color]="getColor(entity.kind)">
                        {{ totalConnections }}
                    </div>
                </div>
                
                <h2 class="mt-3 text-lg font-semibold text-foreground">{{ entity.label }}</h2>
                
                <div class="flex items-center gap-2 mt-1">
                    <span class="text-xs px-2 py-0.5 rounded-full border"
                          [style.borderColor]="getColor(entity.kind)"
                          [style.color]="getColor(entity.kind)">
                        {{ entity.kind }}
                    </span>
                </div>
            </div>

            <!-- Connection Lines Visual -->
            <div *ngIf="totalConnections > 0" class="flex justify-center">
                <div class="w-px h-6 bg-gradient-to-b from-border to-transparent"></div>
            </div>

            <!-- Connections Grid -->
            <div *ngIf="groupedRelationships.length > 0; else emptyState" class="space-y-4">
                <app-connection-group
                    *ngFor="let group of groupedRelationships"
                    [group]="group"
                    (onNavigate)="onNavigate($event)">
                </app-connection-group>
            </div>

            <ng-template #emptyState>
                <div class="text-center py-6 text-muted-foreground text-sm">
                    No connections yet
                </div>
            </ng-template>
        </div>
    `
})
export class GraphDetailComponent implements OnChanges {
    @Input() entity!: RegisteredEntity;

    groupedRelationships: ConnectionGroup[] = [];
    totalConnections = 0;

    ngOnChanges(changes: SimpleChanges) {
        if (changes['entity'] && this.entity) {
            this.refreshConnections();
        }
    }

    refreshConnections() {
        if (!this.entity) return;

        const edges = smartGraphRegistry.getEdgesForEntity(this.entity.id);
        this.totalConnections = edges.length;

        // Group by Type (e.g. "RIVALS_WITH")
        const groups: Record<string, ConnectionGroup> = {};

        for (const edge of edges) {
            if (!groups[edge.type]) {
                groups[edge.type] = { type: edge.type, connections: [] };
            }

            const isSource = edge.sourceId === this.entity.id;
            const otherId = isSource ? edge.targetId : edge.sourceId;
            const otherEntity = smartGraphRegistry.getEntityById(otherId);

            if (otherEntity) {
                groups[edge.type].connections.push({
                    id: edge.id,
                    entity: otherEntity,
                    direction: isSource ? 'outgoing' : 'incoming',
                    confidence: edge.confidence
                });
            }
        }

        this.groupedRelationships = Object.values(groups);
    }

    onNavigate(target: RegisteredEntity) {
        // TODO: Bubble up navigation event to parent tab
        console.log('[GraphDetail] Navigate to:', target.label);
    }

    getColor(kind: string): string {
        return ENTITY_COLORS[kind as EntityKind] || ENTITY_COLORS['UNKNOWN'];
    }

    getBgColor(kind: string): string {
        return `${this.getColor(kind)}25`; // ~15% opacity
    }

    getBorderColor(kind: string): string {
        return `${this.getColor(kind)}66`; // ~40% opacity
    }

    getIcon(kind: string): any {
        return ENTITY_ICONS[kind as EntityKind] || ENTITY_ICONS['UNKNOWN'];
    }
}
