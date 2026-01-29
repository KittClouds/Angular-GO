/**
 * Calendar Repository - CozoDB CRUD operations for calendar data
 * 
 * Handles Normalized Calendar Data:
 * - Definitions (config)
 * - Events (with date normalization)
 * - Periods (eras, arcs, etc.)
 */

import { cozoDb } from '../db';
import type {
    CalendarDefinition,
    CalendarEvent, CalendarEventInput,
    CalendarPeriod, CalendarPeriodInput,
} from './ContentTypes';

// =============================================================================
// HELPERS
// =============================================================================

function now(): number {
    return Date.now();
}

function generateId(): string {
    return crypto.randomUUID();
}

function emptyToNull(s: string | null | undefined): string | null {
    if (!s || s === '') return null;
    return s;
}

function nullToEmpty(s: string | null | undefined): string {
    return s ?? '';
}

// =============================================================================
// CALENDAR REPO
// =============================================================================

export class CalendarRepo {

    // -------------------------------------------------------------------------
    // DEFINITIONS
    // -------------------------------------------------------------------------

    /**
     * Get calendar definition
     * (Currently supports single active calendar per world, but schema allows multiple)
     */
    static getDefinition(worldId: string = 'default'): CalendarDefinition | null {
        // Just get the first one for now
        const script = `
            ?[id, world_id, name, days_per_week, months_per_year, hours_per_day, mins_per_hour,
              current_year, current_month, current_day, created_at, updated_at] :=
                *calendar_definitions{id, world_id, name, days_per_week, months_per_year, hours_per_day, mins_per_hour,
                                     current_year, current_month, current_day, created_at, updated_at},
                world_id == $world_id
            :limit 1
        `;

        const result = cozoDb.runQuery(script, { world_id: worldId });
        if (!result.rows?.length) return null;

        return this.rowToDefinition(result.rows[0]);
    }

    /**
     * Save (Upsert) calendar definition
     */
    static saveDefinition(def: CalendarDefinition): CalendarDefinition {
        const timestamp = now();

        const script = `
            ?[id, world_id, name, days_per_week, months_per_year, hours_per_day, mins_per_hour,
              current_year, current_month, current_day, created_at, updated_at] <- [[
                $id, $world_id, $name, $days_per_week, $months_per_year, $hours_per_day, $mins_per_hour,
                $current_year, $current_month, $current_day, $created_at, $updated_at
            ]]
            :put calendar_definitions {
                id, world_id, name, days_per_week, months_per_year, hours_per_day, mins_per_hour,
                current_year, current_month, current_day, created_at, updated_at
            }
        `;

        cozoDb.runMutation(script, {
            id: def.id,
            world_id: def.worldId,
            name: def.name,
            days_per_week: def.daysPerWeek,
            months_per_year: def.monthsPerYear,
            hours_per_day: def.hoursPerDay,
            mins_per_hour: def.minsPerHour,
            current_year: def.currentYear,
            current_month: def.currentMonth,
            current_day: def.currentDay,
            created_at: def.createdAt.getTime(),
            updated_at: timestamp
        });

        // Return updated object
        return { ...def, updatedAt: new Date(timestamp) };
    }

    // -------------------------------------------------------------------------
    // EVENTS
    // -------------------------------------------------------------------------

    static createEvent(input: CalendarEventInput): CalendarEvent {
        const id = generateId();
        const timestamp = now();

        const script = `
            ?[id, world_id, calendar_id, title, description,
              date_year, date_month, date_day, date_hour, date_minute,
              end_year, end_month, end_day,
              is_all_day, importance, category, color, icon,
              entity_id, entity_kind, source_note_id, parent_event_id,
              created_at, updated_at] <- [[
                $id, $world_id, $calendar_id, $title, $description,
                $date_year, $date_month, $date_day, $date_hour, $date_minute,
                $end_year, $end_month, $end_day,
                $is_all_day, $importance, $category, $color, $icon,
                $entity_id, $entity_kind, $source_note_id, $parent_event_id,
                $now, $now
            ]]
            :put calendar_events {
                id, world_id, calendar_id, title, description,
                date_year, date_month, date_day, date_hour, date_minute,
                end_year, end_month, end_day,
                is_all_day, importance, category, color, icon,
                entity_id, entity_kind, source_note_id, parent_event_id,
                created_at, updated_at
            }
        `;

        cozoDb.runMutation(script, {
            id,
            world_id: input.worldId,
            calendar_id: input.calendarId,
            title: input.title,
            description: nullToEmpty(input.description),
            date_year: input.dateYear,
            date_month: input.dateMonth,
            date_day: input.dateDay,
            date_hour: input.dateHour ?? 0,
            date_minute: input.dateMinute ?? 0,
            end_year: input.endYear ?? 0,
            end_month: input.endMonth ?? 0,
            end_day: input.endDay ?? 0,
            is_all_day: input.isAllDay ?? false,
            importance: input.importance ?? 'medium',
            category: input.category ?? 'general',
            color: nullToEmpty(input.color),
            icon: nullToEmpty(input.icon),
            entity_id: nullToEmpty(input.entityId),
            entity_kind: nullToEmpty(input.entityKind),
            source_note_id: nullToEmpty(input.sourceNoteId),
            parent_event_id: nullToEmpty(input.parentEventId),
            now: timestamp
        });

        return this.getEvent(id)!;
    }

