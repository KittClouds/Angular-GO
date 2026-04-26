import type { AnalyticsHighlightRange, TextAnalytics } from './text-analytics';
import type { AnalyticsHighlightKind, AnalyticsHighlightPaletteKey } from '../Scanner/types';

export type WritingLensId =
    | 'keyword'
    | 'repetition'
    | 'proximity'
    | 'cadence'
    | 'negation'
    | 'ornament'
    | 'distance'
    | 'diction';

export type WritingSeverity = 'low' | 'medium' | 'high';

export interface WritingLensSummary {
    id: WritingLensId;
    label: string;
    description: string;
    count: number;
    severity: WritingSeverity;
}

export interface WritingLensItem {
    id: string;
    lensId: WritingLensId;
    label: string;
    detail: string;
    count: number;
    severity: WritingSeverity;
    highlightKind: AnalyticsHighlightKind;
    paletteKey: AnalyticsHighlightPaletteKey;
    ranges: AnalyticsHighlightRange[];
}

export interface WritingOverviewChip {
    label: string;
    value: string;
    tone: WritingSeverity | 'good';
}

export interface WritingWorkbench {
    summaries: WritingLensSummary[];
    itemsByLens: Record<WritingLensId, WritingLensItem[]>;
    overview: WritingOverviewChip[];
}

interface Token {
    text: string;
    normalized: string;
    from: number;
    to: number;
}

interface Sentence {
    text: string;
    from: number;
    to: number;
    wordCount: number;
}

const LENS_META: Record<WritingLensId, Omit<WritingLensSummary, 'count' | 'severity'>> = {
    keyword: { id: 'keyword', label: 'Echo', description: 'repeated words and local pressure' },
    repetition: { id: 'repetition', label: 'Phrases', description: 'repeated multi-word phrases' },
    proximity: { id: 'proximity', label: 'Proximity', description: 'nearby repeated roots' },
    cadence: { id: 'cadence', label: 'Cadence', description: 'sentence rhythm hotspots' },
    negation: { id: 'negation', label: 'Negation', description: 'no / not / never / without frames' },
    ornament: { id: 'ornament', label: 'Ornament', description: 'lush or overloaded prose' },
    distance: { id: 'distance', label: 'Distance', description: 'felt / seemed / noticed filters' },
    diction: { id: 'diction', label: 'Diction', description: 'register shifts and texture bands' },
};

const NEGATION_PATTERNS = [
    { label: 'not', pattern: /\bnot\b/gi, detail: 'hard negation' },
    { label: 'no', pattern: /\bno\b/gi, detail: 'absence frame' },
    { label: 'never', pattern: /\bnever\b/gi, detail: 'hard negation' },
    { label: 'nothing', pattern: /\bnothing\b/gi, detail: 'absence frame' },
    { label: 'without', pattern: /\bwithout\b/gi, detail: 'absence frame' },
    { label: 'no longer', pattern: /\bno\s+longer\b/gi, detail: 'state reversal' },
    { label: 'not X but Y', pattern: /\bnot\b[^.!?\n]{0,80}\bbut\b/gi, detail: 'contrast negation' },
];

const DISTANCE_WORDS = new Map([
    ['felt', 'interior filter'],
    ['feel', 'interior filter'],
    ['seemed', 'uncertainty filter'],
    ['seem', 'uncertainty filter'],
    ['noticed', 'perception filter'],
    ['notice', 'perception filter'],
    ['realized', 'interiority filter'],
    ['realize', 'interiority filter'],
    ['saw', 'perception filter'],
    ['heard', 'perception filter'],
    ['thought', 'interiority filter'],
    ['wondered', 'interiority filter'],
    ['began', 'delay verb'],
    ['started', 'delay verb'],
    ['managed', 'effort filter'],
    ['tried', 'effort filter'],
]);

const ABSTRACT_NOUNS = new Set([
    'truth', 'shape', 'weight', 'silence', 'memory', 'world', 'light', 'darkness',
    'fear', 'hope', 'grief', 'power', 'presence', 'absence', 'motion', 'time',
    'space', 'meaning', 'certainty', 'attention', 'concern', 'effort', 'exhaustion',
]);

const DICTION_BANDS = [
    { label: 'technical', detail: 'system or mechanism diction', words: ['system', 'operator', 'claim', 'signal', 'protocol', 'module', 'architecture'] },
    { label: 'poetic', detail: 'abstract lyrical diction', words: ['truth', 'silence', 'memory', 'light', 'shadow', 'shape', 'weight'] },
    { label: 'physical', detail: 'body or material diction', words: ['hand', 'hands', 'lungs', 'breath', 'bones', 'skin', 'grass', 'stone'] },
    { label: 'violent', detail: 'impact or rupture diction', words: ['break', 'tore', 'rip', 'wrenched', 'shard', 'deadly', 'brutal'] },
];

