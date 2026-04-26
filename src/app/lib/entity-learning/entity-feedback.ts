import {
    db,
    type EntityFeedbackAction,
    type EntityFeedbackEntry,
    type EntityOccurrence,
} from '../dexie/db';

const MAX_SURFACE_LENGTH = 180;
const MAX_CONTEXT_LENGTH = 240;
const MAX_ALIASES_PER_ENTITY = 32;

type FeedbackWrite = {
    surface: string;
    label: string;
    kind: string;
    noteId?: string;
    entityId?: string;
    provider?: string;
    confidence?: number;
    context?: string;
};

type SuggestionLike = {
    label: string;
    source?: string;
};

export function normalizeEntitySurface(value: string): string {
    return String(value || '')
        .normalize('NFKC')
        .trim()
        .replace(/\s+/g, ' ')
        .toLocaleLowerCase()
        .slice(0, MAX_SURFACE_LENGTH);
}

export async function recordManualEntityTag(args: FeedbackWrite): Promise<void> {
    await upsertFeedback('manual_tag', args);
}

export async function recordSuggestionAccepted(args: FeedbackWrite): Promise<void> {
    await upsertFeedback('accepted_suggestion', args);
    const normalized = normalizeEntitySurface(args.surface || args.label);
    if (args.provider && normalized && canUseEntityFeedbackTable()) {
        await db.entityFeedback.delete(feedbackId('rejected_suggestion', normalized, args.provider));
    }
}

export async function recordSuggestionRejected(args: FeedbackWrite): Promise<void> {
    await upsertFeedback('rejected_suggestion', args);
}

export async function filterRejectedSuggestions<T extends SuggestionLike>(
    suggestions: T[],
    provider?: string,
): Promise<T[]> {
    if (!suggestions.length || !canUseEntityFeedbackTable()) {
        return suggestions;
    }

    const ids = suggestions.map((suggestion) => {
        const source = provider || suggestion.source || '';
        return feedbackId('rejected_suggestion', normalizeEntitySurface(suggestion.label), source);
    });
    const rows = await db.entityFeedback.bulkGet(ids);
    const rejected = new Set(
        rows
            .filter((row): row is EntityFeedbackEntry => !!row)
            .map((row) => feedbackId(row.action, row.normalizedSurface, row.provider)),
    );

    return suggestions.filter((suggestion) => {
        const source = provider || suggestion.source || '';
        return !rejected.has(feedbackId('rejected_suggestion', normalizeEntitySurface(suggestion.label), source));
    });
}

export async function getLearnedAliasesByEntityId(): Promise<Map<string, string[]>> {
    const aliases = new Map<string, Map<string, { surface: string; weight: number }>>();

    if (canUseEntityFeedbackTable()) {
        const rows = await db.entityFeedback
            .where('action')
            .anyOf(['manual_tag', 'accepted_suggestion'])
            .toArray();
        for (const row of rows) {
            addAliasCandidate(aliases, row.entityId, row.surface, row.count || 1);
        }
    }

    if (canUseEntityOccurrenceTable()) {
        const manual = await db.entityOccurrences
            .where('source')
            .equals('manual_tag')
            .toArray();
        for (const occurrence of manual) {
            addAliasCandidate(aliases, occurrence.entityId, occurrence.surface, occurrence.confidence || 1);
        }
    }

    return new Map(
        [...aliases.entries()].map(([entityId, bySurface]) => [
            entityId,
            [...bySurface.values()]
                .sort((left, right) => right.weight - left.weight || right.surface.length - left.surface.length)
                .slice(0, MAX_ALIASES_PER_ENTITY)
                .map((entry) => entry.surface),
        ]),
    );
}

async function upsertFeedback(action: EntityFeedbackAction, args: FeedbackWrite): Promise<void> {
    if (!canUseEntityFeedbackTable()) {
        return;
    }

    const surface = cleanSurface(args.surface || args.label);
    const normalizedSurface = normalizeEntitySurface(surface);
    if (!normalizedSurface) {
        return;
    }

    const id = feedbackId(action, normalizedSurface, args.provider, args.entityId);
    const now = Date.now();
    const current = await db.entityFeedback.get(id);
    const entry: EntityFeedbackEntry = {
        id,
        action,
        normalizedSurface,
        surface,
        label: cleanSurface(args.label || surface),
        kind: String(args.kind || 'UNKNOWN').toUpperCase(),
        provider: args.provider || undefined,
        noteId: args.noteId || undefined,
        entityId: args.entityId || undefined,
        confidence: typeof args.confidence === 'number' ? args.confidence : undefined,
        context: cleanContext(args.context),
        count: (current?.count || 0) + 1,
        createdAt: current?.createdAt || now,
        updatedAt: now,
    };

    await db.entityFeedback.put(entry);
}

function addAliasCandidate(
    aliases: Map<string, Map<string, { surface: string; weight: number }>>,
    entityId: string | undefined,
    surface: string,
    weight: number,
): void {
    if (!entityId) {
        return;
    }
    const cleaned = cleanSurface(surface);
    const normalized = normalizeEntitySurface(cleaned);
    if (!normalized) {
        return;
    }
    let bySurface = aliases.get(entityId);
    if (!bySurface) {
        bySurface = new Map();
        aliases.set(entityId, bySurface);
    }
    const current = bySurface.get(normalized);
    bySurface.set(normalized, {
        surface: current?.surface || cleaned,
        weight: (current?.weight || 0) + Math.max(0, weight),
    });
}

function feedbackId(
    action: EntityFeedbackAction,
    normalizedSurface: string,
    provider?: string,
    entityId?: string,
): string {
    const owner = action === 'rejected_suggestion'
        ? provider || 'unknown-provider'
        : entityId || provider || 'unknown-entity';
    return `${action}:${encodeURIComponent(owner)}:${encodeURIComponent(normalizedSurface)}`;
}

function cleanSurface(value: string): string {
    return String(value || '')
        .normalize('NFKC')
        .trim()
        .replace(/\s+/g, ' ')
        .slice(0, MAX_SURFACE_LENGTH);
}

function cleanContext(value: string | undefined): string | undefined {
    const cleaned = String(value || '')
        .normalize('NFKC')
        .trim()
        .replace(/\s+/g, ' ')
        .slice(0, MAX_CONTEXT_LENGTH);
    return cleaned || undefined;
}

function canUseEntityFeedbackTable(): boolean {
    return typeof db.entityFeedback?.put === 'function'
        && typeof db.entityFeedback?.get === 'function'
        && typeof db.entityFeedback?.bulkGet === 'function';
}

function canUseEntityOccurrenceTable(): boolean {
    return typeof db.entityOccurrences?.where === 'function';
}

export const entityFeedbackTestHooks = {
    feedbackId,
    cleanSurface,
    cleanContext,
};
