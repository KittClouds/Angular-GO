/**
 * Content Schema - CozoDB relation definitions for content storage
 * 
 * Defines the schema for notes, folders, tags, and calendar.
 * Called during CozoDbService initialization.
 */

// =============================================================================
// CORE CONTENT SCHEMA
// =============================================================================

export const NOTES_SCHEMA = `
:create notes {
    id: String
    =>
    world_id: String,
    title: String,
    content: String,
    markdown_content: String,
    folder_id: String,
    entity_kind: String,
    entity_subtype: String,
    is_entity: Bool,
    is_pinned: Bool,
    favorite: Bool,
    owner_id: String,
    created_at: Float,
    updated_at: Float,
    narrative_id: String,
    order: Float
}
`;

export const FOLDERS_SCHEMA = `
:create folders {
    id: String
    =>
    world_id: String,
    name: String,
    parent_id: String,
    entity_kind: String,
    entity_subtype: String,
    entity_label: String,
    color: String,
    is_typed_root: Bool,
    is_subtype_root: Bool,
    collapsed: Bool,
    owner_id: String,
    created_at: Float,
    updated_at: Float,
    narrative_id: String,
    is_narrative_root: Bool,
    network_id: String,
    metadata: Json,
    order: Float
}
`;

export const TAGS_SCHEMA = `
:create tags {
    id: String
    =>
    world_id: String,
    name: String,
    color: String,
    owner_id: String
}
`;

export const NOTE_TAGS_SCHEMA = `
:create note_tags {
    note_id: String,
    tag_id: String
}
`;

// =============================================================================
// CALENDAR SCHEMA (Normalized)
// =============================================================================

export const CALENDAR_DEFINITIONS_SCHEMA = `
:create calendar_definitions {
    id: String
    =>
    world_id: String,
    name: String,
    days_per_week: Int,
    months_per_year: Int,
    hours_per_day: Int,
    mins_per_hour: Int,
    current_year: Int,
    current_month: Int,
    current_day: Int,
    created_at: Float,
    updated_at: Float
}
`;

export const CALENDAR_MONTHS_SCHEMA = `
:create calendar_months {
    id: String
    =>
    calendar_id: String,
    name: String,
    abbreviation: String,
    days: Int,
    order_num: Int
}
`;

export const CALENDAR_WEEKDAYS_SCHEMA = `
:create calendar_weekdays {
    id: String
    =>
    calendar_id: String,
    name: String,
    abbreviation: String,
    order_num: Int
}
`;

export const CALENDAR_EVENTS_SCHEMA = `
:create calendar_events {
    id: String
    =>
    world_id: String,
    calendar_id: String,
    title: String,
    description: String,
    date_year: Int,
    date_month: Int,
    date_day: Int,
    date_hour: Int,
    date_minute: Int,
    end_year: Int,
    end_month: Int,
    end_day: Int,
    is_all_day: Bool,
    importance: String,
    category: String,
    color: String,
    icon: String,
    entity_id: String,
    entity_kind: String,
    source_note_id: String,
    parent_event_id: String,
    created_at: Float,
    updated_at: Float
}
`;

export const CALENDAR_PERIODS_SCHEMA = `
:create calendar_periods {
    id: String
    =>
    world_id: String,
    calendar_id: String,
    name: String,
    description: String,
    start_year: Int,
    start_month: Int,
    end_year: Int,
    end_month: Int,
    parent_period_id: String,
    period_type: String,
    color: String,
    icon: String,
    abbreviation: String,
    direction: String,
    arc_type: String,
    dominant_theme: String,
    protagonist_id: String,
    antagonist_id: String,
    summary: String,
    show_on_timeline: Bool,
    timeline_color: String,
    timeline_icon: String,
    created_at: Float,
    updated_at: Float
}
`;

// =============================================================================
// ALL CONTENT SCHEMAS
// =============================================================================

export const CONTENT_SCHEMAS = [
    { name: 'notes', script: NOTES_SCHEMA },
    { name: 'folders', script: FOLDERS_SCHEMA },
    { name: 'tags', script: TAGS_SCHEMA },
    { name: 'note_tags', script: NOTE_TAGS_SCHEMA },
    { name: 'calendar_definitions', script: CALENDAR_DEFINITIONS_SCHEMA },
    { name: 'calendar_months', script: CALENDAR_MONTHS_SCHEMA },
    { name: 'calendar_weekdays', script: CALENDAR_WEEKDAYS_SCHEMA },
    { name: 'calendar_events', script: CALENDAR_EVENTS_SCHEMA },
    { name: 'calendar_periods', script: CALENDAR_PERIODS_SCHEMA },
];

/**
 * Create all content schemas in CozoDB
 * Returns array of created relation names
 */
export function createContentSchemas(runQuery: (script: string) => void): string[] {
    const created: string[] = [];

    for (const { name, script } of CONTENT_SCHEMAS) {
        try {
            runQuery(script);
            created.push(name);
        } catch (err: any) {
            // Relation already exists is OK
            if (!err.message?.includes('already exists')) {
                console.error(`[ContentSchema] Failed to create ${name}:`, err);
            }
        }
    }

    return created;
}
