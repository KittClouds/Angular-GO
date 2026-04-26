export type MeterLanguage = 'auto' | 'en' | 'ja';
export type MeterDetectedLanguage = 'en' | 'ja' | 'mixed' | 'unknown';
export type MeterUnitKind = 'syllable' | 'mora';
export type MeterLineStatus = 'clean' | 'dense' | 'dragging' | 'clipped' | 'review';
export type MeterTokenSource = 'dictionary' | 'rule' | 'kana' | 'unknown';

export interface MeterAnalysisOptions {
    language?: MeterLanguage;
    targetPattern?: string;
}

export interface MeterToken {
    text: string;
    normalized: string;
    from: number;
    to: number;
    unitCount: number;
    unitKind: MeterUnitKind;
    confidence: number;
    source: MeterTokenSource;
    warnings: string[];
}

export interface MeterLine {
    id: string;
    lineNumber: number;
    stanzaIndex: number;
    text: string;
    from: number;
    to: number;
    language: MeterDetectedLanguage;
    unitKind: MeterUnitKind;
    units: number;
    confidence: number;
    targetUnits: number | null;
    delta: number | null;
    status: MeterLineStatus;
    density: number;
    tokens: MeterToken[];
    warnings: string[];
}

export interface MeterAnalysis {
    lines: MeterLine[];
    totalLines: number;
    countedLines: number;
    denseLines: number;
    reviewLines: number;
    averageUnits: number;
    minUnits: number;
    maxUnits: number;
    targetPattern: number[];
}

