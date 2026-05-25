import { describe, expect, it } from 'vitest';

import { mergeGalaxySettings } from './graph-galaxy-engine';
import { galaxySettingsNeedSceneRebuild } from './graph-galaxy-canvas.component';

describe('GraphGalaxyCanvasComponent settings rebuild routing', () => {
    it('rebuilds the compiled scene when topology lens changes', () => {
        const previous = mergeGalaxySettings({ embeddingTopologyMode: 'off' });
        const current = mergeGalaxySettings({ embeddingTopologyMode: 'regions' });

        expect(galaxySettingsNeedSceneRebuild(previous, current)).toBe(true);
    });

    it('keeps renderer-only settings on the cheap path', () => {
        const previous = mergeGalaxySettings({ labelMode: 'hover' });
        const current = mergeGalaxySettings({ labelMode: 'always' });

        expect(galaxySettingsNeedSceneRebuild(previous, current)).toBe(false);
    });
});
