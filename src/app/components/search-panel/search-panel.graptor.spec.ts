import { describe, expect, it } from 'vitest';

import {
  buildScopedCanonicalEntityMap,
  collectScopedRegistrationNames,
} from './search-panel.graptor';

describe('search-panel Graptor scope helpers', () => {
  it('keeps only canonical entities from the active narrative scope plus global entities', () => {
    const scoped = buildScopedCanonicalEntityMap(
      [
        { id: 'char-fiora', label: 'Fiora', aliases: ['Grand Duelist'], narrativeId: 'narr-1' },
        { id: 'char-vi', label: 'Vi', aliases: ['Piltover Enforcer'], narrativeId: 'narr-2' },
        { id: 'concept-magic', label: 'Magic', aliases: ['Arcana'], narrativeId: '' },
      ],
      [{ id: 'note-1', narrativeId: 'narr-1' }]
    );

    expect(scoped.has('char-fiora')).toBe(true);
    expect(scoped.has('concept-magic')).toBe(true);
    expect(scoped.has('char-vi')).toBe(false);
  });

  it('does not pull narrative-bound aliases when the active scope has no narrative', () => {
    const scoped = buildScopedCanonicalEntityMap(
      [
        { id: 'char-fiora', label: 'Fiora', aliases: ['Grand Duelist'], narrativeId: 'narr-1' },
        { id: 'concept-magic', label: 'Magic', aliases: ['Arcana'], narrativeId: '' },
      ],
      [{ id: 'note-1', narrativeId: '' }]
    );

    expect(scoped.has('concept-magic')).toBe(true);
    expect(scoped.has('char-fiora')).toBe(false);
  });

  it('registers canonical label and aliases only when the canonical entity is in scope', () => {
    const names = collectScopedRegistrationNames(
      'char-fiora',
      { id: 'char-fiora', label: 'Fiora', aliases: ['Grand Duelist', 'Blade'], narrativeId: 'narr-1' },
      { label: 'Fiora Scan Label' }
    );

    expect(names).toEqual(['Fiora', 'Grand Duelist', 'Blade']);
  });

  it('falls back to the scan graph label when the canonical entity is out of scope', () => {
    const names = collectScopedRegistrationNames(
      'char-fiora',
      undefined,
      { label: 'Fiora Scan Label' }
    );

    expect(names).toEqual(['Fiora Scan Label']);
  });
});
