import { Component, EventEmitter, Input, OnChanges, Output, SimpleChanges } from '@angular/core';
import { CommonModule } from '@angular/common';
import { LucideAngularModule, Pencil, User, Users, MapPin, Calendar, Hash, FileText, Zap, Tag, Shield, Package, Lightbulb, Globe } from 'lucide-angular';
import { smartGraphRegistry } from '../../../../../lib/registry';
import type { RegisteredEntity } from '../../../../../lib/registry';
import { ConnectionGroup, ConnectionGroupComponent } from './connection-group/connection-group.component';
import { EntityKind } from '../../../../../lib/Scanner/types';
import { entityColorStore } from '../../../../../lib/store/entityColorStore';

const ENTITY_ICONS: Record<string, any> = {
    CHARACTER: User,
    NPC: Users,
    CREATURE: Users,
    FACTION: Users,
    ORGANIZATION: Shield,
    NETWORK: Globe,
    LOCATION: MapPin,
    EVENT: Calendar,
    TIMELINE: Calendar,
    ITEM: Package,
    OBJECT: Hash,
    CONCEPT: Lightbulb,
    NARRATIVE: FileText,
    ARC: FileText,
    ACT: FileText,
    CHAPTER: FileText,
    SCENE: FileText,
    BEAT: Zap,
    LORE: FileText,
    UNKNOWN: Tag,
};

