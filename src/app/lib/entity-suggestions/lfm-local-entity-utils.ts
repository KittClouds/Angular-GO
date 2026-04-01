import { ENTITY_KINDS, isEntityKind, type EntityKind } from '../types/entity';
import type {
    LocalEntitySuggestion,
    LocalEntitySuggestionConfidence,
    SuggestedEntityKind,
} from './entity-suggestion.types';

export interface EntitySuggestionChunk {
    id: string;
    text: string;
}

type ChatMessage = {
    role: 'system' | 'user';
    content: string;
};

const DEFAULT_CHUNK_CHAR_LIMIT = 6000;
const DEFAULT_SENTENCE_CHUNK_CHAR_LIMIT = 3000;
const DEFAULT_SENTENCE_WORD_FALLBACK_LIMIT = 240;

const OBVIOUS_JUNK_LABELS = new Set([
    'he', 'she', 'they', 'them', 'their', 'theirs', 'him', 'her', 'hers',
    'we', 'us', 'our', 'ours', 'you', 'your', 'yours', 'i', 'me', 'my', 'mine',
    'it', 'its', 'itself', 'this', 'that', 'these', 'those',
    'someone', 'somebody', 'something', 'anyone', 'anybody', 'anything',
    'everyone', 'everybody', 'everything', 'nobody', 'nothing',
]);

const KIND_ALIASES: Record<string, EntityKind | 'UNKNOWN'> = {
    CHARACTER: 'CHARACTER',
    PERSON: 'CHARACTER',
    PEOPLE: 'CHARACTER',
    PROTAGONIST: 'CHARACTER',
    LOCATION: 'LOCATION',
    PLACE: 'LOCATION',
    SETTING: 'LOCATION',
    NPC: 'NPC',
    ITEM: 'ITEM',
    OBJECT: 'ITEM',
    ARTIFACT: 'ITEM',
    FACTION: 'FACTION',
    GROUP: 'FACTION',
    ORGANIZATION: 'FACTION',
    SCENE: 'SCENE',
    EVENT: 'EVENT',
    CONCEPT: 'CONCEPT',
    ARC: 'ARC',
    ACT: 'ACT',
    CHAPTER: 'CHAPTER',
    BEAT: 'BEAT',
    TIMELINE: 'TIMELINE',
    NARRATIVE: 'NARRATIVE',
    UNKNOWN: 'UNKNOWN',
};

function normalizeParagraphs(text: string): string[] {
    return text
        .replace(/\r\n/g, '\n')
        .split(/\n{2,}/)
        .map(paragraph => paragraph.trim())
        .filter(Boolean);
}

