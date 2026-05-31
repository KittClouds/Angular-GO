import { describe, expect, it } from 'vitest';

import template from './graph-style-drawer.component.html?raw';
import source from './graph-style-drawer.component.ts?raw';

describe('GraphStyleDrawerComponent model language', () => {
    it('describes graph model colors as fact and projection styles', () => {
        const text = `${template}\n${source}`;

        expect(text).toContain('Model style controls');
        expect(text).toContain('Fact and projection styles');
        expect(text).toContain('Fact families');
        expect(text).toContain('Narrative facts');
        expect(text).toContain('Projection structure');
        expect(text).toContain('Weak co-occurrence');
        expect(text).toContain('Document atom');
        expect(text).toContain('Fact vertex');
        expect(text).not.toContain('Graph node types');
    });
});
