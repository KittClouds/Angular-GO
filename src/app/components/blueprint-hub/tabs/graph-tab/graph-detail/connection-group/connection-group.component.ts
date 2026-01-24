import { Component, Input, Output, EventEmitter } from '@angular/core';
import { CommonModule } from '@angular/common';
import { LucideAngularModule, ChevronRight, User, Users, MapPin, Calendar, Hash, FileText, Zap, Tag } from 'lucide-angular';
import { EntityKind } from '../../../../../../lib/Scanner/types';
import { RegisteredEntity } from '../../../../../../lib/registry';

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

export interface ConnectionGroup {
    type: string;
    connections: Array<{
        id: string;
        entity: RegisteredEntity;
        direction: 'incoming' | 'outgoing' | 'bidirectional';
        confidence: number;
    }>;
}

@Component({
    selector: 'app-connection-group',
    standalone: true,
    imports: [CommonModule, LucideAngularModule],
    template: `
        <div class="space-y-2">
            <div class="flex items-center gap-2 px-1">
                <div class="h-px flex-1 bg-border/50"></div>
                <span class="text-xs font-medium text-muted-foreground uppercase tracking-wide">
                    {{ group.type.replace('_', ' ') }}
                </span>
                <span class="text-[10px] bg-secondary px-1.5 py-0.5 rounded text-secondary-foreground font-mono">
                    {{ group.connections.length }}
                </span>
                <div class="h-px flex-1 bg-border/50"></div>
            </div>

            <div class="grid grid-cols-2 md:grid-cols-3 gap-2">
                <div *ngFor="let conn of group.connections"
                     class="group relative rounded-xl p-3 bg-muted/30 border border-border/50 hover:bg-muted/50 hover:border-border transition-all cursor-pointer"
                     (click)="onNavigate.emit(conn.entity)">
                    
                    <div class="flex items-center gap-2">
                        <div class="w-8 h-8 rounded-lg flex items-center justify-center shrink-0"
                             [style.backgroundColor]="getBgColor(conn.entity.kind)">
                            <lucide-icon [img]="getIcon(conn.entity.kind)" [class]="'w-4 h-4'" [style.color]="getColor(conn.entity.kind)"></lucide-icon>
                        </div>
                        <div class="min-w-0 flex-1">
                            <p class="font-medium text-sm truncate">{{ conn.entity.label }}</p>
                            <p class="text-[10px] text-muted-foreground">{{ conn.entity.kind }}</p>
                        </div>
                    </div>

                    <div *ngIf="conn.direction === 'incoming'" class="absolute top-1 right-1">
                         <lucide-icon [img]="ChevronRight" class="w-3 h-3 text-muted-foreground rotate-180"></lucide-icon>
                    </div>
                </div>
            </div>
        </div>
    `
})
export class ConnectionGroupComponent {
    @Input() group!: ConnectionGroup;
    @Output() onNavigate = new EventEmitter<RegisteredEntity>();

    // Expose Icon for template
    readonly ChevronRight = ChevronRight;

    getColor(kind: string): string {
        return ENTITY_COLORS[kind as EntityKind] || ENTITY_COLORS['UNKNOWN'];
    }

    getBgColor(kind: string): string {
        const color = this.getColor(kind);
        return `${color}20`;
    }

    getIcon(kind: string): any {
        return ENTITY_ICONS[kind as EntityKind] || ENTITY_ICONS['UNKNOWN'];
    }
}
