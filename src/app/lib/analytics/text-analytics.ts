import type { TextQuoteSelector } from '../Scanner/types';

// src/app/lib/analytics/text-analytics.ts
// Text Analytics Service - shared TS model + local fallback analysis engine

export interface SentenceLengthDistribution {
    '1': number;
    '2-6': number;
    '7-15': number;
    '16-25': number;
    '26-39': number;
    '40+': number;
}

export interface FlowInsights {
    consecutivePatterns: number;
    dominantRange: string;
    varietyScore: number;
    hasMonotony: boolean;
}

export interface AnalyticsHighlightRange {
    from: number;
    to: number;
    text: string;
    selector?: TextQuoteSelector;
}

export interface PhraseEchoItem {
    id: string;
    phrase: string;
    occurrenceCount: number;
    severity: 'low' | 'medium' | 'high';
    snippets: string[];
    highlightRanges: AnalyticsHighlightRange[];
}

export interface ProximityConflictItem {
    id: string;
    root: string;
    surfaceForms: string[];
    partOfSpeech: string;
    minWordDistance: number;
    severity: 'low' | 'medium' | 'high';
    snippets: string[];
    highlightRanges: AnalyticsHighlightRange[];
}

export interface CadenceSentence {
    id: string;
    paragraphIndex: number;
    sentenceIndex: number;
    from: number;
    to: number;
    wordCount: number;
    bucket: keyof SentenceLengthDistribution;
    snippet: string;
}

export interface CadenceHotspot {
    id: string;
    type: 'monotony' | 'whiplash';
    label: string;
    severity: 'low' | 'medium' | 'high';
    explanation: string;
    sentenceIds: string[];
    highlightRanges: AnalyticsHighlightRange[];
}

export interface CadenceAnalysis {
    sentences: CadenceSentence[];
    hotspots: CadenceHotspot[];
}

export interface RepetitionAnalysis {
    items: PhraseEchoItem[];
    totalFlags: number;
}

export interface ProximityAnalysis {
    items: ProximityConflictItem[];
    totalFlags: number;
}

export interface TextAnalytics {
    wordCount: number;
    characterCount: number;
    characterCountNoSpaces: number;
    sentenceCount: number;
    paragraphCount: number;
    readingLevel: string;
    readingTimeMinutes: number;
    readingTimeSeconds: number;
    speakingTimeMinutes: number;
    speakingTimeSeconds: number;
    averageSentenceLength: number;
    sentenceLengthVariation: number;
    flowScore: number;
    sentenceLengthDistribution: SentenceLengthDistribution;
    flowInsights: FlowInsights;
    keywordDensity: Array<{ word: string; count: number; percentage: number }>;
    repetition: RepetitionAnalysis;
    proximity: ProximityAnalysis;
    cadence: CadenceAnalysis;
}

interface TokenMatch {
    text: string;
    normalized: string;
    root: string;
    from: number;
    to: number;
    index: number;
}

interface SentenceMatch {
    text: string;
    from: number;
    to: number;
    paragraphIndex: number;
}

const STOP_WORDS = new Set([
    'the', 'a', 'an', 'and', 'or', 'but', 'in', 'on', 'at', 'to', 'for',
    'of', 'with', 'by', 'from', 'as', 'is', 'was', 'are', 'were', 'been',
    'be', 'have', 'has', 'had', 'do', 'does', 'did', 'will', 'would', 'could',
    'should', 'may', 'might', 'must', 'shall', 'can', 'need', 'dare', 'ought',
    'used', 'it', 'its', 'this', 'that', 'these', 'those', 'i', 'you', 'he',
    'she', 'we', 'they', 'me', 'him', 'her', 'us', 'them', 'my', 'your',
    'his', 'our', 'their', 'mine', 'yours', 'hers', 'ours', 'theirs',
    'what', 'which', 'who', 'whom', 'whose', 'where', 'when', 'why', 'how',
    'all', 'each', 'every', 'both', 'few', 'more', 'most', 'other', 'some',
    'such', 'no', 'nor', 'not', 'only', 'own', 'same', 'so', 'than', 'too',
    'very', 'just', 'also', 'now', 'here', 'there', 'then', 'once', 'if',
    'into', 'through', 'during', 'before', 'after', 'above', 'below', 'up',
    'down', 'out', 'off', 'over', 'under', 'again', 'further', 'any', 'about',
]);

