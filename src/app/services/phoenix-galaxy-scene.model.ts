export interface PhoenixGalaxySceneSettings {
    edgeLength: number;
    nodeDistance: number;
}

export interface PhoenixGalaxySceneEntity {
    id: string;
    label: string;
    kind: string;
    totalMentions?: number;
    atlasX?: number;
    atlasY?: number;
    atlasZ?: number;
    colorHsl?: string;
}

export interface PhoenixGalaxySceneEdge {
    id: string;
    sourceId: string;
    targetId: string;
    type: string;
    confidence: number;
}

export interface PhoenixGalaxySceneRequest {
    entities: PhoenixGalaxySceneEntity[];
    edges: PhoenixGalaxySceneEdge[];
    settings: PhoenixGalaxySceneSettings;
}

export interface PhoenixGalaxySceneEntityRef {
    id: string;
    label: string;
    kind: string;
    totalMentions?: number;
}

export interface PhoenixGalaxySceneNode {
    entity: PhoenixGalaxySceneEntityRef;
    x: number;
    y: number;
    z: number;
    baseX: number;
    baseY: number;
    baseZ: number;
    radius: number;
    r: number;
    g: number;
    b: number;
}

export interface PhoenixGalaxySceneLink {
    id: string;
    source: number;
    target: number;
    type: string;
    confidence: number;
    alpha: number;
    curve: number;
    flowOffset: number;
}

export interface PhoenixGalaxyScene {
    nodes: PhoenixGalaxySceneNode[];
    links: PhoenixGalaxySceneLink[];
}
