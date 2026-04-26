export type NumerologyStyle = 'annotatedOrdinal' | 'annotatedReduced' | 'numberOnlyReduced';

export interface NumerologyResult {
  output: string;
  sourceFormat: 'bible' | 'plain';
  lines: number;
  countedLines: number;
  words: number;
  letters: number;
  rawTotal: number;
  rootTotal: number;
}

interface WordScore {
  letters: number[];
  raw: number;
  root: number;
}

const WORD_RE = /[A-Za-z]+(?:['’][A-Za-z]+)?/g;
const BIBLE_RE = /^(.+?\s+\d+:\d+)\s+(.+)$/;

export function processNumerologyDocument(text: string, style: NumerologyStyle): NumerologyResult {
  const normalized = text.replace(/\r\n?/g, '\n');
  const lines = normalized.split('\n');
  const sourceFormat = lines.some((line) => BIBLE_RE.test(line) || line.includes('\t'))
    ? 'bible'
    : 'plain';
  const output: string[] = [];
  const totals = { countedLines: 0, words: 0, letters: 0, rawTotal: 0 };
  let currentBook = '';
  let currentChapter = '';

  for (const line of lines) {
    if (!line.trim()) {
      output.push('');
      continue;
    }

    const bible = sourceFormat === 'bible' ? splitBibleLine(line) : null;
    if (bible) {
      const book = bible.ref.replace(/\s+\d+:\d+$/, '');
      const chapter = bible.ref.match(/\s+(\d+):\d+$/)?.[1] ?? '';
      if (book && book !== currentBook) {
        currentBook = book;
        currentChapter = '';
        output.push(`# ${book}`);
        output.push('');
      }
      if (chapter && chapter !== currentChapter) {
        currentChapter = chapter;
        output.push(`## ${book} ${chapter}`);
      }
      output.push(`${bible.ref}\t${processLine(bible.body, style, totals)}`);
    } else {
      output.push(processLine(line, style, totals));
    }
  }

  return {
    output: output.join('\n').trim(),
    sourceFormat,
    lines: lines.length,
    countedLines: totals.countedLines,
    words: totals.words,
    letters: totals.letters,
    rawTotal: totals.rawTotal,
    rootTotal: digitalRoot(totals.rawTotal),
  };
}

function splitBibleLine(line: string): { ref: string; body: string } | null {
  const tab = line.indexOf('\t');
  if (tab > 0) {
    const ref = line.slice(0, tab).trim();
    const body = line.slice(tab + 1).trim();
    return ref && body ? { ref, body } : null;
  }

  const match = BIBLE_RE.exec(line.trim());
  return match ? { ref: match[1], body: match[2] } : null;
}

function processLine(
  line: string,
  style: NumerologyStyle,
  totals: { countedLines: number; words: number; letters: number; rawTotal: number },
): string {
  let lineWords = 0;
  let lineLetters = 0;
  let lineRaw = 0;
  const body = style === 'numberOnlyReduced'
    ? numberOnlyLine(line, (score) => {
        lineWords += 1;
        lineLetters += score.letters.length;
        lineRaw += score.raw;
      })
    : annotatedLine(line, style, (score) => {
        lineWords += 1;
        lineLetters += score.letters.length;
        lineRaw += score.raw;
      });

  if (lineWords > 0) {
    totals.countedLines += 1;
    totals.words += lineWords;
    totals.letters += lineLetters;
    totals.rawTotal += lineRaw;
  }

  return `${body} [line raw:${lineRaw} root:${digitalRoot(lineRaw)} letters:${lineLetters}]`;
}

function annotatedLine(line: string, style: NumerologyStyle, onWord: (score: WordScore) => void): string {
  return line.replace(WORD_RE, (word) => {
    const score = scoreWord(word, style === 'annotatedOrdinal' ? 'ordinal' : 'reduced');
    onWord(score);
    const value = style === 'annotatedOrdinal' ? score.raw : score.root;
    return `${word}[${value}]`;
  });
}

function numberOnlyLine(line: string, onWord: (score: WordScore) => void): string {
  const groups: string[] = [];
  for (const match of line.matchAll(WORD_RE)) {
    const score = scoreWord(match[0], 'reduced');
    onWord(score);
    groups.push(`${score.letters.join('-')}[${score.root}]`);
  }
  return groups.join(' ');
}

function scoreWord(word: string, mode: 'ordinal' | 'reduced'): WordScore {
  const letters: number[] = [];
  let raw = 0;
  for (let i = 0; i < word.length; i += 1) {
    const code = word.charCodeAt(i);
    const lower = code >= 65 && code <= 90 ? code + 32 : code;
    if (lower < 97 || lower > 122) continue;
    const ordinal = lower - 96;
    const value = mode === 'ordinal' ? ordinal : digitalRoot(ordinal);
    letters.push(value);
    raw += value;
  }
  return { letters, raw, root: digitalRoot(raw) };
}

function digitalRoot(value: number): number {
  if (value <= 0) return 0;
  return 1 + ((value - 1) % 9);
}
