import type { GalaxySceneV2 } from './graph-galaxy-scene-v2';
import type { GalaxyRenderSettings } from './graph-galaxy-engine';

export type GraphRendererMode = '3d' | '2d';

export interface GraphRendererPointer {
    x: number;
    y: number;
    width: number;
    height: number;
}

export interface GraphRendererPort {
    mount(canvas: HTMLCanvasElement): void;
    setScene(scene: GalaxySceneV2): void;
    setSettings(settings: Partial<GalaxyRenderSettings> | null): void;
    setMode(mode: GraphRendererMode): void;
    resize(width: number, height: number, dpr: number): void;
    render(): void;
    rotate(deltaX: number, deltaY: number): void;
    pan(deltaX: number, deltaY: number): void;
    zoom(delta: number): void;
    resetCamera(): void;
    fitToGraph(): void;
    focusNode(id: string): void;
    beginNodeDrag(id: string): boolean;
    dragNode(deltaX: number, deltaY: number): boolean;
    endNodeDrag(): boolean;
    tickForces(): boolean;
    hasActiveForces(): boolean;
    selectNode(id: string | null): void;
    hoverNode(id: string | null): void;
    pick(pointer: GraphRendererPointer): string | null;
    dispose(): void;
}
