import * as THREE from 'three';
import { describe, expect, it } from 'vitest';

import { DEFAULT_GALAXY_SETTINGS } from './graph-galaxy-engine';
import { buildGalaxyFocusMask } from './graph-galaxy-focus';
import { GraphGalaxyParticles } from './graph-galaxy-particles';
import type { GalaxySceneV2 } from './graph-galaxy-scene-v2';

describe('GraphGalaxyParticles', () => {
    it('renders a bounded particle for every edge using the destination node color', () => {
        const scene = particleScene();
        const particles = new GraphGalaxyParticles();
        const settings = { ...DEFAULT_GALAXY_SETTINGS, particleFlow: true, particleSpeed: 0, particleOpacity: 1 };

        particles.bind(scene, settings);
        particles.update(scene, scene.positions3d, settings, 0);

        const material = particles.points.material as THREE.ShaderMaterial;
        const color = particles.points.geometry.getAttribute('color') as THREE.BufferAttribute;
        const size = particles.points.geometry.getAttribute('flowSize') as THREE.BufferAttribute;
        expect(material.fragmentShader).toContain('gl_PointCoord');
        expect(color.count).toBe(2);
        expect(material.uniforms['uBaseSize'].value).toBeGreaterThan(4);
        expect(material.uniforms['uBaseSize'].value).toBeLessThan(5);
        expect(size.getX(0)).toBeGreaterThan(0.7);
        expect(size.getX(0)).toBeLessThan(0.75);
        expect(color.getX(0)).toBeCloseTo(0.1, 5);
        expect(color.getY(0)).toBeCloseTo(0.8, 5);
        expect(color.getZ(0)).toBeCloseTo(1, 5);
        expect(color.getX(1)).toBeCloseTo(0.9, 5);
        expect(color.getY(1)).toBeCloseTo(0.2, 5);
        expect(color.getZ(1)).toBeCloseTo(0.7, 5);

        particles.dispose();
    });

    it('follows the curved edge path and hides non-focused flow on hover', () => {
        const scene = particleScene();
        const particles = new GraphGalaxyParticles();
        const settings = { ...DEFAULT_GALAXY_SETTINGS, particleFlow: true, particleSpeed: 0, particleOpacity: 1, edgeMode: 'curved' as const };
        const focus = buildGalaxyFocusMask(scene, 'a', null);

        particles.bind(scene, settings);
        particles.update(scene, scene.positions3d, settings, 0, focus);

        const position = particles.points.geometry.getAttribute('position') as THREE.BufferAttribute;
        const alpha = particles.points.geometry.getAttribute('alpha') as THREE.BufferAttribute;
        expect(position.getY(0)).toBeGreaterThan(0);
        expect(alpha.getX(0)).toBeGreaterThan(0);
        expect(alpha.getX(1)).toBe(0);

        particles.dispose();
    });

    it('focuses Caps selection through structural ancestors instead of semantic hubs', () => {
        const scene = structuralCapsScene();
        const focus = buildGalaxyFocusMask(scene, 'kai', null);

        expect([...focus.edgeLevels]).toEqual([2, 2, 2, 0]);
        expect(focus.nodeLevels[0]).toBeGreaterThan(0);
        expect(focus.nodeLevels[1]).toBeGreaterThan(0);
        expect(focus.nodeLevels[2]).toBeGreaterThan(0);
        expect(focus.nodeLevels[3]).toBe(3);
        expect(focus.nodeLevels[4]).toBe(0);
    });

    it('keeps Caps particles on spherical shell edges without affecting map paths', () => {
        const scene = capsParticleScene();
        const particles = new GraphGalaxyParticles();
        const settings = { ...DEFAULT_GALAXY_SETTINGS, particleFlow: true, particleSpeed: 0, particleOpacity: 1, edgeMode: 'straight' as const };
        const probe = particles as unknown as { seeds: number[] };

        particles.bind(scene, settings);
        probe.seeds[0] = 0.5;
        particles.update(scene, scene.positions3d, settings, 0);

        const position = particles.points.geometry.getAttribute('position') as THREE.BufferAttribute;
        expect(Math.hypot(position.getX(0), position.getY(0), position.getZ(0))).toBeCloseTo(2.08);
        expect(position.getX(0)).toBeGreaterThan(1.4);
        expect(position.getY(0)).toBeGreaterThan(1.4);

        particles.update(scene, scene.positions2d, settings, 0);
        expect(position.getX(0)).toBeCloseTo(1.04);
        expect(position.getY(0)).toBeCloseTo(1.04);

        particles.dispose();
    });

    it('matches shell-aware Caps and Hybrid surface routing for particles', () => {
        const settings = { ...DEFAULT_GALAXY_SETTINGS, particleFlow: true, particleSpeed: 0, particleOpacity: 1, edgeMode: 'straight' as const };
        const caps = capsParticleScene(0.98);
        const hybrid = { ...capsParticleScene(2.32), layoutMode: 'hybridSpace' as const };
        const particles = new GraphGalaxyParticles();
        const probe = particles as unknown as { seeds: number[] };

        particles.bind(caps, settings);
        probe.seeds[0] = 0.5;
        particles.update(caps, caps.positions3d, settings, 0);
        let position = particles.points.geometry.getAttribute('position') as THREE.BufferAttribute;
        expect(Math.hypot(position.getX(0), position.getY(0), position.getZ(0))).toBeCloseTo(0.98);

        caps.positions3d = new Float32Array([1.34, 0, 0, 0, 1.48, 0]);
        particles.update(caps, caps.positions3d, settings, 0);
        position = particles.points.geometry.getAttribute('position') as THREE.BufferAttribute;
        expect(position.getX(0)).toBeCloseTo(0.67);
        expect(position.getY(0)).toBeCloseTo(0.74);

        particles.bind(hybrid, settings);
        probe.seeds[0] = 0.5;
        particles.update(hybrid, hybrid.positions3d, settings, 0);
        position = particles.points.geometry.getAttribute('position') as THREE.BufferAttribute;
        expect(Math.hypot(position.getX(0), position.getY(0), position.getZ(0))).toBeCloseTo(2.32);

        hybrid.positions3d = new Float32Array([2.32, 0, 0, 0, 1.74, 0]);
        particles.update(hybrid, hybrid.positions3d, settings, 0);
        position = particles.points.geometry.getAttribute('position') as THREE.BufferAttribute;
        expect(position.getX(0)).toBeCloseTo(1.16);
        expect(position.getY(0)).toBeCloseTo(0.87);

        particles.dispose();
    });
});