    static getEvent(id: string): CalendarEvent | null {
        const script = `
            ?[id, world_id, calendar_id, title, description,
              date_year, date_month, date_day, date_hour, date_minute,
              end_year, end_month, end_day,
              is_all_day, importance, category, color, icon,
              entity_id, entity_kind, source_note_id, parent_event_id,
              created_at, updated_at] :=
                *calendar_events{id, world_id, calendar_id, title, description,
                                 date_year, date_month, date_day, date_hour, date_minute,
                                 end_year, end_month, end_day,
                                 is_all_day, importance, category, color, icon,
                                 entity_id, entity_kind, source_note_id, parent_event_id,
                                 created_at, updated_at},
                id == $id
        `;

        const result = cozoDb.runQuery(script, { id });
        if (!result.rows?.length) return null;

        return this.rowToEvent(result.rows[0]);
    }

    static listEvents(calendarId: string): CalendarEvent[] {
        const script = `
            ?[id, world_id, calendar_id, title, description,
              date_year, date_month, date_day, date_hour, date_minute,
              end_year, end_month, end_day,
              is_all_day, importance, category, color, icon,
              entity_id, entity_kind, source_note_id, parent_event_id,
              created_at, updated_at] :=
                *calendar_events{id, world_id, calendar_id, title, description,
                                 date_year, date_month, date_day, date_hour, date_minute,
                                 end_year, end_month, end_day,
                                 is_all_day, importance, category, color, icon,
                                 entity_id, entity_kind, source_note_id, parent_event_id,
                                 created_at, updated_at},
                calendar_id == $calendar_id
            :order date_year, date_month, date_day
        `;

        const result = cozoDb.runQuery(script, { calendar_id: calendarId });
        return (result.rows || []).map((row: any[]) => this.rowToEvent(row));
    }

