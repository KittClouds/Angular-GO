import { ENTITY_KINDS } from '../types/entity';

export {
    extractFirstJsonArray,
    extractFirstJsonObject,
    getConfidenceRank,
    isLikelyJunkEntityLabel,
    mapConfidenceLevelToScore,
    mapScoreToConfidenceLevel,
    mergeLocalEntitySuggestions,
    normalizeSuggestedEntityKind,
    parseLocalEntitySuggestionsFromModelOutput,
    stripCodeFences,
} from './lfm-local-entity-output';

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

export function decodeUtf8ByteRange(
    encodedText: Uint8Array,
    start: number,
    end: number,
    decoder = new TextDecoder(),
): string {
    const safeStart = Math.max(0, Math.min(start, encodedText.length));
    const safeEnd = Math.max(safeStart, Math.min(end, encodedText.length));
    return decoder.decode(encodedText.subarray(safeStart, safeEnd));
}

export function buildLocalEntityExtractionMessages(noteTitle: string | undefined, chunkText: string): ChatMessage[] {
    const allowedKinds = [...ENTITY_KINDS, 'UNKNOWN'].join(', ');
    return [
        {
            role: 'system',
            content: [
                'You extract structured entity suggestions from fiction-writing notes.',
                'Return only valid JSON. No prose, markdown, or commentary.',
                'Use this exact array schema:',
                '[{"label":"Kai","kind":"CHARACTER","confidence":"high","reasoning":"Named person in the scene.","evidence":"Kai looked up.","aliases":[]}].',
                `Allowed kinds: ${allowedKinds}.`,
                'Use confidence as one of: "high", "medium", "low".',
                'Use CHARACTER for named people, speakers, and person-like actors.',
                'Prefer canonical labels with the exact casing from the text.',
                'Evidence must be a short exact quote copied from the chunk.',
                'Aliases must be an array of alternate surface forms seen in the chunk.',
                'Ignore pronouns, generic nouns, ephemeral phrases, and obvious non-entities.',
                'If no named entities exist, return [].',
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