function particleScene(): GalaxySceneV2 {
    return {
        sourceMode: 'embeddings',
        layoutMode: 'productManifold',
        ids: ['a', 'b', 'c'],
        labels: ['A', 'B', 'C'],
        kinds: ['character', 'location', 'network'],
        groupIds: ['', '', ''],
        groups: [],
        hopfRibbons: [],
        lorentzGuides: [],
        positions3d: new Float32Array([0, 0, 0, 2, 0, 0, 4, 0, 0]),
        positions2d: new Float32Array([0, 0, 0, 2, 0, 0, 4, 0, 0]),
        radii: new Float32Array([0.08, 0.08, 0.08]),
        colors: new Float32Array([1, 0, 0, 0.1, 0.8, 1, 0.9, 0.2, 0.7]),
        edgePairs: new Uint32Array([0, 1, 1, 2]),
        edgeColors: new Float32Array([
            1, 0, 0, 0.1, 0.8, 1,
            0.1, 0.8, 1, 0.9, 0.2, 0.7,
        ]),
        edgeAlpha: new Float32Array([1, 1]),
        edgeKinds: new Uint8Array([0, 0]),
    };
}

function capsParticleScene(radius = 2.08): GalaxySceneV2 {
    return {
        ...particleScene(),
        layoutMode: 'lorentzTree',
        ids: ['a', 'b'],
        labels: ['A', 'B'],
        kinds: ['character', 'location'],
        groupIds: ['', ''],
        positions3d: new Float32Array([radius, 0, 0, 0, radius, 0]),
        positions2d: new Float32Array([radius, 0, 0, 0, radius, 0]),
        radii: new Float32Array([0.08, 0.08]),
        colors: new Float32Array([1, 0, 0, 0.1, 0.8, 1]),
        edgePairs: new Uint32Array([0, 1]),
        edgeColors: new Float32Array([1, 0, 0, 0.1, 0.8, 1]),
        edgeAlpha: new Float32Array([1]),
        edgeKinds: new Uint8Array([0]),
    };
}

function structuralCapsScene(): GalaxySceneV2 {
    return {
        ...particleScene(),
        layoutMode: 'lorentzTree',
        ids: ['doc', 'root', 'chunk', 'kai', 'rowan'],
        labels: ['Document', 'Identity root', 'Chunk 1', 'Kai', 'Rowan'],
        kinds: ['note', 'structureRoot', 'chunk', 'character', 'character'],
        groupIds: ['', '', '', '', ''],
        positions3d: new Float32Array([
            0, 0, 2.08,
            0, 0, 1.92,
            0, 0, 1.72,
            0, 0, 1.42,
            1.42, 0, 0,
        ]),
        positions2d: new Float32Array([
            0, 0, 2.08,
            0, 0, 1.92,
            0, 0, 1.72,
            0, 0, 1.42,
            1.42, 0, 0,
        ]),
        radii: new Float32Array([0.08, 0.08, 0.08, 0.08, 0.08]),
        colors: new Float32Array([
            0.1, 0.8, 1,
            0.1, 0.8, 1,
            0.1, 0.8, 1,
            0.9, 0.2, 0.7,
            0.9, 0.2, 0.7,
        ]),
        edgePairs: new Uint32Array([0, 1, 1, 2, 2, 3, 3, 4]),
        edgeColors: new Float32Array(4 * 6),
        edgeAlpha: new Float32Array([1, 1, 1, 1]),
        edgeKinds: new Uint8Array([2, 2, 2, 0]),
    };
}