export function buildWritingWorkbench(text: string, analytics: TextAnalytics): WritingWorkbench {
    const tokens = tokenize(text);
    const sentences = splitSentences(text);
    const itemsByLens = createEmptyItemsByLens();

    itemsByLens.keyword = buildKeywordItems(analytics);
    itemsByLens.repetition = analytics.repetition.items.map(item => ({
        id: item.id,
        lensId: 'repetition',
        label: item.phrase,
        detail: `${item.occurrenceCount} phrase echoes`,
        count: item.occurrenceCount,
        severity: item.severity,
        highlightKind: 'repetition',
        paletteKey: 'repetition',
        ranges: item.highlightRanges,
    }));
    itemsByLens.proximity = analytics.proximity.items.map(item => ({
        id: item.id,
        lensId: 'proximity',
        label: item.root,
        detail: `${item.partOfSpeech} forms within ${item.minWordDistance} words`,
        count: item.surfaceForms.length,
        severity: item.severity,
        highlightKind: 'proximity',
        paletteKey: 'proximity',
        ranges: item.highlightRanges,
    }));
    itemsByLens.cadence = analytics.cadence.hotspots.map(item => ({
        id: item.id,
        lensId: 'cadence',
        label: item.label,
        detail: item.explanation,
        count: item.highlightRanges.length,
        severity: item.severity,
        highlightKind: 'cadence',
        paletteKey: 'cadence',
        ranges: item.highlightRanges,
    }));
    itemsByLens.negation = buildNegationItems(text);
    itemsByLens.ornament = buildOrnamentItems(sentences);
    itemsByLens.distance = buildDistanceItems(tokens);
    itemsByLens.diction = buildDictionItems(tokens);

    return {
        summaries: (Object.keys(LENS_META) as WritingLensId[]).map(id => summarizeLens(id, itemsByLens[id])),
        itemsByLens,
        overview: buildOverview(analytics, itemsByLens),
    };
}

function buildKeywordItems(analytics: TextAnalytics): WritingLensItem[] {
    return analytics.keywordDensity.slice(0, 20).map(item => ({
        id: `keyword:${item.word}`,
        lensId: 'keyword',
        label: item.word,
        detail: `${item.count} uses, ${item.percentage}% of words`,
        count: item.count,
        severity: severityFromCount(item.count, 8, 14),
        highlightKind: 'keyword',
        paletteKey: 'keyword',
        ranges: [],
    }));
}

function buildNegationItems(text: string): WritingLensItem[] {
    return NEGATION_PATTERNS
        .map(({ label, pattern, detail }) => {
            const ranges = collectRegexRanges(text, pattern);
            return {
                id: `negation:${label}`,
                lensId: 'negation' as const,
                label,
                detail,
                count: ranges.length,
                severity: severityFromCount(ranges.length, 4, 8),
                highlightKind: 'negation' as const,
                paletteKey: 'negation' as const,
                ranges,
            };
        })
        .filter(item => item.count > 0)
        .sort(compareItems);
}

function buildDistanceItems(tokens: Token[]): WritingLensItem[] {
    const groups = new Map<string, { detail: string; ranges: AnalyticsHighlightRange[] }>();
    for (const token of tokens) {
        const detail = DISTANCE_WORDS.get(token.normalized);
        if (!detail) continue;
        const group = groups.get(token.normalized) ?? { detail, ranges: [] };
        group.ranges.push(toRange(token.from, token.to, token.text));
        groups.set(token.normalized, group);
    }

    return Array.from(groups.entries()).map(([label, group]) => ({
        id: `distance:${label}`,
        lensId: 'distance' as const,
        label,
        detail: group.detail,
        count: group.ranges.length,
        severity: severityFromCount(group.ranges.length, 3, 6),
        highlightKind: 'distance' as const,
        paletteKey: 'distance' as const,
        ranges: group.ranges,
    })).sort(compareItems);
}

function buildOrnamentItems(sentences: Sentence[]): WritingLensItem[] {
    return sentences
        .map((sentence, index) => {
            const words = tokenize(sentence.text);
            const abstractCount = words.filter(word => ABSTRACT_NOUNS.has(word.normalized)).length;
            const simileCount = countMatches(sentence.text, /\b(?:like|as if|as though)\b/gi);
            const prepChains = countMatches(sentence.text, /\b(?:of|in|with|through|around|between)\b[^.!?,;]{8,}/gi);
            const hyphenStacks = countMatches(sentence.text, /\b[\p{L}]+-[\p{L}-]+\b/gu);
            const score = abstractCount + simileCount + prepChains + hyphenStacks;
            const reasons = [
                abstractCount ? `${abstractCount} abstract nouns` : '',
                simileCount ? `${simileCount} comparison frames` : '',
                prepChains ? `${prepChains} long tails` : '',
                hyphenStacks ? `${hyphenStacks} compound modifiers` : '',
            ].filter(Boolean);

            return {
                id: `ornament:${index}`,
                lensId: 'ornament' as const,
                label: summarizeSentence(sentence.text),
                detail: reasons.join(', ') || 'light ornament',
                count: score,
                severity: severityFromCount(score, 2, 4),
                highlightKind: 'ornament' as const,
                paletteKey: 'ornament' as const,
                ranges: score > 0 ? [toRange(sentence.from, sentence.to, sentence.text)] : [],
            };
        })
        .filter(item => item.count > 0)
        .sort(compareItems)
        .slice(0, 24);
}