function splitParagraphIntoSentences(paragraph: string): string[] {
    const matches = paragraph.match(/[^.!?\n]+(?:[.!?]+(?:["'”’)\]]+)?|$)/g) ?? [];
    const sentences = matches
        .map(sentence => sentence.trim())
        .filter(Boolean);

    if (sentences.length > 0) {
        return sentences;
    }

    return paragraph.trim() ? [paragraph.trim()] : [];
}

function splitLongSentenceByWords(sentence: string, maxChars: number): string[] {
    const words = sentence.trim().split(/\s+/).filter(Boolean);
    if (!words.length) {
        return [];
    }

    const chunks: string[] = [];
    let currentWords: string[] = [];

    for (const word of words) {
        const candidate = currentWords.length
            ? `${currentWords.join(' ')} ${word}`
            : word;
        if (candidate.length <= maxChars || currentWords.length === 0) {
            currentWords.push(word);
            continue;
        }

        chunks.push(currentWords.join(' '));
        currentWords = currentWords.slice(-Math.min(DEFAULT_SENTENCE_WORD_FALLBACK_LIMIT, currentWords.length));
        currentWords.push(word);
    }

    if (currentWords.length) {
        chunks.push(currentWords.join(' '));
    }

    return chunks;
}

function buildSentenceChunks(paragraph: string, maxChars = DEFAULT_SENTENCE_CHUNK_CHAR_LIMIT): string[] {
    const sentences = splitParagraphIntoSentences(paragraph);
    if (!sentences.length) {
        return [];
    }

    const chunks: string[] = [];
    let currentSentences: string[] = [];

    const flush = () => {
        if (!currentSentences.length) {
            return;
        }
        chunks.push(currentSentences.join(' ').trim());
    };

    for (const sentence of sentences) {
        const safeSentenceChunks = sentence.length > maxChars
            ? splitLongSentenceByWords(sentence, maxChars)
            : [sentence];

        for (const safeSentence of safeSentenceChunks) {
            if (!currentSentences.length) {
                currentSentences.push(safeSentence);
                continue;
            }

            const candidate = `${currentSentences.join(' ')} ${safeSentence}`.trim();
            if (candidate.length <= maxChars) {
                currentSentences.push(safeSentence);
                continue;
            }

            const overlap = currentSentences[currentSentences.length - 1];
            flush();
            currentSentences = overlap && `${overlap} ${safeSentence}`.length <= maxChars
                ? [overlap, safeSentence]
                : [safeSentence];
        }
    }

    flush();
    return dedupeSequentialStrings(chunks);
}

function dedupeSequentialStrings(values: string[]): string[] {
    const deduped: string[] = [];
    for (const value of values) {
        if (!value) {
            continue;
        }

        if (deduped[deduped.length - 1] === value) {
            continue;
        }

        deduped.push(value);
    }

    return deduped;
}

export function buildEntitySuggestionChunks(
    plainText: string,
    maxChunkChars = DEFAULT_CHUNK_CHAR_LIMIT,
    maxSentenceChunkChars = DEFAULT_SENTENCE_CHUNK_CHAR_LIMIT,
): EntitySuggestionChunk[] {
    const paragraphs = normalizeParagraphs(plainText);
    if (!paragraphs.length) {
        return [];
    }

    const chunks: string[] = [];
    let currentParagraphs: string[] = [];

    const flushCurrent = () => {
        if (!currentParagraphs.length) {
            return;
        }
        chunks.push(currentParagraphs.join('\n\n').trim());
    };

    for (const paragraph of paragraphs) {
        if (paragraph.length > maxChunkChars) {
            flushCurrent();
            currentParagraphs = [];
            chunks.push(...buildSentenceChunks(paragraph, maxSentenceChunkChars));
            continue;
        }

        if (!currentParagraphs.length) {
            currentParagraphs.push(paragraph);
            continue;
        }

        const candidate = `${currentParagraphs.join('\n\n')}\n\n${paragraph}`;
        if (candidate.length <= maxChunkChars) {
            currentParagraphs.push(paragraph);
            continue;
        }

        const overlap = currentParagraphs[currentParagraphs.length - 1];
        flushCurrent();
        currentParagraphs = overlap && `${overlap}\n\n${paragraph}`.length <= maxChunkChars
            ? [overlap, paragraph]
            : [paragraph];
    }

    flushCurrent();

    return dedupeSequentialStrings(chunks).map((text, index) => ({
        id: `chunk-${index + 1}`,
        text,
    }));
}

export function buildLocalEntityExtractionMessages(noteTitle: string | undefined, chunkText: string): ChatMessage[] {
    const allowedKinds = [...ENTITY_KINDS, 'UNKNOWN'].join(', ');
    return [
        {
            role: 'system',
            content: [
                'You extract structured entity suggestions from fiction-writing notes.',
                'Return ONLY a JSON array.',
                'Each array item must be an object with keys:',
                '"label", "kind", "confidence", "reasoning", "evidence", "aliases".',
                `Allowed kinds: ${allowedKinds}.`,
                'Use confidence as one of: "high", "medium", "low".',
                'Prefer canonical labels with the exact casing from the text.',
                'Evidence must be a short exact quote copied from the chunk.',
                'Aliases must be an array of alternate surface forms seen in the chunk.',
                'Ignore pronouns, generic nouns, ephemeral phrases, and obvious non-entities.',
                'If no good entity suggestions exist, return [].',
            ].join(' '),
        },
        {
            role: 'user',
            content: [
                `Note title: ${noteTitle?.trim() || 'Untitled Note'}`,
                'Extract entity suggestions from this note chunk:',
                chunkText,
            ].join('\n\n'),
        },
    ];
}

export function extractGeneratedAssistantText(output: unknown): string {
    const first = Array.isArray(output) ? output[0] : output;
    if (!first || typeof first !== 'object') {
        return '';
    }

    const candidate = first as { generated_text?: unknown; text?: unknown };
    const generated = candidate.generated_text;
    if (Array.isArray(generated)) {
        const last = generated[generated.length - 1];
        if (last && typeof last === 'object' && typeof (last as { content?: unknown }).content === 'string') {
            return String((last as { content?: unknown }).content || '');
        }
        if (typeof last === 'string') {
            return last;
        }
    }

    if (typeof generated === 'string') {
        return generated;
    }

    return typeof candidate.text === 'string' ? candidate.text : '';
}

export function stripCodeFences(value: string): string {
    const trimmed = value.trim();
    const fenced = trimmed.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i);
    return fenced ? fenced[1].trim() : trimmed;
}

export function extractFirstJsonArray(value: string): string | null {
    const text = stripCodeFences(value);
    let start = -1;
    let depth = 0;
    let inString = false;
    let escaped = false;

    for (let index = 0; index < text.length; index++) {
        const character = text[index];

        if (escaped) {
            escaped = false;
            continue;
        }

        if (character === '\\') {
            escaped = inString;
            continue;
        }

        if (character === '"') {
            inString = !inString;
            continue;
        }

        if (inString) {
            continue;
        }

        if (character === '[') {
            if (start === -1) {
                start = index;
            }
            depth += 1;
            continue;
        }

        if (character === ']') {
            depth -= 1;
            if (start !== -1 && depth === 0) {
                return text.slice(start, index + 1);
            }
        }
    }

    return null;
}

function normalizeSuggestionLabel(label: string): string {
    return label
        .trim()
        .replace(/\s+/g, ' ')
        .replace(/^["'“”‘’]+|["'“”‘’]+$/g, '')
        .trim();
}

function normalizeKind(kind: string): SuggestedEntityKind {
    const normalized = kind.trim().toUpperCase().replace(/\s+/g, '_');
    if (isEntityKind(normalized)) {
        return normalized;
    }

    return KIND_ALIASES[normalized] ?? 'UNKNOWN';
}

function normalizeConfidence(confidence: string): LocalEntitySuggestionConfidence | null {
    const normalized = confidence.trim().toLowerCase();
    if (normalized === 'high' || normalized === 'medium' || normalized === 'low') {
        return normalized;
    }
    return null;
}

function dedupeAliases(aliases: string[], label: string): string[] {
    const normalizedLabel = normalizeSuggestionLabel(label).toLocaleLowerCase();
    const seen = new Set<string>();
    const result: string[] = [];

    for (const alias of aliases) {
        const cleaned = normalizeSuggestionLabel(alias);
        if (!cleaned) {
            continue;
        }

        const normalized = cleaned.toLocaleLowerCase();
        if (normalized === normalizedLabel || seen.has(normalized)) {
            continue;
        }

        seen.add(normalized);
        result.push(cleaned);
    }

    return result;
}

export function isLikelyJunkEntityLabel(label: string): boolean {
    const cleaned = normalizeSuggestionLabel(label);
    if (!cleaned) {
        return true;
    }

    if (cleaned.length < 2) {
        return true;
    }

    if (!/[\p{L}\p{N}]/u.test(cleaned)) {
        return true;
    }

    return OBVIOUS_JUNK_LABELS.has(cleaned.toLocaleLowerCase());
}

function coerceSuggestion(candidate: unknown): LocalEntitySuggestion | null {
    if (!candidate || typeof candidate !== 'object') {
        return null;
    }

    const raw = candidate as {
        label?: unknown;
        kind?: unknown;
        confidence?: unknown;
        reasoning?: unknown;
        evidence?: unknown;
        aliases?: unknown;
    };

    if (typeof raw.label !== 'string') {
        return null;
    }

    const label = normalizeSuggestionLabel(raw.label);
    if (isLikelyJunkEntityLabel(label)) {
        return null;
    }

    const confidence = typeof raw.confidence === 'string'
        ? normalizeConfidence(raw.confidence)
        : null;
    if (!confidence) {
        return null;
    }

    const evidence = typeof raw.evidence === 'string'
        ? raw.evidence.trim()
        : '';
    const reasoning = typeof raw.reasoning === 'string'
        ? raw.reasoning.trim()
        : '';
    const aliases = Array.isArray(raw.aliases)
        ? raw.aliases.filter((alias): alias is string => typeof alias === 'string')
        : [];

    return {
        label,
        kind: typeof raw.kind === 'string' ? normalizeKind(raw.kind) : 'UNKNOWN',
        confidence,
        reasoning,
        evidence: evidence || label,
        aliases: dedupeAliases(aliases, label),
    };
}

export function parseLocalEntitySuggestionsFromModelOutput(outputText: string): LocalEntitySuggestion[] {
    const jsonArray = extractFirstJsonArray(outputText);
    if (!jsonArray) {
        return [];
    }

    let parsed: unknown;
    try {
        parsed = JSON.parse(jsonArray);
    } catch {
        return [];
    }

    if (!Array.isArray(parsed)) {
        return [];
    }

    return parsed
        .map(coerceSuggestion)
        .filter((suggestion): suggestion is LocalEntitySuggestion => suggestion !== null);
}

export function getConfidenceRank(confidence: LocalEntitySuggestionConfidence): number {
    switch (confidence) {
        case 'high':
            return 3;
        case 'medium':
            return 2;
        case 'low':
        default:
            return 1;
    }
}

export function mapConfidenceLevelToScore(confidence: LocalEntitySuggestionConfidence): number {
    switch (confidence) {
        case 'high':
            return 0.9;
        case 'medium':
            return 0.7;
        case 'low':
        default:
            return 0.5;
    }
}

export function mapScoreToConfidenceLevel(score: number): LocalEntitySuggestionConfidence {
    if (score >= 0.85) {
        return 'high';
    }
    if (score >= 0.65) {
        return 'medium';
    }
    return 'low';
}

function preferKind(current: SuggestedEntityKind, incoming: SuggestedEntityKind): SuggestedEntityKind {
    if (current === 'UNKNOWN' && incoming !== 'UNKNOWN') {
        return incoming;
    }
    return current;
}

export function mergeLocalEntitySuggestions(suggestions: LocalEntitySuggestion[]): LocalEntitySuggestion[] {
    const merged = new Map<string, LocalEntitySuggestion>();

    for (const suggestion of suggestions) {
        if (isLikelyJunkEntityLabel(suggestion.label)) {
            continue;
        }

        const key = normalizeSuggestionLabel(suggestion.label).toLocaleLowerCase();
        const current = merged.get(key);
        if (!current) {
            merged.set(key, {
                ...suggestion,
                aliases: dedupeAliases(suggestion.aliases, suggestion.label),
            });
            continue;
        }

        const currentRank = getConfidenceRank(current.confidence);
        const incomingRank = getConfidenceRank(suggestion.confidence);
        const useIncoming = incomingRank > currentRank;

        merged.set(key, {
            label: current.label,
            kind: preferKind(current.kind, suggestion.kind),
            confidence: useIncoming ? suggestion.confidence : current.confidence,
            reasoning: useIncoming
                ? (suggestion.reasoning || current.reasoning)
                : (current.reasoning || suggestion.reasoning),
            evidence: useIncoming
                ? (suggestion.evidence || current.evidence)
                : (current.evidence || suggestion.evidence),
            aliases: dedupeAliases([...current.aliases, ...suggestion.aliases], current.label),
            rawScore: useIncoming ? suggestion.rawScore : current.rawScore,
        });
    }

    return Array.from(merged.values()).sort((left, right) =>
        getConfidenceRank(right.confidence) - getConfidenceRank(left.confidence) ||
        String(left.kind).localeCompare(String(right.kind)) ||
        left.label.localeCompare(right.label)
    );
}
