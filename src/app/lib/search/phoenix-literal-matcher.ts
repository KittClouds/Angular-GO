export interface PhoenixLiteralPattern<T = unknown> {
    text: string;
    payload?: T;
}

export interface PhoenixLiteralMatch<T = unknown> {
    from: number;
    to: number;
    text: string;
    term: string;
    payload?: T;
}

export function matchLiteralPatterns<T>(
    text: string,
    patterns: PhoenixLiteralPattern<T>[],
    options: { caseSensitive?: boolean; wholeWord?: boolean } = {},
): Array<PhoenixLiteralMatch<T>> {
    if (!text || !patterns.length) {
        return [];
    }

    const normalizedText = options.caseSensitive ? text : text.toLocaleLowerCase();
    const buckets = new Map<string, Array<{ pattern: PhoenixLiteralPattern<T>; normalized: string }>>();
    for (const pattern of patterns) {
        const normalized = (options.caseSensitive ? pattern.text : pattern.text.toLocaleLowerCase()).trim();
        if (!normalized) {
            continue;
        }
        const key = normalized[0] || '';
        const bucket = buckets.get(key);
        if (bucket) {
            bucket.push({ pattern, normalized });
        } else {
            buckets.set(key, [{ pattern, normalized }]);
        }
    }
    for (const bucket of buckets.values()) {
        bucket.sort((left, right) => right.normalized.length - left.normalized.length);
    }

    const candidates: Array<PhoenixLiteralMatch<T>> = [];
    for (let index = 0; index < normalizedText.length; index += 1) {
        const bucket = buckets.get(normalizedText[index] || '');
        if (!bucket) {
            continue;
        }
        for (const item of bucket) {
            const end = index + item.normalized.length;
            if (end > normalizedText.length || !normalizedText.startsWith(item.normalized, index)) {
                continue;
            }
            if (options.wholeWord && !isWordBoundary(text, index, end)) {
                continue;
            }
            candidates.push({
                from: index,
                to: end,
                text: text.slice(index, end),
                term: item.pattern.text,
                payload: item.pattern.payload,
            });
        }
    }

    return selectNonOverlapping(candidates);
}

function selectNonOverlapping<T>(matches: Array<PhoenixLiteralMatch<T>>): Array<PhoenixLiteralMatch<T>> {
    const selected: Array<PhoenixLiteralMatch<T>> = [];
    const sorted = [...matches].sort((left, right) => left.from - right.from || (right.to - right.from) - (left.to - left.from));
    for (const match of sorted) {
        if (selected.some((existing) => existing.from < match.to && match.from < existing.to)) {
            continue;
        }
        selected.push(match);
    }
    return selected;
}

function isWordBoundary(text: string, from: number, to: number): boolean {
    const before = from > 0 ? text[from - 1] || '' : '';
    const after = to < text.length ? text[to] || '' : '';
    return !isWordChar(before) && !isWordChar(after);
}

function isWordChar(char: string): boolean {
    return !!char && /[\p{L}\p{N}_]/u.test(char);
}