    static updateEvent(id: string, updates: Partial<CalendarEvent>): CalendarEvent | null {
        const existing = this.getEvent(id);
        if (!existing) return null;

        // Merge logic handled by creating full object with fallback to existing
        // Since Cozo :put replaces, we need all fields
        // Simplification: We'll construct the query args with simple coalescing

        const script = `
            ?[id, world_id, calendar_id, title, description,
              date_year, date_month, date_day, date_hour, date_minute,
              end_year, end_month, end_day,
              is_all_day, importance, category, color, icon,
              entity_id, entity_kind, source_note_id, parent_event_id,
              created_at, updated_at] <- [[
                $id, $world_id, $calendar_id, $title, $description,
                $date_year, $date_month, $date_day, $date_hour, $date_minute,
                $end_year, $end_month, $end_day,
                $is_all_day, $importance, $category, $color, $icon,
                $entity_id, $entity_kind, $source_note_id, $parent_event_id,
                $created_at, $updated_at
            ]]
            :put calendar_events {
                id, world_id, calendar_id, title, description,
                date_year, date_month, date_day, date_hour, date_minute,
                end_year, end_month, end_day,
                is_all_day, importance, category, color, icon,
                entity_id, entity_kind, source_note_id, parent_event_id,
                created_at, updated_at
            }
        `;

        cozoDb.runMutation(script, {
            id,
            world_id: existing.worldId,
            calendar_id: existing.calendarId,
            title: updates.title ?? existing.title,
            description: updates.description !== undefined ? nullToEmpty(updates.description) : nullToEmpty(existing.description),

            date_year: updates.dateYear ?? existing.dateYear,
            date_month: updates.dateMonth ?? existing.dateMonth,
            date_day: updates.dateDay ?? existing.dateDay,
            date_hour: updates.dateHour ?? existing.dateHour ?? 0,
            date_minute: updates.dateMinute ?? existing.dateMinute ?? 0,

            end_year: updates.endYear ?? existing.endYear ?? 0,
            end_month: updates.endMonth ?? existing.endMonth ?? 0,
            end_day: updates.endDay ?? existing.endDay ?? 0,

            is_all_day: updates.isAllDay ?? existing.isAllDay,
            importance: updates.importance ?? existing.importance,
            category: updates.category ?? existing.category,
            color: updates.color !== undefined ? nullToEmpty(updates.color) : nullToEmpty(existing.color),
            icon: updates.icon !== undefined ? nullToEmpty(updates.icon) : nullToEmpty(existing.icon),

            entity_id: updates.entityId !== undefined ? nullToEmpty(updates.entityId) : nullToEmpty(existing.entityId),
            entity_kind: updates.entityKind !== undefined ? nullToEmpty(updates.entityKind) : nullToEmpty(existing.entityKind),
            source_note_id: updates.sourceNoteId !== undefined ? nullToEmpty(updates.sourceNoteId) : nullToEmpty(existing.sourceNoteId),
            parent_event_id: updates.parentEventId !== undefined ? nullToEmpty(updates.parentEventId) : nullToEmpty(existing.parentEventId),

            created_at: existing.createdAt.getTime(),
            updated_at: now()
        });

        return this.getEvent(id);
    }

    static deleteEvent(id: string): boolean {
        cozoDb.runMutation(`?[id] <- [[$id]] :rm calendar_events { id }`, { id });
        return true;
    }

    // -------------------------------------------------------------------------
    // PERIODS (Eras, Arcs, etc.)
    // -------------------------------------------------------------------------

    static createPeriod(input: CalendarPeriodInput): CalendarPeriod {
        const id = generateId();
        const timestamp = now();

        const script = `
            ?[id, world_id, calendar_id, name, description,
              start_year, start_month, end_year, end_month,
              parent_period_id, period_type, color, icon, abbreviation, direction,
              arc_type, dominant_theme, protagonist_id, antagonist_id, summary,
              show_on_timeline, timeline_color, timeline_icon,
              created_at, updated_at] <- [[
                $id, $world_id, $calendar_id, $name, $description,
                $start_year, $start_month, $end_year, $end_month,
                $parent_period_id, $period_type, $color, $icon, $abbreviation, $direction,
                $arc_type, $dominant_theme, $protagonist_id, $antagonist_id, $summary,
                $show_on_timeline, $timeline_color, $timeline_icon,
                $now, $now
            ]]
            :put calendar_periods {
                id, world_id, calendar_id, name, description,
                start_year, start_month, end_year, end_month,
                parent_period_id, period_type, color, icon, abbreviation, direction,
                arc_type, dominant_theme, protagonist_id, antagonist_id, summary,
                show_on_timeline, timeline_color, timeline_icon,
                created_at, updated_at
            }
        `;

        cozoDb.runMutation(script, {
            id,
            world_id: input.worldId,
            calendar_id: input.calendarId,
            name: input.name,
            description: nullToEmpty(input.description),
            start_year: input.startYear,
            start_month: input.startMonth ?? 0,
            end_year: input.endYear ?? 0,
            end_month: input.endMonth ?? 0,
            parent_period_id: nullToEmpty(input.parentPeriodId),
            period_type: input.periodType ?? 'custom',
            color: input.color,
            icon: nullToEmpty(input.icon),
            abbreviation: nullToEmpty(input.abbreviation),
            direction: input.direction ?? 'ascending',
            arc_type: nullToEmpty(input.arcType),
            dominant_theme: nullToEmpty(input.dominantTheme),
            protagonist_id: nullToEmpty(input.protagonistId),
            antagonist_id: nullToEmpty(input.antagonistId),
            summary: nullToEmpty(input.summary),
            show_on_timeline: input.showOnTimeline ?? true,
            timeline_color: nullToEmpty(input.timelineColor),
            timeline_icon: nullToEmpty(input.timelineIcon),
            now: timestamp
        });

        return this.getPeriod(id)!;
    }

