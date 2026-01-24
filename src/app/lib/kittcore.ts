// src/app/lib/kittcore.ts
import type { DecorationSpan } from './Scanner/types';

export interface EntitySpan {
    id?: string;
    label: string;
    start: number;
    end: number;
}

export interface ExtractedRelation {
    subject: string;
    predicate: string;
    object: string;
    kind: string; // e.g. "PARTICIPATES_IN"
    confidence: number;
}

export interface KittCoreService {
    scan(content: string, entities: EntitySpan[]): Promise<{ relations: any[], triples: any[] }>;
    extractRelations(content: string, entities: EntitySpan[]): Promise<ExtractedRelation[]>;
    scanImplicitRust(content: string, narrativeId?: string): Promise<DecorationSpan[]>;
    scanDiscovery(content: string): Promise<{ token: string; score: number; status: number }[]>;
}

// Mock Implementation
export const kittCore: KittCoreService = {
    scan: async (_content, _entities) => ({ relations: [], triples: [] }),
    extractRelations: async (_content, _entities) => [],
    scanImplicitRust: async (_content, _narrativeId) => [],
    scanDiscovery: async (_content) => []
};