@Component({
    selector: 'app-graph-detail',
    standalone: true,
    imports: [CommonModule, LucideAngularModule, ConnectionGroupComponent],
    template: `
        <div class="animate-in fade-in duration-300 space-y-6">
            <section
                class="overflow-hidden rounded-[30px] border border-white/5 bg-[linear-gradient(180deg,rgba(255,255,255,0.04),rgba(255,255,255,0.02))] shadow-[0_32px_90px_rgba(0,0,0,0.24)]"
            >
                <div class="relative overflow-hidden px-6 py-7">
                    <div
                        class="pointer-events-none absolute inset-0 opacity-90"
                        [style.background]="heroGlow(entity.kind)"
                    ></div>

                    <div class="relative grid gap-6 lg:grid-cols-[minmax(0,1fr)_280px]">
                        <div class="min-w-0">
                            <div class="flex flex-wrap items-center gap-3">
                                <span
                                    class="inline-flex items-center gap-2 rounded-full border px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.22em]"
                                    [style.borderColor]="getBorderColor(entity.kind)"
                                    [style.backgroundColor]="getBgColor(entity.kind)"
                                    [style.color]="getColor(entity.kind)"
                                >
                                    <lucide-icon [img]="getIcon(entity.kind)" class="h-3.5 w-3.5"></lucide-icon>
                                    {{ entity.kind }}
                                </span>
                                <span class="rounded-full border border-white/10 bg-black/20 px-3 py-1 text-[11px] uppercase tracking-[0.18em] text-zinc-400">
                                    {{ totalConnections }} {{ totalConnections === 1 ? 'connection' : 'connections' }}
                                </span>
                                <span *ngIf="entity.aliases.length > 0" class="rounded-full border border-white/10 bg-black/20 px-3 py-1 text-[11px] uppercase tracking-[0.18em] text-zinc-400">
                                    {{ entity.aliases.length }} aliases
                                </span>
                            </div>

                            <h2 class="mt-5 text-4xl font-semibold tracking-tight text-white">{{ entity.label }}</h2>
                            <p class="mt-3 max-w-3xl text-sm leading-7 text-zinc-300">
                                Traverse the local atlas from here. Connections stay grouped by relation so you can jump across the cast without losing the shape of the scene.
                            </p>

                            <div *ngIf="entity.aliases.length > 0" class="mt-5 flex flex-wrap gap-2">
                                <span
                                    *ngFor="let alias of entity.aliases"
                                    class="rounded-full border border-white/10 bg-black/25 px-3 py-1.5 text-xs text-zinc-300"
                                >
                                    {{ alias }}
                                </span>
                            </div>
                        </div>

                        <div class="relative rounded-[26px] border border-white/10 bg-black/20 p-5 backdrop-blur-sm">
                            <p class="text-[10px] font-semibold uppercase tracking-[0.22em] text-zinc-500">Atlas Node</p>
                            <div class="mt-5 flex items-start gap-4">
                                <div
                                    class="relative flex h-16 w-16 shrink-0 items-center justify-center rounded-2xl border shadow-[0_18px_40px_rgba(0,0,0,0.28)]"
                                    [style.backgroundColor]="getBgColor(entity.kind)"
                                    [style.borderColor]="getBorderColor(entity.kind)"
                                >
                                    <lucide-icon [img]="getIcon(entity.kind)" class="h-7 w-7" [style.color]="getColor(entity.kind)"></lucide-icon>
                                </div>

                                <div class="min-w-0 flex-1">
                                    <p class="text-sm font-semibold text-white">Registry Presence</p>
                                    <p class="mt-2 text-xs leading-6 text-zinc-400">
                                        Styled from the shared entity palette. Inline highlights, pills, and graph details stay visually aligned from this one source.
                                    </p>
                                </div>
                            </div>

                            <div class="mt-5 grid grid-cols-2 gap-3">
                                <div class="rounded-2xl border border-white/5 bg-white/[0.03] p-4">
                                    <p class="text-[10px] uppercase tracking-[0.18em] text-zinc-500">Relations</p>
                                    <p class="mt-2 text-2xl font-semibold text-white">{{ totalConnections }}</p>
                                </div>
                                <div class="rounded-2xl border border-white/5 bg-white/[0.03] p-4">
                                    <p class="text-[10px] uppercase tracking-[0.18em] text-zinc-500">Groups</p>
                                    <p class="mt-2 text-2xl font-semibold text-white">{{ groupedRelationships.length }}</p>
                                </div>
                            </div>

                            <button
                                type="button"
                                class="mt-5 inline-flex w-full items-center justify-center gap-2 rounded-2xl border px-4 py-3 text-sm font-medium transition hover:bg-white/[0.04]"
                                [style.borderColor]="getBorderColor(entity.kind)"
                                [style.color]="getColor(entity.kind)"
                                (click)="editRequested.emit(entity)"
                            >
                                <lucide-icon [img]="PencilIcon" class="h-4 w-4"></lucide-icon>
                                Edit Entity
                            </button>
                        </div>
                    </div>
                </div>
            </section>

            <section *ngIf="groupedRelationships.length > 0; else emptyState" class="space-y-4">
                <div class="flex items-center gap-3 px-1">
                    <div class="h-px flex-1 bg-white/5"></div>
                    <span class="text-[11px] font-semibold uppercase tracking-[0.22em] text-zinc-500">Connections</span>
                    <div class="h-px flex-1 bg-white/5"></div>
                </div>

                <app-connection-group
                    *ngFor="let group of groupedRelationships"
                    [group]="group"
                    (onNavigate)="onNavigate($event)"
                ></app-connection-group>
            </section>

            <ng-template #emptyState>
                <section class="rounded-[28px] border border-dashed border-white/10 bg-white/[0.02] px-8 py-12 text-center">
                    <div
                        class="mx-auto flex h-16 w-16 items-center justify-center rounded-2xl border border-white/10 bg-black/20"
                        [style.color]="getColor(entity.kind)"
                    >
                        <lucide-icon [img]="getIcon(entity.kind)" class="h-7 w-7"></lucide-icon>
                    </div>
                    <h3 class="mt-5 text-xl font-semibold text-white">No links yet</h3>
                    <p class="mx-auto mt-3 max-w-lg text-sm leading-7 text-zinc-400">
                        This entity is registered, but nothing in the current graph points toward or away from it yet. As notes, spans, and relationships accumulate, this section will start to breathe.
                    </p>
                </section>
            </ng-template>
        </div>
    `,
})
export class GraphDetailComponent implements OnChanges {
    @Input() entity!: RegisteredEntity;
    @Output() editRequested = new EventEmitter<RegisteredEntity>();
    @Output() navigateRequested = new EventEmitter<RegisteredEntity>();

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
        this.navigateRequested.emit(target);
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

    heroGlow(kind: string): string {
        const glow = entityColorStore.getEntityBgColor(kind, 0.22);
        return `radial-gradient(circle at top left, ${glow}, transparent 42%), radial-gradient(circle at 82% 18%, rgba(34,211,238,0.12), transparent 28%), linear-gradient(180deg, rgba(255,255,255,0.04), rgba(255,255,255,0.01))`;
    }

    getIcon(kind: string): any {
        return ENTITY_ICONS[kind as EntityKind] || ENTITY_ICONS['UNKNOWN'];
    }
}
