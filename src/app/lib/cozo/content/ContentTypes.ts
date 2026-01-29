/**
 * Content Types - TypeScript interfaces for CozoDB content storage
 * 
 * Mirrors native Rust content_types.rs for consistency.
 * All content (notes, folders, tags) will live in Cozo.
 */

// =============================================================================
// NOTE
// =============================================================================

export interface Note {
    id: string;
    worldId: string;
    title: string;
    content: string;           // Raw content
    markdownContent: string;   // Markdown version
    folderId: string | null;
    entityKind: string | null;
    entitySubtype: string | null;
    isEntity: boolean;
    isPinned: boolean;
    favorite: boolean;
    ownerId: string;
    createdAt: Date;
    updatedAt: Date;
}

export interface NoteInput {
    worldId: string;
    title: string;
    content?: string;
    markdownContent?: string;
    folderId?: string | null;
    entityKind?: string;
    entitySubtype?: string;
    isEntity?: boolean;
}

export interface NoteUpdate {
    title?: string;
    content?: string;
    markdownContent?: string;
    folderId?: string | null;
    entityKind?: string | null;
    entitySubtype?: string | null;
    isEntity?: boolean;
    isPinned?: boolean;
    favorite?: boolean;
}

export interface NoteSummary {
    id: string;
    title: string;
    isPinned: boolean;
    favorite: boolean;
    entityKind: string | null;
    updatedAt: Date;
}

// =============================================================================
// FOLDER
// =============================================================================

export interface Folder {
    id: string;
    worldId: string;
    name: string;
    parentId: string | null;
    entityKind: string | null;
    entitySubtype: string | null;
    entityLabel: string | null;
    color: string | null;
    isTypedRoot: boolean;
    isSubtypeRoot: boolean;
    collapsed: boolean;
    ownerId: string;
    createdAt: Date;
    updatedAt: Date;
    // Narrative Vault Isolation
    narrativeId: string | null;      // ID of the narrative vault this folder belongs to
    isNarrativeRoot: boolean;        // true if this folder IS a narrative vault root
}

export interface FolderInput {
    worldId: string;
    name: string;
    parentId?: string | null;
    entityKind?: string;
    entitySubtype?: string;
    entityLabel?: string;
    color?: string;
    isTypedRoot?: boolean;
    isSubtypeRoot?: boolean;
    // Narrative Vault Isolation
    narrativeId?: string | null;
    isNarrativeRoot?: boolean;
}

export interface FolderUpdate {
    name?: string;
    parentId?: string | null;
    entityKind?: string | null;
    entitySubtype?: string | null;
    entityLabel?: string | null;
    color?: string | null;
    collapsed?: boolean;
}

export interface FolderTreeNode {
    folder: Folder;
    children: FolderTreeNode[];
    notes: NoteSummary[];
}

// =============================================================================
// TAG
// =============================================================================

export interface Tag {
    id: string;
    worldId: string;
    name: string;
    color: string;
    ownerId: string;
}

export interface TagInput {
    worldId: string;
    name: string;
    color?: string;
}

// =============================================================================
// CALENDAR - Normalized (not JSON blobs)
// =============================================================================

export interface CalendarDefinition {
    id: string;
    worldId: string;
    name: string;
    // Normalized config fields
    daysPerWeek: number;
    monthsPerYear: number;
    hoursPerDay: number;
    minsPerHour: number;
    currentYear: number;
    currentMonth: number;
    currentDay: number;
    createdAt: Date;
    updatedAt: Date;
}

export interface CalendarMonth {
    id: string;
    calendarId: string;
    name: string;
    abbreviation: string;
    days: number;
    order: number;
}

export interface CalendarWeekday {
    id: string;
    calendarId: string;
    name: string;
    abbreviation: string;
    order: number;
}

export interface CalendarEvent {
    id: string;
    worldId: string;
    calendarId: string;
    title: string;
    description: string | null;
    // Date fields (normalized)
    dateYear: number;
    dateMonth: number;
    dateDay: number;
    dateHour: number | null;
    dateMinute: number | null;
    // End date (for spans)
    endYear: number | null;
    endMonth: number | null;
    endDay: number | null;
    // Metadata
    isAllDay: boolean;
    importance: 'low' | 'medium' | 'high' | 'critical';
    category: string;
    color: string | null;
    icon: string | null;
    // Entity linking
    entityId: string | null;
    entityKind: string | null;
    sourceNoteId: string | null;
    // Causality
    parentEventId: string | null;
    // Timestamps
    createdAt: Date;
    updatedAt: Date;
}

export interface CalendarEventInput {
    worldId: string;
    calendarId: string;
    title: string;
    description?: string;
    dateYear: number;
    dateMonth: number;
    dateDay: number;
    dateHour?: number;
    dateMinute?: number;
    endYear?: number;
    endMonth?: number;
    endDay?: number;
    isAllDay?: boolean;
    importance?: 'low' | 'medium' | 'high' | 'critical';
    category?: string;
    color?: string;
    icon?: string;
    entityId?: string;
    entityKind?: string;
    sourceNoteId?: string;
    parentEventId?: string;
}

export interface CalendarPeriod {
    id: string;
    worldId: string;
    calendarId: string;
    name: string;
    description: string | null;
    // Time span
    startYear: number;
    startMonth: number | null;
    endYear: number | null;
    endMonth: number | null;
    // Hierarchy
    parentPeriodId: string | null;
    // Metadata
    periodType: 'era' | 'age' | 'epoch' | 'arc' | 'chapter' | 'custom';
    color: string;
    icon: string | null;
    abbreviation: string | null;
    direction: 'ascending' | 'descending';
    // Narrative
    arcType: string | null;
    dominantTheme: string | null;
    protagonistId: string | null;
    antagonistId: string | null;
    summary: string | null;
    // Timeline display
    showOnTimeline: boolean;
    timelineColor: string | null;
    timelineIcon: string | null;
    // Timestamps
    createdAt: Date;
    updatedAt: Date;
}

export interface CalendarPeriodInput {
    worldId: string;
    calendarId: string;
    name: string;
    description?: string;
    startYear: number;
    startMonth?: number;
    endYear?: number;
    endMonth?: number;
    parentPeriodId?: string;
    periodType?: 'era' | 'age' | 'epoch' | 'arc' | 'chapter' | 'custom';
    color: string;
    icon?: string;
    abbreviation?: string;
    direction?: 'ascending' | 'descending';
    arcType?: string;
    dominantTheme?: string;
    protagonistId?: string;
    antagonistId?: string;
    summary?: string;
    showOnTimeline?: boolean;
    timelineColor?: string;
    timelineIcon?: string;
}

// =============================================================================
// CONSTANTS
// =============================================================================

export const DEFAULT_WORLD_ID = 'default';
export const DEFAULT_OWNER_ID = 'local-user';

export const DEFAULT_NOTE_CONTENT = `# Welcome to Inkwell

Start writing your thoughts here. This editor supports **Markdown** formatting.

## Features

- **Bold** and *italic* text
- Lists and checkboxes
- Code blocks with syntax highlighting
- Tables and images
- And much more...

Happy writing! ✨
`;