function buildDictionItems(tokens: Token[]): WritingLensItem[] {
    return DICTION_BANDS.map(band => {
        const words = new Set(band.words);
        const ranges = tokens
            .filter(token => words.has(token.normalized))
            .map(token => toRange(token.from, token.to, token.text));
        return {
            id: `diction:${band.label}`,
            lensId: 'diction' as const,
            label: band.label,
            detail: band.detail,
            count: ranges.length,
            severity: severityFromCount(ranges.length, 5, 10),
            highlightKind: 'diction' as const,
            paletteKey: 'diction' as const,
            ranges,
        };
    }).filter(item => item.count > 0).sort(compareItems);
}

function buildOverview(
    analytics: TextAnalytics,
    itemsByLens: Record<WritingLensId, WritingLensItem[]>,
): WritingOverviewChip[] {
    const rhythmTone = analytics.flowInsights.hasMonotony ? 'medium' : 'good';
    return [
        { label: 'Flow', value: `${analytics.flowScore}%`, tone: analytics.flowScore >= 80 ? 'good' : 'medium' },
        { label: 'Rhythm', value: rhythmTone === 'good' ? 'varied' : 'monotony', tone: rhythmTone },
        { label: 'Echo', value: String(totalCount(itemsByLens.keyword)), tone: severityFromCount(totalCount(itemsByLens.keyword), 18, 32) },
        { label: 'Negation', value: String(totalCount(itemsByLens.negation)), tone: severityFromCount(totalCount(itemsByLens.negation), 8, 16) },
        { label: 'Ornament', value: ornamentLabel(itemsByLens.ornament), tone: maxSeverity(itemsByLens.ornament) },
    ];
}

function summarizeLens(id: WritingLensId, items: WritingLensItem[]): WritingLensSummary {
    return {
        ...LENS_META[id],
        count: totalCount(items),
        severity: maxSeverity(items),
    };
}

function createEmptyItemsByLens(): Record<WritingLensId, WritingLensItem[]> {
    return {
        keyword: [],
        repetition: [],
        proximity: [],
        cadence: [],
        negation: [],
        ornament: [],
        distance: [],
        diction: [],
    };
}

function collectRegexRanges(text: string, pattern: RegExp): AnalyticsHighlightRange[] {
    const ranges: AnalyticsHighlightRange[] = [];
    pattern.lastIndex = 0;
    for (const match of text.matchAll(pattern)) {
        if (typeof match.index !== 'number' || !match[0]) continue;
        ranges.push(toRange(match.index, match.index + match[0].length, match[0]));
    }
    return ranges;
}

function tokenize(text: string): Token[] {
    const tokens: Token[] = [];
    for (const match of text.matchAll(/[\p{L}\p{N}]+(?:['’-][\p{L}\p{N}]+)*/gu)) {
        if (typeof match.index !== 'number') continue;
        const raw = match[0];
        tokens.push({
            text: raw,
            normalized: raw.toLowerCase().replace(/[’']/g, ''),
            from: match.index,
            to: match.index + raw.length,
        });
    }
    return tokens;
}

function splitSentences(text: string): Sentence[] {
    const sentences: Sentence[] = [];
    for (const match of text.matchAll(/[^.!?\n]+[.!?]?/g)) {
        if (typeof match.index !== 'number') continue;
        const raw = match[0];
        const trimmed = raw.trim();
        if (!trimmed) continue;
        const leading = raw.search(/\S/);
        const from = match.index + Math.max(leading, 0);
        const to = from + trimmed.length;
        sentences.push({ text: trimmed, from, to, wordCount: tokenize(trimmed).length });
    }
    return sentences;
}

function countMatches(text: string, pattern: RegExp): number {
    return Array.from(text.matchAll(pattern)).length;
}

function toRange(from: number, to: number, text: string): AnalyticsHighlightRange {
    return { from, to, text };
}

function totalCount(items: WritingLensItem[]): number {
    return items.reduce((sum, item) => sum + item.count, 0);
}

function maxSeverity(items: WritingLensItem[]): WritingSeverity {
    if (items.some(item => item.severity === 'high')) return 'high';
    if (items.some(item => item.severity === 'medium')) return 'medium';
    return 'low';
}

function severityFromCount(count: number, medium: number, high: number): WritingSeverity {
    if (count >= high) return 'high';
    if (count >= medium) return 'medium';
    return 'low';
}

function ornamentLabel(items: WritingLensItem[]): string {
    const severe = maxSeverity(items);
    if (severe === 'high') return 'overgrown';
    if (severe === 'medium') return 'lush';
    return items.length ? 'clean' : 'quiet';
}

function summarizeSentence(text: string): string {
    const compact = text.replace(/\s+/g, ' ').trim();
    return compact.length > 78 ? `${compact.slice(0, 75)}...` : compact;
}

function compareItems(a: WritingLensItem, b: WritingLensItem): number {
    return b.count - a.count || a.label.localeCompare(b.label);
}