    static getPeriod(id: string): CalendarPeriod | null {
        const script = `
            ?[id, world_id, calendar_id, name, description,
              start_year, start_month, end_year, end_month,
              parent_period_id, period_type, color, icon, abbreviation, direction,
              arc_type, dominant_theme, protagonist_id, antagonist_id, summary,
              show_on_timeline, timeline_color, timeline_icon,
              created_at, updated_at] :=
                *calendar_periods{id, world_id, calendar_id, name, description,
                                  start_year, start_month, end_year, end_month,
                                  parent_period_id, period_type, color, icon, abbreviation, direction,
                                  arc_type, dominant_theme, protagonist_id, antagonist_id, summary,
                                  show_on_timeline, timeline_color, timeline_icon,
                                  created_at, updated_at},
                id == $id
        `;

        const result = cozoDb.runQuery(script, { id });
        if (!result.rows?.length) return null;

        return this.rowToPeriod(result.rows[0]);
    }

    static listPeriods(calendarId: string): CalendarPeriod[] {
        const script = `
           ?[id, world_id, calendar_id, name, description,
              start_year, start_month, end_year, end_month,
              parent_period_id, period_type, color, icon, abbreviation, direction,
              arc_type, dominant_theme, protagonist_id, antagonist_id, summary,
              show_on_timeline, timeline_color, timeline_icon,
              created_at, updated_at] :=
                *calendar_periods{id, world_id, calendar_id, name, description,
                                  start_year, start_month, end_year, end_month,
                                  parent_period_id, period_type, color, icon, abbreviation, direction,
                                  arc_type, dominant_theme, protagonist_id, antagonist_id, summary,
                                  show_on_timeline, timeline_color, timeline_icon,
                                  created_at, updated_at},
                calendar_id == $calendar_id
            :order start_year, start_month
        `;

        const result = cozoDb.runQuery(script, { calendar_id: calendarId });
        return (result.rows || []).map((row: any[]) => this.rowToPeriod(row));
    }

    static updatePeriod(id: string, updates: Partial<CalendarPeriod>): CalendarPeriod | null {
        const existing = this.getPeriod(id);
        if (!existing) return null;

        const script = `
            ?[id, world_id, calendar_id, name, description,
              start_year, start_month, end_year, end_month,
              parent_period_id, period_type, color, icon, abbreviation, direction,
              arc_type, dominant_theme, protagonist_id, antagonist_id, summary,
              show_on_timeline, timeline_color, timeline_icon,
              created_at, updated_at] <- [[
                $id, $world_id, $calendar_id, $name, $description,
                $start_year, $start_month, $end_year, $end_month,
                $parent_period_id, $period_type, $color, $icon, $abbreviation, $direction,
                $arc_type, $dominant_theme, $protagonist_id, $antagonist_id, $summary,
                $show_on_timeline, $timeline_color, $timeline_icon,
                $created_at, $updated_at
            ]]
            :put calendar_periods {
                id, world_id, calendar_id, name, description,
                start_year, start_month, end_year, end_month,
                parent_period_id, period_type, color, icon, abbreviation, direction,
                arc_type, dominant_theme, protagonist_id, antagonist_id, summary,
                show_on_timeline, timeline_color, timeline_icon,
                created_at, updated_at
            }
        `;

        // Helper to check undefined vs null
        // Updates can contain null to clear field, or undefined to keep existing
        // Native TS Partial makes all fields undefined | T
        // We assume explicit null cleans the field

        cozoDb.runMutation(script, {
            id,
            world_id: existing.worldId,
            calendar_id: existing.calendarId,
            name: updates.name ?? existing.name,
            description: updates.description !== undefined ? nullToEmpty(updates.description) : nullToEmpty(existing.description),
            start_year: updates.startYear ?? existing.startYear,
            start_month: updates.startMonth ?? existing.startMonth ?? 0,
            end_year: updates.endYear ?? existing.endYear ?? 0,
            end_month: updates.endMonth ?? existing.endMonth ?? 0,
            parent_period_id: updates.parentPeriodId !== undefined ? nullToEmpty(updates.parentPeriodId) : nullToEmpty(existing.parentPeriodId),
            period_type: updates.periodType ?? existing.periodType,
            color: updates.color ?? existing.color,
            icon: updates.icon !== undefined ? nullToEmpty(updates.icon) : nullToEmpty(existing.icon),
            abbreviation: updates.abbreviation !== undefined ? nullToEmpty(updates.abbreviation) : nullToEmpty(existing.abbreviation),
            direction: updates.direction ?? existing.direction,
            arc_type: updates.arcType !== undefined ? nullToEmpty(updates.arcType) : nullToEmpty(existing.arcType),
            dominant_theme: updates.dominantTheme !== undefined ? nullToEmpty(updates.dominantTheme) : nullToEmpty(existing.dominantTheme),
            protagonist_id: updates.protagonistId !== undefined ? nullToEmpty(updates.protagonistId) : nullToEmpty(existing.protagonistId),
            antagonist_id: updates.antagonistId !== undefined ? nullToEmpty(updates.antagonistId) : nullToEmpty(existing.antagonistId),
            summary: updates.summary !== undefined ? nullToEmpty(updates.summary) : nullToEmpty(existing.summary),
            show_on_timeline: updates.showOnTimeline ?? existing.showOnTimeline,
            timeline_color: updates.timelineColor !== undefined ? nullToEmpty(updates.timelineColor) : nullToEmpty(existing.timelineColor),
            timeline_icon: updates.timelineIcon !== undefined ? nullToEmpty(updates.timelineIcon) : nullToEmpty(existing.timelineIcon),
            created_at: existing.createdAt.getTime(),
            updated_at: now()
        });

        return this.getPeriod(id);
    }