const LINE_BREAK_PATTERN = /[\r\n]/g;
const DIACRITIC_PATTERN = /\p{M}/gu;
const CURLY_APOSTROPHE_PATTERN = /’/g;
const NON_LEXEME_CHARS_PATTERN = /[^\p{L}\p{N}'-]/gu;
const LEXEME_EDGE_PATTERN = /^['-]+|['-]+$/g;

function createWordPattern(): RegExp {
    return /[\p{L}\p{N}]+(?:['’-][\p{L}\p{N}]+)*/gu;
}

/**
 * Parse Milkdown/ProseMirror JSON content to plain text
 */
export function parseContentToPlainText(content: string): string {
    if (!content) return '';

    try {
        const json = JSON.parse(content);
        return extractProjectedTextFromJsonNode(json);
    } catch {
        return content;
    }
}

function extractProjectedTextFromJsonNode(node: any): string {
    if (!node) return '';

    if (typeof node.text === 'string') {
        return node.text;
    }

    if (node.type === 'hard_break') {
        return '\n';
    }

    const children = Array.isArray(node.content)
        ? node.content.map(extractProjectedTextFromJsonNode)
        : [];

    if (children.length === 0) {
        return '';
    }

    return joinProjectedChildren(node.type, children);
}

function joinProjectedChildren(type: string | undefined, children: string[]): string {
    if (!children.length) {
        return '';
    }

    switch (type) {
        case 'doc':
        case 'blockquote':
        case 'bullet_list':
        case 'ordered_list':
            return joinWithSeparator(children, '\n\n');
        case 'listItem':
            return joinWithSeparator(children, '\n');
        default:
            return children.join('');
    }
}

function joinWithSeparator(children: string[], separator: string): string {
    const filtered = children.filter(child => child.length > 0);
    return filtered.join(separator);
}

function countSyllables(word: string): number {
    let normalized = normalizeLexeme(word).replace(/['-]/g, '');
    if (normalized.length <= 3) return 1;

    normalized = normalized.replace(/(?:[^laeiouy]es|ed|[^laeiouy]e)$/, '');
    normalized = normalized.replace(/^y/, '');

    const matches = normalized.match(/[aeiouy]{1,2}/g);
    return matches ? Math.max(matches.length, 1) : 1;
}

function getWords(text: string): string[] {
    return text.match(createWordPattern()) ?? [];
}

function getSentences(text: string): string[] {
    return text
        .split(/[.!?]+/)
        .map(sentence => sentence.trim())
        .filter(Boolean);
}

function getParagraphs(text: string): string[] {
    return text
        .split(/\n\n+/)
        .map(paragraph => paragraph.trim())
        .filter(Boolean);
}

function categorizeSentenceLengths(sentences: string[]): SentenceLengthDistribution {
    const distribution: SentenceLengthDistribution = {
        '1': 0,
        '2-6': 0,
        '7-15': 0,
        '16-25': 0,
        '26-39': 0,
        '40+': 0,
    };

    for (const sentence of sentences) {
        const count = getWords(sentence).length;
        distribution[getSentenceBucket(count)]++;
    }

    return distribution;
}

function getSentenceBucket(count: number): keyof SentenceLengthDistribution {
    if (count <= 1) return '1';
    if (count <= 6) return '2-6';
    if (count <= 15) return '7-15';
    if (count <= 25) return '16-25';
    if (count <= 39) return '26-39';
    return '40+';
}

function detectConsecutivePatterns(sentences: string[]): number {
    const lengths = sentences.map(sentence => getWords(sentence).length);
    let patternCount = 0;
    let consecutiveCount = 1;

    for (let index = 1; index < lengths.length; index++) {
        if (Math.abs(lengths[index] - lengths[index - 1]) <= 3) {
            consecutiveCount++;
            if (consecutiveCount >= 3) {
                patternCount++;
            }
        } else {
            consecutiveCount = 1;
        }
    }

    return patternCount;
}

function calculateVarietyScore(distribution: SentenceLengthDistribution, totalSentences: number): number {
    if (totalSentences === 0) return 0;

    const probabilities = Object.values(distribution)
        .map(value => value / totalSentences)
        .filter(value => value > 0);

    if (probabilities.length <= 1) return 0;

    const entropy = -probabilities.reduce((sum, probability) => sum + probability * Math.log2(probability), 0);
    const maxEntropy = Math.log2(probabilities.length);

    if (maxEntropy === 0) return 0;
    return Math.round((entropy / maxEntropy) * 100);
}

function analyzeFlowInsights(distribution: SentenceLengthDistribution, sentences: string[]): FlowInsights {
    const consecutivePatterns = detectConsecutivePatterns(sentences);
    const totalSentences = Object.values(distribution).reduce((sum, value) => sum + value, 0);
    const varietyScore = calculateVarietyScore(distribution, totalSentences);

    const entries = Object.entries(distribution) as [keyof SentenceLengthDistribution, number][];
    const dominant = entries.reduce((best, entry) => (entry[1] > best[1] ? entry : best), entries[0] || ['7-15', 0]);

    const lengths = sentences.map(sentence => getWords(sentence).length);
    let maxConsecutive = 1;
    let currentConsecutive = 1;

    for (let index = 1; index < lengths.length; index++) {
        if (Math.abs(lengths[index] - lengths[index - 1]) <= 3) {
            currentConsecutive++;
            maxConsecutive = Math.max(maxConsecutive, currentConsecutive);
        } else {
            currentConsecutive = 1;
        }
    }

    return {
        consecutivePatterns,
        dominantRange: dominant[0],
        varietyScore,
        hasMonotony: maxConsecutive >= 5,
    };
}

function calculateReadingLevel(wordCount: number, sentenceCount: number, syllableCount: number): string {
    if (wordCount === 0 || sentenceCount === 0) return 'N/A';

    const avgWordsPerSentence = wordCount / sentenceCount;
    const avgSyllablesPerWord = syllableCount / wordCount;
    const grade = 0.39 * avgWordsPerSentence + 11.8 * avgSyllablesPerWord - 15.59;

    if (grade < 1) return 'Kindergarten';
    if (grade < 6) return '1st-5th Grade';
    if (grade < 9) return '6th-8th Grade';
    if (grade < 13) return '9th-12th Grade';
    if (grade < 17) return 'College Level';
    return 'Graduate Level';
}

function calculateStandardDeviation(numbers: number[]): number {
    if (numbers.length === 0) return 0;

    const mean = numbers.reduce((sum, value) => sum + value, 0) / numbers.length;
    const squaredDiffs = numbers.map(value => (value - mean) ** 2);
    const variance = squaredDiffs.reduce((sum, value) => sum + value, 0) / numbers.length;
    return Math.sqrt(variance);
}

function calculateKeywordDensity(words: string[], totalWords: number): Array<{ word: string; count: number; percentage: number }> {
    const frequencies: Record<string, number> = {};

    for (const word of words) {
        const normalized = normalizeLexeme(word);
        if (normalized.length < 4 || STOP_WORDS.has(normalized) || /\d/.test(normalized)) {
            continue;
        }

        frequencies[normalized] = (frequencies[normalized] || 0) + 1;
    }

    return Object.entries(frequencies)
        .sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0]))
        .slice(0, 100)
        .map(([word, count]) => ({
            word,
            count,
            percentage: Math.round((count / Math.max(totalWords, 1)) * 1000) / 10,
        }));
}

function normalizeLexeme(word: string): string {
    return word
        .normalize('NFKD')
        .replace(DIACRITIC_PATTERN, '')
        .replace(CURLY_APOSTROPHE_PATTERN, '\'')
        .toLowerCase()
        .replace(NON_LEXEME_CHARS_PATTERN, '')
        .replace(LEXEME_EDGE_PATTERN, '');
}

function stemWord(word: string): string {
    let stem = normalizeLexeme(word).replace(/['-]/g, '');
    if (stem.length <= 4) {
        return stem;
    }

    const suffixes = ['ingly', 'edly', 'ingly', 'ment', 'ness', 'tion', 'sion', 'able', 'ible', 'less', 'ously', 'edly', 'ing', 'ers', 'ies', 'ied', 'est', 'ism', 'ist', 'ous', 'ive', 'ful', 'ly', 'ed', 'es', 'er', 's'];
    for (const suffix of suffixes) {
        if (stem.endsWith(suffix) && stem.length - suffix.length >= 3) {
            stem = stem.slice(0, -suffix.length);
            break;
        }
    }

    if (stem.endsWith('i') && stem.length > 3) {
        stem = `${stem.slice(0, -1)}y`;
    }

    if (stem.length >= 3 && stem.at(-1) === stem.at(-2) && /[bcdfghjklmnpqrstvwxyz]/.test(stem.at(-1) || '')) {
        stem = stem.slice(0, -1);
    }

    return stem;
}

function extractTokenMatches(text: string): TokenMatch[] {
    const matches = text.matchAll(createWordPattern());
    const tokens: TokenMatch[] = [];

    for (const match of matches) {
        const raw = match[0];
        const from = match.index ?? 0;
        const to = from + raw.length;
        tokens.push({
            text: raw,
            normalized: normalizeLexeme(raw),
            root: stemWord(raw),
            from,
            to,
            index: tokens.length,
        });
    }

    return tokens;
}

function buildSnippet(text: string, from: number, to: number, radius = 28): string {
    const start = Math.max(0, from - radius);
    const end = Math.min(text.length, to + radius);
    const prefix = start > 0 ? '...' : '';
    const suffix = end < text.length ? '...' : '';
    return `${prefix}${text.slice(start, end).replace(/\s+/g, ' ').trim()}${suffix}`;
}

function severityFromScore(score: number): 'low' | 'medium' | 'high' {
    if (score >= 4) return 'high';
    if (score >= 2) return 'medium';
    return 'low';
}

function analyzeRepetition(text: string, tokens: TokenMatch[]): RepetitionAnalysis {
    const phraseMap = new Map<string, { phrase: string; ranges: AnalyticsHighlightRange[]; tokenStarts: number[] }>();

    for (let size = 2; size <= 5; size++) {
        for (let index = 0; index + size <= tokens.length; index++) {
            const slice = tokens.slice(index, index + size);
            const normalizedParts = slice.map(token => token.normalized);
            const contentCount = normalizedParts.filter(part => part.length >= 4 && !STOP_WORDS.has(part)).length;
            if (contentCount < 2) {
                continue;
            }

            const phraseKey = normalizedParts.join(' ');
            const phraseText = slice.map(token => token.text.toLowerCase()).join(' ');
            const existing = phraseMap.get(phraseKey) ?? { phrase: phraseText, ranges: [], tokenStarts: [] };

            if (existing.tokenStarts.some(start => Math.abs(start - index) < size)) {
                continue;
            }

            existing.tokenStarts.push(index);
            existing.ranges.push({
                from: slice[0].from,
                to: slice[slice.length - 1].to,
                text: text.slice(slice[0].from, slice[slice.length - 1].to),
            });
            phraseMap.set(phraseKey, existing);
        }
    }

    const items = [...phraseMap.entries()]
        .filter(([, value]) => value.ranges.length >= 2)
        .sort((left, right) => {
            const countDiff = right[1].ranges.length - left[1].ranges.length;
            if (countDiff !== 0) return countDiff;
            return right[0].length - left[0].length;
        })
        .slice(0, 12)
        .map(([key, value]) => {
            const occurrenceCount = value.ranges.length;
            const score = occurrenceCount + Math.max(0, key.split(' ').length - 2);
            return {
                id: `echo:${key.replace(/\s+/g, '-')}`,
                phrase: value.phrase,
                occurrenceCount,
                severity: severityFromScore(score),
                snippets: value.ranges.slice(0, 3).map(range => buildSnippet(text, range.from, range.to)),
                highlightRanges: value.ranges,
            } satisfies PhraseEchoItem;
        });

    return {
        items,
        totalFlags: items.length,
    };
}

function analyzeProximity(text: string, tokens: TokenMatch[]): ProximityAnalysis {
    const byRoot = new Map<string, TokenMatch[]>();

    for (const token of tokens) {
        if (token.normalized.length < 4 || STOP_WORDS.has(token.normalized) || token.root.length < 3) {
            continue;
        }

        const group = byRoot.get(token.root) ?? [];
        group.push(token);
        byRoot.set(token.root, group);
    }

    const items: ProximityConflictItem[] = [];

    for (const [root, group] of byRoot.entries()) {
        if (group.length < 2) {
            continue;
        }

        const highlightRanges: AnalyticsHighlightRange[] = [];
        let minWordDistance = Number.POSITIVE_INFINITY;
        let bestPair: [TokenMatch, TokenMatch] | null = null;

        for (let index = 1; index < group.length; index++) {
            const prev = group[index - 1];
            const current = group[index];
            const distance = current.index - prev.index;
            if (distance > 26) {
                continue;
            }

            if (distance < minWordDistance) {
                minWordDistance = distance;
                bestPair = [prev, current];
            }

            for (const token of [prev, current]) {
                if (!highlightRanges.some(range => range.from === token.from && range.to === token.to)) {
                    highlightRanges.push({
                        from: token.from,
                        to: token.to,
                        text: text.slice(token.from, token.to),
                    });
                }
            }
        }

        if (!bestPair || !Number.isFinite(minWordDistance)) {
            continue;
        }

        const severityScore = Math.max(1, 6 - Math.min(minWordDistance, 5)) + Math.max(0, highlightRanges.length - 2);
        items.push({
            id: `prox:${root}`,
            root,
            surfaceForms: [...new Set(group.map(token => token.text.toLowerCase()))].slice(0, 4),
            partOfSpeech: 'root-family',
            minWordDistance,
            severity: severityFromScore(severityScore),
            snippets: [
                buildSnippet(text, bestPair[0].from, bestPair[0].to),
                buildSnippet(text, bestPair[1].from, bestPair[1].to),
            ],
            highlightRanges: highlightRanges.sort((left, right) => left.from - right.from),
        });
    }

    items.sort((left, right) => left.minWordDistance - right.minWordDistance || right.highlightRanges.length - left.highlightRanges.length);

    return {
        items: items.slice(0, 12),
        totalFlags: Math.min(items.length, 12),
    };
}

function extractSentenceMatches(text: string): SentenceMatch[] {
    const sentences: SentenceMatch[] = [];
    let cursor = 0;
    let paragraphIndex = 0;

    while (cursor < text.length) {
        while (cursor < text.length && /\s/.test(text[cursor])) {
            if (text[cursor] === '\n' && text[cursor + 1] === '\n') {
                paragraphIndex++;
            }
            cursor++;
        }

        if (cursor >= text.length) {
            break;
        }

        const start = cursor;
        while (cursor < text.length && !/[.!?]/.test(text[cursor])) {
            cursor++;
        }
        while (cursor < text.length && /[.!?]/.test(text[cursor])) {
            cursor++;
        }

        const end = cursor;
        const raw = text.slice(start, end).trim();
        if (!raw) {
            continue;
        }

        const from = text.indexOf(raw, start);
        const to = from + raw.length;
        sentences.push({
            text: raw,
            from,
            to,
            paragraphIndex,
        });
    }

    return sentences;
}

function analyzeCadence(text: string): CadenceAnalysis {
    const sentenceMatches = extractSentenceMatches(text);
    const sentences: CadenceSentence[] = sentenceMatches.map((sentence, index) => {
        const wordCount = getWords(sentence.text).length;
        return {
            id: `sentence:${index}`,
            paragraphIndex: sentence.paragraphIndex,
            sentenceIndex: index,
            from: sentence.from,
            to: sentence.to,
            wordCount,
            bucket: getSentenceBucket(wordCount),
            snippet: buildSnippet(text, sentence.from, sentence.to, 18),
        };
    });

    const hotspots: CadenceHotspot[] = [];

    let runStart = 0;
    while (runStart < sentences.length) {
        let runEnd = runStart;
        while (
            runEnd + 1 < sentences.length &&
            Math.abs(sentences[runEnd + 1].wordCount - sentences[runEnd].wordCount) <= 3
        ) {
            runEnd++;
        }

        if (runEnd - runStart + 1 >= 5) {
            const run = sentences.slice(runStart, runEnd + 1);
            hotspots.push({
                id: `cadence:monotony:${runStart}`,
                type: 'monotony',
                label: `${run.length} similar-length sentences`,
                severity: severityFromScore(run.length - 1),
                explanation: 'A long run of similarly sized sentences can flatten the rhythm.',
                sentenceIds: run.map(sentence => sentence.id),
                highlightRanges: run.map(sentence => ({
                    from: sentence.from,
                    to: sentence.to,
                    text: text.slice(sentence.from, sentence.to),
                })),
            });
        }

        runStart = runEnd + 1;
    }

    for (let index = 1; index < sentences.length; index++) {
        const prev = sentences[index - 1];
        const current = sentences[index];
        const diff = Math.abs(current.wordCount - prev.wordCount);
        if (diff < 12) {
            continue;
        }

        hotspots.push({
            id: `cadence:whiplash:${index}`,
            type: 'whiplash',
            label: `${prev.wordCount} -> ${current.wordCount} words`,
            severity: diff >= 20 ? 'high' : 'medium',
            explanation: 'A sharp sentence-length jump creates a noticeable pacing snap.',
            sentenceIds: [prev.id, current.id],
            highlightRanges: [
                { from: prev.from, to: prev.to, text: text.slice(prev.from, prev.to) },
                { from: current.from, to: current.to, text: text.slice(current.from, current.to) },
            ],
        });
    }

    return {
        sentences,
        hotspots: hotspots.slice(0, 16),
    };
}

export function analyzeText(text: string): TextAnalytics {
    const words = getWords(text);
    const sentences = getSentences(text);
    const paragraphs = getParagraphs(text);
    const tokens = extractTokenMatches(text);

    const wordCount = words.length;
    const characterCount = text.replace(LINE_BREAK_PATTERN, '').length;
    const characterCountNoSpaces = text.replace(/\s/g, '').length;
    const sentenceCount = sentences.length;
    // Paragraphs are counted from rendered prose blocks, not raw source lines.
    const paragraphCount = paragraphs.length;

    const syllableCount = words.reduce((sum, word) => sum + countSyllables(word), 0);
    const readingLevel = calculateReadingLevel(wordCount, sentenceCount, syllableCount);

    const readingTimeTotal = Math.ceil((wordCount / 225) * 60);
    const readingTimeMinutes = Math.floor(readingTimeTotal / 60);
    const readingTimeSeconds = readingTimeTotal % 60;

    const speakingTimeTotal = Math.ceil((wordCount / 150) * 60);
    const speakingTimeMinutes = Math.floor(speakingTimeTotal / 60);
    const speakingTimeSeconds = speakingTimeTotal % 60;

    const sentenceLengths = sentences.map(sentence => getWords(sentence).length);
    const averageSentenceLength = sentenceCount > 0
        ? Math.round((wordCount / sentenceCount) * 10) / 10
        : 0;
    const sentenceLengthVariation = calculateStandardDeviation(sentenceLengths);

    const sentenceLengthDistribution = categorizeSentenceLengths(sentences);
    const flowInsights = analyzeFlowInsights(sentenceLengthDistribution, sentences);
    const flowScore = sentenceCount > 0
        ? Math.round((Math.min(100, (sentenceLengthVariation / 8) * 100) * 0.6) + (flowInsights.varietyScore * 0.4))
        : 0;

    return {
        wordCount,
        characterCount,
        characterCountNoSpaces,
        sentenceCount,
        paragraphCount,
        readingLevel,
        readingTimeMinutes,
        readingTimeSeconds,
        speakingTimeMinutes,
        speakingTimeSeconds,
        averageSentenceLength,
        sentenceLengthVariation,
        flowScore,
        sentenceLengthDistribution,
        flowInsights,
        keywordDensity: calculateKeywordDensity(words, wordCount),
        repetition: analyzeRepetition(text, tokens),
        proximity: analyzeProximity(text, tokens),
        cadence: analyzeCadence(text),
    };
}

export function getEmptyAnalytics(): TextAnalytics {
    return {
        wordCount: 0,
        characterCount: 0,
        characterCountNoSpaces: 0,
        sentenceCount: 0,
        paragraphCount: 0,
        readingLevel: 'N/A',
        readingTimeMinutes: 0,
        readingTimeSeconds: 0,
        speakingTimeMinutes: 0,
        speakingTimeSeconds: 0,
        averageSentenceLength: 0,
        sentenceLengthVariation: 0,
        flowScore: 0,
        sentenceLengthDistribution: { '1': 0, '2-6': 0, '7-15': 0, '16-25': 0, '26-39': 0, '40+': 0 },
        flowInsights: { consecutivePatterns: 0, dominantRange: '7-15', varietyScore: 0, hasMonotony: false },
        keywordDensity: [],
        repetition: { items: [], totalFlags: 0 },
        proximity: { items: [], totalFlags: 0 },
        cadence: { sentences: [], hotspots: [] },
    };
}
