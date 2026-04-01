import { Component, EventEmitter, Input, OnChanges, Output, SimpleChanges } from '@angular/core';
import { CommonModule } from '@angular/common';
import { LucideAngularModule, Pencil, User, Users, MapPin, Calendar, Hash, FileText, Zap, Tag } from 'lucide-angular';
import { smartGraphRegistry } from '../../../../../lib/registry';
import type { RegisteredEntity } from '../../../../../lib/registry';
import { ConnectionGroup, ConnectionGroupComponent } from './connection-group/connection-group.component';
import { EntityKind } from '../../../../../lib/Scanner/types';
import { entityColorStore } from '../../../../../lib/store/entityColorStore';

const ENTITY_ICONS: Record<string, any> = {
    CHARACTER: User,
    FACTION: Users,
    LOCATION: MapPin,
    EVENT: Calendar,
    OBJECT: Hash,
    LORE: FileText,
    SPECIES: Users,
    ABILITY: Zap,
    UNKNOWN: Tag,
};

@Component({
    selector: 'app-graph-detail',
    standalone: true,
    imports: [CommonModule, LucideAngularModule, ConnectionGroupComponent],
    template: `
        <div class="p-4 space-y-6 animate-in fade-in duration-300">
            <div class="flex flex-col items-center">
                <div
                    class="relative flex h-20 w-20 items-center justify-center rounded-2xl shadow-lg transition-transform hover:scale-105"
                    [style.backgroundColor]="getBgColor(entity.kind)"
                    [style.border]="'2px solid ' + getBorderColor(entity.kind)"
                >
                    <lucide-icon [img]="getIcon(entity.kind)" [class]="'w-10 h-10'" [style.color]="getColor(entity.kind)"></lucide-icon>

                    <div
                        class="absolute -bottom-1 -right-1 flex h-6 w-6 items-center justify-center rounded-full border-2 bg-background text-[10px] font-bold"
                        [style.borderColor]="getColor(entity.kind)"
                        [style.color]="getColor(entity.kind)"
                    >
                        {{ totalConnections }}
                    </div>
                </div>

                <h2 class="mt-3 text-lg font-semibold text-foreground">{{ entity.label }}</h2>

                <div class="mt-1 flex items-center gap-2">
                    <span
                        class="rounded-full border px-2 py-0.5 text-xs"
                        [style.borderColor]="getColor(entity.kind)"
                        [style.color]="getColor(entity.kind)"
                    >
                        {{ entity.kind }}
                    </span>
                    <button
                        type="button"
                        class="inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] font-medium transition-colors hover:bg-accent/40"
                        [style.borderColor]="getColor(entity.kind)"
                        [style.color]="getColor(entity.kind)"
                        (click)="editRequested.emit(entity)"
                    >
                        <lucide-icon [img]="PencilIcon" class="h-3 w-3"></lucide-icon>
                        Edit
                    </button>
                </div>
            </div>

            <div *ngIf="totalConnections > 0" class="flex justify-center">
                <div class="h-6 w-px bg-gradient-to-b from-border to-transparent"></div>
            </div>

            <div *ngIf="groupedRelationships.length > 0; else emptyState" class="space-y-4">
                <app-connection-group
                    *ngFor="let group of groupedRelationships"
                    [group]="group"
                    (onNavigate)="onNavigate($event)"
                ></app-connection-group>
            </div>

            <ng-template #emptyState>
                <div class="py-6 text-center text-sm text-muted-foreground">
                    No connections yet
                </div>
            </ng-template>
        </div>
    `,
})
export class GraphDetailComponent implements OnChanges {
    @Input() entity!: RegisteredEntity;
    @Output() editRequested = new EventEmitter<RegisteredEntity>();

    groupedRelationships: ConnectionGroup[] = [];
    totalConnections = 0;
    readonly PencilIcon = Pencil;

    ngOnChanges(changes: SimpleChanges) {
        if (changes['entity'] && this.entity) {
            this.refreshConnections();
        }
    }

    refreshConnections() {
        if (!this.entity) {
            return;
        }

        const edges = smartGraphRegistry.getEdgesForEntity(this.entity.id);
        this.totalConnections = edges.length;

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
                    confidence: edge.confidence,
                });
            }
        }

        this.groupedRelationships = Object.values(groups);
    }

    onNavigate(target: RegisteredEntity) {
        console.log('[GraphDetail] Navigate to:', target.label);
    }

    getColor(kind: string): string {
        return entityColorStore.getEntityColor(kind);
    }

    getBgColor(kind: string): string {
        return entityColorStore.getEntityBgColor(kind, 0.15);
    }

    getBorderColor(kind: string): string {
        return entityColorStore.getEntityBgColor(kind, 0.4);
    }

    getIcon(kind: string): any {
        return ENTITY_ICONS[kind as EntityKind] || ENTITY_ICONS['UNKNOWN'];
    }
}
