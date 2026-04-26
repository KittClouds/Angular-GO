import { describe, expect, it } from 'vitest';
import { processNumerologyDocument } from './numerology';

describe('playground numerology processor', () => {
  it('annotates words with ordinal 1-26 totals', () => {
    const result = processNumerologyDocument('Genesis 1:1\tIn the beginning', 'annotatedOrdinal');

    expect(result.output).toContain('Genesis 1:1\tIn[23] the[33] beginning[81]');
    expect(result.words).toBe(3);
    expect(result.sourceFormat).toBe('bible');
  });

  it('annotates words with reduced 1-9 totals', () => {
    const result = processNumerologyDocument('Genesis 1:1\tGrace came', 'annotatedReduced');

    expect(result.output).toContain('Genesis 1:1\tGrace[7] came[4]');
    expect(result.rootTotal).toBe(2);
  });

  it('emits a number-only body while preserving refs', () => {
    const result = processNumerologyDocument('Genesis 1:1\tGrace came', 'numberOnlyReduced');

    expect(result.output).toContain('Genesis 1:1\t7-9-1-3-5[7] 3-1-4-5[4]');
    expect(result.output).not.toContain('Grace');
  });
});