const LATIN_WORD_PATTERN = /[\p{Script=Latin}]+(?:['’-][\p{Script=Latin}]+)*/gu;
const JAPANESE_CHAR_PATTERN = /[\u3040-\u30ff\uff66-\uff9f\u3400-\u9fff]/u;
const KANJI_PATTERN = /[\u3400-\u9fff]/u;
const KANA_RUN_PATTERN = /[\u3040-\u30ff\uff66-\uff9f]+/gu;
const VOWEL_RUN_PATTERN = /[aeiouy]+/g;

const ENGLISH_EXCEPTIONS = new Map<string, number>([
    ['a', 1], ['i', 1], ['one', 1], ['once', 1], ['two', 1],
    ['every', 2], ['everyone', 3], ['everything', 3], ['family', 3],
    ['beautiful', 3], ['because', 2], ['business', 2], ['different', 3],
    ['favorite', 3], ['finally', 3], ['quiet', 2], ['really', 2],
    ['people', 2], ['toward', 1], ['always', 2], ['often', 2],
    ['heaven', 2], ['power', 2], ['flower', 2], ['hour', 1],
]);

const AMBIGUOUS_ENGLISH = new Map<string, number[]>([
    ['fire', [1, 2]], ['higher', [1, 2]], ['our', [1, 2]],
    ['poem', [1, 2]], ['poet', [1, 2]], ['real', [1, 2]],
    ['cruel', [1, 2]], ['fuel', [1, 2]], ['jewel', [1, 2]],
]);

const SMALL_KANA = new Set([
    'ゃ', 'ゅ', 'ょ', 'ぁ', 'ぃ', 'ぅ', 'ぇ', 'ぉ', 'ゎ', 'ゕ', 'ゖ',
    'ャ', 'ュ', 'ョ', 'ァ', 'ィ', 'ゥ', 'ェ', 'ォ', 'ヮ', 'ヶ',
    'ｧ', 'ｨ', 'ｩ', 'ｪ', 'ｫ', 'ｬ', 'ｭ', 'ｮ',
]);

const MORA_KANA = new Set(['っ', 'ッ', 'ｯ', 'ん', 'ン', 'ﾝ', 'ー']);

export function analyzeMeter(text: string, options: MeterAnalysisOptions = {}): MeterAnalysis {
    const targetPattern = parseTargetPattern(options.targetPattern);
    const rawLines = splitLogicalLines(text);
    const lines: MeterLine[] = [];
    let stanzaIndex = 0;
    let countedIndex = 0;

    for (const raw of rawLines) {
        const trimmed = raw.text.trim();
        if (!trimmed) {
            stanzaIndex++;
            continue;
        }

        const targetUnits = targetPattern.length
            ? targetPattern[countedIndex % targetPattern.length]
            : null;
        const line = analyzeLine(raw.text, raw.lineNumber, stanzaIndex, raw.from, raw.to, targetUnits, options.language ?? 'auto');
        lines.push(line);
        countedIndex++;
    }

    const units = lines.map(line => line.units);
    const totalUnits = units.reduce((sum, value) => sum + value, 0);
    return {
        lines,
        totalLines: rawLines.length,
        countedLines: lines.length,
        denseLines: lines.filter(line => line.status === 'dense' || line.status === 'dragging').length,
        reviewLines: lines.filter(line => line.status === 'review' || line.confidence < 0.8).length,
        averageUnits: lines.length ? roundTo(totalUnits / lines.length, 1) : 0,
        minUnits: units.length ? Math.min(...units) : 0,
        maxUnits: units.length ? Math.max(...units) : 0,
        targetPattern,
    };
}

export function parseTargetPattern(input: string | undefined): number[] {
    if (!input) return [];
    return input
        .split(/[^\d]+/)
        .map(value => Number.parseInt(value, 10))
        .filter(value => Number.isFinite(value) && value > 0 && value <= 64)
        .slice(0, 32);
}

function analyzeLine(
    text: string,
    lineNumber: number,
    stanzaIndex: number,
    from: number,
    to: number,
    targetUnits: number | null,
    languageMode: MeterLanguage,
): MeterLine {
    const language = detectLineLanguage(text, languageMode);
    const unitKind: MeterUnitKind = language === 'ja' ? 'mora' : 'syllable';
    const tokens = language === 'ja'
        ? tokenizeJapaneseLine(text, from)
        : tokenizeEnglishLine(text, from, language === 'mixed');
    const units = tokens.reduce((sum, token) => sum + token.unitCount, 0);
    const warnings = collectLineWarnings(text, language, tokens);
    const confidence = tokens.length
        ? roundTo(tokens.reduce((sum, token) => sum + token.confidence, 0) / tokens.length, 2)
        : 0;
    const delta = targetUnits === null ? null : units - targetUnits;
    const density = tokens.length ? roundTo(units / tokens.length, 2) : 0;
    const status = classifyLineStatus({ confidence, delta, density, tokens, warnings });

    return {
        id: `meter-line-${lineNumber}`,
        lineNumber,
        stanzaIndex,
        text,
        from,
        to,
        language,
        unitKind,
        units,
        confidence,
        targetUnits,
        delta,
        status,
        density,
        tokens,
        warnings,
    };
}

function splitLogicalLines(text: string): Array<{ lineNumber: number; text: string; from: number; to: number }> {
    const lines: Array<{ lineNumber: number; text: string; from: number; to: number }> = [];
    let start = 0;
    let lineNumber = 1;

    for (let i = 0; i <= text.length; i++) {
        const char = text[i];
        if (i === text.length || char === '\n' || char === '\r') {
            lines.push({ lineNumber, text: text.slice(start, i), from: start, to: i });
            if (char === '\r' && text[i + 1] === '\n') i++;
            start = i + 1;
            lineNumber++;
        }
    }

    return lines;
}

function detectLineLanguage(text: string, mode: MeterLanguage): MeterDetectedLanguage {
    if (mode === 'en') return 'en';
    if (mode === 'ja') return 'ja';
    const hasJapanese = JAPANESE_CHAR_PATTERN.test(text);
    const hasLatin = /[\p{Script=Latin}]/u.test(text);
    if (hasJapanese && hasLatin) return 'mixed';
    if (hasJapanese) return 'ja';
    if (hasLatin) return 'en';
    return 'unknown';
}

function tokenizeEnglishLine(text: string, lineOffset: number, mixed: boolean): MeterToken[] {
    const tokens: MeterToken[] = [];
    for (const match of text.matchAll(LATIN_WORD_PATTERN)) {
        const raw = match[0];
        const localFrom = match.index ?? 0;
        const result = countEnglishSyllables(raw);
        tokens.push({
            text: raw,
            normalized: normalizeEnglish(raw),
            from: lineOffset + localFrom,
            to: lineOffset + localFrom + raw.length,
            unitCount: result.count,
            unitKind: 'syllable',
            confidence: mixed ? Math.min(result.confidence, 0.78) : result.confidence,
            source: result.source,
            warnings: result.warnings,
        });
    }
    return tokens;
}

function countEnglishSyllables(word: string): { count: number; confidence: number; source: MeterTokenSource; warnings: string[] } {
    const normalized = normalizeEnglish(word);
    if (!normalized) return { count: 0, confidence: 0, source: 'unknown', warnings: ['empty token'] };
    if (normalized.includes('-')) {
        const parts = normalized.split('-').filter(Boolean).map(countEnglishSyllables);
        return {
            count: Math.max(1, parts.reduce((sum, part) => sum + part.count, 0)),
            confidence: roundTo(Math.min(...parts.map(part => part.confidence), 0.86), 2),
            source: parts.every(part => part.source === 'dictionary') ? 'dictionary' : 'rule',
            warnings: parts.flatMap(part => part.warnings),
        };
    }

    const ambiguous = AMBIGUOUS_ENGLISH.get(normalized);
    if (ambiguous) {
        return {
            count: ambiguous[0],
            confidence: 0.62,
            source: 'dictionary',
            warnings: [`ambiguous pronunciation: ${ambiguous.join(' or ')}`],
        };
    }

    const exception = ENGLISH_EXCEPTIONS.get(normalized);
    if (exception) {
        return { count: exception, confidence: 0.98, source: 'dictionary', warnings: [] };
    }

    const stripped = normalized.replace(/'s$/, '').replace(/'/g, '');
    const count = countEnglishByRule(stripped);
    const properName = /^[A-Z]/.test(word) && word.length > 1;
    return {
        count,
        confidence: properName ? 0.68 : 0.82,
        source: 'rule',
        warnings: properName ? ['proper name uses rule estimate'] : [],
    };
}

function countEnglishByRule(word: string): number {
    if (word.length <= 3) return 1;
    let value = word.toLowerCase();
    value = value.replace(/(?:[^laeiouy]es|(?<![td])ed|[^laeiouy]e)$/, '');
    value = value.replace(/^y/, '');
    const groups = value.match(VOWEL_RUN_PATTERN)?.length ?? 0;
    const leBonus = /[^aeiouy]le$/.test(word) ? 1 : 0;
    const iaBonus = /[iu]a|io/.test(word) ? 1 : 0;
    return Math.max(1, groups + leBonus + iaBonus);
}

function tokenizeJapaneseLine(text: string, lineOffset: number): MeterToken[] {
    const tokens: MeterToken[] = [];
    for (const match of text.matchAll(KANA_RUN_PATTERN)) {
        const raw = match[0];
        const localFrom = match.index ?? 0;
        tokens.push({
            text: raw,
            normalized: raw,
            from: lineOffset + localFrom,
            to: lineOffset + localFrom + raw.length,
            unitCount: countKanaMorae(raw),
            unitKind: 'mora',
            confidence: 0.99,
            source: 'kana',
            warnings: [],
        });
    }
    return tokens;
}

function countKanaMorae(text: string): number {
    let count = 0;
    for (const char of Array.from(text)) {
        if (SMALL_KANA.has(char)) continue;
        if (MORA_KANA.has(char)) {
            count++;
            continue;
        }
        if (/[\u3040-\u30ff\uff66-\uff9f]/u.test(char)) count++;
    }
    return count;
}

function collectLineWarnings(text: string, language: MeterDetectedLanguage, tokens: MeterToken[]): string[] {
    const warnings = tokens.flatMap(token => token.warnings);
    if ((language === 'ja' || language === 'mixed') && KANJI_PATTERN.test(text)) {
        warnings.push('kanji needs a reading before mora count is authoritative');
    }
    if (language === 'mixed') warnings.push('mixed-language line uses partial estimates');
    if (language === 'unknown') warnings.push('no countable vocal tokens found');
    return [...new Set(warnings)];
}

function classifyLineStatus(input: {
    confidence: number;
    delta: number | null;
    density: number;
    tokens: MeterToken[];
    warnings: string[];
}): MeterLineStatus {
    if (input.confidence < 0.72 || input.warnings.some(warning => warning.includes('kanji'))) return 'review';
    if (input.delta !== null && input.delta <= -3) return 'clipped';
    if (input.delta !== null && input.delta >= 4) return 'dragging';
    if (input.tokens.some(token => token.unitKind === 'mora')) return 'clean';
    if (input.density >= 2.4 || input.tokens.some(token => token.unitCount >= 5)) return 'dense';
    return 'clean';
}

function normalizeEnglish(word: string): string {
    return word
        .normalize('NFKD')
        .replace(/\p{M}/gu, '')
        .replace(/[’]/g, "'")
        .toLowerCase()
        .replace(/^[^a-z]+|[^a-z'-]+$/g, '');
}

function roundTo(value: number, digits: number): number {
    const factor = 10 ** digits;
    return Math.round(value * factor) / factor;
}
