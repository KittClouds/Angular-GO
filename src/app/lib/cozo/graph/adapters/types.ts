
export type RelationshipSource =
    | 'user'
    | 'extraction'
    | 'llm'
    | 'pattern'
    | 'folder'
    | 'hierarchy'
    | 'MANUAL'
    | 'NER_EXTRACTION'
    | 'LLM_EXTRACTION'
    | 'FOLDER_STRUCTURE'
    | 'CO_OCCURRENCE'
    | 'IMPORT'
    | 'TIMELINE'
    | 'NETWORK';

export interface RelationshipProvenance {
    source: string; // broadened from RelationshipSource to allow strings
    originId: string;
    confidence: number;
    timestamp: Date;
    context?: string;
}

export interface UnifiedRelationship {
    id: string;
    sourceEntityId: string;
    targetEntityId: string;
    type: string;
    inverseType?: string;
    bidirectional?: boolean;
    confidence: number;
    confidenceBySource?: Partial<Record<string, number>>;
    provenance: RelationshipProvenance[];
    namespace?: string;
    attributes?: Record<string, any>;
    createdAt: Date;
    updatedAt: Date;
}

export interface RelationshipInput {
    sourceEntityId: string;
    targetEntityId: string;
    type: string;
    inverseType?: string;
    bidirectional?: boolean;
    provenance: RelationshipProvenance[];
    namespace?: string;
    attributes?: Record<string, any>;
}

export interface RelationshipQuery {
    sourceId?: string;
    targetId?: string;
    entityId?: string;
    type?: string | string[];
    namespace?: string;
    minConfidence?: number;
    sources?: string[];
    offset?: number;
    limit?: number;
}

export interface RelationshipStats {
    total: number;
    byType: Record<string, number>;
    bySource: Record<string, number>;
    byNamespace: Record<string, number>;
    averageConfidence: number;
}
