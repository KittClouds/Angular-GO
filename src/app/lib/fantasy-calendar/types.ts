export type StarType = 'red_dwarf' | 'yellow_dwarf' | 'blue_giant' | 'binary' | 'custom';

export interface OrbitalMechanics {
    starType: StarType;
    starMass: number; // Solar masses
    orbitalRadius: number; // AU
    axialTilt: number; // degrees
    rotationPeriod: number; // hours (day length)
    orbitalPeriod: number; // Earth days (year length)
}

export interface LeapDayRule {
    interval: number; // Every X years
    daysToAdd: number; // Usually 1
    unlessDivisibleBy?: number; // Gregorian exception rule (optional)
}

export interface WeekdayDefinition {
    id: string;
    index: number;
    name: string;
    shortName: string;
}

export interface MonthDefinition {
    id: string;
    index: number;
    name: string;
    shortName: string;
    days: number;
    leapDayRule?: LeapDayRule;
}

export interface EraDefinition {
    id: string;
    name: string;                     // "Before Common Era", "Age of Fire"
    abbreviation: string;             // "BCE", "CE", "AF"
    startYear: number;                // Year this era starts (can be negative)
    endYear?: number;                 // Optional end year (null = ongoing)
    direction: 'ascending' | 'descending'; // "BCE" counts down, "CE" counts up
    isNegative?: boolean;             // Years display as "X BCE" style
    color?: string;                   // For timeline visualization
    description?: string;
}

// Epoch - large spans of time (larger than eras)
export interface EpochDefinition {
    id: string;
    name: string;                     // "Age of Myth", "Industrial Era"
    startYear: number;                // Can be negative
    endYear?: number;                 // null = ongoing
    color: string;
    description?: string;
}

// Time Marker - Major named events on the timeline
export interface TimeMarker {
    id: string;
    calendarId: string;
    name: string;                     // "Cambrian Explosion", "Fall of the Balrog"
    year: number;                     // Can be negative
    monthIndex?: number;              // Optional month specificity
    dayIndex?: number;                // Optional day specificity
    eraId?: string;
    importance: 'epoch' | 'major' | 'minor';
    description?: string;
    color?: string;
}

export interface MoonDefinition {
    id: string;
    name: string;
    cycleDays: number; // Synodic month
    color: string;
    phaseOffset?: number; // 0-1 (starting phase)
}

export interface SeasonDefinition {
    id: string;
    name: string;
    startMonthIndex: number;
    startDayIndex: number; // Day of month
    color: string;
}

// Complete definition of a fantasy calendar system
export interface CalendarDefinition {
    id: string;
    name: string;
    description?: string;

    // Time structure
    hoursPerDay: number;
    minutesPerHour: number;
    secondsPerMinute: number;

    // Date structure
    weekdays: WeekdayDefinition[];
    months: MonthDefinition[];

    // Eras - time periods with different naming conventions
    defaultEraId: string;
    eras: EraDefinition[];

    // Epochs - large spans of time for visualization
    epochs: EpochDefinition[];

    // Time Markers - named events on the timeline
    timeMarkers: TimeMarker[];

    // Year zero handling
    hasYearZero: boolean;             // Does this calendar have year 0?
    zeroYearLabel?: string;           // Custom label for year 0

    // Moons & Seasons
    moons: MoonDefinition[];
    seasons: SeasonDefinition[];

    // Metadata & Config
    createdFrom: 'orbital' | 'manual' | 'preset';
    orbitalMechanics?: OrbitalMechanics;
    currentDate?: FantasyDate; // "Now" marker
}

// Point in time representation
export interface FantasyDate {
    year: number;                     // Can be negative for BCE-style dates
    eraId?: string;
    monthIndex: number; // 0-based
    dayIndex: number; // 0-based (Day 1 = index 0)
    hour?: number;
    minute?: number;
}

// Event importance levels
export type EventImportance = 'trivial' | 'minor' | 'moderate' | 'major' | 'critical';

// Event categories
export type EventCategory = 'general' | 'battle' | 'political' | 'personal' | 'discovery' | 'disaster' | 'celebration' | 'death' | 'birth' | 'travel' | 'custom';

// Recurrence frequency
export type RecurrenceFrequency = 'daily' | 'weekly' | 'monthly' | 'yearly' | 'custom';

// Event recurrence configuration
export interface EventRecurrence {
    frequency: RecurrenceFrequency;
    interval: number;        // Every X days/weeks/etc
    endDate?: FantasyDate;   // When to stop recurring
    count?: number;          // Or stop after X occurrences
    customDays?: number;     // For 'custom' frequency: every X days
}

// === NARRATIVE SYSTEM TYPES ===

// Narrative event type for story structure
export type NarrativeEventType =
    | 'inciting_incident' | 'rising_action' | 'climax'
    | 'falling_action' | 'resolution' | 'subplot'
    | 'foreshadowing' | 'callback' | 'revelation';

