import { describe, expect, it } from 'vitest';
import { buildWritingWorkbench } from './writing-lenses';
import { getEmptyAnalytics } from './text-analytics';

describe('buildWritingWorkbench', () => {
    it('detects negation and distance markers with highlight ranges', () => {
        const text = 'No one moved. She did not look away, but Kai felt the room change.';
        const workbench = buildWritingWorkbench(text, getEmptyAnalytics());

        const negation = workbench.itemsByLens.negation;
        const distance = workbench.itemsByLens.distance;

        expect(negation.map(item => item.label)).toContain('no');
        expect(negation.map(item => item.label)).toContain('not');
        expect(negation.find(item => item.label === 'not X but Y')?.ranges[0].text)
            .toContain('not look away, but');
        expect(distance.find(item => item.label === 'felt')?.ranges[0])
            .toMatchObject({ text: 'felt' });
    });

    it('turns ornament pressure into sentence-level edit rows', () => {
        const text = 'The old weight of memory moved through the room like a second weather.';
        const workbench = buildWritingWorkbench(text, getEmptyAnalytics());

        expect(workbench.itemsByLens.ornament[0]).toEqual(expect.objectContaining({
            lensId: 'ornament',
            highlightKind: 'ornament',
            count: expect.any(Number),
        }));
        expect(workbench.itemsByLens.ornament[0].ranges[0].text).toBe(text);
    });

    it('summarizes existing analytics into overview chips', () => {
        const analytics = {
            ...getEmptyAnalytics(),
            flowScore: 91,
            keywordDensity: [{ word: 'still', count: 14, percentage: 0.9 }],
        };
        const workbench = buildWritingWorkbench('still still', analytics);

        expect(workbench.overview).toEqual(expect.arrayContaining([
            expect.objectContaining({ label: 'Flow', value: '91%' }),
            expect.objectContaining({ label: 'Echo', value: '14' }),
        ]));
        expect(workbench.summaries.find(lens => lens.id === 'keyword')?.count).toBe(14);
    });
});
