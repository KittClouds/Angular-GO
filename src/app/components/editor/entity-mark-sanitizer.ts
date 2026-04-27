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

export function repairDuplicatedEntityLabelsInDocJson<T extends JsonValue>(
    content: T,
    labels: Iterable<string>
): SanitizedDocResult<T> {
    const normalizedLabels = [...labels]
        .map(label => label.trim())
        .filter(label => label.length >= 2)
        .sort((a, b) => b.length - a.length);

    if (normalizedLabels.length === 0) {
        return { content, changed: false };
    }

    const { content: repairedContent, changed } = repairDuplicatedLabels(content, normalizedLabels);
    return {
        content: repairedContent as T,
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

function repairDuplicatedLabels(value: JsonValue, labels: string[]): SanitizedDocResult<JsonValue> {
    if (Array.isArray(value)) {
        let changed = false;
        const next = value.map(item => {
            const result = repairDuplicatedLabels(item, labels);
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
        if (key === 'text' && typeof child === 'string') {
            const repaired = repairTextWithNormalizedLabels(child, labels);
            changed = changed || repaired !== child;
            next[key] = repaired;
            continue;
        }

        const result = repairDuplicatedLabels(child, labels);
        changed = changed || result.changed;
        next[key] = result.content;
    }

    return { content: changed ? next : value, changed };
}

export function repairDuplicatedEntityLabelsInText(text: string, labels: Iterable<string>): string {
    const normalizedLabels = [...labels]
        .map(label => label.trim())
        .filter(label => label.length >= 2)
        .sort((a, b) => b.length - a.length);

    return repairTextWithNormalizedLabels(text, normalizedLabels);
}

function repairTextWithNormalizedLabels(text: string, normalizedLabels: string[]): string {
    let repaired = text;
    for (const label of normalizedLabels) {
        repaired = repaired.split(`${label}${label}`).join(label);
    }
    return repaired;
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
