type JsonValue = null | boolean | number | string | JsonValue[] | { [key: string]: JsonValue };

export interface SanitizedDocResult<T = JsonValue> {
    content: T;
    changed: boolean;
}

export type EntityLookup = {
    hasEntityId: (id: string) => boolean;
    hasEntityLabel: (label: string) => boolean;
};

export type ExplicitEntityMarkStatus = 'valid' | 'stale' | 'derived';

export type EntityMarkClassification =
    | 'valid-explicit'
    | 'stale-explicit'
    | 'derived-implicit'
    | 'other';

export function sanitizeEntityMarksInDocJson<T extends JsonValue>(
    content: T,
    lookup: EntityLookup
): SanitizedDocResult<T> {
    const { content: sanitizedContent, changed } = sanitizeValue(content, mark => {
        if (isDerivedEntityMark(mark)) {
            return true;
        }
        return isStaleEntityMark(mark, lookup);
    });
    return {
        content: sanitizedContent as T,
        changed,
    };
}

export function stripDerivedEntityMarksInDocJson<T extends JsonValue>(content: T): SanitizedDocResult<T> {
    const { content: sanitizedContent, changed } = sanitizeValue(content, isDerivedEntityMark);
    return {
        content: sanitizedContent as T,
        changed,
    };
}

function sanitizeValue(
    value: JsonValue,
    shouldRemoveMark: (mark: JsonValue) => boolean
): SanitizedDocResult<JsonValue> {
    if (Array.isArray(value)) {
        let changed = false;
        const next = value.map(item => {
            const result = sanitizeValue(item, shouldRemoveMark);
            changed = changed || result.changed;
            return result.content;
        });
        return { content: changed ? next : value, changed };
    }

    if (value === null || typeof value !== 'object') {
        return { content: value, changed: false };
    }

    let changed = false;
    const next: Record<string, JsonValue> = {};

    for (const [key, child] of Object.entries(value)) {
        if (key === 'marks' && Array.isArray(child)) {
            const filteredMarks = child.filter(mark => !shouldRemoveMark(mark));
            if (filteredMarks.length !== child.length) {
                changed = true;
            }
            next[key] = filteredMarks;
            continue;
        }

        const result = sanitizeValue(child, shouldRemoveMark);
        changed = changed || result.changed;
        next[key] = result.content;
    }

    return {
        content: changed ? next : value,
        changed,
    };
}

export function classifyExplicitEntityAttrs(attrs: unknown, lookup: EntityLookup): ExplicitEntityMarkStatus {
    if (!isRecord(attrs)) {
        return 'stale';
    }

    if (typeof attrs['type'] === 'string' && attrs['type'] === 'entity_implicit') {
        return 'derived';
    }

    const id = typeof attrs['id'] === 'string' ? attrs['id'].trim() : '';
    const label = typeof attrs['label'] === 'string' ? attrs['label'].trim() : '';

    if (id && lookup.hasEntityId(id)) {
        return 'valid';
    }

    if (label && lookup.hasEntityLabel(label)) {
        return 'valid';
    }

    return 'stale';
}

export function classifyEntityMark(mark: JsonValue, lookup: EntityLookup): EntityMarkClassification {
    if (!isRecord(mark)) {
        return 'other';
    }

    const type = typeof mark['type'] === 'string' ? mark['type'] : '';
    if (type === 'entity_implicit') {
        return 'derived-implicit';
    }

    if (type !== 'entity') {
        return 'other';
    }

    const status = classifyExplicitEntityAttrs(mark['attrs'], lookup);
    if (status === 'valid') {
        return 'valid-explicit';
    }
    if (status === 'derived') {
        return 'derived-implicit';
    }
    return 'stale-explicit';
}

function isDerivedEntityMark(mark: JsonValue): boolean {
    return classifyEntityMark(mark, {
        hasEntityId: () => false,
        hasEntityLabel: () => false,
    }) === 'derived-implicit';
}

function isStaleEntityMark(mark: JsonValue, lookup: EntityLookup): boolean {
    return classifyEntityMark(mark, lookup) === 'stale-explicit';
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return !!value && typeof value === 'object' && !Array.isArray(value);
}
