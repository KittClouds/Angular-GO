import { describe, expect, it } from 'vitest';
import {
  buildEntitySuggestionChunks,
  buildLocalEntityExtractionMessages,
  decodeUtf8ByteRange,
  extractFirstJsonArray,
  extractFirstJsonObject,
  mergeLocalEntitySuggestions,
  normalizeSuggestedEntityKind,
  parseLocalEntitySuggestionsFromModelOutput,
} from './lfm-local-entity-utils';

describe('lfm-local-entity-utils', () => {
  it('chunks paragraphs with overlap and sentence fallback for oversized paragraphs', () => {
    const shortA = 'Kai crossed the room.';
    const shortB = 'Kamaria looked up from the blanket.';
    const longParagraph = Array.from({ length: 24 }, (_, index) => `Sentence ${index + 1} about Fiora and Isolde.`).join(' ');
    const text = [shortA, shortB, longParagraph].join('\n\n');

    const chunks = buildEntitySuggestionChunks(text, 90, 80);

    expect(chunks.length).toBeGreaterThan(2);
    expect(chunks[0].text).toContain(shortA);
    expect(chunks.some((chunk) => chunk.text.includes(shortB))).toBe(true);
    expect(chunks.some((chunk) => chunk.text.includes('Sentence 1 about Fiora and Isolde.'))).toBe(true);
    expect(chunks.some((chunk) => chunk.text.includes('Sentence 24 about Fiora and Isolde.'))).toBe(true);
  });

  it('builds strict JSON extraction messages for the local model', () => {
    const messages = buildLocalEntityExtractionMessages('Inner World', 'Kai met Fiora.');

    expect(messages).toHaveLength(2);
    expect(messages[0].role).toBe('system');
    expect(messages[0].content).toContain('Return only valid JSON');
    expect(messages[0].content).toContain('"kind":"CHARACTER"');
    expect(messages[1].content).toContain('Note title: Inner World');
    expect(messages[1].content).toContain('Kai met Fiora.');
  });

  it('decodes Phoenix WASM byte ranges without drifting on curly prose', () => {
    const text = 'Aella said, “Kai waits near Isolde.” Then Phaeris smiled.';
    const encoder = new TextEncoder();
    const encoded = encoder.encode(text);
    const start = encoder.encode('Aella said, “').length;
    const end = start + encoder.encode('Kai waits near Isolde.').length;

    expect(decodeUtf8ByteRange(encoded, start, end)).toBe('Kai waits near Isolde.');
  });

  it('normalizes person-like model kinds into registry character kinds', () => {
    expect(normalizeSuggestedEntityKind('person')).toBe('CHARACTER');
    expect(normalizeSuggestedEntityKind('PER')).toBe('CHARACTER');
    expect(normalizeSuggestedEntityKind('speaker')).toBe('CHARACTER');
  });

  it('extracts the first json array even when the model wraps it in fences', () => {
    const output = `
\`\`\`json
[
  {
    "label": "Kai",
    "kind": "CHARACTER",
    "confidence": "high",
    "reasoning": "Kai is a named person in the scene.",
    "evidence": "Kai turns his head toward her.",
    "aliases": ["Kai"]
  }
]
\`\`\`
`;

    const extracted = extractFirstJsonArray(output);
    const parsed = parseLocalEntitySuggestionsFromModelOutput(output);

    expect(extracted).toContain('"label": "Kai"');
    expect(parsed).toEqual([
      {
        label: 'Kai',
        kind: 'CHARACTER',
        confidence: 'high',
        reasoning: 'Kai is a named person in the scene.',
        evidence: 'Kai turns his head toward her.',
        aliases: [],
      },
    ]);
  });

  it('extracts json objects when small models wrap suggestions under an entities key', () => {
    const output = `Here are the entities:
{
  "entities": [
    {
      "name": "Aella",
      "type": "person",
      "score": 0.91,
      "reason": "Named speaker.",
      "quote": "Aella said softly.",
      "alias": "Lady Aella"
    }
  ]
}`;

    const extracted = extractFirstJsonObject(output);
    const parsed = parseLocalEntitySuggestionsFromModelOutput(output);

    expect(extracted).toContain('"entities"');
    expect(parsed).toEqual([
      {
        label: 'Aella',
        kind: 'CHARACTER',
        confidence: 'high',
        reasoning: 'Named speaker.',
        evidence: 'Aella said softly.',
        aliases: ['Lady Aella'],
      },
    ]);
  });

  it('keeps array parsing ahead of nested object parsing for normal outputs', () => {
    const output = 'Result: [{"label":"Kai","kind":"person","confidence":"medium","evidence":"Kai looked up.","aliases":[]}]';

    expect(extractFirstJsonArray(output)).toContain('"label":"Kai"');
    expect(parseLocalEntitySuggestionsFromModelOutput(output)).toEqual([
      {
        label: 'Kai',
        kind: 'CHARACTER',
        confidence: 'medium',
        reasoning: '',
        evidence: 'Kai looked up.',
        aliases: [],
      },
    ]);
  });

  it('skips invalid suggestions while keeping valid ones from the same payload', () => {
    const output = JSON.stringify([
      {
        label: 'Fiora',
        kind: 'character',
        confidence: 'medium',
        reasoning: 'Named speaker in dialogue.',
        evidence: 'Fiora smiles without shame.',
        aliases: ['Lady Fiora'],
      },
      {
        label: 'she',
        kind: 'character',
        confidence: 'high',
        reasoning: 'Pronoun only.',
        evidence: 'She laughs.',
        aliases: [],
      },
      {
        label: 'Room',
        kind: 'location',
        confidence: 'maybe',
        reasoning: 'Bad confidence enum.',
        evidence: 'The room goes quiet.',
        aliases: [],
      },
    ]);

    expect(parseLocalEntitySuggestionsFromModelOutput(output)).toEqual([
      {
        label: 'Fiora',
        kind: 'CHARACTER',
        confidence: 'medium',
        reasoning: 'Named speaker in dialogue.',
        evidence: 'Fiora smiles without shame.',
        aliases: ['Lady Fiora'],
      },
    ]);
  });

  it('merges overlapping chunk results by label and prefers stronger kinds/confidence', () => {
    const merged = mergeLocalEntitySuggestions([
      {
        label: 'Kai',
        kind: 'UNKNOWN',
        confidence: 'medium',
        reasoning: 'Named actor in scene.',
        evidence: 'Kai laughs, then lets his head fall back again.',
        aliases: ['Kai'],
      },
      {
        label: 'Kai',
        kind: 'CHARACTER',
        confidence: 'high',
        reasoning: 'Central character addressed repeatedly.',
        evidence: 'Kamaria ignores her and keeps looking at Kai.',
        aliases: ['Kai', 'Kai of the Circle'],
      },
    ]);

    expect(merged).toEqual([
      {
        label: 'Kai',
        kind: 'CHARACTER',
        confidence: 'high',
        reasoning: 'Central character addressed repeatedly.',
        evidence: 'Kamaria ignores her and keeps looking at Kai.',
        aliases: ['Kai of the Circle'],
        rawScore: undefined,
      },
    ]);
  });
});
