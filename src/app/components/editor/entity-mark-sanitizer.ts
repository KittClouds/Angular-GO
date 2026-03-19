type JsonValue = null | boolean | number | string | JsonValue[] | { [key: string]: JsonValue };

export interface SanitizedDocResult<T = JsonValue> {
    content: T;
    changed: boolean;
}

type EntityLookup = {
    hasEntityId: (id: string) => boolean;
    hasEntityLabel: (label: string) => boolean;
};

export function sanitizeEntityMarksInDocJson<T extends JsonValue>(
    content: T,
    lookup: EntityLookup
): SanitizedDocResult<T> {
    const { content: sanitizedContent, changed } = sanitizeValue(content, lookup);
    return {
        content: sanitizedContent as T,
        changed,
    };
}

function sanitizeValue(value: JsonValue, lookup: EntityLookup): SanitizedDocResult<JsonValue> {
    if (Array.isArray(value)) {
        let changed = false;
        const next = value.map(item => {
            const result = sanitizeValue(item, lookup);
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
            const filteredMarks = child.filter(mark => !isStaleEntityMark(mark, lookup));
            if (filteredMarks.length !== child.length) {
                changed = true;
            }
            next[key] = filteredMarks;
            continue;
        }

        const result = sanitizeValue(child, lookup);
        changed = changed || result.changed;
        next[key] = result.content;
    }

    return {
        content: changed ? next : value,
        changed,
    };
}

function isStaleEntityMark(mark: JsonValue, lookup: EntityLookup): boolean {
    if (!mark || typeof mark !== 'object' || Array.isArray(mark)) {
        return false;
    }

    const type = typeof mark['type'] === 'string' ? mark['type'] : '';
    if (type !== 'entity') {
        return false;
    }

    const attrs = mark['attrs'];
    if (!attrs || typeof attrs !== 'object' || Array.isArray(attrs)) {
        return true;
    }

    const id = typeof attrs['id'] === 'string' ? attrs['id'].trim() : '';
    const label = typeof attrs['label'] === 'string' ? attrs['label'].trim() : '';

    if (id && lookup.hasEntityId(id)) {
        return false;
    }

    if (label && lookup.hasEntityLabel(label)) {
        return false;
    }

    return true;
}
