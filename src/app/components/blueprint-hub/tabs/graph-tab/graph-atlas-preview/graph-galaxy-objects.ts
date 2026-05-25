import * as THREE from 'three';

import type { GalaxyRenderSettings } from './graph-galaxy-engine';
import type { GalaxySceneV2 } from './graph-galaxy-scene-v2';

export type GalaxyNodeObject = THREE.Sprite | THREE.Mesh;

export function buildGalaxyNodes(scene: GalaxySceneV2, settings: GalaxyRenderSettings, nodeTexture: THREE.Texture, atomTexture: THREE.Texture): THREE.Group | null {
    if (!scene.ids.length) return null;
    const group = new THREE.Group();
    const productAtom = settings.nodeShape === 'atom' && scene.layoutMode === 'productManifold';
    for (let index = 0; index < scene.ids.length; index++) {
        const material = settings.nodeShape === 'sphere'
            ? new THREE.MeshBasicMaterial({
                color: 0xffffff,
                transparent: true,
                opacity: 0.92,
                depthWrite: false,
                depthTest: true,
                toneMapped: false,
            })
            : new THREE.SpriteMaterial({
                map: settings.nodeShape === 'atom' ? atomTexture : nodeTexture,
                color: 0xffffff,
                transparent: true,
                opacity: productAtom ? 0.98 : 0.96,
                alphaTest: productAtom ? 0.055 : 0,
                depthWrite: false,
                depthTest: true,
                blending: THREE.NormalBlending,
                toneMapped: false,
            });
        const object: GalaxyNodeObject = settings.nodeShape === 'sphere'
            ? new THREE.Mesh(new THREE.SphereGeometry(1, 16, 10), material as THREE.MeshBasicMaterial)
            : new THREE.Sprite(material as THREE.SpriteMaterial);
        object.userData['index'] = index;
        group.add(object);
    }
    return group;
}

export function buildGalaxyGlows(scene: GalaxySceneV2, haloTexture: THREE.Texture): THREE.Group | null {
    if (!scene.ids.length) return null;
    const group = new THREE.Group();
    for (let index = 0; index < scene.ids.length; index++) {
        const material = new THREE.SpriteMaterial({
            map: haloTexture,
            color: 0xffffff,
            transparent: true,
            opacity: 0.38,
            depthWrite: false,
            depthTest: false,
            blending: THREE.NormalBlending,
            toneMapped: false,
        });
        const sprite = new THREE.Sprite(material);
        sprite.userData['index'] = index;
        group.add(sprite);
    }
    return group;
}
