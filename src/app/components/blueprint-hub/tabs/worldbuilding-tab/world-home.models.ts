import type { CalendarEvent } from '../../../../lib/fantasy-calendar/types';
import type {
    ActDelta,
    ActStake,
    CanonConstraint,
    Culture,
    LoreThread,
    PowerSystem,
    Religion,
    WorldPillar,
    WorldSnapshot,
} from '../../../../lib/services/world-building.service';
import type { ResolvedScope, ScopeType } from '../../../../lib/services/scope.service';

export type WorldSourceState = 'base' | 'inherited' | 'local-overrides';

export interface ScopeInheritanceState {
    state: WorldSourceState;
    label: string;
    detail: string;
    scopeLabel: string;
    scopeType: ScopeType;
}

export interface WorldModuleSummary {
    id: 'cultures' | 'magic' | 'religion' | 'politics';
    label: string;
    state: WorldSourceState;
    totalCount: number;
    overrideCount: number;
    headline: string;
    detail: string;
    sampleLabels: string[];
}

export interface CharacterRollupSummary {
    entityId: string;
    label: string;
    fullName: string;
    role: string;
    status: string;
    factions: string[];
    totalMentions: number;
    lastSeenLabel: string;
}

export interface LoreThreadSummary {
    total: number;
    open: number;
    hinted: number;
    revealed: number;
    dropped: number;
    featured: LoreThread[];
}

export interface CalendarSummary {
    total: number;
    upcoming: CalendarEvent[];
    recent: CalendarEvent[];
    emptyLabel: string;
}

export interface KanbanSummary {
    todo: number;
    inProgress: number;
    completed: number;
    total: number;
}

export interface WorldHomeViewModel {
    scope: ResolvedScope;
    inheritance: ScopeInheritanceState;
    snapshot: WorldSnapshot;
    statusQuo: string;
    constraints: CanonConstraint[];
    pillars: WorldPillar[];
    deltas: ActDelta[];
    stakes: ActStake[];
    cultures: Culture[];
    powerSystems: PowerSystem[];
    religions: Religion[];
    politicsSummary: string;
    modules: WorldModuleSummary[];
    characters: CharacterRollupSummary[];
    lore: LoreThreadSummary;
    calendar: CalendarSummary;
    kanban: KanbanSummary;
}