    static deletePeriod(id: string): boolean {
        cozoDb.runMutation(`?[id] <- [[$id]] :rm calendar_periods { id }`, { id });
        return true;
    }

    // -------------------------------------------------------------------------
    // MAPPERS
    // -------------------------------------------------------------------------

    private static rowToDefinition(row: any[]): CalendarDefinition {
        return {
            id: row[0],
            worldId: row[1],
            name: row[2],
            daysPerWeek: row[3],
            monthsPerYear: row[4],
            hoursPerDay: row[5],
            minsPerHour: row[6],
            currentYear: row[7],
            currentMonth: row[8],
            currentDay: row[9],
            createdAt: new Date(row[10]),
            updatedAt: new Date(row[11]),
        };
    }

    private static rowToEvent(row: any[]): CalendarEvent {
        return {
            id: row[0],
            worldId: row[1],
            calendarId: row[2],
            title: row[3],
            description: emptyToNull(row[4]),
            dateYear: row[5],
            dateMonth: row[6],
            dateDay: row[7],
            dateHour: row[8] === 0 ? null : row[8],
            dateMinute: row[9] === 0 ? null : row[9],
            endYear: row[10] === 0 ? null : row[10],
            endMonth: row[11] === 0 ? null : row[11],
            endDay: row[12] === 0 ? null : row[12],
            isAllDay: row[13],
            importance: row[14],
            category: row[15],
            color: emptyToNull(row[16]),
            icon: emptyToNull(row[17]),
            entityId: emptyToNull(row[18]),
            entityKind: emptyToNull(row[19]),
            sourceNoteId: emptyToNull(row[20]),
            parentEventId: emptyToNull(row[21]),
            createdAt: new Date(row[22]),
            updatedAt: new Date(row[23]),
        };
    }

    private static rowToPeriod(row: any[]): CalendarPeriod {
        return {
            id: row[0],
            worldId: row[1],
            calendarId: row[2],
            name: row[3],
            description: emptyToNull(row[4]),
            startYear: row[5],
            startMonth: row[6] === 0 ? null : row[6],
            endYear: row[7] === 0 ? null : row[7],
            endMonth: row[8] === 0 ? null : row[8],
            parentPeriodId: emptyToNull(row[9]),
            periodType: row[10],
            color: row[11],
            icon: emptyToNull(row[12]),
            abbreviation: emptyToNull(row[13]),
            direction: row[14],
            arcType: emptyToNull(row[15]),
            dominantTheme: emptyToNull(row[16]),
            protagonistId: emptyToNull(row[17]),
            antagonistId: emptyToNull(row[18]),
            summary: emptyToNull(row[19]),
            showOnTimeline: row[20],
            timelineColor: emptyToNull(row[21]),
            timelineIcon: emptyToNull(row[22]),
            createdAt: new Date(row[23]),
            updatedAt: new Date(row[24]),
        };
    }
}