// Story beats (Save the Cat structure)
export type StoryBeat =
    | 'opening_image' | 'theme_stated' | 'setup'
    | 'catalyst' | 'debate' | 'break_into_two'
    | 'b_story' | 'fun_and_games' | 'midpoint'
    | 'bad_guys_close_in' | 'all_is_lost' | 'dark_night_of_soul'
    | 'break_into_three' | 'finale' | 'final_image';

// Entity reference for linking events to entities
export interface EntityRef {
    id: string;
    kind: string;            // 'CHARACTER' | 'LOCATION' | 'FACTION' etc
    name: string;            // Cached for display
    role?: string;           // 'protagonist' | 'antagonist' | 'witness' etc
}

// Cell display modes for events
export type CellDisplayMode = 'minimal' | 'badge' | 'full';

// Time scales for editor scoping
export type TimeScale = 'day' | 'week' | 'month' | 'year' | 'decade' | 'century';

// Editor scope for the master event editor
export type EditorScope = 'day' | 'week' | 'month' | 'period';

// Narrative arc types for periods
export type NarrativeArcType = 'rising' | 'falling' | 'stable' | 'chaotic';

// Causality chain result
export interface CausalChain {
    upstream: string[];      // Event IDs that caused this
    downstream: string[];    // Event IDs this causes
    depth: number;           // How many layers of causality
}


// Event on the calendar
export interface CalendarEvent {
    id: string;
    calendarId: string;

    // Timing
    date: FantasyDate;
    endDate?: FantasyDate;   // For multi-day events
    isAllDay?: boolean;      // Default true

    // Recurrence
    recurrence?: EventRecurrence;
    parentEventId?: string;  // If this is an instance of a recurring event

    // Content
    title: string;
    description?: string;

    // Categorization
    importance?: EventImportance;
    category?: EventCategory;
    type?: string;           // Generic subtype for entity mapping
    eventTypeId?: string;    // ID from eventTypeRegistry
    tags?: string[];

    // Hierarchy
    periodId?: string;       // Parent period this event belongs to

    // Display
    color?: string;          // Override color
    icon?: string;           // Lucide icon name

    // Entity linking (legacy single link)
    entityId?: string;       // Link to existing entity
    entityKind?: string;     // Cache kind for coloring

    // Source
    sourceNoteId?: string;

    // Kanban-style tracking
    status?: 'todo' | 'in-progress' | 'completed';
    progress?: number;           // 0-100 for multi-step events
    checklist?: ChecklistItem[]; // Sub-tasks within event

    // === CAUSALITY TRACKING ===
    causedBy?: string[];         // Event IDs that led to this
    causes?: string[];           // Event IDs this triggers
    causalityWeight?: number;    // 0-1: how strongly linked

    // === NARRATIVE METADATA ===
    narrativeType?: NarrativeEventType;
    storyBeat?: StoryBeat;       // Save the Cat / Hero's Journey beats
    tension?: number;            // 0-100 dramatic tension level
    stakes?: string;             // What's at risk

    // === ENTITY LINKS (prep for future) ===
    participants?: EntityRef[];  // Characters/factions involved
    locations?: EntityRef[];     // Places involved
    artifacts?: EntityRef[];     // Objects involved

    // === DISPLAY CONTROL ===
    showInCell?: boolean;        // Show in calendar cell? Default true
    cellDisplayMode?: CellDisplayMode;
    pinnedToTimeline?: boolean;  // Show on timeline bar?

    // === SCALE RELEVANCE ===
    visibleAtScales?: TimeScale[]; // ['day', 'week', 'month']

    // Metadata
    createdAt?: string;      // ISO datetime
    updatedAt?: string;      // ISO datetime
}

// Checklist item for event sub-tasks
export interface ChecklistItem {
    id: string;
    text: string;
    completed: boolean;
}

// Period types for hierarchy
export type PeriodType = 'epoch' | 'era' | 'age' | 'custom';

// Hierarchical Period (Era, Epoch, Age, etc.)
export interface Period {
    id: string;
    calendarId: string;
    name: string;
    description?: string;

    // Time bounds
    startYear: number;
    startMonth?: number;     // Optional for finer granularity
    endYear?: number;        // undefined = ongoing
    endMonth?: number;

    // Hierarchy
    parentPeriodId?: string; // undefined = root period
    periodType: PeriodType;

    // Display
    color: string;
    icon?: string;
    abbreviation?: string;   // "BCE", "CE", "AF"

    // Direction for display
    direction?: 'ascending' | 'descending';

    // === NARRATIVE ENHANCEMENTS ===
    triggeredBy?: string;        // Event ID that started this period
    endsWhen?: string;           // Event ID that ends this period
    majorEvents?: string[];      // Key event IDs in this period

    // Narrative arc
    arcType?: NarrativeArcType;  // 'rising' | 'falling' | 'stable' | 'chaotic'
    dominantTheme?: string;
    antagonist?: EntityRef;      // Who/what opposes during this period
    protagonist?: EntityRef;     // Whose story is primary

    // Summary
    summary?: string;            // One-line period summary
    detailedNotes?: string;      // Rich text notes

    // Timeline display
    showOnTimeline?: boolean;
    timelineColor?: string;
    timelineIcon?: string;

    // Metadata
    createdAt?: string;
    updatedAt?: string;
}
