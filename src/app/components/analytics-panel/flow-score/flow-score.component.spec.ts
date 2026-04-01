import '@angular/compiler';
import {
    Injector,
    createEnvironmentInjector,
    runInInjectionContext,
    type EnvironmentInjector,
} from '@angular/core';
import { describe, expect, it } from 'vitest';

import { FlowScoreComponent } from './flow-score.component';

describe('FlowScoreComponent', () => {
    it('tracks sentence availability across all six variation buckets', () => {
        const injector: EnvironmentInjector = createEnvironmentInjector([], Injector.create({ providers: [] }));
        const component = runInInjectionContext(injector, () => new FlowScoreComponent());

        (component as any).sentences = () => [
            {
                id: 'sentence:0',
                paragraphIndex: 0,
                sentenceIndex: 0,
                from: 0,
                to: 4,
                wordCount: 1,
                bucket: '1',
                snippet: 'Hi.',
            },
            {
                id: 'sentence:1',
                paragraphIndex: 0,
                sentenceIndex: 1,
                from: 5,
                to: 20,
                wordCount: 6,
                bucket: '2-6',
                snippet: 'A short sentence.',
            },
            {
                id: 'sentence:2',
                paragraphIndex: 0,
                sentenceIndex: 2,
                from: 21,
                to: 48,
                wordCount: 8,
                bucket: '7-15',
                snippet: 'A medium-sized sentence lives here.',
            },
        ];

        expect(component.categories).toHaveLength(6);
        expect(component.hasSentences('1')).toBe(true);
        expect(component.hasSentences('2-6')).toBe(true);
        expect(component.hasSentences('7-15')).toBe(true);
        expect(component.hasSentences('16-25')).toBe(false);
        expect(component.hasSentences('26-39')).toBe(false);
        expect(component.hasSentences('40+')).toBe(false);

        injector.destroy();
    });
});
